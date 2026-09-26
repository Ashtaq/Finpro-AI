# Finotech AI — Finance Intelligence SaaS

A separate, production-oriented React + TypeScript + Vite frontend scaffold for a multi-tenant Finance AI SaaS platform.

## Included
- Login / signup demo flows
- Super Admin / Admin / Finance User RBAC
- Organization, client and project workspaces
- AI agent marketplace and professional-review notices
- Evidence/citation-oriented AI responses
- Document management and mock processing states
- Financial analysis, ratios, forecasting and budget-vs-actual
- Anomaly detection, valuation and due diligence
- MIS/report builder
- Tasks, compliance calendar, knowledge base, workflow library
- Team collaboration, notifications, analytics, audit log
- Billing/usage-ready architecture
- Responsive enterprise UI
- Replaceable mock API service layer

## Run
Recommended runtime: Node 20.14+ (or newer Node 20/22). The project pins `@vitejs/plugin-react` to 4.3.4 for compatibility with Vite 6 and older Node 20 releases.

```bash
npm install
npm run dev
```

## Demo roles
The login screen provides role switching for:
- Super Admin
- Admin
- Finance User

No production credentials or API keys are included.

## Architecture
The frontend deliberately separates pages from services so a real backend can replace the mock services without rewriting the UI.

AI provider keys should be kept server-side in the eventual backend. This starter app uses deterministic mock AI responses.
# Finpro-AI
