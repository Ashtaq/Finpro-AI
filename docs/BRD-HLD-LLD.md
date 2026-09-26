# Finotech AI — BRD, HLD & LLD

**Repository:** `Ashtaq/Finpro-AI`  
**Version:** 1.0  
**Date:** 27 September 2026  
**Status:** Product baseline / implementation specification  
**Audience:** Product, business, engineering, QA, security, DevOps and AI/ML teams

---

## 1. Executive Summary

Finotech AI is a multi-tenant financial-professional productivity and AI workspace for Chartered Accountants (CA), Company Secretaries (CS), CFA professionals, auditors, accountants, finance managers, financial analysts, investment analysts and related professionals.

The platform brings together:

- Client and project management
- Financial document management
- Financial analysis
- AI-powered finance assistance
- Project-specific AI workspaces
- Task and Kanban management
- Compliance/deadline management
- Knowledge management
- Reports and analytics
- Organization/team administration
- Platform-level Super Admin controls
- Auditability and AI usage monitoring

The current repository is a React/TypeScript frontend with a browser-local mock service layer. This document defines both the current product requirements and the target production architecture required to evolve it into a secure SaaS application.

---

# PART A — BUSINESS REQUIREMENTS DOCUMENT

## 2. Business Problem

Finance professionals work across fragmented spreadsheets, PDFs, client documents, email, task trackers and internal SOPs. This creates:

1. Distributed financial information.
2. High manual effort for document review and analysis.
3. Repetitive calculations and reporting.
4. Difficulty tracking clients, projects and deadlines.
5. AI answers without sufficient project context or source traceability.
6. Security and access-control requirements for confidential client information.
7. Limited management visibility into workload, projects, compliance and AI consumption.

Finotech AI addresses these problems through a connected finance workspace.

---

## 3. Product Vision

Build an AI-first operating system for finance professionals where users can:

**Upload → Understand → Analyze → Collaborate → Review → Report**

while keeping client, project, document, task and AI context connected.

AI should be assistive rather than authoritative. Professional users must be able to inspect evidence, assumptions, calculations and limitations before relying on output.

---

## 4. Business Objectives

### BO-01 — Centralize finance work
Provide one workspace for clients, projects, documents, financial data, analysis, tasks and reports.

### BO-02 — Reduce manual analysis
Automate repetitive financial-document, spreadsheet and reporting workflows.

### BO-03 — Improve source traceability
Enable material AI conclusions to reference source documents, pages, tables, worksheets or extracted data.

### BO-04 — Improve collaboration
Allow finance teams to work on shared projects with controlled access and task ownership.

### BO-05 — Establish secure organization boundaries
Ensure users can access only information permitted by their role and organization.

### BO-06 — Provide management visibility
Provide dashboards covering projects, clients, documents, tasks, AI usage, users, compliance and operational activity.

### BO-07 — Support commercial SaaS deployment
Provide foundations for subscriptions, usage metering and enterprise controls.

---

## 5. Target Users

### 5.1 Super Admin
Platform operator responsible for:

- Organizations
- Platform users
- Admin accounts
- Finance User accounts
- Plans and platform controls
- Platform usage
- Security/audit visibility

### 5.2 Admin
Organization administrator responsible for:

- Finance Users within the organization
- Client/team operations
- Projects
- Documents
- AI usage
- Tasks
- Compliance
- Knowledge
- Reports
- Organization audit activity

### 5.3 Finance User
Professional user responsible for:

- Clients
- Projects
- Documents
- Financial analysis
- AI Assistant
- AI Agents
- Reports
- Tasks
- Compliance
- Knowledge Base

Professional designations include CA, CS, CFA, Financial Analyst, Accountant, Auditor, Finance Manager, Investment Analyst, Consultant and Other.

---

# 6. Role & Access Matrix

| Capability | Super Admin | Admin | Finance User |
|---|---:|---:|---:|
| Platform administration | Yes | No | No |
| Organization management | Yes | Scoped | No |
| Create Admin | Yes | No | No |
| Create Finance User | Yes | Yes | No |
| Edit managed users | Yes | Yes, scoped | No |
| Reset managed-user password | Yes | Yes, scoped | No |
| Delete managed users | Yes | Yes, scoped | No |
| Clients | Oversight | Yes | Yes |
| Projects | Oversight | Yes | Yes |
| Documents | Oversight | Yes | Yes |
| AI Assistant | Yes | Yes | Yes |
| AI Agents | Yes | Yes | Yes |
| Financial Analysis | Yes | Yes | Yes |
| Reports | Yes | Yes | Yes |
| Tasks | Yes | Yes | Yes |
| Compliance | Yes | Yes | Yes |
| Knowledge Base | Yes | Yes | Yes |
| Analytics | Platform | Organization | Scoped |
| Audit Logs | Platform | Organization | Limited |
| Billing | Yes | Optional org billing | No |
| Settings | Platform | Organization | Personal |

**Production rule:** authorization must be enforced server-side. Frontend route protection alone is not a security boundary.

---

# 7. Functional Requirements

## FR-001 Authentication

The system shall support:

- Email/password authentication
- Secure password hashing
- Session management
- Logout
- Password reset
- Account activation/deactivation
- Role-aware access
- Optional MFA
- Optional enterprise SSO

Public signup creates a Finance User by default. Admin and Super Admin accounts can only be created by authorized administrators.

---

## FR-002 Organization Management

Super Admin shall be able to:

- Create organizations
- Edit organization details
- Assign plans
- Activate/deactivate organizations
- View organization statistics
- Manage organization administrators
- View usage
- View storage
- View AI consumption

All tenant-owned records must be scoped by organization.

---

## FR-003 User Management

### Super Admin

Can:

- Create Admin
- Create Finance User
- Edit users
- Reset passwords
- Activate/deactivate users
- Delete/deactivate users
- Assign organization
- View role and professional designation

### Admin

Can:

- Create Finance User
- Edit Finance User
- Reset Finance User password
- Activate/deactivate Finance User
- Delete/deactivate Finance User

Admin cannot:

- Create Admin
- Create Super Admin
- Promote Finance User to Admin
- Access another organization

---

## FR-004 Client Management

Users shall be able to:

- Create clients
- Edit clients
- Archive clients
- Search and filter clients
- View client history
- Associate clients with projects
- View project/document counts

---

## FR-005 Project Management

Projects contain:

- Project name
- Client
- Project type
- Financial year
- Currency
- Status
- Priority
- Start date
- End date
- Team members
- Tags

Statuses:

- Draft
- Active
- Under Review
- Completed
- Archived

Every project has an isolated workspace.

---

# 8. Project Workspace

Each project workspace shall provide:

1. Overview
2. AI Chat
3. Documents
4. Financial Data
5. Analysis
6. Reports
7. Tasks
8. Team
9. Activity

Project ID must be propagated into AI and backend services.

---

# 9. Document Management

Supported initial types:

- XLSX
- XLS
- CSV
- PDF
- DOCX
- TXT
- JSON

Required capabilities:

- Upload
- Validation
- Malware scanning
- Metadata extraction
- OCR where needed
- Text extraction
- Table extraction
- Spreadsheet parsing
- Preview
- Versioning
- Processing status
- Download
- Delete/archive
- Project association

Lifecycle:

`Uploading → Processing → Extracting → Analyzing → Completed`

Failure path:

`Processing → Failed`

---

# 10. AI Assistant

The AI Assistant shall support:

- Project context
- Agent selection
- Conversation history
- File attachments
- Finance questions
- Tax questions
- Audit questions
- Valuation questions
- Compliance questions
- Spreadsheet questions
- Document questions
- Calculation explanations
- Evidence references
- Assumptions
- Limitations
- Regeneration
- Copy
- Feedback

Preferred response structure:

1. Answer
2. Calculation
3. Evidence
4. Sources
5. Assumptions
6. Limitations
7. Suggested next step

---

# 11. AI Agents

### Finance Analyst
P&L, balance sheet, ratios, cash flow, working capital and risk.

### Tax Assistant
Tax documents, calculations, reconciliations and issue identification.

### Audit Assistant
Audit planning, risk assessment, transaction review, duplicates and outliers.

### CFA / Investment Agent
DCF, trading comparables, precedents, multiples, scenarios and risk.

### CS / Compliance Agent
Compliance checklists, corporate documents, deadlines and board material.

### Excel AI Agent
Formula explanation/generation, cleaning, duplicates, charts and worksheet comparison.

### Document Intelligence
PDF extraction, table extraction, summaries, comparisons and source references.

---

# 12. AI Workspace

The AI Workspace should maintain:

- User
- Organization
- Project
- Client
- Agent
- Attached documents
- Conversation
- Message history
- Model
- Token usage
- Evidence
- Citations
- Audit metadata

AI must never retrieve documents outside the user's authorization scope.

---

# 13. Financial Analysis

Initial analysis capabilities:

- Revenue
- Expenses
- EBITDA
- EBITDA margin
- Current ratio
- Debt-to-equity
- ROE
- Free cash flow
- Trend analysis
- YoY/MoM analysis
- Variance analysis
- Scenario analysis

Critical calculations should be performed by deterministic calculation services, with the AI explaining the results.

---

# 14. Task Management

Task fields:

- ID
- Title
- Client
- Project
- Assignee
- Priority
- Due date
- Status
- Created date
- Updated date

Statuses:

- To Do
- In Progress
- Review
- Completed

Users can:

- Drag and drop tasks
- Change status
- Assign tasks
- Change priority
- Set due dates
- Filter/search tasks

Every status transition should create an audit event.

---

# 15. Compliance

Support:

- Compliance item creation
- Client association
- Due dates
- Category
- Assignee
- Reminders
- Escalation

Statuses:

- Upcoming
- Due Soon
- Overdue
- Completed

Future versions can integrate configurable regulatory/tax calendars.

---

# 16. Knowledge Base

Support:

- SOPs
- Templates
- Policies
- Reports
- Methodologies
- Internal guidance

Capabilities:

- Search
- Filter
- Versioning
- Ownership
- Approval
- Archive
- AI retrieval

---

# 17. Reports

Report types:

- Financial health
- Management summary
- Client report
- Audit report
- Tax analysis
- Valuation report
- Compliance report
- AI analysis report

Lifecycle:

**Draft → Review → Approved → Published → Archived**

---

# 18. Dashboards

Core KPIs:

- Clients
- Active projects
- Documents
- AI analyses
- Reports
- Pending tasks
- Upcoming deadlines
- AI usage

Super Admin additionally sees:

- Organizations
- Platform users
- Storage
- AI requests
- Security events
- Tenant health

---

# 19. Audit

Audit events should include:

- Login/logout
- User creation/modification/deletion
- Password reset
- Project changes
- Document upload/download/delete
- AI requests/responses
- Report generation
- Task status changes
- Permission changes
- Organization changes

Each event should capture actor, organization, action, resource, timestamp, result and relevant metadata.

---

# PART B — HIGH LEVEL DESIGN (HLD)

# 20. Target Architecture

```
Web Browser
    |
    v
React / TypeScript Frontend
    |
    v
API Gateway / Backend API
    |
    +-----------------------+
    |                       |
    v                       v
Authentication/RBAC     Application Services
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
        PostgreSQL      Object Storage   Redis/Queue
             |              |              |
             +--------------+--------------+
                            |
                            v
                     AI Orchestration
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
          LLM API      Document Parser   Embeddings
                            |
                            v
                       Vector Store
```

---

# 21. Recommended Technology Stack

## Frontend

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- React Hook Form
- Zod
- Recharts
- Lucide

## Backend

Either:

### Node.js
- Node.js
- TypeScript
- NestJS/Fastify
- PostgreSQL
- Prisma
- Redis
- BullMQ

### Laravel
- Laravel
- PostgreSQL/MySQL
- Laravel Sanctum
- Redis
- Laravel Queues

The existing frontend can consume either backend through versioned REST APIs.

## Storage

Object storage:

- AWS S3
- Azure Blob
- Google Cloud Storage
- Supabase Storage

Vector storage:

- pgvector
- Pinecone
- Weaviate
- Qdrant

---

# 22. Multi-Tenant Architecture

Every organization-owned entity should include:

`organization_id`

Examples:

- users
- clients
- projects
- documents
- tasks
- conversations
- messages
- reports
- audit events

Every query must apply organization scope.

Enterprise deployments should consider PostgreSQL Row Level Security as an additional boundary.

---

# 23. Authentication Architecture

```
User
 ↓
Login
 ↓
Authentication Service
 ↓
Access + Refresh Session
 ↓
RBAC Middleware
 ↓
Organization Scope
 ↓
Application API
```

Passwords must never be stored in plaintext. Recommended hashing: Argon2id, with bcrypt as an alternative.

---

# 24. AI Architecture

```
User Question
     ↓
Authorization
     ↓
Project Context
     ↓
Document Permission Check
     ↓
Conversation History
     ↓
Relevant Document Retrieval
     ↓
Context Builder
     ↓
LLM
     ↓
Calculation / Validation Layer
     ↓
Citation Builder
     ↓
Response
     ↓
Audit + Usage Metering
```

The AI gateway should abstract model providers so the application is not coupled to one vendor.

---

# 25. Document Intelligence Pipeline

```
Upload
 ↓
Malware Scan
 ↓
Object Storage
 ↓
Metadata Extraction
 ↓
Classification
 ↓
OCR / Parser
 ↓
Text + Table Extraction
 ↓
Chunking
 ↓
Embeddings
 ↓
Vector Store
 ↓
Project Knowledge Index
```

Spreadsheet pipeline:

```
Workbook
 ↓
Workbook metadata
 ↓
Sheets
 ↓
Tables
 ↓
Cells / ranges
 ↓
Formula analysis
 ↓
Structured financial dataset
```

---

# 26. AI Calculation Architecture

Separate language generation from critical calculations.

Example:

`EBITDA Margin = EBITDA / Revenue × 100`

Calculation service should return:

- Formula
- Inputs
- Output
- Source cells
- Source document
- Precision
- Validation status

The LLM explains the result but should not be the sole calculator for material financial figures.

---

# 27. Queue Architecture

Long-running work should be asynchronous:

- Large document processing
- OCR
- Spreadsheet parsing
- Embedding generation
- AI report generation
- Bulk imports
- Report generation

Example:

```
POST /documents
       ↓
Queue Job
       ↓
Worker
       ↓
Process
       ↓
Update Status
       ↓
Notify Frontend
```

---

# PART C — LOW LEVEL DESIGN (LLD)

# 28. Core Database Model

## organizations

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR | Required |
| plan | VARCHAR | Subscription plan |
| status | VARCHAR | Active/Inactive |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

## users

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| organization_id | UUID | FK |
| name | VARCHAR | |
| email | VARCHAR | Unique within platform |
| password_hash | TEXT | Never plaintext |
| professional_role | VARCHAR | |
| status | VARCHAR | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

## roles

Roles:

- SUPER_ADMIN
- ADMIN
- FINANCE_USER

## clients

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| name | VARCHAR |
| company | VARCHAR |
| industry | VARCHAR |
| email | VARCHAR |
| phone | VARCHAR |
| status | VARCHAR |

## projects

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| client_id | UUID |
| name | VARCHAR |
| type | VARCHAR |
| financial_year | VARCHAR |
| currency | VARCHAR |
| status | VARCHAR |
| priority | VARCHAR |
| start_date | DATE |
| end_date | DATE |

## project_members

| Field | Type |
|---|---|
| project_id | UUID |
| user_id | UUID |
| permission | VARCHAR |

## documents

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| project_id | UUID |
| uploaded_by | UUID |
| filename | VARCHAR |
| object_key | TEXT |
| mime_type | VARCHAR |
| size_bytes | BIGINT |
| processing_status | VARCHAR |
| version | INTEGER |
| created_at | TIMESTAMP |

## tasks

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| project_id | UUID |
| client_id | UUID |
| assignee_id | UUID |
| title | VARCHAR |
| priority | VARCHAR |
| due_date | DATE |
| status | VARCHAR |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

## conversations

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| project_id | UUID |
| user_id | UUID |
| agent_id | UUID |
| title | VARCHAR |
| created_at | TIMESTAMP |

## messages

| Field | Type |
|---|---|
| id | UUID |
| conversation_id | UUID |
| role | VARCHAR |
| content | TEXT |
| model | VARCHAR |
| token_count | INTEGER |
| created_at | TIMESTAMP |

## evidence

| Field | Type |
|---|---|
| id | UUID |
| message_id | UUID |
| document_id | UUID |
| page | INTEGER |
| sheet | VARCHAR |
| cell_range | VARCHAR |
| excerpt | TEXT |

## audit_logs

| Field | Type |
|---|---|
| id | UUID |
| organization_id | UUID |
| actor_id | UUID |
| action | VARCHAR |
| resource_type | VARCHAR |
| resource_id | UUID |
| metadata | JSONB |
| ip_address | INET |
| created_at | TIMESTAMP |

---

# 29. API Design

## Authentication

- POST `/api/v1/auth/login`
- POST `/api/v1/auth/logout`
- POST `/api/v1/auth/refresh`
- POST `/api/v1/auth/forgot-password`
- POST `/api/v1/auth/reset-password`

Login request:

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

---

# 30. User APIs

- GET `/api/v1/users`
- POST `/api/v1/users`
- PATCH `/api/v1/users/:id`
- DELETE `/api/v1/users/:id`
- POST `/api/v1/users/:id/reset-password`

Authorization:

```
SUPER_ADMIN:
  manage permitted users across organizations

ADMIN:
  manage FINANCE_USER
  where organization_id == current.organization_id

FINANCE_USER:
  cannot manage users
```

---

# 31. Client APIs

- GET `/api/v1/clients`
- POST `/api/v1/clients`
- GET `/api/v1/clients/:id`
- PATCH `/api/v1/clients/:id`
- DELETE `/api/v1/clients/:id`

---

# 32. Project APIs

- GET `/api/v1/projects`
- POST `/api/v1/projects`
- GET `/api/v1/projects/:id`
- PATCH `/api/v1/projects/:id`
- DELETE `/api/v1/projects/:id`
- POST `/api/v1/projects/:id/members`
- DELETE `/api/v1/projects/:id/members/:userId`

---

# 33. Document APIs

- POST `/api/v1/projects/:projectId/documents`
- GET `/api/v1/projects/:projectId/documents`
- GET `/api/v1/documents/:id`
- GET `/api/v1/documents/:id/download`
- DELETE `/api/v1/documents/:id`
- POST `/api/v1/documents/:id/reprocess`

---

# 34. Task APIs

- GET `/api/v1/tasks`
- POST `/api/v1/tasks`
- GET `/api/v1/tasks/:id`
- PATCH `/api/v1/tasks/:id`
- PATCH `/api/v1/tasks/:id/status`
- DELETE `/api/v1/tasks/:id`

Status workflow:

```
To Do
 ↓
In Progress
 ↓
Review
 ↓
Completed
```

Backward movement should be supported where authorized.

---

# 35. AI APIs

- POST `/api/v1/ai/conversations`
- GET `/api/v1/ai/conversations`
- POST `/api/v1/ai/conversations/:id/messages`
- POST `/api/v1/ai/analyze`
- POST `/api/v1/ai/regenerate`

Example:

```json
{
  "message": "Analyze the EBITDA trend",
  "agentId": "finance",
  "documentIds": ["doc-1", "doc-2"]
}
```

Recommended response:

```json
{
  "answer": "...",
  "calculations": [
    {
      "formula": "EBITDA / Revenue * 100",
      "inputs": {},
      "result": 23.0
    }
  ],
  "evidence": [
    {
      "documentId": "...",
      "page": 47,
      "excerpt": "..."
    }
  ],
  "assumptions": [],
  "limitations": []
}
```

Do not show a confidence score unless it is backed by a validated methodology.

---

# 36. Task Drag-and-Drop Design

Frontend flow:

```
onDragStart(taskId)
        ↓
set dataTransfer(taskId)
        ↓
onDragOver(status)
        ↓
highlight column
        ↓
onDrop(status)
        ↓
PATCH /tasks/:id/status
        ↓
optimistic UI update
        ↓
rollback if API fails
```

The current prototype uses browser storage; production must persist through the API.

---

# 37. Security Requirements

Mandatory:

- TLS
- Secure session/token handling
- Password hashing
- RBAC
- Organization-level authorization
- Object-level authorization
- Input validation
- File validation
- Malware scanning
- Rate limiting
- CSRF protection where applicable
- XSS protection
- SQL injection protection
- Audit logging
- Secret management
- Encryption at rest
- Encryption in transit

AI-specific controls:

- Tenant-isolated retrieval
- Prompt-injection defenses
- System-prompt protection
- Token/request limits
- File-size limits
- AI usage logging
- No authorization decisions based on document content

---

# 38. Non-Functional Requirements

## Performance targets

- Dashboard API: <2s target
- Standard CRUD APIs: <500ms p95 target
- AI first token: target <3s depending on provider
- Task status update: <1s perceived response
- Large files: asynchronous processing

## Availability

Target 99.9% monthly production availability, with graceful degradation when an AI provider is unavailable.

## Scalability

Support:

- Horizontal API scaling
- Background workers
- Redis queues
- Object storage
- Database scaling/read replicas where needed
- Model-provider abstraction

## Observability

Implement:

- Structured logs
- Metrics
- Error tracking
- API latency monitoring
- Queue monitoring
- AI token monitoring
- Storage monitoring

---

# 39. Backup & Disaster Recovery

Recommended:

- Daily database backups
- Point-in-time recovery
- Object-storage versioning
- Cross-region backup for enterprise plans

Initial targets:

- RPO: 15–60 minutes
- RTO: <4 hours

Final SLA depends on the commercial plan.

---

# 40. Testing Strategy

## Unit

Test:

- RBAC
- Financial calculations
- Task transitions
- Document validation
- AI context construction
- Permission policies

## Integration

Test:

- Authentication
- Database
- File uploads
- Document parser
- AI provider
- Queue workers

## End-to-End

Critical flow:

1. Super Admin login
2. Super Admin creates Admin
3. Admin login
4. Admin creates Finance User
5. Finance User login
6. Finance User creates project
7. User uploads document
8. Document processing completes
9. User asks AI question
10. AI returns source evidence
11. User creates task
12. User drags task to In Progress
13. User moves task to Completed
14. Audit log records changes

---

# 41. Acceptance Criteria

## User Management

- [ ] Super Admin can create Admin
- [ ] Super Admin can create Finance User
- [ ] Super Admin can assign organization
- [ ] Admin can create Finance User
- [ ] Admin cannot create Admin
- [ ] Admin cannot create Super Admin
- [ ] Finance User cannot manage users
- [ ] Cross-tenant access is blocked
- [ ] Production passwords are securely hashed

## AI

- [ ] AI receives only authorized project context
- [ ] AI can retrieve authorized uploaded documents
- [ ] Evidence is traceable
- [ ] Critical financial calculations are deterministic
- [ ] Conversation history is persisted
- [ ] AI usage is metered
- [ ] AI requests are audited

## Tasks

- [ ] Drag/drop works
- [ ] Drop target highlights
- [ ] Status updates immediately
- [ ] Status persists after refresh
- [ ] API failure rolls back optimistic update
- [ ] Transition is audited

---

# 42. Current Prototype vs Production Gap

| Area | Current Prototype | Production Target |
|---|---|---|
| Authentication | Browser/local service | Secure backend |
| Passwords | Local demo | Argon2id/bcrypt |
| Users | localStorage | PostgreSQL |
| RBAC | Frontend/service demo | Server middleware/policies |
| Organizations | Static data | Multi-tenant database |
| Documents | Metadata/mock | Object storage + processing |
| AI | Structured mock | LLM + RAG + validation |
| Excel parsing | Attachment UI | Workbook parser |
| PDF parsing | Attachment UI | PDF/OCR pipeline |
| Vector search | Not connected | pgvector/vector DB |
| Tasks | localStorage | API/database |
| Audit | Static/demo | Persistent audit stream/store |
| Billing | UI | Payment/subscription service |
| Notifications | UI-level | Event/email/in-app |
| Monitoring | Demo metrics | Observability stack |

---

# 43. Implementation Roadmap

## Phase 1 — Foundation

- Backend API
- PostgreSQL
- Authentication
- RBAC
- Organizations
- User management
- Audit logs
- CI/CD

## Phase 2 — Core Workspace

- Clients
- Projects
- Project members
- Documents
- Object storage
- Tasks
- Persistent Kanban

## Phase 3 — Document Intelligence

- PDF parser
- XLSX parser
- CSV parser
- DOCX parser
- OCR
- Extraction pipeline
- Background workers

## Phase 4 — AI Platform

- AI gateway
- Provider abstraction
- RAG
- Vector store
- Project context
- Evidence/citations
- Calculation engine
- AI usage metering
- Prompt-injection controls

## Phase 5 — Professional Workflows

- Tax workflows
- Audit workflows
- Valuation workflows
- Compliance workflows
- Management reporting
- Knowledge retrieval

## Phase 6 — Enterprise

- SSO
- MFA
- SCIM
- Advanced audit
- Retention policies
- Custom models
- Enterprise billing
- Advanced analytics
- Enterprise SLA/DR

---

# 44. Recommended Future Features

1. Financial statement OCR
2. Bank statement reconciliation
3. GST/tax document analysis
4. Trial balance analyzer
5. Ledger anomaly detection
6. Excel formula auditor
7. Financial ratio benchmarking
8. DCF model builder
9. Comparable-company analysis
10. Cash-flow forecasting
11. Budget vs actual
12. Working-capital forecasting
13. Automated MIS
14. Board-report generation
15. Client portal
16. Secure client document requests
17. Approval workflows
18. E-signature integration
19. Email ingestion
20. Calendar/deadline integration
21. Enterprise SSO
22. Enterprise API access

---

# 45. Compliance & Professional Responsibility

Finotech AI is an assistive technology platform.

The system should clearly state that:

- AI output is not automatically professional advice.
- Calculations should be validated.
- Regulatory interpretations should be reviewed.
- Source documents should be checked.
- Client-facing reports should receive appropriate human approval.

Applicable privacy, professional-confidentiality, financial-information and client-record requirements must be assessed for each target jurisdiction before production deployment.

---

# 46. Definition of Done — Production MVP

Production MVP is complete when:

- Authentication is production secure.
- Organizations are fully isolated.
- RBAC is enforced server-side.
- Admin/Super Admin user management works.
- Clients and projects persist in PostgreSQL.
- Documents are securely stored.
- Documents can be parsed.
- AI retrieves only authorized project documents.
- AI responses contain verifiable evidence.
- Financial calculations use deterministic services.
- Tasks persist and support drag/drop.
- Audit logs are generated.
- Backup/recovery is configured.
- Monitoring is operational.
- Critical E2E tests pass.
- Security testing is complete.
- Production deployment is automated.

---

# 47. Current Frontend Modules

The current application contains routes/modules for:

- Dashboard
- Clients
- Projects
- Project Workspace
- AI Agents
- AI Assistant
- Documents
- Financial Analysis
- Reports
- Tasks
- Compliance
- Knowledge Base
- Analytics
- Team/User Management
- Audit Logs
- Settings
- Platform/Super Admin
- Billing

The application uses React, TypeScript and React Router with permission-aware routes.

---

# 48. Product Principle

The central product principle is:

> **AI assists the finance professional; it does not replace professional judgment.**

Architecture and product decisions should therefore prioritize:

**Security → Authorization → Source Evidence → Deterministic Calculations → AI Reasoning → Human Review → Auditability**
