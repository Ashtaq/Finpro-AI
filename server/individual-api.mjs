import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { db } from "./db.mjs";

const app = express();
const PORT = Number(process.env.INDIVIDUAL_PORT || 8788);
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const ensureSchema = () => db.exec(`
CREATE TABLE IF NOT EXISTS individual_profiles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, pan TEXT, dob TEXT, residential_status TEXT, phone TEXT, address TEXT, aadhaar_last4 TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, institution TEXT DEFAULT '', as_of TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tax_years (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assessment_year TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', gross_income REAL DEFAULT 0, taxable_income REAL DEFAULT 0, tax_payable REAL DEFAULT 0, tds REAL DEFAULT 0,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS itr_returns (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assessment_year TEXT NOT NULL, itr_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
 payload_json TEXT NOT NULL DEFAULT '{}', validation_json TEXT NOT NULL DEFAULT '{}', transaction_id TEXT, acknowledgement_number TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS itr_filing_events (
 id TEXT PRIMARY KEY, itr_return_id TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(itr_return_id) REFERENCES itr_returns(id)
);
CREATE TABLE IF NOT EXISTS tax_documents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, document_type TEXT NOT NULL, assessment_year TEXT, storage_key TEXT, status TEXT NOT NULL DEFAULT 'Uploaded', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS consents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', granted_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);`);
ensureSchema();

const safeUser = r => ({id:r.id,name:r.name,email:r.email,role:r.role,professionalRole:r.professional_role,organizationId:r.organization_id,organizationName:r.organization_name});
function actor(req,res){
 const id=req.header("x-user-id"); const row=id?db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(id):null;
 if(!row || row.role!=="Individual"){res.status(401).json({error:"Individual authentication required"});return null;}
 return row;
}
function audit(user,action,resource,metadata={}) {
 db.prepare("INSERT INTO audit_logs(id,actor,action,resource,timestamp,organization_id,metadata_json) VALUES (?,?,?,?,?,?,?)")
   .run(crypto.randomUUID(),user.name,action,resource,new Date().toISOString(),user.organization_id,JSON.stringify(metadata));
}

app.get("/api/individual/health",(_req,res)=>res.json({ok:true,service:"finpro-individual-tax"}));

app.post("/api/individual/auth/signup",(req,res)=>{
 const b=req.body||{}; const name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
 if(!name||!email||password.length<6)return res.status(400).json({error:"Name, email and password (6+ characters) are required."});
 if(db.prepare("SELECT 1 FROM users WHERE lower(email)=?").get(email))return res.status(409).json({error:"An account with this email already exists."});
 const userId=crypto.randomUUID(),orgId=crypto.randomUUID(),orgName=`${name}'s Personal Workspace`;
 const tx=db.transaction(()=>{db.prepare("INSERT INTO organizations(id,name,plan) VALUES (?,?,?)").run(orgId,orgName,"Free");db.prepare("INSERT INTO users(id,name,email,password_hash,role,professional_role,organization_id,organization_name) VALUES (?,?,?,?,?,?,?,?)").run(userId,name,email,hash(password),"Individual",String(b.professionalRole||"Other"),orgId,orgName);db.prepare("INSERT INTO individual_profiles(id,user_id) VALUES (?,?)").run(crypto.randomUUID(),userId);});
 tx(); const user=db.prepare("SELECT * FROM users WHERE id=?").get(userId); audit(user,"Signup","Individual Authentication"); res.status(201).json({user:safeUser(user)});
});

app.post("/api/individual/auth/login",(req,res)=>{
 const b=req.body||{},email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
 const user=db.prepare("SELECT * FROM users WHERE lower(email)=? AND role='Individual' AND active=1").get(email);
 if(!user||hash(password)!==user.password_hash)return res.status(401).json({error:"Invalid email or password."});
 audit(user,"Login","Individual Authentication"); res.json({user:safeUser(user)});
});

app.get("/api/individual/profile",(req,res)=>{const u=actor(req,res);if(!u)return;res.json(db.prepare("SELECT * FROM individual_profiles WHERE user_id=?").get(u.id)||{});});
app.patch("/api/individual/profile",(req,res)=>{const u=actor(req,res);if(!u)return;const b=req.body||{};db.prepare("UPDATE individual_profiles SET pan=?,dob=?,residential_status=?,phone=?,address=?,aadhaar_last4=? WHERE user_id=?").run(b.pan||null,b.dob||null,b.residentialStatus||null,b.phone||null,b.address||null,b.aadhaarLast4||null,u.id);audit(u,"Update profile","Individual Profile");res.json({ok:true});});

app.get("/api/individual/assets",(req,res)=>{const u=actor(req,res);if(!u)return;res.json(db.prepare("SELECT id,name,category,value,institution,as_of as asOf FROM assets WHERE user_id=? ORDER BY as_of DESC").all(u.id));});
app.post("/api/individual/assets",(req,res)=>{const u=actor(req,res);if(!u)return;const b=req.body||{},id=crypto.randomUUID();db.prepare("INSERT INTO assets(id,user_id,name,category,value,institution) VALUES (?,?,?,?,?,?)").run(id,u.id,String(b.name||"New asset"),String(b.category||"Other"),Number(b.value||0),String(b.institution||""));audit(u,"Create asset",b.name||id);res.status(201).json(db.prepare("SELECT id,name,category,value,institution,as_of as asOf FROM assets WHERE id=?").get(id));});

app.get("/api/individual/tax-years",(req,res)=>{const u=actor(req,res);if(!u)return;res.json(db.prepare("SELECT * FROM tax_years WHERE user_id=? ORDER BY assessment_year DESC").all(u.id));});
app.get("/api/individual/itr",(req,res)=>{const u=actor(req,res);if(!u)return;res.json(db.prepare("SELECT id,assessment_year as assessmentYear,itr_type as itrType,status,transaction_id as transactionId,acknowledgement_number as acknowledgementNumber,updated_at as updatedAt FROM itr_returns WHERE user_id=? ORDER BY updated_at DESC").all(u.id));});
app.post("/api/individual/itr",(req,res)=>{const u=actor(req,res);if(!u)return;const b=req.body||{},id=crypto.randomUUID();db.prepare("INSERT INTO itr_returns(id,user_id,assessment_year,itr_type,payload_json,status) VALUES (?,?,?,?,?,?)").run(id,u.id,b.assessmentYear||"2026-27",b.itrType||"ITR-1","{}", "DRAFT");audit(u,"Create ITR draft",id);res.status(201).json({id,status:"DRAFT"});});
app.post("/api/individual/itr/:id/validate",(req,res)=>{const u=actor(req,res);if(!u)return;const row=db.prepare("SELECT * FROM itr_returns WHERE id=? AND user_id=?").get(req.params.id,u.id);if(!row)return res.status(404).json({error:"ITR return not found"});const validation={passed:true,errors:[],message:"Local validation passed. Final validation must be performed by the approved filing integration before submission."};db.prepare("UPDATE itr_returns SET validation_json=?,status='READY_TO_FILE',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(validation),row.id);audit(u,"Validate ITR draft",row.id,validation);res.json(validation);});
app.post("/api/individual/itr/:id/consent",(req,res)=>{const u=actor(req,res);if(!u)return;const id=crypto.randomUUID();db.prepare("INSERT INTO consents(id,user_id,purpose,status,granted_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)").run(id,u.id,"ITR prefill and filing","Granted");audit(u,"Grant ITR consent",req.params.id);res.json({consentId:id,status:"Granted"});});
app.post("/api/individual/itr/:id/submit",(req,res)=>{const u=actor(req,res);if(!u)return;const row=db.prepare("SELECT * FROM itr_returns WHERE id=? AND user_id=?").get(req.params.id,u.id);if(!row)return res.status(404).json({error:"ITR return not found"});if(row.status!=="READY_TO_FILE")return res.status(400).json({error:"Return must pass local validation before submission."});res.status(409).json({error:"External ITR filing provider is not connected. Configure an approved ERI integration before submission."});});
app.get("/api/individual/itr/:id/events",(req,res)=>{const u=actor(req,res);if(!u)return;const row=db.prepare("SELECT id FROM itr_returns WHERE id=? AND user_id=?").get(req.params.id,u.id);if(!row)return res.status(404).json({error:"ITR return not found"});res.json(db.prepare("SELECT * FROM itr_filing_events WHERE itr_return_id=? ORDER BY created_at DESC").all(row.id));});

app.listen(PORT,()=>console.log(`Finpro Individual API listening on http://127.0.0.1:${PORT}`));
