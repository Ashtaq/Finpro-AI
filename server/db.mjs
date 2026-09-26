import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clients, compliance, demoUsers, documents, knowledgeBase, organizations, projects, tasks } from "./seed.mjs";

const root=process.env.FINOTECH_DATA_DIR||path.resolve(process.cwd(),"server/data");
fs.mkdirSync(root,{recursive:true});
const db=new Database(path.join(root,"finotech.local.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
const hash=(value)=>crypto.createHash("sha256").update(String(value)).digest("hex");

export function migrateAndSeed(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY,name TEXT NOT NULL,plan TEXT NOT NULL,users INTEGER NOT NULL DEFAULT 0,active_projects INTEGER NOT NULL DEFAULT 0,documents_processed INTEGER NOT NULL DEFAULT 0,ai_requests INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('Super Admin','Admin','Finance User')),professional_role TEXT NOT NULL,organization_id TEXT NOT NULL,organization_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
    CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT NOT NULL,industry TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',fy TEXT NOT NULL,status TEXT NOT NULL,team TEXT NOT NULL,projects INTEGER NOT NULL DEFAULT 0,documents INTEGER NOT NULL DEFAULT 0,organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,client_id TEXT NOT NULL,client_name TEXT NOT NULL,type TEXT NOT NULL,fy TEXT NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,priority TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,team_json TEXT NOT NULL DEFAULT '[]',tags_json TEXT NOT NULL DEFAULT '[]',organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id),FOREIGN KEY (client_id) REFERENCES clients(id));
    CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,size TEXT NOT NULL,status TEXT NOT NULL,uploaded_by TEXT NOT NULL,uploaded_at TEXT NOT NULL,project_id TEXT NOT NULL,organization_id TEXT NOT NULL,pages INTEGER,storage_key TEXT,mime_type TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id),FOREIGN KEY (project_id) REFERENCES projects(id));
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,title TEXT NOT NULL,client TEXT NOT NULL,project TEXT NOT NULL,assignee TEXT NOT NULL,priority TEXT NOT NULL,due TEXT NOT NULL,status TEXT NOT NULL,organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(organization_id,status);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT,agent_id TEXT NOT NULL,title TEXT NOT NULL DEFAULT 'New conversation',organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (user_id) REFERENCES users(id),FOREIGN KEY (project_id) REFERENCES projects(id),FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at TEXT NOT NULL,evidence_json TEXT,calculation TEXT,assumptions_json TEXT,limitations TEXT,FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
    CREATE TABLE IF NOT EXISTS conversation_files (conversation_id TEXT NOT NULL,document_id TEXT NOT NULL,PRIMARY KEY (conversation_id,document_id),FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,FOREIGN KEY (document_id) REFERENCES documents(id));
    CREATE TABLE IF NOT EXISTS compliance_items (id TEXT PRIMARY KEY,title TEXT NOT NULL,client TEXT NOT NULL,due_date TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE TABLE IF NOT EXISTS knowledge_items (id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,owner TEXT NOT NULL,updated TEXT NOT NULL,organization_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,timestamp TEXT NOT NULL,organization_id TEXT NOT NULL,metadata_json TEXT,FOREIGN KEY (organization_id) REFERENCES organizations(id));
    CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs(organization_id,timestamp);
    CREATE TABLE IF NOT EXISTS settings (organization_id TEXT PRIMARY KEY,data_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (organization_id) REFERENCES organizations(id));
  `);
  const addOrg=db.prepare("INSERT OR IGNORE INTO organizations(id,name,plan,users,active_projects,documents_processed,ai_requests) VALUES (?,?,?,?,?,?,?)");
  // Super Admin is platform-scoped, so always ensure its FK target exists.
  addOrg.run("platform","Finotech AI Platform","Enterprise",0,0,0,0);
  if(db.prepare("SELECT COUNT(*) c FROM organizations WHERE id<>'platform'").get().c>0)return;
  const tx=db.transaction(()=>{
    organizations.forEach(o=>addOrg.run(o.id,o.name,o.plan,o.users,o.activeProjects,o.documentsProcessed,o.aiRequests));
    const addUser=db.prepare("INSERT INTO users(id,name,email,password_hash,role,professional_role,organization_id,organization_name) VALUES (?,?,?,?,?,?,?,?)");
    demoUsers.forEach(u=>addUser.run(u.id,u.name,u.email,hash("demo123"),u.role,u.professionalRole,u.organizationId,u.organizationName));
    const addClient=db.prepare("INSERT INTO clients(id,name,company,industry,email,phone,fy,status,team,projects,documents,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    clients.forEach(c=>addClient.run(c.id,c.name,c.company,c.industry,c.email,c.phone,c.fy,c.status,c.team,c.projects,c.documents,"org-1"));
    const addProject=db.prepare("INSERT INTO projects(id,name,client_id,client_name,type,fy,currency,status,priority,start_date,end_date,team_json,tags_json,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    projects.forEach(p=>addProject.run(p.id,p.name,p.clientId,p.clientName,p.type,p.fy,p.currency,p.status,p.priority,p.startDate,p.endDate,JSON.stringify(p.team),JSON.stringify(p.tags),"org-1"));
    const addDoc=db.prepare("INSERT INTO documents(id,name,type,size,status,uploaded_by,uploaded_at,project_id,organization_id,pages) VALUES (?,?,?,?,?,?,?,?,?,?)");
    documents.forEach(d=>addDoc.run(d.id,d.name,d.type,d.size,d.status,d.uploadedBy,d.uploadedAt,d.projectId,"org-1",d.pages||null));
    const addTask=db.prepare("INSERT INTO tasks(id,title,client,project,assignee,priority,due,status,organization_id) VALUES (?,?,?,?,?,?,?,?,?)");
    tasks.forEach(t=>addTask.run(t.id,t.title,t.client,t.project,t.assignee,t.priority,t.due,t.status,"org-1"));
    const addCompliance=db.prepare("INSERT INTO compliance_items(id,title,client,due_date,category,status,organization_id) VALUES (?,?,?,?,?,?,?)");
    compliance.forEach(c=>addCompliance.run(c.id,c.title,c.client,c.dueDate,c.category,c.status,"org-1"));
    const addKb=db.prepare("INSERT INTO knowledge_items(id,title,kind,owner,updated,organization_id) VALUES (?,?,?,?,?,?)");
    knowledgeBase.forEach(k=>addKb.run(k.id,k.title,k.kind,k.owner,k.updated,"org-1"));
  });
  tx();
}
migrateAndSeed();
export { db };
