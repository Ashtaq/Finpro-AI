import { forbidden, unauthorized } from "../lib/errors.mjs";
import { resolveSession, SESSION_COOKIE } from "../lib/sessions.mjs";

/** Attach `req.user` when a valid session cookie is present. Never fails the request. */
export function loadSession(db, config) {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.sessionToken = token;
    req.user = resolveSession(db, config, token) || null;
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Restrict a route to the given roles (requires auth). */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
