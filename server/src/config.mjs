import path from "node:path";
import { z } from "zod";

const bool = (fallback) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Public origin(s) of the web app, comma separated. Used for CSRF origin checks,
  // CORS (only when the SPA is hosted on a different origin) and redirects.
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().optional(),
  TRUST_PROXY: z.string().default("false"),

  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  UPLOAD_DIR: z.string().optional(),
  STATIC_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(25),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(12),
  COOKIE_SECURE: bool(false),

  SEED_DEMO: bool(false),

  // none = assistant says AI is not configured; service = AI_Assistant_Code (FastAPI) service.
  AI_PROVIDER: z.enum(["none", "service", "anthropic"]).default("none"),
  AI_SERVICE_URL: z.string().url().default("http://127.0.0.1:8090"),
  AI_SERVICE_TOKEN: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(120_000),

  KYC_MODE: z.enum(["disabled", "mock", "sandbox", "digilocker"]).default("disabled"),
  // When true, Individual users must complete identity verification before using tax features.
  KYC_REQUIRED: bool(true),
  DIGILOCKER_CLIENT_ID: z.string().optional(),
  DIGILOCKER_CLIENT_SECRET: z.string().optional(),
  DIGILOCKER_REDIRECT_URI: z.string().optional(),

  ITR_PROVIDER: z.enum(["none"]).default("none"),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === "production";
  const appOrigins = c.APP_ORIGIN.split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

  const problems = [];
  if (isProd) {
    if (appOrigins.some((o) => o.startsWith("http://") && !o.includes("localhost"))) problems.push("APP_ORIGIN must use https in production");
    if (!c.COOKIE_SECURE && appOrigins.every((o) => o.startsWith("https://"))) c.COOKIE_SECURE = true;
    if (c.SEED_DEMO) problems.push("SEED_DEMO must not be enabled in production");
    if (c.KYC_MODE === "mock" || c.KYC_MODE === "sandbox") problems.push(`KYC_MODE=${c.KYC_MODE} is not allowed in production`);
  }
  if (c.AI_PROVIDER === "anthropic")
    problems.push("AI_PROVIDER=anthropic was replaced by the AI_Assistant_Code service: set AI_PROVIDER=service and configure AI_TOP_PROVIDER=anthropic there");
  if (isProd && c.AI_PROVIDER === "service" && (c.AI_SERVICE_TOKEN || "").length < 32)
    problems.push("AI_SERVICE_TOKEN (32+ characters, same value as the AI service) is required in production");
  if (c.KYC_MODE === "digilocker" && !(c.DIGILOCKER_CLIENT_ID && c.DIGILOCKER_CLIENT_SECRET && c.DIGILOCKER_REDIRECT_URI))
    problems.push("DIGILOCKER_CLIENT_ID, DIGILOCKER_CLIENT_SECRET and DIGILOCKER_REDIRECT_URI are required when KYC_MODE=digilocker");
  if (problems.length) throw new Error(`Invalid configuration: ${problems.join("; ")}`);

  let trustProxy = c.TRUST_PROXY;
  if (trustProxy === "true") trustProxy = true;
  else if (trustProxy === "false") trustProxy = false;
  else if (/^\d+$/.test(trustProxy)) trustProxy = Number(trustProxy);

  return {
    env: c.NODE_ENV,
    isProd,
    isTest: c.NODE_ENV === "test",
    host: c.HOST,
    port: c.PORT,
    logLevel: c.NODE_ENV === "test" ? "silent" : c.LOG_LEVEL,
    appOrigins,
    appUrl: appOrigins[0],
    corsOrigins: c.CORS_ORIGINS
      ? c.CORS_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    trustProxy,
    dataDir: c.DATA_DIR,
    uploadDir: c.UPLOAD_DIR || path.join(c.DATA_DIR, "uploads"),
    staticDir: c.STATIC_DIR,
    maxUploadBytes: Math.round(c.MAX_UPLOAD_MB * 1024 * 1024),
    sessionTtlMs: c.SESSION_TTL_HOURS * 3600 * 1000,
    cookieSecure: c.COOKIE_SECURE,
    seedDemo: c.SEED_DEMO,
    ai: {
      provider: c.AI_PROVIDER,
      serviceUrl: c.AI_SERVICE_URL.replace(/\/$/, ""),
      serviceToken: c.AI_SERVICE_TOKEN || DEV_AI_SERVICE_TOKEN,
      timeoutMs: c.AI_TIMEOUT_MS,
    },
    kyc: kycConfig(c, appOrigins[0]),
    itr: { provider: c.ITR_PROVIDER },
  };
}

// Used only outside production when AI_SERVICE_TOKEN is unset; the AI service has the same default.
export const DEV_AI_SERVICE_TOKEN = "finpro-dev-ai-token";

export const SANDBOX_CLIENT = { id: "finpro-sandbox-client", secret: "finpro-sandbox-secret" };

function kycConfig(c, appUrl) {
  const enabled = c.KYC_MODE !== "disabled";
  const base = { mode: c.KYC_MODE, enabled, required: enabled && c.KYC_REQUIRED };
  if (c.KYC_MODE === "sandbox") {
    // Local DigiLocker simulator served by this API (see routes/digilocker-sandbox.mjs).
    // Browser-facing URLs go through the app origin (Vite proxies /api in dev);
    // server-to-server calls hit this process directly.
    const internal = `http://127.0.0.1:${c.PORT}/api/sandbox/digilocker`;
    return {
      ...base,
      clientId: SANDBOX_CLIENT.id,
      clientSecret: SANDBOX_CLIENT.secret,
      redirectUri: `${appUrl}/api/kyc/digilocker/callback`,
      urls: {
        authorize: `${appUrl}/api/sandbox/digilocker/authorize`,
        token: `${internal}/token`,
        user: `${internal}/user`,
        issuedDocs: `${internal}/files/issued`,
        docXml: `${internal}/xml`,
        aadhaarXml: `${internal}/xml/eaadhaar`,
      },
    };
  }
  return { ...base, clientId: c.DIGILOCKER_CLIENT_ID, clientSecret: c.DIGILOCKER_CLIENT_SECRET, redirectUri: c.DIGILOCKER_REDIRECT_URI };
}
