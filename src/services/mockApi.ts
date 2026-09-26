import { agents, clients, compliance, demoUsers, documents, organizations, projects, tasks, usage } from "../data/mockData";
import { AnalysisResult, ChatMessage, DocumentRecord, ProfessionalRole, Role, Task, User } from "../types";

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
type StoredUser = User & { password: string };

const USERS_KEY = "finotech_users";
const TASKS_KEY = "finotech_tasks";
const CHAT_KEY = "finotech_chat_history";

function readUsers(): StoredUser[] {
  try {
    const saved = localStorage.getItem(USERS_KEY);
    if (saved) return JSON.parse(saved) as StoredUser[];
  } catch {}
  const seeded = demoUsers.map((u) => ({ ...u, password: "demo123" }));
  localStorage.setItem(USERS_KEY, JSON.stringify(seeded));
  return seeded;
}
function writeUsers(users: StoredUser[]) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
function readTasks(): Task[] {
  try {
    const saved = localStorage.getItem(TASKS_KEY);
    if (saved) return JSON.parse(saved) as Task[];
  } catch {}
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  return [...tasks];
}
function writeTasks(next: Task[]) { localStorage.setItem(TASKS_KEY, JSON.stringify(next)); }

export async function login(email: string, password: string, role: Role): Promise<User> {
  await delay(300);
  const existing = readUsers().find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.role === role);
  if (!existing || existing.password !== password) throw new Error("Invalid email, password, or role.");
  const { password: _password, ...safe } = existing;
  return safe;
}

export async function signup(name: string, email: string, professionalRole: ProfessionalRole): Promise<User> {
  await delay(250);
  const users = readUsers();
  const normalized = email.trim().toLowerCase();
  if (!name.trim() || !normalized) throw new Error("Name and email are required.");
  if (users.some((u) => u.email.toLowerCase() === normalized)) throw new Error("An account with this email already exists.");
  const next: StoredUser = { id: `u-${Date.now()}`, name: name.trim(), email: email.trim(), professionalRole, role: "Finance User", organizationId: "org-1", organizationName: "Meridian Advisory LLP", password: "welcome123" };
  writeUsers([...users, next]);
  const { password: _password, ...safe } = next;
  return safe;
}

export async function listManagedUsers(actor: User): Promise<User[]> {
  await delay(100);
  return readUsers()
    .filter((u) => actor.role === "Super Admin" ? u.id !== actor.id : u.organizationId === actor.organizationId && u.role === "Finance User")
    .map(({ password: _password, ...u }) => u);
}

function canManageUser(actor: User, target: User) {
  return actor.role === "Super Admin"
    ? target.id !== actor.id
    : actor.role === "Admin" && target.organizationId === actor.organizationId && target.role === "Finance User";
}

export async function createManagedUser(actor: User, input: { name: string; email: string; professionalRole: ProfessionalRole; role: Role; password: string; organizationId?: string }) {
  await delay(150);
  if (actor.role !== "Super Admin" && input.role !== "Finance User") throw new Error("Admins can create Finance User accounts only.");
  const organizationId = input.organizationId || actor.organizationId;
  if (actor.role !== "Super Admin" && organizationId !== actor.organizationId) throw new Error("You can only create users in your organization.");
  const users = readUsers();
  if (users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase())) throw new Error("An account with this email already exists.");
  const org = organizations.find((o) => o.id === organizationId);
  const next: StoredUser = { id: `u-${Date.now()}`, name: input.name.trim(), email: input.email.trim(), professionalRole: input.professionalRole, role: input.role, organizationId, organizationName: org?.name || actor.organizationName, password: input.password };
  writeUsers([...users, next]);
  const { password: _password, ...safe } = next;
  return safe;
}

export async function updateManagedUser(actor: User, targetId: string, patch: Partial<Pick<User, "name" | "email" | "professionalRole" | "role">>) {
  await delay(100);
  const users = readUsers();
  const target = users.find((u) => u.id === targetId);
  if (!target || !canManageUser(actor, target)) throw new Error("You are not authorized to manage this user.");
  if (actor.role === "Admin" && patch.role && patch.role !== "Finance User") throw new Error("Admins cannot change a Finance User into another role.");
  if (users.some((u) => u.id !== targetId && u.email.toLowerCase() === (patch.email || target.email).trim().toLowerCase())) throw new Error("Another account already uses this email.");
  const updated = { ...target, ...patch } as StoredUser;
  users[users.findIndex((u) => u.id === targetId)] = updated;
  writeUsers(users);
  const { password: _password, ...safe } = updated;
  return safe;
}

export async function deleteManagedUser(actor: User, targetId: string) {
  await delay(100);
  const users = readUsers();
  const target = users.find((u) => u.id === targetId);
  if (!target || !canManageUser(actor, target)) throw new Error("You are not authorized to delete this user.");
  writeUsers(users.filter((u) => u.id !== targetId));
}

export async function resetManagedUserPassword(actor: User, targetId: string, password: string) {
  await delay(100);
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  const users = readUsers();
  const target = users.find((u) => u.id === targetId);
  if (!target || !canManageUser(actor, target)) throw new Error("You are not authorized to reset this password.");
  writeUsers(users.map((u) => u.id === targetId ? { ...u, password } : u));
}

export async function fetchDashboard(role: Role) {
  await delay(80);
  const currentTasks = readTasks();
  return { role, clients: clients.length, activeProjects: projects.filter((p) => p.status === "Active").length, documents: documents.length + 88, aiAnalyses: role === "Super Admin" ? 286 : 186, reports: 64, pendingTasks: currentTasks.filter((t) => t.status !== "Completed").length, upcomingDeadlines: compliance.filter((c) => c.status !== "Overdue").length, aiUsage: usage.aiRequests };
}

export async function analyzeFinancials(): Promise<AnalysisResult> {
  await delay(350);
  return { revenue: 118.4, expenses: 91.2, ebitda: 27.2, ebitdaMargin: 23.0, currentRatio: 1.84, debtToEquity: 0.62, roe: 18.7, freeCashFlow: 21.6, trend: [92, 101, 108, 114, 118, 126] };
}

export type AssistantRequest = { message: string; agentId: string; projectId?: string; fileIds?: string[]; history?: ChatMessage[] };

function buildAssistantResponse(request: AssistantRequest) {
  const agent = agents.find((a) => a.id === request.agentId) ?? agents[0];
  const project = projects.find((p) => p.id === request.projectId);
  const sourceDocs = documents.filter((d) => (request.fileIds || []).includes(d.id) || (project && d.projectId === project.id)).slice(0, 4);
  const source = sourceDocs[0];
  return `I’m operating as the ${agent.name} ${project ? `for ${project.name} (${project.clientName})` : "for the current finance workspace"}.

Question: “${request.message}”

Answer: The browser-only demo can reason over the selected project and document metadata, but it cannot truthfully calculate values from file contents until a server-side parser/LLM is connected.

Calculation: Revenue growth = (Current period − Prior period) / Prior period × 100.

Source: ${source ? source.name + (source.pages ? `, page ${Math.min(47, source.pages)}` : "") : "No project document selected"}.

Evidence: ${sourceDocs.length ? sourceDocs.map((d) => d.name).join(", ") : "No evidence attached"}.

Assumptions: Source figures are complete, consistently classified and approved for analysis.

Limitations: Real XLSX/CSV/PDF/DOCX extraction and an LLM endpoint are not present in this frontend. Connect them server-side for source-grounded production answers.

Suggested next step: attach the relevant source files and run the same request through the production AI endpoint.`;
}

export async function streamAssistantReply(requestOrMessage: string | AssistantRequest, agentId?: string, projectId?: string, fileIds: string[] = []): Promise<AsyncGenerator<string>> {
  const request: AssistantRequest = typeof requestOrMessage === "string" ? { message: requestOrMessage, agentId: agentId || agents[0].id, projectId, fileIds } : requestOrMessage;
  const response = buildAssistantResponse(request);
  async function* generator() {
    for (const chunk of response.split(/(\s+)/)) { await delay(8); yield chunk; }
  }
  return generator();
}

export async function createDocument(fileName: string, projectId: string): Promise<DocumentRecord> {
  await delay(250);
  return { id: `d-${Date.now()}`, name: fileName, type: fileName.split(".").pop()?.toUpperCase() || "FILE", size: "Uploaded", status: "Completed", uploadedBy: "Current User", uploadedAt: new Date().toISOString().slice(0, 10), projectId, pages: 1 };
}

export async function getTasks(): Promise<Task[]> { await delay(70); return readTasks(); }
export async function updateTaskStatus(_actor: User, taskId: string, status: Task["status"]): Promise<Task> {
  const rows = readTasks();
  const task = rows.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  const updated = { ...task, status };
  writeTasks(rows.map((t) => t.id === taskId ? updated : t));
  return updated;
}
export async function getAssistantHistory(_user: User): Promise<ChatMessage[]> {
  try { const saved = localStorage.getItem(CHAT_KEY); return saved ? JSON.parse(saved) as ChatMessage[] : []; } catch { return []; }
}
export async function saveAssistantHistory(_user: User, messages: ChatMessage[]) { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-100))); }

export async function getStaticData() {
  return { organizations, clients, projects, documents, agents, tasks: readTasks(), compliance, knowledgeBase: [], workflows: [], auditLogs: [], usage };
}
