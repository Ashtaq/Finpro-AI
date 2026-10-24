# Security

## Reporting a vulnerability

Email the maintainers privately (do not open a public issue). Include steps to reproduce and impact. We aim to acknowledge within 3 business days.

## Security model

**Authentication**

- Passwords hashed with scrypt (N=16384, r=8, p=1, per-user salt); minimum 10 characters.
- Sessions are opaque 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). Only a SHA-256 of the token is stored server-side.
- Sessions slide on activity and expire after `SESSION_TTL_HOURS`. Password change/reset and deactivation revoke sessions.
- Login and signup are rate-limited; login timing does not reveal whether an email exists.

**Authorization**

- Every row is owned by an organization; every query is scoped to `req.user.organization_id` (individual data additionally to `req.user.id`).
- Role checks are enforced in the API (`requireRole`) — the UI mirrors them only for navigation.
- Request bodies are validated with zod; unknown fields are rejected on update endpoints.

**Web**

- Helmet: CSP (`default-src 'self'`), HSTS in production, `frame-ancestors 'none'`, no-sniff, referrer policy.
- CSRF: SameSite cookies plus an Origin/Referer allow-list on state-changing requests.
- API responses are `Cache-Control: no-store`.

**Files**

- Uploads are size-limited, extension allow-listed, signature-checked, stored under random keys outside the web root, and served only to members of the owning organization with `Content-Disposition: attachment`.

**Data handling**

- Audit log records sign-ins, uploads, downloads, AI requests, user and permission changes.
- KYC stores only status and the last 4 Aadhaar digits; no documents or provider tokens.
- Logs redact cookies, authorization headers and password fields.

## Known limitations

See [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) — notably: no MFA yet, no email verification / self-service password reset yet, uploads are not malware-scanned, and data-at-rest encryption depends on the host volume.
