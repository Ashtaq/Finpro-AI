# Deployment guide

Finpro AI ships as one stateless-code / stateful-volume container. Any platform that runs a Docker image with a **persistent volume** works (Azure App Service for Containers, AWS ECS/Fargate + EFS, Render, Railway, Fly.io, a VM with Docker).

> SQLite is used for the initial launch. Run **exactly one instance** of the container against a given volume. Horizontal scaling requires the PostgreSQL migration listed in PRODUCTION-READINESS.md.

## 1. Build

```bash
docker build -t finpro-ai:2.0.0 .
```

CI (`.github/workflows/ci.yml`) runs lint, type-check, tests, build, dependency audit, and a container smoke test on every push/PR.

## 2. Configure

Create the environment from `.env.example`. Minimum for production:

```env
NODE_ENV=production
APP_ORIGIN=https://app.yourdomain.in
TRUST_PROXY=1            # behind a load balancer / ingress
DATA_DIR=/data           # mount a persistent volume here
```

Store secrets (`ANTHROPIC_API_KEY`, `DIGILOCKER_CLIENT_SECRET`) in the platform's secret store, not in the image.

## 3. Run

```bash
docker run -d --name finpro \
  -p 8787:8787 \
  --env-file .env \
  -v finpro-data:/data \
  --read-only --tmpfs /tmp \
  --restart unless-stopped \
  finpro-ai:2.0.0
```

Terminate TLS at your load balancer / reverse proxy and forward to port 8787. The app sets HSTS, secure cookies and CSP itself.

Health endpoints:

| Path          | Use                         |
| ------------- | --------------------------- |
| `/api/health` | liveness (process is up)    |
| `/api/ready`  | readiness (database usable) |

Migrations apply automatically on start and are recorded in `schema_migrations`.

## 4. Backups (required)

Everything lives in `DATA_DIR`: `finpro.db` (+ `-wal`/`-shm`) and `uploads/`.

- **Database**: use [Litestream](https://litestream.io) to stream to object storage, or take a consistent snapshot with `sqlite3 /data/finpro.db ".backup '/backup/finpro-$(date +%F).db'"` on a schedule.
- **Uploads**: sync `/data/uploads` to object storage (versioning on).
- Test a restore before go-live and quarterly after.

## 5. Enabling optional integrations

### AI assistant (Claude)

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...         # secret
AI_MODEL=claude-sonnet-5-5    # any available model id
```

Review the data-processing terms for sending client documents to an AI provider and update your privacy policy before enabling.

### DigiLocker KYC

Register as a DigiLocker requester, then:

```env
KYC_MODE=digilocker
DIGILOCKER_CLIENT_ID=...
DIGILOCKER_CLIENT_SECRET=...  # secret
DIGILOCKER_REDIRECT_URI=https://app.yourdomain.in/api/kyc/digilocker/callback
```

Endpoint URLs can be overridden with `DIGILOCKER_*_URL` variables if your partner agreement specifies different ones.

### ITR e-filing

Not available. `ITR_PROVIDER` only accepts `none`. Implement an ERI adapter in `server/src/routes/individual.mjs` (submit, e-verify, acknowledgement) after ERI approval.

## 6. Go-live checklist

- [ ] `APP_ORIGIN` is the final https URL; DNS + TLS working
- [ ] Persistent volume mounted at `DATA_DIR`; backups running and a restore tested
- [ ] `SEED_DEMO` unset; no demo accounts in the database
- [ ] Log shipping configured (stdout is JSON via pino)
- [ ] Uptime monitor on `/api/ready`
- [ ] Terms of service and privacy policy pages published and linked from signup
- [ ] Items in PRODUCTION-READINESS.md "Before launch" signed off
