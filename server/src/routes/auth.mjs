import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { badRequest, conflict, unauthorized } from "../lib/errors.mjs";
import { toUser } from "../lib/mappers.mjs";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/password.mjs";
import { cookieOptions, createSession, destroySession, SESSION_COOKIE } from "../lib/sessions.mjs";
import { email, isoDate, pan, parse, password, PROFESSIONAL_ROLES, requiredText, ROLES } from "../lib/validate.mjs";
import { requireAuth } from "../middleware/auth.mjs";

const signupSchema = z.object({
  name: requiredText(120),
  email: email(),
  password: password(),
  role: z.enum(ROLES),
  professionalRole: z.enum(PROFESSIONAL_ROLES).default("Other"),
  organizationName: z.string().trim().max(120).optional(),
  acceptTerms: z.literal(true, { message: "must be accepted" }),
  // Individual accounts: identity details used for DigiLocker verification.
  pan: pan().optional(),
  dob: isoDate().optional(),
});
const loginSchema = z.object({ email: email(), password: z.string().min(1).max(128) });

export function loadUser(db, id) {
  return db
    .prepare(
      "SELECT u.*, o.name AS organization_name, ip.kyc_status FROM users u JOIN organizations o ON o.id = u.organization_id LEFT JOIN individual_profiles ip ON ip.user_id = u.id WHERE u.id = ?",
    )
    .get(id);
}

export default function authRoutes({ db, config }) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isTest ? 1000 : 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a few minutes and try again." },
  });

  r.post("/signup", limiter, async (req, res) => {
    const b = parse(signupSchema, req.body);
    if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ?").get(b.email)) throw conflict("An account with this email already exists.");
    if (b.role === "Individual" && config.kyc.required) {
      if (!b.pan) throw badRequest("pan: is required for identity verification");
      if (!b.dob) throw badRequest("dob: is required for identity verification");
    }
    if (b.dob && (b.dob > new Date().toISOString().slice(0, 10) || b.dob < "1900-01-01")) throw badRequest("dob: must be a valid date of birth");
    if (b.pan && db.prepare("SELECT 1 FROM individual_profiles WHERE pan = ? AND kyc_status = 'VERIFIED'").get(b.pan))
      throw conflict("This PAN is already verified on another Finpro account.");
    const passwordHash = await hashPassword(b.password);
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const personal = b.role === "Individual";
    const orgName = b.organizationName || (personal ? `${b.name} — Personal` : `${b.name}'s Workspace`);
    db.transaction(() => {
      db.prepare("INSERT INTO organizations(id, name, plan, kind) VALUES (?,?,?,?)").run(orgId, orgName, "Free", personal ? "personal" : "workspace");
      db.prepare("INSERT INTO users(id, organization_id, name, email, password_hash, role, professional_role) VALUES (?,?,?,?,?,?,?)").run(
        userId,
        orgId,
        b.name,
        b.email,
        passwordHash,
        b.role,
        b.role === "Professional User" ? b.professionalRole : "Other",
      );
      if (personal) db.prepare("INSERT INTO individual_profiles(user_id, pan, dob) VALUES (?,?,?)").run(userId, b.pan || null, b.dob || null);
    })();
    const user = loadUser(db, userId);
    createSession(db, config, req, res, userId);
    audit(db, req, "Signup", "Authentication", { role: b.role }, user);
    res.status(201).json({ user: toUser(user) });
  });

  r.post("/login", limiter, async (req, res) => {
    const b = parse(loginSchema, req.body);
    const row = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(b.email);
    const ok = row ? await verifyPassword(b.password, row.password_hash) : await burnPasswordCheck(b.password);
    if (!ok || !row.active) throw unauthorized("Invalid email or password.");
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    if (req.sessionToken) destroySession(db, req.sessionToken);
    createSession(db, config, req, res, row.id);
    const user = loadUser(db, row.id);
    audit(db, req, "Login", "Authentication", {}, user);
    res.json({ user: toUser(user) });
  });

  r.post("/logout", (req, res) => {
    if (req.user) audit(db, req, "Logout", "Authentication");
    destroySession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(config), maxAge: undefined });
    res.status(204).end();
  });

  r.get("/me", requireAuth, (req, res) => res.json({ user: toUser(req.user) }));

  return r;
}
