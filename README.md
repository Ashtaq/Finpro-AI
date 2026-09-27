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
- Super Admin — platform administration
- Admin — organization/team administration
- Finance User — CA/CS/CFA/accounting/finance professional workspace
- Individual — personal finance, asset management and ITR workspace

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