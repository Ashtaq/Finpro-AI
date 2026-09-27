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


---

# 49. Architecture & Implementation Update — 27 September 2026

This section supersedes older statements that described the repository as frontend-only/localStorage. The repository now contains a working Phase 1 local backend foundation.

## 49.1 Current Phase 1 Runtime

The current development architecture is:

```
React + TypeScript + Vite
        |
        | HTTP / JSON
        v
Node.js + Express API
        |
        v
SQLite (better-sqlite3)
        |
        +--> Local upload directory
        |
        +--> Audit logs
        |
        +--> AI conversation history
```

Development endpoints:

- Frontend: `http://localhost:5173`
- Professional API: `http://127.0.0.1:8787`
- Health check: `GET /api/health`
- SQLite database: `server/data/finotech.local.db`
- Local uploads: `server/uploads`

The Phase 1 local database is intentionally not a production database. The production target remains PostgreSQL plus managed object storage.

## 49.2 Current Backend Stack

Implemented:

- Node.js
- Express 5
- better-sqlite3
- CORS
- JSON REST APIs
- Local filesystem storage foundation
- Seed/bootstrap data
- Organization-aware authorization
- Audit logging
- Persistent AI conversation/message storage

The backend is started with:

```bash
npm run server:dev
```

The frontend is started with:

```bash
npm run dev
```

For both:

```bash
npm run dev:full
```

## 49.3 Current Authentication Flow

Phase 1 now uses backend-controlled authentication when the API is available.

```
Login form
   |
   v
POST /api/auth/login
   |
   v
SQLite users table
   |
   +--> email
   +--> password hash
   +--> role
   +--> organization
   |
   v
Authenticated user context
```

Supported roles:

- Super Admin
- Admin
- Finance User
- Individual

The current local demo accounts are documented in the repository README. The demo password is for local development only.

### Production authentication gap

The current local Phase 1 password hashing uses SHA-256 for development compatibility. This MUST be replaced by Argon2id or an equivalent password-password-hashing mechanism before production launch. Production sessions should use secure server-side sessions or short-lived access tokens with refresh-token rotation.

## 49.4 Current User Management

Implemented API capabilities:

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `POST /api/users/:id/reset-password`

Authorization rules currently implemented:

- Super Admin can manage permitted users across organizations.
- Admin can manage Finance Users in the Admin's organization.
- Finance Users cannot manage users.
- Cross-organization user creation/update is blocked for Admins.
- Deactivation is preferred over physical deletion for managed users.

## 49.5 Current Core APIs

The Phase 1 local API includes:

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/signup`

### Dashboard

- `GET /api/dashboard`

### Users

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `POST /api/users/:id/reset-password`

### Clients

- `GET /api/clients`
- `POST /api/clients`

### Projects

- `GET /api/projects`

### Documents

- `GET /api/documents`
- `POST /api/documents`

### Tasks

- `GET /api/tasks`
- `PATCH /api/tasks/:id`

### Compliance

- `GET /api/compliance`

### Knowledge Base

- `GET /api/knowledge-base`

### Audit

- `GET /api/audit-logs`

### AI Assistant

- `POST /api/assistant/conversations`
- `GET /api/assistant/history`
- `POST /api/assistant/conversations/:id/messages`

### Settings

- `GET /api/settings`
- `PUT /api/settings`

### Upload status

- `GET /api/uploads/status`

These are Phase 1 local API paths. The production API should move to a versioned contract such as `/api/v1/*` after the domain model stabilizes.

## 49.6 Current Database Implementation

Phase 1 uses SQLite with the following core tables:

- organizations
- users
- clients
- projects
- documents
- tasks
- conversations
- messages
- conversation_files
- compliance_items
- knowledge_items
- audit_logs
- settings

Every tenant-owned table contains an organization relationship where appropriate.

The database is initialized from `server/schema.sql` and bootstrapped with local seed data.

## 49.7 Current Task Workflow

The Kanban workflow is persisted through the backend:

```
To Do
  |
  v
In Progress
  |
  v
Review
  |
  v
Completed
```

Task status changes are sent to the API and recorded in the audit log.

The UI should retain optimistic updates with rollback on API failure.

## 49.8 Current AI Phase 1 Boundary

The AI Assistant now persists:

- Conversations
- User messages
- Assistant messages
- Project association
- Agent identifier
- AI request usage
- Audit events

The current backend response is a structured/mock response. It does NOT yet provide production-grade:

- LLM provider integration
- XLSX/CSV semantic parsing
- PDF/DOCX extraction
- OCR
- Embeddings
- Vector retrieval
- Source-page/cell-level citations
- Deterministic tax calculation engine

These are explicitly Phase 2/3 capabilities.

---

# 50. ITR Filing Product Extension

Finotech AI will be extended with a dedicated **ITR Filing** capability for Indian tax workflows.

The ITR module is designed as a professional preparation, review, reconciliation and filing workflow rather than an AI-only answer generator.

## 50.1 ITR Product Objective

The objective is to allow a finance professional to:

```
Collect
  ↓
Import / Upload
  ↓
Extract
  ↓
Reconcile
  ↓
Compute
  ↓
Validate
  ↓
Review
  ↓
Client Approval
  ↓
Generate Filing Data
  ↓
Approved Filing Integration
  ↓
e-Verify
  ↓
Acknowledgement
```

Human review remains mandatory for material tax decisions.

## 50.2 Proposed ITR Workspace

Each client can have one or more assessment-year returns.

Example:

```
Client: ABC Private Limited
Assessment Year: 2026-27
Return: ITR-6
Status: Under Review

Sections
├── Taxpayer Profile
├── Income
├── Business / Profession
├── House Property
├── Capital Gains
├── Deductions
├── TDS / TCS
├── Tax Computation
├── Reconciliation
├── Validation
├── Review
├── Filing
└── Acknowledgement
```

## 50.3 ITR Data Sources

The system should support ingestion of:

- Form 16
- AIS
- TIS
- Form 26AS
- Bank statements
- Trial balance
- Profit & Loss
- Balance Sheet
- Capital account
- Demat/capital-gains statements
- Interest certificates
- Dividend information
- Rent information
- Deduction/supporting documents
- Previous-year ITR data
- Department-provided pre-filled data where the approved integration permits it

## 50.4 ITR Reconciliation

A dedicated reconciliation engine should compare independent sources.

Example:

```
                 AIS       Books      ITR

Salary          ₹12.40L    ₹12.40L    ₹12.40L     ✓
Interest         ₹42.5K     ₹41.8K     ₹41.8K     ⚠
Dividend         ₹18.2K     ₹18.2K     ₹18.2K     ✓
TDS              ₹1.24L     ₹1.24L     ₹1.24L     ✓
```

The system should identify:

- Missing income
- Duplicate income
- TDS mismatch
- Capital-gain mismatch
- Interest mismatch
- Bank-account mismatch
- Unsupported deduction
- Data-quality issues

## 50.5 Deterministic Tax Engine

Tax computation MUST NOT depend solely on an LLM.

The calculation engine should produce:

- Gross total income
- Income-head totals
- Eligible deductions
- Taxable income
- Applicable tax
- Rebate where applicable
- Cess
- TDS/TCS
- Advance tax
- Self-assessment tax
- Refund/payable
- Calculation trace

Each material calculation should retain:

- Formula
- Input values
- Source
- Rule/version
- Result
- Validation status

The AI layer can explain the calculation but must not replace the deterministic calculation engine.

## 50.6 ITR Form Support

The architecture should support the ITR form family applicable to the taxpayer and assessment year, including:

- ITR-1
- ITR-2
- ITR-3
- ITR-4
- ITR-5
- ITR-6
- ITR-7

Eligibility must be evaluated against the official rules applicable to the relevant assessment year.

## 50.7 Maker-Checker Workflow

The ITR module should support:

```
Maker
  ↓
AI/Data Validation
  ↓
Reviewer / CA
  ↓
Corrections
  ↓
Final Review
  ↓
Client Approval
  ↓
Ready to File
```

Review records should capture:

- Prepared by
- Reviewed by
- Review date
- Review comments
- Issues raised
- Issues resolved
- Client approval
- Final filing state

## 50.8 ITR Validation

Before filing, the system should run:

- PAN/taxpayer validation
- Assessment-year validation
- ITR-form eligibility checks
- Mandatory-field validation
- Income schedule validation
- Deduction validation
- TDS/TCS reconciliation
- Bank-detail validation
- Tax computation validation
- Return-schema validation
- Supporting-document checks

The UI should clearly separate:

- Errors — filing blocked
- Warnings — professional review required
- Information — no blocking issue

## 50.9 Filing Integration Boundary

Finotech should NOT automate browser login to the Income Tax portal using a professional's credentials.

The production design should use an approved server-side filing/ERI integration where applicable.

The architecture is:

```
Finotech ITR Engine
        |
        v
Final Validation
        |
        v
Filing Provider / Approved ERI Integration
        |
        v
Income Tax Department
        |
        +--> Filing Status
        +--> e-Verification
        +--> Acknowledgement
```

Provider credentials, consent, signing material and sensitive integration secrets must remain server-side.

Until an approved provider is configured, Finotech should stop at **Ready to File / Generate Filing Data** rather than pretending that a return was submitted.

## 50.10 ITR Proposed Database Model

The production model should add entities such as:

- itr_profiles
- itr_returns
- itr_income
- itr_deductions
- itr_tds
- itr_capital_gains
- itr_house_property
- itr_business_income
- itr_bank_accounts
- itr_reconciliations
- itr_validations
- itr_reviews
- itr_filings
- itr_filing_events
- itr_documents

Every ITR record must be linked to:

- Organization
- Client/taxpayer
- Assessment year
- Return type
- User/auditor/reviewer
- Source documents
- Audit trail

## 50.11 ITR APIs — Target Contract

Target APIs should include:

- `GET /api/v1/itr/returns`
- `POST /api/v1/itr/returns`
- `GET /api/v1/itr/returns/:id`
- `PATCH /api/v1/itr/returns/:id`
- `POST /api/v1/itr/returns/:id/documents`
- `POST /api/v1/itr/returns/:id/reconcile`
- `POST /api/v1/itr/returns/:id/calculate`
- `POST /api/v1/itr/returns/:id/validate`
- `POST /api/v1/itr/returns/:id/review`
- `POST /api/v1/itr/returns/:id/client-approval`
- `POST /api/v1/itr/returns/:id/generate-json`
- `POST /api/v1/itr/returns/:id/submit`
- `GET /api/v1/itr/returns/:id/events`

The `submit` operation must remain disabled until the approved filing provider/ERI integration is configured and the required consent/security controls are active.

---

# 51. ITR Delivery Roadmap

## ITR Phase A — Preparation Foundation

- Taxpayer profile
- Assessment-year selection
- ITR-type metadata
- Income data model
- Deductions data model
- TDS data model
- Capital gains data model
- Supporting documents
- Local validation
- Draft lifecycle
- Audit trail

## ITR Phase B — Intelligence

- Form 16 extraction
- AIS/TIS/26AS ingestion
- Bank statement parsing
- Trial-balance parsing
- Capital-gain extraction
- Source reconciliation
- Mismatch detection
- Previous-year comparison
- Deterministic tax engine
- AI explanations

## ITR Phase C — Professional Review

- Maker-checker
- CA review
- Issue tracking
- Client approval
- Filing readiness
- Filing JSON/schema validation

## ITR Phase D — Filing Integration

- Approved ERI/provider integration
- Secure credentials
- Taxpayer/client consent
- Prefill where permitted
- Final validation
- Submission
- e-Verification workflow
- Acknowledgement retrieval
- Filing status tracking

---

# 52. Updated Phase Plan

## Phase 1 — Local Professional Workspace Foundation — CURRENT

Completed/founded:

- React/Vite frontend
- Node/Express local API
- SQLite database
- Database schema
- Seed/bootstrap data
- Backend authentication
- Role-based user management
- Organization scoping
- Client/project/document/task persistence foundation
- AI conversation persistence foundation
- Compliance/knowledge/audit APIs
- Settings API
- Local upload storage foundation
- Kanban task persistence
- Phase 1 runbook

Remaining before external production launch:

- Production authentication
- PostgreSQL
- Object storage
- Real file upload pipeline
- File parsing/OCR
- LLM provider
- RAG/vector search
- Deterministic financial/tax engines
- Security hardening
- Monitoring
- Backups
- CI/CD
- E2E/security testing

## Phase 2 — Document Intelligence + Tax/ITR Preparation

- PDF/XLSX/CSV/DOCX extraction
- OCR
- AIS/TIS/26AS workflows
- ITR data model
- Tax computation engine
- ITR reconciliation
- ITR validation
- Maker-checker review
- Client approval
- Filing-data generation

## Phase 3 — Production AI Platform

- LLM gateway
- RAG
- Vector store
- Evidence/citations
- Financial calculation engine
- AI usage metering
- Prompt-injection controls
- Background workers

## Phase 4 — Filing Integration

- Approved ERI/provider integration
- Consent
- Prefill
- Submission
- e-Verification
- Acknowledgement
- Filing status

## Phase 5 — Enterprise SaaS

- PostgreSQL
- Object storage
- Redis
- SSO
- MFA
- SCIM
- Billing
- Advanced analytics
- Enterprise audit
- DR/BCP
- Enterprise SLA

---

# 53. Updated Product Navigation

Recommended product navigation:

```
Dashboard

WORKSPACE
├── Clients
├── Projects
├── Documents
└── Tasks

TAX
├── ITR Filing
├── Tax Computation
├── Tax Reconciliation
├── TDS
├── Capital Gains
└── Compliance

AI
├── AI Assistant
├── AI Workspace
├── AI Agents
└── Financial Analysis

KNOWLEDGE
├── Knowledge Base
└── Tax Library

ADMIN
├── Team
├── Organizations
├── Audit Logs
├── Billing
└── Settings
```

The Individual workspace can expose a simplified personal-finance/ITR navigation while keeping professional organization workspaces separate.

---

# 54. Updated Production Readiness Rules

The following rules are mandatory before Finotech is marketed as a production tax-filing system:

1. Do not expose SQLite as the production database.
2. Do not expose local upload directories publicly.
3. Replace development password hashing with Argon2id or an approved equivalent.
4. Implement secure sessions/tokens and CSRF/session controls as applicable.
5. Implement tenant isolation and object-level authorization.
6. Implement encrypted object storage and signed access URLs.
7. Implement malware scanning and file-type validation.
8. Implement deterministic tax calculations.
9. Version tax rules by assessment year.
10. Validate generated filing data against the applicable official schema.
11. Keep AI output distinguishable from deterministic tax calculations.
12. Require human review for material tax outputs.
13. Maintain complete filing and calculation audit trails.
14. Implement consent and approval records.
15. Use an approved filing/ERI integration for actual submission.
16. Never store provider secrets or signing material in the browser.
17. Implement backup, monitoring, incident response and recovery.
18. Complete security, privacy and professional-compliance review before production filing is enabled.

---

# 55. Updated Definition of Done

### Phase 1 local MVP

- [x] React/Vite application runs locally
- [x] Node/Express API runs locally
- [x] SQLite schema exists
- [x] Seed/bootstrap data exists
- [x] Backend login exists
- [x] Super Admin/Admin/Finance User authorization exists
- [x] User management APIs exist
- [x] Client/project/document/task persistence foundation exists
- [x] AI conversation persistence exists
- [x] Audit logging foundation exists
- [x] Local development runbook exists

### Production professional workspace

- [ ] PostgreSQL
- [ ] Secure authentication
- [ ] Production RBAC
- [ ] Object storage
- [ ] Real document processing
- [ ] Production AI/RAG
- [ ] Deterministic financial calculations
- [ ] Monitoring and backups
- [ ] Security testing
- [ ] CI/CD

### Production ITR platform

- [ ] ITR data model
- [ ] Assessment-year tax rules
- [ ] Deterministic tax engine
- [ ] AIS/TIS/26AS reconciliation
- [ ] ITR schema validation
- [ ] Maker-checker review
- [ ] Client approval
- [ ] Filing provider/ERI integration
- [ ] e-Verification
- [ ] Acknowledgement tracking
- [ ] Filing audit trail

---
