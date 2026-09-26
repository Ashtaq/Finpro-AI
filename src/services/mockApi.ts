import { agents, auditLogs, clients, compliance, demoUsers, documents, knowledgeBase, organizations, projects, tasks, usage, workflows } from "../data/mockData";
import { AnalysisResult, ChatMessage, DocumentRecord, Role, User } from "../types";

const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(email: string, _password: string, role: Role): Promise<User> {
  await delay(400);
  const existing = demoUsers.find((u) => u.role === role);
  if (!existing) throw new Error("Demo role is unavailable.");
  return { ...existing, email: email || existing.email };
}

export async function signup(name: string, email: string, professionalRole: User["professionalRole"]): Promise<User> {
  await delay(500);
  return {
    id: `new-${Date.now()}`,
    name,
    email,
    professionalRole,
    role: "Finance User",
    organizationId: "org-1",
    organizationName: "Meridian Advisory LLP"
  };
}

export async function fetchDashboard(role: Role) {
  await delay(150);
  return {
    role,
    clients: clients.length,
    activeProjects: projects.filter((p) => p.status === "Active").length,
    documents: documents.length + 88,
    aiAnalyses: 286,
    reports: 64,
    pendingTasks: tasks.filter((t) => t.status !== "Completed").length,
    upcomingDeadlines: compliance.filter((c) => c.status !== "Overdue").length,
    aiUsage: usage.aiRequests
  };
}

export async function analyzeFinancials(): Promise<AnalysisResult> {
  await delay(650);
  return {
    revenue: 118.4,
    expenses: 91.2,
    ebitda: 27.2,
    ebitdaMargin: 23.0,
    currentRatio: 1.84,
    debtToEquity: 0.62,
    roe: 18.7,
    freeCashFlow: 21.6,
    trend: [92, 101, 108, 114, 118, 126]
  };
}

export async function streamAssistantReply(
  message: string,
  agentId: string,
  _projectId?: string,
  _fileIds: string[] = []
): Promise<AsyncGenerator<string>> {
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const response =
    `I’m operating as the ${agent.name} for this demo workspace.\n\n` +
    `For “${message}”, I would combine the selected project context, authorized documents and prior conversation before producing a final professional response.\n\n` +
    `Evidence-first output:\n` +
    `• Answer: The demo indicates a positive operating trend, with the final conclusion dependent on verified source data.\n` +
    `• Calculation: Example EBITDA margin = EBITDA / Revenue × 100.\n` +
    `• Source: Aster_Annual_Report_FY25.pdf, page 47 (demo citation).\n` +
    `• Evidence: Revenue and operating performance tables are referenced before interpretation.\n` +
    `• Assumptions: Uploaded figures are complete and consistently classified.\n` +
    `• Limitations: This demo uses mock evidence; professional review is required before client delivery.\n\n` +
    `Suggested next step: validate the calculation against the underlying workbook and approved source documents.`;

  async function* generator() {
    for (const word of response.split(/(\s+)/)) {
      await delay(18);
      yield word;
    }
  }
  return generator();
}

export async function createDocument(fileName: string, projectId: string): Promise<DocumentRecord> {
  await delay(500);
  return {
    id: `d-${Date.now()}`,
    name: fileName,
    type: fileName.split(".").pop()?.toUpperCase() || "FILE",
    size: "2.4 MB",
    status: "Completed",
    uploadedBy: "Current User",
    uploadedAt: new Date().toISOString().slice(0, 10),
    projectId,
    pages: 12
  };
}

export async function getStaticData() {
  return { organizations, clients, projects, documents, agents, tasks, compliance, knowledgeBase, workflows, auditLogs, usage };
}

export type MockChatContext = {
  projectId?: string;
  agentId?: string;
  files?: string[];
  messages?: ChatMessage[];
};