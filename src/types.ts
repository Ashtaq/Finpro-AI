export type Role = "Individual" | "Finance User" | "Professional User";
export type ProfessionalRole =
  "CA" | "CS" | "CFA" | "Financial Analyst" | "Accountant" | "Auditor" | "Finance Manager" | "Investment Analyst" | "Consultant" | "Other";
export const PROFESSIONAL_ROLES: ProfessionalRole[] = [
  "CA",
  "CS",
  "CFA",
  "Financial Analyst",
  "Accountant",
  "Auditor",
  "Finance Manager",
  "Investment Analyst",
  "Consultant",
  "Other",
];

export type Priority = "High" | "Medium" | "Low";
export type ClientStatus = "Active" | "Prospect" | "Onboarding" | "Inactive" | "Archived";
export type ProjectStatus = "Draft" | "Active" | "Under Review" | "Completed" | "Archived";
export type TaskStatus = "To Do" | "In Progress" | "Review" | "Completed";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  professionalRole: ProfessionalRole;
  organizationId: string;
  organizationName?: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Meta {
  version: string;
  demo: boolean;
  ai: { enabled: boolean };
  kyc: { enabled: boolean; mode: string };
  itrFiling: { enabled: boolean };
  maxUploadBytes: number;
}

export interface Client {
  id: string;
  name: string;
  company: string;
  industry: string;
  email: string;
  phone: string;
  alternatePhone: string;
  clientType: string;
  legalName: string;
  contactPerson: string;
  pan: string;
  gstin: string;
  cin: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pinCode: string;
  professionActivity: string;
  gstRegistrationType: string;
  taxRegime: string;
  priority: Priority;
  communicationPreference: string;
  notes: string;
  fy: string;
  status: ClientStatus;
  team: string;
  projects: number;
  documents: number;
}

export interface Project {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string;
  type: string;
  fy: string;
  currency: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string;
  endDate: string;
  team: string[];
  tags: string[];
}

export interface DocumentRecord {
  id: string;
  name: string;
  type: string;
  category: string;
  sizeBytes: number;
  mimeType: string;
  status: string;
  uploadedBy: string;
  uploadedAt: string;
  clientId: string | null;
  projectId: string | null;
  projectName: string;
  clientName: string;
}

export interface Task {
  id: string;
  title: string;
  projectId: string | null;
  project: string;
  client: string;
  assigneeId: string | null;
  assignee: string;
  priority: Priority;
  due: string;
  status: TaskStatus;
}

export interface ComplianceItem {
  id: string;
  title: string;
  clientId: string | null;
  client: string;
  category: "Tax" | "Audit" | "Filing" | "Deliverable" | "Internal";
  dueDate: string;
  status: "Upcoming" | "Due Soon" | "Overdue" | "Completed";
}

export interface KnowledgeItem {
  id: string;
  title: string;
  kind: "SOP" | "Template" | "Policy" | "Report" | "Methodology";
  owner: string;
  body: string;
  updated: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  resource: string;
  timestamp: string;
  ip?: string;
  metadata: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: { documentId: string; name: string; read: boolean }[];
  limitations?: string;
  model?: string;
  pending?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  agentId: string;
  projectId: string | null;
  updatedAt: string;
}

export interface MonthPoint {
  month: string;
  value: number;
}

export interface DashboardData {
  role: Role;
  metrics: {
    clients: number;
    activeProjects: number;
    documents: number;
    aiAnalyses: number;
    pendingTasks: number;
    highPriorityTasks: number;
    upcomingDeadlines: number;
    overdueDeadlines: number;
  };
  recentProjects: Project[];
  recentClients: Client[];
  upcomingTasks: Task[];
  activity: MonthPoint[];
}

export interface IndividualAsset {
  id: string;
  name: string;
  category: string;
  value: number;
  institution: string;
  asOf: string;
}

export interface IndividualProfile {
  pan: string;
  dob: string;
  residentialStatus: "" | "Resident" | "Non-resident" | "RNOR";
  address: string;
  kycStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "FAILED";
  kycVerifiedAt?: string;
  aadhaarLast4?: string;
}

export interface ItrPayload {
  regime: "new" | "old";
  profile: { pan: string; residentialStatus: IndividualProfile["residentialStatus"]; taxpayerType: "Individual" | "Individual with business/profession" };
  income: {
    salary: number;
    houseProperty: number;
    interest: number;
    dividends: number;
    capitalGainsShortTerm: number;
    capitalGainsLongTerm: number;
    business: number;
    other: number;
  };
  deductions: { sec80C: number; sec80D: number; sec80CCD1B: number; sec80TTA: number; other: number };
  taxesPaid: { tds: number; tcs: number; advanceTax: number; selfAssessmentTax: number };
}

export interface ItrIssue {
  field: string;
  message: string;
}

export interface ItrValidation {
  passed?: boolean;
  errors?: ItrIssue[];
  warnings?: ItrIssue[];
  totals?: { grossTotalIncome: number; deductionsClaimed: number; taxesPaid: number };
  checkedAt?: string;
  note?: string;
}

export interface ItrReturn {
  id: string;
  assessmentYear: string;
  itrType: "ITR-1" | "ITR-2" | "ITR-3" | "ITR-4";
  status: "DRAFT" | "READY_TO_FILE" | "SUBMITTED" | "E_VERIFIED" | "ACKNOWLEDGED";
  payload: ItrPayload;
  validation: ItrValidation;
  updatedAt: string;
  consent?: { status: string; grantedAt: string } | null;
  events?: { type: string; status: string; createdAt: string }[];
}
