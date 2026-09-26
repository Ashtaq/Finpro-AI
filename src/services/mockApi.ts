import { agents, clients, compliance, demoUsers, documents, organizations, projects, tasks, usage } from "../data/mockData";
import { AnalysisResult, ChatMessage, DocumentRecord, ProfessionalRole, Role, Task, User } from "../types";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const USERS_KEY = "finotech_users";
const TASKS_KEY = "finotech_tasks";
const CHAT_KEY = "finotech_chat_history";

type StoredUser = User & { password: string };

const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

function localUsers(): StoredUser[] {
  try {
    const saved = localStorage.getItem(USERS_KEY);
    if (saved) return JSON.parse(saved) as StoredUser[];
  } catch {}
  const seeded = demoUsers.map((u) => ({ ...u, password: "demo123" }));
  localStorage.setItem(USERS_KEY, JSON.stringify(seeded));
  return seeded;
}

function localTasks(): Task[] {
  try {
    const saved = localStorage.getItem(TASKS_KEY);
    if (saved) return JSON.parse(saved) as Task[];
  } catch {}
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  return [...tasks];
}

async function request<T>(path: string, options: RequestInit = {}, actorId?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (actorId) headers.set("x-user-id", actorId);
  const response = await fetch(`${API_BASE}${path}`, {...options, headers});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

async function hasBackend() {
  if (!API_BASE && typeof window !== "undefined") {
    try {
      const response = await fetch("/api/health", { signal: AbortSignal.timeout(500) });
      return response.ok;
    } catch {}
  }
  try { const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(500) }); return response.ok; } catch { return false; }
}

export async function login(email: string, password: string, role: Role): Promise<User> {
  if (await hasBackend()) {
    const result = await request<{user: User}>("/api/auth/login", {method:"POST", body:JSON.stringify({email,password,role})});
    return result.user;
  }
  await delay(250);
  const existing = localUsers().find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.role === role);
  if (!existing || existing.password !== password) throw new Error("Invalid email, password, or role.");
  const { password: _password, ...safe } = existing;
  return safe;
}

export async function signup(name: string, email: string, password: string, professionalRole: ProfessionalRole): Promise<User> {
  if (await hasBackend()) {
    const result = await request<{user: User}>("/api/auth/signup", {method:"POST", body:JSON.stringify({name,email,password,professionalRole})});
    return result.user;
  }
  await delay(200);
  const users = localUsers();
  const normalized = email.trim().toLowerCase();
  if (users.some((u) => u.email.toLowerCase() === normalized)) throw new Error("An account with this email already exists.");
  const next: StoredUser = {id:`u-${Date.now()}`,name:name.trim(),email:email.trim(),professionalRole,role:"Finance User",organizationId:"org-1",organizationName:"Meridian Advisory LLP",password};
  localStorage.setItem(USERS_KEY, JSON.stringify([...users,next]));
  const {password:_password,...safe}=next; return safe;
}

export async function listManagedUsers(actor: User): Promise<User[]> {
  if (await hasBackend()) return request<User[]>("/api/users", {}, actor.id);
  await delay(80);
  return localUsers().filter((u)=>actor.role==="Super Admin"?u.id!==actor.id:u.organizationId===actor.organizationId&&u.role==="Finance User").map(({password:_password,...u})=>u);
}

export async function createManagedUser(actor: User, input: {name:string;email:string;professionalRole:ProfessionalRole;role:Role;password:string;organizationId?:string}) {
  if (await hasBackend()) return request<User>("/api/users",{method:"POST",body:JSON.stringify(input)},actor.id);
  const users=localUsers(); if(actor.role!=="Super Admin"&&input.role!=="Finance User")throw new Error("Admins can create Finance User accounts only.");
  const orgId=input.organizationId||actor.organizationId; if(actor.role!=="Super Admin"&&orgId!==actor.organizationId)throw new Error("You can only create users in your organization.");
  if(users.some((u)=>u.email.toLowerCase()===input.email.trim().toLowerCase()))throw new Error("An account with this email already exists.");
  const org=organizations.find((o)=>o.id===orgId);
  const next:StoredUser={id:`u-${Date.now()}`,name:input.name.trim(),email:input.email.trim(),professionalRole:input.professionalRole,role:input.role,organizationId:orgId,organizationName:org?.name||actor.organizationName,password:input.password};
  localStorage.setItem(USERS_KEY,JSON.stringify([...users,next])); const {password:_password,...safe}=next; return safe;
}

export async function updateManagedUser(actor: User,targetId:string,patch:Partial<Pick<User,"name"|"email"|"professionalRole"|"role">>) {
  if(await hasBackend())return request<User>(`/api/users/${targetId}`,{method:"PATCH",body:JSON.stringify(patch)},actor.id);
  const users=localUsers();const target=users.find((u)=>u.id===targetId);if(!target)throw new Error("User not found.");
  const allowed=actor.role==="Super Admin"&&target.id!==actor.id||actor.role==="Admin"&&target.organizationId===actor.organizationId&&target.role==="Finance User";if(!allowed)throw new Error("You are not authorized to manage this user.");
  const updated={...target,...patch} as StoredUser;users[users.findIndex((u)=>u.id===targetId)]=updated;localStorage.setItem(USERS_KEY,JSON.stringify(users));const {password:_password,...safe}=updated;return safe;
}

export async function deleteManagedUser(actor:User,targetId:string) {
  if(await hasBackend()){await request<void>(`/api/users/${targetId}`,{method:"DELETE"},actor.id);return;}
  const users=localUsers();const target=users.find((u)=>u.id===targetId);if(!target)throw new Error("User not found.");
  const allowed=actor.role==="Super Admin"&&target.id!==actor.id||actor.role==="Admin"&&target.organizationId===actor.organizationId&&target.role==="Finance User";if(!allowed)throw new Error("You are not authorized to manage this user.");
  localStorage.setItem(USERS_KEY,JSON.stringify(users.filter((u)=>u.id!==targetId)));
}

export async function resetManagedUserPassword(actor:User,targetId:string,password:string) {
  if(await hasBackend()){await request<void>(`/api/users/${targetId}/reset-password`,{method:"POST",body:JSON.stringify({password})},actor.id);return;}
  const users=localUsers();const i=users.findIndex((u)=>u.id===targetId);if(i<0)throw new Error("User not found.");users[i].password=password;localStorage.setItem(USERS_KEY,JSON.stringify(users));
}

export async function fetchDashboard(role:Role) {
  const saved=localStorage.getItem("finotech_saas_user");const actor=saved?JSON.parse(saved) as User:null;
  if(actor&&await hasBackend())return request<any>("/api/dashboard",{},actor.id);
  await delay(50);const current=localTasks();return {role,clients:clients.length,activeProjects:projects.filter((p)=>p.status==="Active").length,documents:documents.length+88,aiAnalyses:role==="Super Admin"?286:186,reports:64,pendingTasks:current.filter((t)=>t.status!=="Completed").length,upcomingDeadlines:compliance.filter((c)=>c.status!=="Overdue").length,aiUsage:usage.aiRequests};
}

export async function analyzeFinancials():Promise<AnalysisResult>{return {revenue:118.4,expenses:91.2,ebitda:27.2,ebitdaMargin:23,currentRatio:1.84,debtToEquity:0.62,roe:18.7,freeCashFlow:21.6,trend:[92,101,108,114,118,126]};}

export type AssistantRequest={message:string;agentId:string;projectId?:string;fileIds?:string[];history?:ChatMessage[]};

async function backendAssistant(request:AssistantRequest,actor:User):Promise<AsyncGenerator<string>> {
  const conversationKey="finotech_ai_conversation";
  let conversationId=sessionStorage.getItem(conversationKey);
  if(!conversationId){const c=await request<{id:string}>("/api/assistant/conversations",{method:"POST",body:JSON.stringify({projectId:request.projectId||null,agentId:request.agentId,title:request.message.slice(0,80)})},actor.id);conversationId=c.id;sessionStorage.setItem(conversationKey,conversationId);}
  const result=await request<{content:string}>(`/api/assistant/conversations/${conversationId}/messages`,{method:"POST",body:JSON.stringify({message:request.message})},actor.id);
  async function* generator(){for(const chunk of result.content.split(/(\s+)/)){await delay(8);yield chunk;}}
  return generator();
}

function localAssistantResponse(request:AssistantRequest){
  const agent=agents.find((a)=>a.id===request.agentId)||agents[0], project=projects.find((p)=>p.id===request.projectId), sourceDocs=documents.filter((d)=>(request.fileIds||[]).includes(d.id)||(project&&d.projectId===project.id)).slice(0,4), source=sourceDocs[0];
  return `I’m operating as the ${agent.name} ${project?`for ${project.name} (${project.clientName})`:"for the current finance workspace"}.

Question: “${request.message}”

Answer: The browser fallback can use project and document metadata, but it cannot truthfully calculate values from file contents without a server-side parser and LLM.

Calculation: Revenue growth = (Current period − Prior period) / Prior period × 100.

Source: ${source?source.name:"No project document selected"}.

Evidence: ${sourceDocs.length?sourceDocs.map((d)=>d.name).join(", "):"No evidence attached"}.

Assumptions: Source figures are complete, consistently classified and approved for analysis.

Limitations: Local fallback mode is demo-only; use the SQLite API for persistent Phase 1 data.`;
}
export async function streamAssistantReply(requestOrMessage:string|AssistantRequest,agentId?:string,projectId?:string,fileIds:string[]=[]):Promise<AsyncGenerator<string>> {
  const request:AssistantRequest=typeof requestOrMessage==="string"?{message:requestOrMessage,agentId:agentId||agents[0].id,projectId,fileIds}:requestOrMessage;
  const saved=localStorage.getItem("finotech_saas_user");const actor=saved?JSON.parse(saved) as User:null;
  if(actor&&await hasBackend())return backendAssistant(request,actor);
  const response=localAssistantResponse(request);async function* generator(){for(const chunk of response.split(/(\s+)/)){await delay(8);yield chunk;}}return generator();
}

export async function createDocument(fileName:string,projectId:string):Promise<DocumentRecord>{
  const saved=localStorage.getItem("finotech_saas_user");const actor=saved?JSON.parse(saved) as User:null;
  if(actor&&await hasBackend())return request<DocumentRecord>("/api/documents",{method:"POST",body:JSON.stringify({name:fileName,projectId,size:"Uploaded"})},actor.id);
  await delay(150);return {id:`d-${Date.now()}`,name:fileName,type:fileName.split(".").pop()?.toUpperCase()||"FILE",size:"Uploaded",status:"Completed",uploadedBy:"Current User",uploadedAt:new Date().toISOString().slice(0,10),projectId,pages:1};
}

export async function getTasks():Promise<Task[]> {
  const saved=localStorage.getItem("finotech_saas_user");const actor=saved?JSON.parse(saved) as User:null;
  if(actor&&await hasBackend())return request<Task[]>("/api/tasks",{},actor.id);
  return localTasks();
}
export async function updateTaskStatus(actor:User,taskId:string,status:Task["status"]):Promise<Task>{
  if(await hasBackend())return request<Task>(`/api/tasks/${taskId}`,{method:"PATCH",body:JSON.stringify({status})},actor.id);
  const rows=localTasks(),task=rows.find((t)=>t.id===taskId);if(!task)throw new Error("Task not found.");const updated={...task,status};localStorage.setItem(TASKS_KEY,JSON.stringify(rows.map((t)=>t.id===taskId?updated:t)));return updated;
}

export async function getAssistantHistory(user:User):Promise<ChatMessage[]> {
  if(await hasBackend())return request<ChatMessage[]>("/api/assistant/history",{},user.id);
  try{const saved=localStorage.getItem(CHAT_KEY);return saved?JSON.parse(saved) as ChatMessage[]:[]}catch{return [];}
}
export async function saveAssistantHistory(_user:User,messages:ChatMessage[]){
  if(await hasBackend())return;
  localStorage.setItem(CHAT_KEY,JSON.stringify(messages.slice(-100)));
}

export async function getStaticData(){return {organizations,clients,projects,documents,agents,tasks:localTasks(),compliance,knowledgeBase:[],workflows:[],auditLogs:[],usage};}
