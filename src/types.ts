export type Role = "Individual" | "Finance User" | "Professional User";
export type ProfessionalRole =
  | "CA" | "CS" | "CFA" | "Financial Analyst" | "Accountant"
  | "Auditor" | "Finance Manager" | "Investment Analyst" | "Consultant" | "Other";

export type Status = "Active" | "Prospect" | "Onboarding" | "Inactive" | "Archived";
export type ProjectStatus = "Draft" | "Active" | "Under Review" | "Completed" | "Archived";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  professionalRole: ProfessionalRole;
  organizationId: string;
  organizationName: string;
}

export interface Organization { id:string; name:string; plan:"Free"|"Professional"|"Business"|"Enterprise"; users:number; activeProjects:number; documentsProcessed:number; aiRequests:number; }
export interface Client { id:string; name:string; company:string; industry:string; email:string; phone:string; fy:string; status:Status; team:string; projects:number; documents:number; }
export interface Project { id:string; name:string; clientId:string; clientName:string; type:string; fy:string; currency:string; status:ProjectStatus; priority:"High"|"Medium"|"Low"; startDate:string; endDate:string; team:string[]; tags:string[]; }
export interface DocumentRecord { id:string; name:string; type:string; size:string; status:"Uploading"|"Processing"|"Extracting"|"Analyzing"|"Completed"|"Failed"; uploadedBy:string; uploadedAt:string; clientId:string; projectId:string; pages?:number; }
export interface ChatMessage { id:string; role:"user"|"assistant"; content:string; createdAt:string; evidence?:Evidence[]; calculation?:string; assumptions?:string[]; limitations?:string; }
export interface Evidence { source:string; page?:number; excerpt:string; }
export interface Agent { id:string; name:string; description:string; category:string; capabilities:string[]; tone:string; }
export interface Task { id:string; title:string; client:string; project:string; assignee:string; priority:"High"|"Medium"|"Low"; due:string; status:"To Do"|"In Progress"|"Review"|"Completed"; }
export interface ComplianceItem { id:string; title:string; client:string; dueDate:string; category:"Tax"|"Audit"|"Filing"|"Deliverable"|"Internal"; status:"Upcoming"|"Due Soon"|"Overdue"; }
export interface AuditLog { id:string; actor:string; action:string; resource:string; timestamp:string; }
export interface KnowledgeItem { id:string; title:string; kind:"SOP"|"Template"|"Policy"|"Report"|"Methodology"; owner:string; updated:string; }
export interface Workflow { id:string; name:string; category:string; runs:number; description:string; }
export interface AnalysisResult { revenue:number; expenses:number; ebitda:number; ebitdaMargin:number; currentRatio:number; debtToEquity:number; roe:number; freeCashFlow:number; trend:number[]; }
export interface UsageMetrics { aiRequests:number; tokens:number; documents:number; storageGb:number; activeUsers:number; }
export interface IndividualAsset { id:string; name:string; category:string; value:number; institution:string; asOf?:string; }
export interface ITRReturn { id:string; assessmentYear:string; itrType:string; status:string; transactionId?:string; acknowledgementNumber?:string; updatedAt?:string; }
