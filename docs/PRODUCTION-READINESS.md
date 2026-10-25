# Production readiness review — v2.0.0

Review date: 24 Oct 2026. Scope: the full repository (`src/`, `server/`, config, docs).

## Summary

The original repository could not run: the API crashed on start-up and the web build failed. Authentication trusted a client-supplied `x-user-id` header, so any user could act as any other. Half the screens showed hardcoded data.

v2.0.0 rebuilds the API and wires every screen to it. It is suitable for a **controlled launch** (single instance, known customers) once the "Before launch" items below are signed off. It is **not** an e-filing product yet.

## Findings and resolution

| # | Severity | Finding (before)                                                                 | Resolution                                                                 |
| - | -------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1 | Critical | API crashed on start (`db.mjs` broken merge)                                     | API rewritten; versioned migrations                                        |
| 2 | Critical | Auth = `x-user-id` header; seeded IDs were guessable (`u-professional`)          | Server-side sessions, httpOnly cookies, scrypt                              |
| 3 | Critical | Frontend fell back to a localStorage "API" with plaintext passwords + demo bypass | Removed; single API client                                                 |
| 4 | High     | `POST /api/users` created users in any organization                              | Org always taken from the session; tested                                  |
| 5 | High     | Dashboard counted AI messages across all tenants                                 | All queries org-scoped; tenancy test suite                                 |
| 6 | High     | Unsalted SHA-256 passwords, 6-char minimum                                       | scrypt, 10-char minimum, sessions revoked on change                        |
| 7 | High     | No rate limiting, CSP, HSTS, CSRF defence; 20 MB JSON bodies                     | helmet, origin check, rate limits, 256 KB JSON limit                       |
| 8 | High     | Frontend build failed; KYC endpoints referenced but missing                      | Fixed; KYC implemented behind `KYC_MODE`                                   |
| 9 | Medium   | Document upload stored only a file name                                          | Real uploads with type/signature checks, private storage, audited download |
| 10 | Medium  | Two Node processes writing one SQLite file                                        | Single process                                                              |
| 11 | Medium  | Hardcoded figures on dashboards, ITR (₹9,60,000 salary etc.), reports, analytics  | All replaced with live data or user input                                   |
| 12 | Medium  | No tests, lint, CI, container, env template                                      | Added                                                                       |
| 13 | Low     | No mobile navigation; long modals unreachable; Google Fonts blocked by CSP        | Fixed                                                                       |

## Before launch (needs an owner decision)

1. **Legal pages** — publish Terms of Service and Privacy Policy (DPDP Act 2023 notice, purpose, retention, grievance officer) and link them from signup.
2. **Backups** — configure Litestream or scheduled snapshots of `DATA_DIR` and test a restore.
3. **Email** — there is no email verification or self-service "forgot password" yet. Until an email provider is chosen, password resets go through a workspace Professional User; Individual users cannot self-recover. Decide whether that is acceptable for launch.
4. **AI data processing** — if enabling `AI_PROVIDER=service` with hosted or top models, confirm customers consent to client documents being sent to the AI provider.
5. **Hosting region** — choose an India region if your customers require data localisation.

## Roadmap (not blocking a controlled launch)

| Area           | Item                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| Scale          | Migrate to PostgreSQL + object storage (S3/Azure Blob) to run more than one instance        |
| Accounts       | Email verification, password reset by email, MFA (TOTP), session list / sign-out-everywhere |
| Documents      | Malware scanning; PDF/XLSX/DOCX text extraction so the AI can read them                     |
| Tax            | Versioned tax-computation engine (per AY, both regimes) with CA review; ERI integration     |
| Billing        | Plans/limits and payments (the old Billing page was a placeholder and was removed)          |
| Observability  | Metrics (request rate, latency, errors), error tracking (e.g. Sentry), alerting             |
| Testing        | Browser end-to-end tests in CI (Playwright)                                                 |

## Verification performed

- `npm run check`: ESLint, Prettier, TypeScript, 22 API tests (auth, sessions, CSRF, RBAC, tenant isolation, uploads, AI context scoping, ITR lifecycle, config guards), production build.
- `npm audit --omit=dev`: 0 vulnerabilities (web and API).
- Production-mode boot from the image layout: `/api/ready`, SPA routing, HSTS/CSP headers, `Secure; HttpOnly; SameSite=Lax` session cookie, refusal of unsafe config.
- Browser walkthrough of every page for all three roles at desktop and mobile widths, plus flows: ITR draft → income → checks → consent; document upload; client creation; task creation; AI message.
- Not verified here: the Docker image build itself (no Docker daemon in the review environment — CI builds and smoke-tests it), live DigiLocker and Anthropic calls (need credentials).
