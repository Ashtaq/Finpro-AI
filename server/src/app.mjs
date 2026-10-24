import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { loadSession } from "./middleware/auth.mjs";
import { errorHandler, notFoundHandler } from "./middleware/errors.mjs";
import { cors, originCheck } from "./middleware/security.mjs";
import accountRoutes from "./routes/account.mjs";
import assistantRoutes from "./routes/assistant.mjs";
import authRoutes from "./routes/auth.mjs";
import clientRoutes from "./routes/clients.mjs";
import documentRoutes from "./routes/documents.mjs";
import individualRoutes from "./routes/individual.mjs";
import kycRoutes from "./routes/kyc.mjs";
import projectRoutes from "./routes/projects.mjs";
import taskRoutes from "./routes/tasks.mjs";
import userRoutes from "./routes/users.mjs";
import workspaceRoutes from "./routes/workspace.mjs";
import { createAiService } from "./services/ai.mjs";
import { createDigiLocker } from "./services/digilocker.mjs";
import { createLocalStorage } from "./services/storage.mjs";

export const VERSION = "2.0.0";

/**
 * Build the Express application. Dependencies are injectable for tests.
 * @param {{db: import("better-sqlite3").Database, config: ReturnType<import("./config.mjs").loadConfig>, logger: import("pino").Logger, ai?: any, storage?: any, digilocker?: any}} deps
 */
export function createApp({ db, config, logger, ai, storage, digilocker }) {
  const ctx = {
    db,
    config,
    ai: ai ?? createAiService(config),
    storage: storage ?? createLocalStorage(config.uploadDir),
    digilocker: digilocker ?? createDigiLocker(config.kyc),
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers["x-request-id"] && String(req.headers["x-request-id"]).slice(0, 64);
        const value = id || crypto.randomUUID();
        res.setHeader("X-Request-Id", value);
        return value;
      },
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => (req.user ? { userId: req.user.id, orgId: req.user.organization_id } : {}),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  const api = express.Router();
  api.use(cors(config));
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.isTest ? 10_000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests." },
    }),
  );
  api.use(express.json({ limit: "256kb" }));
  api.use(cookieParser());
  api.use(originCheck(config));
  api.use(loadSession(db, config));
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  api.get("/health", (_req, res) => res.json({ ok: true, version: VERSION }));
  api.get("/ready", (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  api.get("/meta", (_req, res) =>
    res.json({
      version: VERSION,
      demo: config.seedDemo,
      ai: { enabled: ctx.ai.enabled },
      kyc: { enabled: config.kyc.mode !== "disabled", mode: config.kyc.mode },
      itrFiling: { enabled: config.itr.provider !== "none" },
      maxUploadBytes: config.maxUploadBytes,
    }),
  );

  api.use("/auth", authRoutes(ctx));
  api.use("/account", accountRoutes(ctx));
  api.use("/users", userRoutes(ctx));
  api.use("/clients", clientRoutes(ctx));
  api.use("/projects", projectRoutes(ctx));
  api.use("/tasks", taskRoutes(ctx));
  api.use("/documents", documentRoutes(ctx));
  api.use("/assistant", assistantRoutes(ctx));
  api.use("/individual", individualRoutes(ctx));
  api.use("/kyc", kycRoutes(ctx));
  api.use("/", workspaceRoutes(ctx));
  api.use(notFoundHandler);

  app.use("/api", api);

  // Serve the built SPA when present (single-origin production deployment).
  const staticDir = config.staticDir && path.resolve(config.staticDir);
  if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
    app.use("/static", express.static(path.join(staticDir, "static"), { immutable: true, maxAge: "1y", fallthrough: false }));
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
