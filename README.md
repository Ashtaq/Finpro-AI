# Finpro AI

Finance workspace for Indian finance professionals, small businesses and individual taxpayers.

| Account type          | Who it's for                    | Workspace                                                                                                          |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Professional User** | CAs, CSs, auditors, CFAs        | Clients, projects, documents, tasks, compliance calendar, knowledge base, team, audit log, AI assistant, analytics |
| **Finance User**      | Shop owners, freelancers, SMEs  | Projects, documents, tasks, AI assistant, financial analysis, reports                                              |
| **Individual**        | Salaried / self-filing taxpayer | Asset register, tax documents, ITR preparation & pre-checks, AI assistant, personal summary                        |

## Architecture

```
Browser (React 19 SPA, Vite)
   │  same-origin, httpOnly session cookie
   ▼
Node 22 · Express 5 API  (server/src)
   ├── auth: scrypt passwords, server-side sessions, RBAC, per-org tenant isolation
   ├── security: helmet/CSP/HSTS, CSRF origin check, rate limits, zod validation
   ├── storage: SQLite (WAL, versioned migrations) + private file store
   ├── AI: provider abstraction (Anthropic Claude) — disabled unless configured
   ├── KYC: DigiLocker OAuth2/PKCE adapter — disabled unless configured
   └── ITR: deterministic draft checks; e-filing blocked until an ERI adapter exists
```

One container serves both the API (`/api/*`) and the built SPA.

## Quick start (development)

Requirements: Node 22+.

```bash
npm install
npm --prefix server install
echo "SEED_DEMO=true" > .env        # optional: demo data; defaults work for local dev
npm run dev:full
```

- Web: http://localhost:5173 (proxies `/api` to the API)
- API: http://127.0.0.1:8787/api/health
- Demo accounts (only with `SEED_DEMO=true`): `professional@finpro.demo`, `finance@finpro.demo`, `individual@finpro.demo` — password `Demo@Finpro2026`

## Scripts

| Command                           | What it does                                       |
| --------------------------------- | -------------------------------------------------- |
| `npm run dev:full`                | Web + API with reload                              |
| `npm run check`                   | Lint, type-check, API tests and production build   |
| `npm test`                        | API test suite (auth, RBAC, tenancy, uploads, ITR) |
| `npm run build`                   | Build the SPA into `dist/`                         |
| `npm start`                       | Run the API (serves `dist/` when `STATIC_DIR` set) |
| `npm --prefix server run migrate` | Apply/list database migrations                     |
| `docker compose up --build`       | Production-like container on http://localhost:8787 |

## Configuration

All settings are environment variables, validated at boot — see [`.env.example`](.env.example). In development, `npm run dev:api` also reads a root `.env` file; in production, supply variables through your platform. The server **refuses to start** with unsafe production settings (non-https `APP_ORIGIN`, demo seeding, mock KYC, AI enabled without a key).

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Read [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) before go-live — it lists what is done and what still needs a business or compliance decision.

## Regulated features

- **ITR filing** — the app prepares and pre-checks a return. It does **not** compute final tax liability and does **not** submit to the Income Tax Department; that needs an approved e-Return Intermediary (ERI) integration.
- **KYC** — DigiLocker verification requires a registered DigiLocker partner account. Raw Aadhaar/PAN documents and provider tokens are never stored.
- **AI** — outputs are assistive and labelled as such. The assistant never fabricates analysis when no provider is configured.

## Project docs

- [docs/BRD-HLD-LLD.md](docs/BRD-HLD-LLD.md) — product, architecture and design specification
- [docs/ITR-FILING-SPEC.md](docs/ITR-FILING-SPEC.md) — ITR product and technical specification
- [SECURITY.md](SECURITY.md) — security model and vulnerability reporting
- [CHANGELOG.md](CHANGELOG.md)

## Troubleshooting (local dev)

| Symptom                                                                                                                 | Fix                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node -v` shows < 22, `bad option: --env-file-if-exists`, or `better-sqlite3` build errors (`'climits' file not found`) | Put Node 22+ first on PATH (Homebrew: `/opt/homebrew/opt/node@22/bin`), then `rm -rf node_modules server/node_modules && npm install && npm --prefix server install` |
| `✖ Finpro dev environment is not ready`                                                                                 | Follow the printed command — usually reinstalling after `git pull` / branch switch                                                                                   |
| `[vite] http proxy error … ECONNREFUSED 127.0.0.1:8787`                                                                 | The API is not running. Check the `[api]` lines above it; switching branches while `dev:full` runs can leave stale dependencies — stop, reinstall, restart           |
| Demo login fails                                                                                                        | Demo users are created only on an empty database with `SEED_DEMO=true`: `rm -rf server/data` and restart                                                             |
