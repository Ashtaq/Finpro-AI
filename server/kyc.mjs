import crypto from "node:crypto";

export const kycMode=process.env.KYC_MODE||"digilocker";
const env=(key, fallback="")=>process.env[key]||fallback;

const urls={
 authorize:env("DIGILOCKER_AUTH_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize"),
 token:env("DIGILOCKER_TOKEN_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/1/token"),
 user:env("DIGILOCKER_USER_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/1/user"),
 issuedDocs:env("DIGILOCKER_ISSUED_DOCS_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/2/entity/files/issued"),
 docXml:env("DIGILOCKER_DOCUMENT_XML_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/1/entity/xml/uri"),
 aadhaarXml:env("DIGILOCKER_AADHAAR_XML_URL","https://digilocker.meripehchaan.gov.in/public/oauth2/3/xml/eaadhaar")
};

const normalize=(value)=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
const maskLast4=(value)=>String(value||"").replace(/\D/g,"").slice(-4);
const normalizeDob=(value)=>{
  const v=String(value||"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
  if(/^\d{2}-\d{2}-\d{4}$/.test(v)){const [d,m,y]=v.split("-");return y+"-"+m+"-"+d;}
  if(/^\d{8}$/.test(v))return v.slice(4)+"-"+v.slice(2,4)+"-"+v.slice(0,2);
  return v;
};

function parseTag(text, tag, attr){
  const re=new RegExp("<"+tag+"\\b[^>]*\\b"+attr+"=[\\\"]([^\\\"]*)[\\\"]","i");
  return re.exec(text)?.[1]||"";
}
function findPan(xml){
  const patterns=[
    /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
    /\bPAN(?:\\s*NUMBER)?\\s*[:=]\\s*([A-Z0-9]{10})\b/i
  ];
  for(const re of patterns){const m=re.exec(String(xml||""));if(m)return (m[1]||m[0]).toUpperCase();}
  return "";
}
function findAadhaarLast4(xml){
  const patterns=[/\b\d{4}\s+\d{4}\s+\d{4}\b/,/\b\d{12}\b/];
  for(const re of patterns){const m=re.exec(String(xml||""));if(m)return maskLast4(m[0]);}
  return "";
}
async function get(url, token){
  const response=await fetch(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json,application/xml,text/xml"}});
  const text=await response.text();
  if(!response.ok)throw new Error("DigiLocker request failed ("+response.status+")");
  try{return {data:JSON.parse(text),raw:text};}catch{return {data:null,raw:text};}
}
export function createPkceVerifier(){return crypto.randomBytes(48).toString("base64url");}
export function createPkceChallenge(verifier){return crypto.createHash("sha256").update(verifier).digest("base64url");}
export function createKycState(){return crypto.randomBytes(32).toString("hex");}

export function buildAuthorizationUrl({state,codeChallenge,name,dob,pan}){
  const url=new URL(urls.authorize);
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",env("DIGILOCKER_CLIENT_ID"));
  url.searchParams.set("redirect_uri",env("DIGILOCKER_REDIRECT_URI","http://localhost:8787/api/kyc/digilocker/callback"));
  url.searchParams.set("state",state);
  url.searchParams.set("code_challenge",codeChallenge);
  url.searchParams.set("code_challenge_method","S256");
  url.searchParams.set("scope",env("DIGILOCKER_SCOPE","files.issueddocs"));
  url.searchParams.set("req_doctype",env("DIGILOCKER_REQ_DOCTYPE","ADHAR,PANCR"));
  url.searchParams.set("purpose",env("DIGILOCKER_PURPOSE","kyc"));
  url.searchParams.set("consent_valid_till",new Date(Date.now()+15*60*1000).toISOString());
  if(name)url.searchParams.set("name",name);
  if(dob)url.searchParams.set("dob",dob);
  if(pan)url.searchParams.set("pan",pan);
  return url.toString();
}

export async function exchangeCode(code,verifier){
  const body=new URLSearchParams({
    code,
    grant_type:"authorization_code",
    client_id:env("DIGILOCKER_CLIENT_ID"),
    client_secret:env("DIGILOCKER_CLIENT_SECRET"),
    redirect_uri:env("DIGILOCKER_REDIRECT_URI","http://localhost:8787/api/kyc/digilocker/callback"),
    code_verifier:verifier
  });
  const response=await fetch(urls.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw new Error(data.error_description||data.error||"DigiLocker token exchange failed");
  return data.access_token;
}

export async function verifyDigiLockerIdentity({token,claimedName,claimedDob,claimedPan}){
  const userResponse=await get(urls.user,token);
  const user=userResponse.data||{};
  const issuedResponse=await get(urls.issuedDocs,token).catch(()=>({data:{},raw:""}));
  const docs=Array.isArray(issuedResponse.data?.items)?issuedResponse.data.items:(Array.isArray(issuedResponse.data?.documents)?issuedResponse.data.documents:[]);
  const panDoc=docs.find((d)=>String(d.doctype||d.type||"").toUpperCase()==="PANCR" || /pan/i.test(String(d.name||d.description||"")));
  if(!panDoc)throw new Error("A PAN Card issued by the Income Tax Department was not found in the DigiLocker account.");

  let panXml="";
  const panUri=panDoc.uri||panDoc.documentUri||panDoc.url||"";
  if(panUri){
    const target=new URL(urls.docXml);
    target.searchParams.set("uri",panUri);
    panXml=(await get(target.toString(),token).catch(()=>({raw:""}))).raw||"";
  }

  let aadhaarXml="";
  const hasEaadhaar=String(user.eaadhaar||user.eAadhaar||"").toUpperCase()==="Y" || docs.some((d)=>String(d.doctype||d.type||"").toUpperCase()==="ADHAR");
  if(hasEaadhaar){
    aadhaarXml=(await get(urls.aadhaarXml,token).catch(()=>({raw:""}))).raw||"";
  }

  const returnedName=String(user.name||parseTag(panXml,"Person","name")||parseTag(aadhaarXml,"Poi","name")||"").trim();
  const returnedDob=normalizeDob(user.dob||parseTag(panXml,"Person","dob")||parseTag(aadhaarXml,"Poi","dob")||"");
  const panFromDoc=findPan(panXml);
  const panMatches=claimedPan?(!panFromDoc || normalize(panFromDoc)===normalize(claimedPan)):Boolean(panFromDoc);
  const nameMatches=!claimedName || !returnedName || normalize(returnedName)===normalize(claimedName);
  const dobMatches=!claimedDob || !returnedDob || normalizeDob(returnedDob)===normalizeDob(claimedDob);

  return {
    verified:Boolean(panDoc && hasEaadhaar && panMatches && nameMatches && dobMatches),
    provider:"digilocker",
    digilockerId:user.digilockerid||user.digilockerId||user.id||undefined,
    aadhaarVerified:Boolean(hasEaadhaar),
    panVerified:Boolean(panDoc && panMatches),
    name:returnedName||undefined,
    dob:returnedDob||undefined,
    aadhaarLast4:findAadhaarLast4(aadhaarXml)||undefined,
    panLast4:maskLast4(panFromDoc||claimedPan)||undefined,
    metadata:{panIssuer:panDoc.issuer||panDoc.issuerName||"Income Tax Department"}
  };
}

export function validateLocalKyc({name,dob,pan}){
  const panOk=/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(String(pan||"").trim());
  const nameOk=String(name||"").trim().length>=2;
  const dobOk=/^\d{4}-\d{2}-\d{2}$/.test(normalizeDob(dob));
  return {
    verified:panOk&&nameOk&&dobOk,
    provider:"mock",
    aadhaarVerified:true,
    panVerified:panOk,
    name:String(name||"").trim(),
    dob:normalizeDob(dob),
    aadhaarLast4:"0000",
    panLast4:maskLast4(pan),
    metadata:{mode:"mock",warning:"Development-only KYC simulation. Not valid for production identity proof."}
  };
}

export const kycConfig={mode:kycMode,configured:Boolean(env("DIGILOCKER_CLIENT_ID")&&env("DIGILOCKER_CLIENT_SECRET")),urls};
