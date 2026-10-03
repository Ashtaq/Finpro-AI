import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { db } from "./db.mjs";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: "20mb" }));

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const rowToUser = (r) => ({id:r.id,name:r.name,email:r.email,role:r.role,professionalRole:r.professional_role,organizationId:r.organization_id,organizationName:r.organization_name});
const parseProject = (r) => ({id:r.id,name:r.name,clientId:r.client_id,clientName:r.client_name,type:r.type,fy:r.fy,currency:r.currency,status:r.status,priority:r.priority,startDate:r.start_date,endDate:r.end_date,team:JSON.parse(r.team_json||"[]"),tags:JSON.parse(r.tags_json||"[]")});
const parseDocument = (r) => ({id:r.id,name:r.name,type:r.type,size:r.size,status:r.status,uploadedBy:r.uploaded_by,uploadedAt:r.uploaded_at,clientId:r.client_id,projectId:r.project_id,pages:r.pages});
const parseTask = (r) => ({id:r.id,title:r.title,client:r.client,project:r.project,assignee:r.assignee,priority:r.priority,due:r.due,status:r.status});
const parseCompliance = (r) => ({id:r.id,title:r.title,client:r.client,dueDate:r.due_date,category:r.category,status:r.status});
const parseKnowledge = (r) => ({id:r.id,title:r.title,kind:r.kind,owner:r.owner,updated:r.updated});

function audit(actor, action, resource, metadata={}) {
  if (!actor) return;
  db.prepare("INSERT INTO audit_logs(id,actor,action,resource,timestamp,organization_id,metadata_json) VALUES (?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(),actor.name,action,resource,new Date().toISOString(),actor.organization_id,JSON.stringify(metadata));
}
function auth(req,res) {
  const id=req.header("x-user-id");
  const actor=id?db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(id):null;
  if(!actor){res.status(401).json({error:"Authentication required"});return null;}
  return actor;
}
function orgQuery(actor, table, order="created_at DESC") { return db.prepare(`SELECT * FROM ${table} WHERE organization_id=? ORDER BY ${order}`).all(actor.organization_id); }

app.get("/api/health",(_req,res)=>res.json({ok:true,service:"finotech-local-api",database:"sqlite",storage:"local-disk",time:new Date().toISOString()}));

app.post("/api/auth/login",(req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||""), role=String(req.body?.role||"");
  const actor=db.prepare("SELECT * FROM users WHERE lower(email)=? AND role=? AND active=1").get(email,role);
  if(!actor || hash(password)!==actor.password_hash)return res.status(401).json({error:"Invalid email, password, or role."});
  audit(actor,"Login","Authentication"); res.json({user:rowToUser(actor)});
});

app.post("/api/auth/signup",(req,res)=>{
  const name=String(req.body?.name||"").trim(), email=String(req.body?.email||"").trim(), password=String(req.body?.password||""), professionalRole=String(req.body?.professionalRole||"Other");
  if(!name||!email||password.length<6)return res.status(400).json({error:"Name, email and password (6+ characters) are required."});
  if(db.prepare("SELECT 1 FROM users WHERE lower(email)=?").get(email.toLowerCase()))return res.status(409).json({error:"An account with this email already exists."});
  const organizationId=crypto.randomUUID(), organizationName=`${name}'s Finance Workspace`, userId=crypto.randomUUID();
  db.prepare("INSERT INTO organizations(id,name,plan) VALUES (?,?,?)").run(organizationId,organizationName,"Professional");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,professional_role,organization_id,organization_name) VALUES (?,?,?,?,?,?,?,?)").run(userId,name,email,hash(password),role,professionalRole,organizationId,organizationName);
  const actor=db.prepare("SELECT * FROM users WHERE id=?").get(userId); audit(actor,"Signup","Authentication");
  res.status(201).json({user:rowToUser(actor)});
});

app.get("/api/dashboard",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;
  const scoped=(base)=>`${base} WHERE organization_id=?`;
  const args=[actor.organization_id];
  const count=(sql,a=args)=>db.prepare(sql).get(...a)?.c||0;
  res.json({
    role:actor.role,
    clients:count(`SELECT COUNT(*) c FROM clients${scoped("")}`),
    activeProjects:count(`SELECT COUNT(*) c FROM projects WHERE status='Active'${" AND organization_id=?"}`),
    documents:count(`SELECT COUNT(*) c FROM documents${scoped("")}`),
    aiAnalyses:count("SELECT COUNT(*) c FROM messages WHERE role='assistant'"),
    reports:0,
    pendingTasks:count(`SELECT COUNT(*) c FROM tasks WHERE status!='Completed'${" AND organization_id=?"}`),
    upcomingDeadlines:count(`SELECT COUNT(*) c FROM compliance_items WHERE status!='Overdue'${" AND organization_id=?"}`),
    aiUsage:count(`SELECT COALESCE(SUM(ai_requests),0) c FROM organizations${scoped("")}`)
  });
});

app.get("/api/users",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;
  if(actor.role!=="Professional User")return res.status(403).json({error:"Only Professional Users can manage workspace users."});
  const rows=db.prepare("SELECT * FROM users WHERE organization_id=? AND id<>? AND active=1 ORDER BY created_at DESC").all(actor.organization_id,actor.id);
  res.json(rows.map(rowToUser));
});
app.post("/api/users",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const b=req.body||{};
  if(actor.role!=="Professional User"||!["Finance User","Professional User"].includes(String(b.role)))return res.status(403).json({error:"Only Professional Users can create Finance User or Professional User accounts."});
  const orgId=String(b.organizationId||actor.organization_id);
  if(actor.role!=="Professional User"&&orgId!==actor.organization_id)return res.status(403).json({error:"You can only create users in your organization."});
  const org=db.prepare("SELECT id,name FROM organizations WHERE id=?").get(orgId);
  if(!org)return res.status(400).json({error:"Organization not found."});
  if(!String(b.name||"").trim()||!String(b.email||"").trim()||String(b.password||"").length<6)return res.status(400).json({error:"Name, email and password (6+ characters) are required."});
  if(db.prepare("SELECT 1 FROM users WHERE lower(email)=?").get(String(b.email).trim().toLowerCase()))return res.status(409).json({error:"An account with this email already exists."});
  const id=crypto.randomUUID();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,professional_role,organization_id,organization_name) VALUES (?,?,?,?,?,?,?,?)").run(id,String(b.name).trim(),String(b.email).trim(),hash(b.password),String(b.role),String(b.professionalRole||"Other"),orgId,org.name);
  const created=db.prepare("SELECT * FROM users WHERE id=?").get(id);audit(actor,"Create user",created.email,{role:created.role,organizationId:orgId});
  res.status(201).json(rowToUser(created));
});
app.patch("/api/users/:id",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  const allowed=actor.role==="Professional User"&&target.id!==actor.id&&target.organization_id===actor.organization_id&&(target.role==="Finance User"||target.role==="Professional User");
  if(!allowed)return res.status(403).json({error:"You are not authorized to manage this user."});
  const b=req.body||{};if(actor.role!=="Professional User"&&b.role)return res.status(403).json({error:"Only Professional Users can change workspace roles."});
  if(b.role&&!["Finance User","Professional User"].includes(String(b.role)))return res.status(400).json({error:"Invalid workspace role."});
  if(b.email&&db.prepare("SELECT 1 FROM users WHERE lower(email)=? AND id<>?").get(String(b.email).trim().toLowerCase(),target.id))return res.status(409).json({error:"Another account already uses this email."});
  db.prepare("UPDATE users SET name=COALESCE(?,name),email=COALESCE(?,email),professional_role=COALESCE(?,professional_role),role=COALESCE(?,role),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.name??null,b.email??null,b.professionalRole??null,b.role??null,target.id);
  const updated=db.prepare("SELECT * FROM users WHERE id=?").get(target.id);audit(actor,"Update user",updated.email);res.json(rowToUser(updated));
});
app.delete("/api/users/:id",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  const allowed=actor.role==="Professional User"&&target.id!==actor.id&&target.organization_id===actor.organization_id&&(target.role==="Finance User"||target.role==="Professional User");
  if(!allowed)return res.status(403).json({error:"You are not authorized to manage this user."});
  db.prepare("UPDATE users SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(target.id);audit(actor,"Deactivate user",target.email);res.status(204).end();
});
app.post("/api/users/:id/reset-password",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const target=db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  const allowed=actor.role==="Professional User"&&target.id!==actor.id&&target.organization_id===actor.organization_id&&(target.role==="Finance User"||target.role==="Professional User");
  if(!allowed)return res.status(403).json({error:"You are not authorized to manage this user."});
  const password=String(req.body?.password||"");if(password.length<6)return res.status(400).json({error:"Password must be at least 6 characters."});
  db.prepare("UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hash(password),target.id);audit(actor,"Reset password",target.email);res.status(204).end();
});

app.get("/api/clients",(req,res)=>{const actor=auth(req,res);if(!actor)return;if(actor.role!=="Professional User")return res.status(403).json({error:"Client management is available to Professional Users only."});res.json(orgQuery(actor,"clients"));});
app.post("/api/clients",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;if(actor.role!=="Professional User")return res.status(403).json({error:"Client management is available to Professional Users only."});const b=req.body||{};if(!String(b.company||"").trim())return res.status(400).json({error:"Company name is required."});
  const row={id:crypto.randomUUID(),name:String(b.name||"New contact").trim(),company:String(b.company).trim(),industry:String(b.industry||"Technology"),email:String(b.email||""),phone:String(b.phone||""),fy:String(b.fy||"FY 2025-26"),status:String(b.status||"Onboarding"),team:String(b.team||"New Coverage"),projects:0,documents:0};
  db.prepare("INSERT INTO clients(id,name,company,industry,email,phone,fy,status,team,projects,documents,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(row.id,row.name,row.company,row.industry,row.email,row.phone,row.fy,row.status,row.team,0,0,actor.organization_id);
  audit(actor,"Create client",row.company);res.status(201).json(row);
});

app.get("/api/projects",(req,res)=>{const actor=auth(req,res);if(!actor)return;if(actor.role==="Individual")return res.status(403).json({error:"Project workspace is not available to Individual users."});res.json(orgQuery(actor,"projects").map(parseProject));});
app.get("/api/documents",(req,res)=>{const actor=auth(req,res);if(!actor)return;res.json(orgQuery(actor,"documents").map(parseDocument));});
app.post("/api/documents",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const b=req.body||{};
  const project=db.prepare("SELECT * FROM projects WHERE id=? AND organization_id=?").get(b.projectId,actor.organization_id);
  if(!project)return res.status(404).json({error:"Project not found."});
  if(!String(b.name||"").trim())return res.status(400).json({error:"File name is required."});
  const id=crypto.randomUUID(), uploadedAt=new Date().toISOString().slice(0,10);
  db.prepare("INSERT INTO documents(id,name,type,size,status,uploaded_by,uploaded_at,client_id,project_id,organization_id,pages,storage_key,mime_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,b.name,String(b.name).split(".").pop()?.toUpperCase()||"FILE",String(b.size||"Uploaded"),"Completed",actor.name,uploadedAt,project.client_id,b.projectId,actor.organization_id,Number(b.pages||1),b.storageKey||null,b.mimeType||null);
  const out=parseDocument(db.prepare("SELECT * FROM documents WHERE id=?").get(id));audit(actor,"File upload",out.name,{projectId:b.projectId});res.status(201).json(out);
});
app.get("/api/tasks",(req,res)=>{const actor=auth(req,res);if(!actor)return;res.json(orgQuery(actor,"tasks","due ASC").map(parseTask));});
app.patch("/api/tasks/:id",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const target=db.prepare("SELECT * FROM tasks WHERE id=? AND organization_id=?").get(req.params.id,actor.organization_id);
  if(!target)return res.status(404).json({error:"Task not found."});const status=String(req.body?.status||"");
  if(!["To Do","In Progress","Review","Completed"].includes(status))return res.status(400).json({error:"Invalid task status."});
  db.prepare("UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,target.id);audit(actor,"Task status update",target.title,{status});
  res.json(parseTask(db.prepare("SELECT * FROM tasks WHERE id=?").get(target.id)));
});
app.get("/api/compliance",(req,res)=>{const actor=auth(req,res);if(!actor)return;res.json(orgQuery(actor,"compliance_items","due_date ASC").map(parseCompliance));});
app.get("/api/knowledge-base",(req,res)=>{const actor=auth(req,res);if(!actor)return;res.json(orgQuery(actor,"knowledge_items","updated DESC").map(parseKnowledge));});
app.get("/api/audit-logs",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;
  const rows=db.prepare("SELECT * FROM audit_logs WHERE organization_id=? ORDER BY timestamp DESC LIMIT 250").all(actor.organization_id);
  res.json(rows.map(r=>({...r,metadata:r.metadata_json?JSON.parse(r.metadata_json):{}})));
});

app.post("/api/assistant/conversations",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;const b=req.body||{},projectId=b.projectId||null;
  if(projectId&&!db.prepare("SELECT 1 FROM projects WHERE id=? AND organization_id=?").get(projectId,actor.organization_id))return res.status(403).json({error:"Project is outside your organization."});
  const id=crypto.randomUUID();db.prepare("INSERT INTO conversations(id,user_id,project_id,agent_id,title,organization_id) VALUES (?,?,?,?,?,?)").run(id,actor.id,projectId,String(b.agentId||"finance"),String(b.title||"New conversation"),actor.organization_id);
  audit(actor,"Create AI conversation",String(b.title||"New conversation"),{projectId,agentId:b.agentId});res.status(201).json({id});
});
app.get("/api/assistant/history",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;
  const rows=db.prepare("SELECT m.id,m.role,m.content,m.created_at,m.evidence_json,m.calculation,m.assumptions_json,m.limitations FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=? AND c.organization_id=? ORDER BY m.created_at DESC LIMIT 100").all(actor.id,actor.organization_id);
  res.json(rows.reverse().map(m=>({id:m.id,role:m.role,content:m.content,createdAt:m.created_at,evidence:m.evidence_json?JSON.parse(m.evidence_json):undefined,calculation:m.calculation,assumptions:m.assumptions_json?JSON.parse(m.assumptions_json):undefined,limitations:m.limitations||undefined})));
});
app.post("/api/assistant/conversations/:id/messages",(req,res)=>{
  const actor=auth(req,res);if(!actor)return;
  const convo=db.prepare("SELECT * FROM conversations WHERE id=? AND user_id=? AND organization_id=?").get(req.params.id,actor.id,actor.organization_id);
  if(!convo)return res.status(404).json({error:"Conversation not found."});
  const message=String(req.body?.message||"").trim();if(!message)return res.status(400).json({error:"Message is required."});
  const now=new Date().toISOString();db.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)").run(crypto.randomUUID(),convo.id,"user",message,now);
  const docs=convo.project_id?db.prepare("SELECT name FROM documents WHERE project_id=? AND organization_id=? ORDER BY uploaded_at DESC LIMIT 4").all(convo.project_id,actor.organization_id):[];
  const source=docs[0]?.name||"No project document selected";
  const answer=[`I’m operating as the ${convo.agent_id} for the selected finance project.`,"",`Question: “${message}”`,"","Answer: The Phase 1 backend persists this conversation and project context in SQLite. Source-grounded numeric extraction still requires the production document parser and LLM integration.","","Calculation: Revenue growth = (Current period − Prior period) / Prior period × 100.","",`Source: ${source}.`,"","Assumptions: Source figures are complete, consistently classified and approved for analysis.","","Limitations: Phase 1 stores structured metadata and chat history locally; binary XLSX/CSV/PDF/DOCX parsing and a production model endpoint remain Phase 2 integrations."].join("
");
  const assistantId=crypto.randomUUID();db.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at,limitations) VALUES (?,?,?,?,?,?)").run(assistantId,convo.id,"assistant",answer,new Date().toISOString(),"Production LLM and binary document parsing are Phase 2 integrations.");
  db.prepare("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(convo.id);db.prepare("UPDATE organizations SET ai_requests=ai_requests+1 WHERE id=?").run(actor.organization_id);
  audit(actor,"AI request",`Conversation ${convo.id}`,{agent:convo.agent_id,projectId:convo.project_id});
  res.json({id:assistantId,role:"assistant",content:answer,createdAt:new Date().toISOString(),limitations:"Production LLM and binary document parsing are Phase 2 integrations."});
});

app.get("/api/settings",(req,res)=>{const actor=auth(req,res);if(!actor)return;const row=db.prepare("SELECT data_json FROM settings WHERE organization_id=?").get(actor.organization_id);res.json(row?JSON.parse(row.data_json):{});});
app.put("/api/settings",(req,res)=>{const actor=auth(req,res);if(!actor)return;const data=req.body||{};db.prepare("INSERT INTO settings(organization_id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(organization_id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP").run(actor.organization_id,JSON.stringify(data));audit(actor,"Update settings","Organization settings");res.json(data);});

const uploadRoot=process.env.FINOTECH_UPLOAD_DIR||path.resolve(process.cwd(),"server/uploads");fs.mkdirSync(uploadRoot,{recursive:true});
app.get("/api/uploads/status",(_req,res)=>res.json({configured:true,mode:"local-disk",directory:uploadRoot,note:"Use object storage and signed URLs before external production launch."}));
app.use(express.static(path.resolve(process.cwd(),"dist")));
app.get("/{*splat}",(req,res,next)=>{if(req.path.startsWith("/api/"))return next();res.sendFile(path.resolve(process.cwd(),"dist/index.html"));});
app.listen(PORT,HOST,()=>console.log(`Finotech local API listening on http://${HOST}:${PORT}`));
