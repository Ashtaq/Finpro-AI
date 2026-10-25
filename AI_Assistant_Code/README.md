# AI_Assistant_Code — Finpro AI Assistant service

FastAPI service that answers Finpro's AI assistant questions. The Finpro Node API keeps authentication, RBAC, tenant isolation, document access and audit logging; it sends this service the question, conversation history and the already-authorized document text, and stores the answer.

```
Browser → Finpro API (Node) ──Bearer token──▶ AI service (FastAPI, :8090)
                                                ├─ router: fast or top tier?
                                                ├─ PII masking (hosted models only)
                                                ├─ cache + per-org daily budget for the top tier
                                                ├─ fast tier: Ollama (dev) / hosted open-source model (prod)
                                                └─ top tier: Claude or any OpenAI-compatible model
```

## How a question is answered

1. **Prompt** — the agent (`finance`, `tax`, `audit`, `investment`, `compliance`, `excel`, `document`) picks the system prompt (`app/agents.py`). Documents are wrapped in `<document>` tags and treated as untrusted data.
2. **Route** (`app/router.py`) — a free, rule-based score: agent type, analysis terms (DCF, reconcile, compare, compute, 26AS, regime…), number of documents, length, figures, multiple questions, conversation length. Short look-ups score negative. Score ≥ `AI_COMPLEX_THRESHOLD` (default 4) → top tier. The user can force the top model with **Deep analysis** in the UI, and `AI_ROUTING_MODE=fast|top` forces a tier for everyone. Every answer returns the score and reasons.
3. **Budget** — top-tier calls are capped per organization per day (`AI_TOP_DAILY_LIMIT_PER_ORG`). Over the cap, or with no top model configured, the fast model answers and the reply says so.
4. **Mask** (`app/redact.py`) — before calling any non-local model, PAN, Aadhaar, mobile numbers and e-mails become `[PAN_1]`-style placeholders; the real values are restored in the answer. Ollama runs locally, so it gets the raw text.
5. **Cache** — identical requests within `AI_CACHE_TTL_SECONDS` (per organization) are answered from memory.
6. **Call with fallback** — one retry on rate limits/5xx/network errors; if the chosen tier still fails, the other tier answers and the reply notes it. Claude calls mark the system prompt cacheable (prompt caching lowers repeat input cost).

## Run locally (macOS)

```bash
# 1. Ollama — free local model for development
brew install ollama
ollama serve            # or open the Ollama app
ollama pull qwen3:8b    # default OLLAMA_MODEL; any Ollama chat model works

# 2. From the repo root
npm run ai:setup        # creates AI_Assistant_Code/.venv and installs dependencies (Python 3.11+)
echo "AI_PROVIDER=service" >> .env
npm run dev:all         # web + API + AI service
```

The service reads the repo's root `.env`. Interactive API docs: http://127.0.0.1:8090/docs (development only).

Optional in development: set `AI_TOP_PROVIDER=anthropic` and `AI_TOP_API_KEY` to try the top tier; without it, complex questions are answered by Ollama with a note.

## Production

Fast tier = a hosted open-source model through any OpenAI-compatible API (Groq, Together, OpenRouter, DeepInfra, or your own vLLM server); top tier = Claude or another frontier model. See [`.env.example`](../.env.example) for every setting and [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#ai-assistant-ai_assistant_code-service) for the container setup. The service refuses to start in production without a 32+ character `AI_SERVICE_TOKEN` and a complete fast-tier configuration, and `/docs` is disabled.

The cache and daily budget are in memory (per container, reset on restart). Move them to Redis before running several replicas.

## API

| Method | Path         | Auth   | Purpose                                         |
| ------ | ------------ | ------ | ----------------------------------------------- |
| GET    | `/health`    | none   | Status, environment and configured tiers/models |
| GET    | `/v1/agents` | Bearer | Agent ids and names                             |
| POST   | `/v1/chat`   | Bearer | Answer a question                               |

`POST /v1/chat` request:

```json
{
  "agent_id": "tax",
  "message": "Compare old vs new regime for me",
  "history": [
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "…" }
  ],
  "documents": [{ "name": "form16.txt", "text": "…" }],
  "context": { "org_id": "…", "user_id": "…", "user_role": "Individual" },
  "complexity": "auto"
}
```

Response: `content`, `limitations`, `tier` (`fast`/`top`), `provider`, `model`, `route` (`mode`, `score`, `reasons`), `usage` (tokens), `latency_ms`, `cached`, `fallback_used`, `redacted_items`. Errors: `{ "error": "…" }` with 401, 422, 502 or 503.

## Develop

```bash
npm run test:ai         # pytest + ruff (from the repo root)
```

Code map: `app/main.py` (FastAPI app), `app/assistant.py` (orchestration), `app/router.py`, `app/redact.py`, `app/limits.py` (cache, budget), `app/agents.py` (prompts), `app/providers/` (Ollama/OpenAI-compatible, Anthropic), `app/config.py` (settings and production checks).
