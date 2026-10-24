import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { badRequest, conflict, unauthorized } from "../lib/errors.mjs";
import { toUser } from "../lib/mappers.mjs";
import { hashPassword, verifyPassword } from "../lib/password.mjs";
import { destroyUserSessions } from "../lib/sessions.mjs";
import { email, parse, password, phone, requiredText } from "../lib/validate.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import { loadUser } from "./auth.mjs";

const updateSchema = z.object({ name: requiredText(120), email: email(), phone: phone().default("") });
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password() });

export default function accountRoutes({ db }) {
  const r = Router();
  r.use(requireAuth);

  r.get("/", (req, res) => res.json({ user: toUser(req.user) }));

  r.patch("/", (req, res) => {
    const b = parse(updateSchema, req.body);
    if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?").get(b.email, req.user.id))
      throw conflict("Another account already uses this email.");
    db.prepare("UPDATE users SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?").run(
      b.name,
      b.email,
      b.phone,
      new Date().toISOString(),
      req.user.id,
    );
    audit(db, req, "Update account", "Account", { fields: Object.keys(b) });
    res.json({ user: toUser(loadUser(db, req.user.id)) });
  });

  r.post("/change-password", async (req, res) => {
    const b = parse(passwordSchema, req.body);
    if (!(await verifyPassword(b.currentPassword, req.user.password_hash))) throw unauthorized("Current password is incorrect.");
    if (b.currentPassword === b.newPassword) throw badRequest("New password must be different from the current password.");
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await hashPassword(b.newPassword), new Date().toISOString(), req.user.id);
    destroyUserSessions(db, req.user.id, req.sessionToken); // sign out other devices
    audit(db, req, "Change password", "Account");
    res.status(204).end();
  });

  return r;
}
