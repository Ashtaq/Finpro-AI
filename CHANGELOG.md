# Changelog

## 2.1.0 — 2026-10-25 — AI assistant service

### Added

- `AI_Assistant_Code/`: FastAPI service that owns the AI assistant — prompts, model routing, PII masking, caching and fallback.
- Two model tiers: a fast tier (Ollama locally, a hosted open-source model through any OpenAI-compatible API in production) and a top tier (Claude or any OpenAI-compatible model) for complex questions.
- Rule-based complexity router with reasons in every response; per-organization daily cap on top-model calls.
- Reversible masking of PAN, Aadhaar, mobile numbers and e-mails before any hosted model call.
- **Deep analysis** toggle in the chat and the answering model shown under each reply.
- `npm run ai:setup`, `npm run dev:ai`, `npm run dev:all`, `npm run test:ai`; Compose profiles `ai` and `ollama`; CI job for the service.

### Changed

- `AI_PROVIDER=anthropic` is replaced by `AI_PROVIDER=service`; model keys now live in the AI service settings.

### Fixed

- AI Assistant was squeezed into a 240px column on screens narrower than 1180px.

## 2.0.0 — 2026-10-24 — Production hardening

### Fixed

- API failed to start: `server/db.mjs` contained a broken merge (JS inside an SQL string, duplicated transaction block).
- Frontend build failed (`Signup` called `signup()` with the wrong arguments; KYC endpoints it depended on did not exist).
- `/assets` page returned 500 on reload because it collided with Vite's asset folder (build assets now under `/static`).
- AI Assistant crashed after sending a message in current Chromium (`scrollIntoView` promise returned from an effect).
- Long modals (e.g. New client) could not be scrolled to the submit button.
- No navigation on mobile (sidebar was hidden with no menu).

### Security

- Replaced `x-user-id` header "authentication" (anyone could impersonate any user) with server-side cookie sessions.
- Replaced unsalted SHA-256 password hashes with scrypt.
- Fixed cross-tenant writes (`POST /api/users` accepted any `organizationId`) and cross-tenant dashboard counts.
- Removed browser-side mock API that stored plaintext passwords in localStorage and a hardcoded demo-login bypass.
- Added helmet/CSP/HSTS, CSRF origin checks, rate limiting, request validation, upload signature checks, audit of downloads.

### Changed

- Two API processes sharing one SQLite file merged into a single structured API (`server/src`: config, migrations, middleware, routes, services).
- Versioned SQL migrations; demo data only via `SEED_DEMO=true` (refused in production).
- Every page now uses the real API — removed hardcoded dashboards, fake reports, fake ITR figures and mock data.
- Real file upload/download/delete; AI assistant with pluggable provider and document context; DigiLocker KYC wired (disabled by default); ITR draft editor with deterministic pre-checks, consent and blocked submission.
- Financial Analysis is now a transparent ratio calculator over user-entered figures.
- Self-hosted fonts (CSP-compatible), lazy-loaded routes, error boundary, 404 page.
- Tooling: ESLint, Prettier, 22 API tests, GitHub Actions CI, Dockerfile, docker-compose, `.env.example`.
- Branding unified as "Finpro AI".

### Removed

- Unrouted pages `PlatformAdmin` and `Billing`, `KycCallback`, `mockApi`, `mockData`.
