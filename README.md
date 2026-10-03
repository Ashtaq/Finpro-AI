# Finotech AI — Finance Intelligence SaaS

Phase 2 adds a dedicated Individual workspace for employees, freelancers and small-business owners who manage their own finances and ITR preparation.

## Run locally

```bash
npm install
npm --prefix server install
npm run dev:full
```

The frontend runs on http://localhost:5173. The professional API runs on http://127.0.0.1:8787 and the Individual tax API runs on http://127.0.0.1:8788.

## User types
- Professional User — CA, CS, auditor, CFA and other finance professionals managing clients, projects, documents and reports
- Finance User — small-business owners managing their own business finances and reports
- Individual User — salaried individuals managing personal income, assets, investments and ITR

Admin and Super Admin roles are intentionally excluded from the current product and reserved for a future management module.

## Individual Phase 2 features
- Individual signup and authentication
- Personal finance dashboard
- Personal asset register
- Taxpayer profile foundation
- ITR draft creation
- ITR assessment-year and ITR-type metadata
- Local validation workflow
- Filing consent records
- Filing lifecycle/event storage
- ERI-ready submission boundary
- e-Verification and acknowledgement lifecycle placeholders

## ITR integration boundary
The application currently prepares and validates an ITR draft locally. The /api/individual/itr/:id/submit endpoint deliberately refuses external submission until an approved filing/ERI provider is configured.

The Income Tax Department's published ERI API specifications describe a flow involving login/session, taxpayer consent for client/prefill services, prefill, validation/submission, e-Verification and acknowledgement. Finpro should implement those external calls behind a server-side provider abstraction rather than placing credentials or signing material in the browser.

## Individual workflow
Signup → Individual Dashboard → Profile + Assets + Documents → Income / Deductions / Capital Gains → ITR Draft → Local Validation → Taxpayer Consent → Approved ERI Integration → Final Validation + Submit → e-Verify → Acknowledgement

AI should assist with document understanding and explanations; material tax calculations should remain deterministic and reviewable.

## Phase 1 professional workspace
The original CA/CS/CFA workspace remains available with clients, projects, documents, AI assistants, financial analysis, reports, tasks, compliance, knowledge base, analytics, team management, audit and billing.

## Production boundary
Do not expose SQLite files or local uploads publicly. Production ITR filing also requires the appropriate Income Tax Department/ERI integration, credentials, consent handling, signing/security controls, validation and operational approval.

## Latest architecture update — 27 September 2026

The repository now includes a **Phase 1 local backend foundation** for the professional workspace:

- Node.js + Express API
- SQLite via better-sqlite3
- Backend-controlled login and signup
- Super Admin / Admin / Finance User role controls
- Organization-scoped user management
- Persistent clients, projects, documents, tasks and AI conversations
- Compliance, knowledge-base, settings and audit APIs
- Local upload-storage foundation
- Seed/bootstrap data for local development
- Persistent Kanban task status updates

### Local services

| Service | URL |
|---|---|
| React/Vite frontend | http://localhost:5173 |
| Professional API | http://127.0.0.1:8787 |
| API health | http://127.0.0.1:8787/api/health |
| SQLite database | `server/data/finotech.local.db` |
| Local uploads | `server/uploads` |

Run:

```bash
npm install
npm --prefix server install
npm run dev:full
```

If the frontend is started separately, configure:

```env
VITE_API_URL=http://127.0.0.1:8787
```

### Current Phase 1 boundary

The local backend is a development foundation, not the final production architecture. Before external production launch, migrate to PostgreSQL, use managed object storage, implement production-grade password hashing/session security, add document parsing/OCR, real LLM/RAG integration, deterministic financial/tax calculation services, monitoring, backups and security testing.

## ITR roadmap

Finotech AI is being extended with a dedicated **ITR Filing** workflow for Indian tax professionals and, where applicable, individual taxpayers.

Target workflow:

```
Client / Taxpayer
   ↓
Assessment Year + ITR Type
   ↓
Documents / AIS / TIS / 26AS / Books
   ↓
Extraction
   ↓
Reconciliation
   ↓
Deterministic Tax Computation
   ↓
Validation
   ↓
CA / Reviewer
   ↓
Client Approval
   ↓
Filing Data / JSON
   ↓
Approved Filing / ERI Integration
   ↓
e-Verification
   ↓
Acknowledgement
```

The product should use AI for extraction, explanations, anomaly detection and workflow assistance, while material tax calculations remain deterministic and reviewable.

**Direct filing is not enabled merely by adding an AI agent or browser automation.** Production submission must use the appropriate approved Income Tax Department/ERI integration, server-side credentials/consent/security controls and applicable validation requirements.

See:

- `docs/BRD-HLD-LLD.md` — master product, architecture and implementation specification
- `docs/ITR-FILING-SPEC.md` — ITR product and technical specification
