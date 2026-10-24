import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { conflict, forbidden, notFound } from "../lib/errors.mjs";
import { toUser } from "../lib/mappers.mjs";
import { hashPassword } from "../lib/password.mjs";
import { destroyUserSessions } from "../lib/sessions.mjs";
import { email, parse, password, PROFESSIONAL_ROLES, requiredText, WORKSPACE_ROLES } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";
import { loadUser } from "./auth.mjs";

const createSchema = z.object({
  name: requiredText(120),
  email: email(),
  password: password(),
  role: z.enum(WORKSPACE_ROLES),
  professionalRole: z.enum(PROFESSIONAL_ROLES).default("Other"),
});
const updateSchema = z
  .object({
    name: requiredText(120).optional(),
    email: email().optional(),
    role: z.enum(WORKSPACE_ROLES).optional(),
    professionalRole: z.enum(PROFESSIONAL_ROLES).optional(),
  })
  .strict();
const resetSchema = z.object({ password: password() });

/** Workspace user management — Professional Users manage their own organization only. */
export default function userRoutes({ db }) {
  const r = Router();
  r.use(requireRole("Professional User"));

  const target = (req) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?").get(req.params.id, req.user.organization_id);
    if (!row) throw notFound("User not found.");
    if (row.id === req.user.id) throw forbidden("Use Settings to manage your own account.");
    return row;
  };

  r.get("/", (req, res) => {
    const rows = db
      .prepare(
        "SELECT u.*, o.name AS organization_name FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.organization_id = ? AND u.id <> ? AND u.active = 1 ORDER BY u.created_at DESC",
      )
      .all(req.user.organization_id, req.user.id);
    res.json(rows.map(toUser));
  });

  r.post("/", async (req, res) => {
    const b = parse(createSchema, req.body);
    if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ?").get(b.email)) throw conflict("An account with this email already exists.");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users(id, organization_id, name, email, password_hash, role, professional_role) VALUES (?,?,?,?,?,?,?)").run(
      id,
      req.user.organization_id,
      b.name,
      b.email,
      await hashPassword(b.password),
      b.role,
      b.professionalRole,
    );
    audit(db, req, "Create user", b.email, { role: b.role });
    res.status(201).json(toUser(loadUser(db, id)));
  });

  r.patch("/:id", (req, res) => {
    const row = target(req);
    const b = parse(updateSchema, req.body);
    if (b.email && db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?").get(b.email, row.id))
      throw conflict("Another account already uses this email.");
    db.prepare(
      "UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role), professional_role = COALESCE(?, professional_role), updated_at = ? WHERE id = ?",
    ).run(b.name ?? null, b.email ?? null, b.role ?? null, b.professionalRole ?? null, new Date().toISOString(), row.id);
    if (b.role && b.role !== row.role) destroyUserSessions(db, row.id);
    audit(db, req, "Update user", row.email, { fields: Object.keys(b) });
    res.json(toUser(loadUser(db, row.id)));
  });

  r.delete("/:id", (req, res) => {
    const row = target(req);
    db.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    destroyUserSessions(db, row.id);
    audit(db, req, "Deactivate user", row.email);
    res.status(204).end();
  });

  r.post("/:id/reset-password", async (req, res) => {
    const row = target(req);
    const b = parse(resetSchema, req.body);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await hashPassword(b.password), new Date().toISOString(), row.id);
    destroyUserSessions(db, row.id);
    audit(db, req, "Reset password", row.email);
    res.status(204).end();
  });

  return r;
}
