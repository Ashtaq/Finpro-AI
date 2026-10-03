export type KycVerification = {
  verified:boolean;
  provider:"digilocker"|"mock";
  digilockerId?:string;
  aadhaarVerified:boolean;
  panVerified:boolean;
  name?:string;
  dob?:string;
  aadhaarLast4?:string;
  panLast4?:string;
};

async function request<T>(path:string, options:RequestInit={}):Promise<T>{
  const response=await fetch(path,{
    ...options,
    headers:{"Content-Type":"application/json",...(options.headers||{})}
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error||`Request failed (${response.status})`);
  return body as T;
}

export async function startDigiLockerKyc(name:string,dob:string,pan:string){
  return request<{authorizationUrl:string}>("/api/kyc/digilocker/start",{
    method:"POST",
    body:JSON.stringify({name,dob,pan})
  });
}

export async function getDigiLockerKycResult(ref:string){
  return request<KycVerification>(`/api/kyc/digilocker/result/${encodeURIComponent(ref)}`);
}

export async function verifyPanDev(pan:string,name:string,dob:string){
  return request<KycVerification>("/api/kyc/pan/verify",{
    method:"POST",
    body:JSON.stringify({pan,name,dob})
  });
}
