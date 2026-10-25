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

/**
 * When identity verification is required, Individual users must be VERIFIED before using
 * tax/document features. Other roles are not affected.
 */
export const requireKyc = (config) => (req, _res, next) => {
  if (!config.kyc.required || req.user?.role !== "Individual" || req.user.kyc_status === "VERIFIED") return next();
  const err = forbidden("Verify your identity with DigiLocker to continue.");
  err.details = [{ field: "kyc", message: "KYC_REQUIRED" }];
  next(err);
};

/** Restrict a route to the given roles (requires auth). */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
