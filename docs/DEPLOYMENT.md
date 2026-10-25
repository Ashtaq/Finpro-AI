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

Store secrets (`AI_SERVICE_TOKEN`, `AI_HOSTED_API_KEY`, `AI_TOP_API_KEY`, `DIGILOCKER_CLIENT_SECRET`) in the platform's secret store, not in the image.

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

### AI assistant (AI_Assistant_Code service)

The assistant runs as a second container built from `AI_Assistant_Code/`. Keep it on the private network only (no public port); the Finpro API calls it with a shared bearer token.

```env
# Finpro API
AI_PROVIDER=service
AI_SERVICE_URL=http://ai:8090          # internal address of the AI container
AI_SERVICE_TOKEN=<64 hex chars>        # secret, same value in both containers

# AI service
AI_ENV=production
AI_HOSTED_NAME=groq                    # cheap hosted open-source model (fast tier)
AI_HOSTED_BASE_URL=https://api.groq.com/openai/v1
AI_HOSTED_API_KEY=...                  # secret
AI_HOSTED_MODEL=<model id from the provider>
AI_TOP_PROVIDER=anthropic              # top model for complex questions
AI_TOP_API_KEY=...                     # secret
AI_TOP_MODEL=claude-opus-5-5
AI_TOP_DAILY_LIMIT_PER_ORG=200
```

```bash
docker build -t finpro-ai-assistant:1.0.0 AI_Assistant_Code
docker run -d --name ai --network <private-net> --env-file ai.env --read-only --tmpfs /tmp finpro-ai-assistant:1.0.0
```

Or with Compose: `docker compose --profile ai up --build`. Health: `GET /health` on port 8090 (tiers and models, no secrets). The service refuses to start in production without a 32+ character token and a complete fast-tier configuration.

Before enabling: review the data-processing terms of each model provider (prefer zero-data-retention plans), record customer consent for sending documents to AI providers, and update your privacy policy. PAN, Aadhaar, mobile numbers and e-mails are masked before any hosted model call (`AI_REDACT_PII=true`).

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
