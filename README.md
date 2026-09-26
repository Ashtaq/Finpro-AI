# Finotech AI — Finance Intelligence SaaS

A production-oriented React + TypeScript + Vite frontend with a Node/Express + SQLite Phase 1 backend.

## Phase 1 status

Phase 1 now includes a local persistent data layer. The browser UI calls the API when it is available; the legacy demo fallback remains available for frontend-only preview.

### Local database

SQLite is stored on disk at `server/data/finotech.local.db` by default.

Core tables:
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

The schema is also checked into `server/schema.sql`.

### Run locally

Install frontend and backend dependencies:

```bash
npm install
npm --prefix server install
```

Start the API:

```bash
npm run server:dev
```

Start the frontend in another terminal:

```bash
npm run dev
```

Or run both together:

```bash
npm run dev:full
```

The API listens on `http://127.0.0.1:8787` and the frontend on `http://localhost:5173`.

To point the frontend at a separately hosted API, set:

```bash
VITE_API_URL=http://your-api-host:8787
```

### Demo accounts

- Super Admin: `superadmin@finotech.demo`
- Admin: `admin@finotech.demo`
- Finance User: `finance@finotech.demo`
- Password: `demo123`

## Phase 1 production-readiness boundary

Implemented:
- backend-controlled login/signup against SQLite
- role-based user management and password resets
- organization/tenant scoping on core API queries
- client creation
- project/document/task persistence and reads
- task status updates / Kanban persistence
- AI conversation + message persistence
- audit log persistence
- organization settings persistence
- API health endpoint
- local-disk upload storage contract
- frontend-to-backend service abstraction

Still intentionally Phase 2:
- real LLM provider and streaming model responses
- binary XLSX/CSV/PDF/DOCX parsing and OCR
- object storage and signed download URLs
- production session tokens / SSO / MFA
- background document-processing workers
- report generation/export pipeline
- billing/payment provider integration
- hosted database, backups, monitoring and alerting
- full create/edit/delete UI for every domain module

Do not expose the SQLite file, `server/data`, or local uploads directly on a public production host.

## Architecture

```
React + Vite
   |
   | HTTP / JSON
   v
Node + Express API
   |
   +--> SQLite (local Phase 1 persistence)
   |
   +--> local uploads directory
   |
   +--> audit + settings + AI conversation records

Phase 2 extension points:
   API -> PostgreSQL
       -> object storage
       -> background queue
       -> document parser
       -> LLM / RAG service
       -> observability / billing
```

## Development notes

AI provider keys belong on the server, never in the Vite bundle. AI output is assistive and requires professional review before client delivery or decision use.

## Build

```bash
npm run build
```

For a deployable external environment, run the API as a separate service or use the Express server to serve the built frontend, after replacing local-disk persistence with managed infrastructure.
