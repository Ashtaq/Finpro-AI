import { HttpError } from "../lib/errors.mjs";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth (cookies are already SameSite=Lax): reject state-changing
 * requests whose Origin/Referer is present and not one of the configured app origins.
 */
export function originCheck(config) {
  const allowed = new Set([...config.appOrigins, ...config.corsOrigins].map((o) => o.replace(/\/$/, "")));
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get("origin") || refererOrigin(req.get("referer"));
    if (!origin) return next(); // non-browser clients; SameSite cookies still apply
    const self = `${req.protocol}://${req.get("host")}`;
    if (origin === self || allowed.has(origin)) return next();
    next(new HttpError(403, "Cross-origin request blocked."));
  };
}

function refererOrigin(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Minimal CORS for split deployments (SPA on a different origin). Same-origin deployments need none. */
export function cors(config) {
  const allowed = new Set(config.corsOrigins);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Max-Age", "600");
        return res.status(204).end();
      }
    }
    next();
  };
}
