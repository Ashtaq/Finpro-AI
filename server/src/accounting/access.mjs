// Access control for the accounting module.
//
//  * Only "Professional User" accounts (CA / CS / accounting professionals) may use it. Finance Users and
//    Individuals get 403 on every /api/accounting route.
//  * Inside a professional firm each user has an accounting role. Without an explicit assignment a
//    Professional User is an Admin — the same trust the rest of the workspace already gives them
//    (they can manage team members). Admins can then narrow staff to Accountant / Reviewer / Viewer.
//  * A user can additionally be restricted to specific clients; such users only see those clients' books.

import crypto from "node:crypto";
import { forbidden, notFound } from "../lib/errors.mjs";

export const ACCOUNTING_ROLES = ["Admin", "Accountant", "Reviewer", "Viewer"];

const CAPABILITIES = {
  Admin: ["read", "write", "approve", "admin"],
  Accountant: ["read", "write"],
  Reviewer: ["read", "approve"],
  Viewer: ["read"],
};

export function accountingRole(db, user) {
  const row = db.prepare("SELECT role FROM accounting_user_roles WHERE organization_id = ? AND user_id = ?").get(user.organization_id, user.id);
  return row?.role || "Admin";
}

export function clientRestriction(db, user, role) {
  if (role === "Admin") return null;
  const rows = db.prepare("SELECT client_id FROM accounting_client_access WHERE organization_id = ? AND user_id = ?").all(user.organization_id, user.id);
  return rows.length ? new Set(rows.map((r) => r.client_id)) : null;
}

/** Router-level guard: authenticated Professional User; attaches req.acct. */
export const requireAccounting = (db) => (req, _res, next) => {
  if (!req.user) return next(Object.assign(forbidden("Authentication required."), { status: 401 }));
  if (req.user.role !== "Professional User") return next(forbidden("The accounting module is available to professional accounts only."));
  const role = accountingRole(db, req.user);
  const caps = new Set(CAPABILITIES[role]);
  req.acct = {
    role,
    caps: [...caps],
    can: (cap) => caps.has(cap),
    clients: clientRestriction(db, req.user, role),
  };
  next();
};

export const requireCap = (cap) => (req, _res, next) => {
  if (!req.acct?.can(cap)) return next(forbidden(`Your accounting role (${req.acct?.role}) does not allow this action.`));
  next();
};

export function assertCap(req, cap) {
  if (!req.acct?.can(cap)) throw forbidden(`Your accounting role (${req.acct?.role}) does not allow this action.`);
}

/** Load a company the caller may access, or 404 (never reveal other tenants' ids). */
export function loadCompany(db, req, companyId) {
  const row = db.prepare("SELECT * FROM accounting_companies WHERE id = ? AND organization_id = ?").get(String(companyId), req.user.organization_id);
  if (!row || (req.acct.clients && !req.acct.clients.has(row.client_id))) throw notFound("Company not found.");
  return row;
}

/** Append to the immutable accounting audit trail. */
export function acctAudit(db, req, { companyId = null, action, entityType, entityId = null, summary = "", before, after }) {
  db.prepare(
    `INSERT INTO accounting_audit_logs(id, organization_id, company_id, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    req.user.organization_id,
    companyId,
    req.user.id,
    req.user.name,
    action,
    entityType,
    entityId,
    String(summary).slice(0, 500),
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    req.ip || null,
  );
}

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
