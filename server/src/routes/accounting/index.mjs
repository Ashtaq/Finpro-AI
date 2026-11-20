// /api/accounting — Professional accounting & financial management module.
// Every route requires a Professional User (see accounting/access.mjs); company routes additionally
// verify the company belongs to the caller's firm and to a client the caller may access.

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ACCOUNTING_ROLES, acctAudit, loadCompany, requireAccounting, requireCap } from "../../accounting/access.mjs";
import { createCompanyBooks } from "../../accounting/chart.mjs";
import { toCompany } from "../../accounting/mappers.mjs";
import { ensurePayrollSetup } from "../../accounting/payroll.mjs";
import { badRequest, notFound } from "../../lib/errors.mjs";
import { gstin, id, isoDate, pan, parse, requiredText, text } from "../../lib/validate.mjs";
import bankingRoutes from "./banking.mjs";
import dashboardRoutes from "./dashboard.mjs";
import gstRoutes from "./gst.mjs";
import inventoryRoutes from "./inventory.mjs";
import masterRoutes from "./masters.mjs";
import miscRoutes, { restoreCompany } from "./misc.mjs";
import payrollRoutes from "./payroll.mjs";
import reportRoutes from "./reports.mjs";
import voucherRoutes from "./vouchers.mjs";

const companySchema = z.object({
  clientId: id(),
  name: requiredText(160),
  legalName: text(200).default(""),
  pan: pan().default(""),
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v), "must be a valid TAN")
    .default(""),
  cin: text(30).default(""),
  address: text(500).default(""),
  stateCode: z
    .string()
    .regex(/^(\d{2})?$/, "must be a 2-digit GST state code")
    .default(""),
  gstin: gstin().default(""),
  booksStartDate: isoDate().refine((v) => v !== "", "is required"),
  fyStartMonth: z.number().int().min(1).max(12).default(4),
  baseCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  gstEnabled: z.boolean().default(true),
  inventoryEnabled: z.boolean().default(false),
  payrollEnabled: z.boolean().default(false),
  tdsEnabled: z.boolean().default(false),
  requireVoucherApproval: z.boolean().default(false),
});

const roleSchema = z.object({ role: z.enum(ACCOUNTING_ROLES), clientIds: z.array(id()).max(500).default([]) });

const COMPANY_SELECT = `SELECT ac.*, c.company AS client_name,
  (SELECT gstin FROM gst_registrations g WHERE g.company_id = ac.id ORDER BY is_primary DESC LIMIT 1) AS gstin
  FROM accounting_companies ac JOIN clients c ON c.id = ac.client_id`;

export default function accountingRoutes(ctx) {
  const { db } = ctx;
  const r = Router();
  r.use(requireAccounting(db));

  r.get("/me", (req, res) =>
    res.json({ role: req.acct.role, capabilities: req.acct.caps, restrictedToClientIds: req.acct.clients ? [...req.acct.clients] : null }),
  );

  // Team accounting roles -------------------------------------------------------------------------
  r.get("/roles", requireCap("admin"), (req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.professional_role, COALESCE(ar.role, 'Admin') AS role FROM users u
         LEFT JOIN accounting_user_roles ar ON ar.user_id = u.id AND ar.organization_id = u.organization_id
         WHERE u.organization_id = ? AND u.role = 'Professional User' AND u.active = 1 ORDER BY u.name`,
      )
      .all(req.user.organization_id);
    const access = db.prepare("SELECT user_id, client_id FROM accounting_client_access WHERE organization_id = ?").all(req.user.organization_id);
    res.json(
      users.map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        professionalRole: u.professional_role,
        role: u.role,
        clientIds: access.filter((a) => a.user_id === u.id).map((a) => a.client_id),
      })),
    );
  });

  r.put("/roles/:userId", requireCap("admin"), (req, res) => {
    const b = parse(roleSchema, req.body);
    const u = db
      .prepare("SELECT * FROM users WHERE id = ? AND organization_id = ? AND role = 'Professional User'")
      .get(req.params.userId, req.user.organization_id);
    if (!u) throw notFound("User not found.");
    if (u.id === req.user.id && b.role !== "Admin") throw badRequest("You cannot remove your own Admin role.");
    for (const cid of b.clientIds)
      if (!db.prepare("SELECT 1 FROM clients WHERE id = ? AND organization_id = ?").get(cid, req.user.organization_id))
        throw badRequest("clientIds: unknown client.");
    db.transaction(() => {
      db.prepare(
        "INSERT INTO accounting_user_roles(organization_id, user_id, role, updated_by) VALUES (?,?,?,?) ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      ).run(req.user.organization_id, u.id, b.role, req.user.id);
      db.prepare("DELETE FROM accounting_client_access WHERE organization_id = ? AND user_id = ?").run(req.user.organization_id, u.id);
      const ins = db.prepare("INSERT INTO accounting_client_access(organization_id, user_id, client_id) VALUES (?,?,?)");
      for (const cid of b.clientIds) ins.run(req.user.organization_id, u.id, cid);
      acctAudit(db, req, {
        action: "roles.update",
        entityType: "User",
        entityId: u.id,
        summary: `${u.email} → ${b.role}${b.clientIds.length ? ` (${b.clientIds.length} clients)` : ""}`,
      });
    })();
    res.json({ userId: u.id, role: b.role, clientIds: b.clientIds });
  });

  // Companies ------------------------------------------------------------------------------------
  r.get("/companies", (req, res) => {
    const rows = db.prepare(`${COMPANY_SELECT} WHERE ac.organization_id = ? ORDER BY c.company, ac.name`).all(req.user.organization_id);
    res.json(rows.filter((row) => !req.acct.clients || req.acct.clients.has(row.client_id)).map(toCompany));
  });

  r.post("/companies", requireCap("write"), (req, res) => {
    const b = parse(companySchema, req.body);
    const client = db.prepare("SELECT * FROM clients WHERE id = ? AND organization_id = ?").get(b.clientId, req.user.organization_id);
    if (!client || (req.acct.clients && !req.acct.clients.has(client.id))) throw notFound("Client not found.");
    if (b.gstin && b.stateCode && b.gstin.slice(0, 2) !== b.stateCode) throw badRequest("stateCode: does not match the GSTIN's state code.");
    const companyId = db.transaction(() => {
      const cid = createCompanyBooks(db, { organizationId: req.user.organization_id, clientId: client.id, userId: req.user.id, input: b });
      if (b.payrollEnabled) ensurePayrollSetup(db, db.prepare("SELECT * FROM accounting_companies WHERE id = ?").get(cid), req.user.id);
      acctAudit(db, req, {
        companyId: cid,
        action: "company.create",
        entityType: "Company",
        entityId: cid,
        summary: `${b.name} for ${client.company}`,
        after: b,
      });
      return cid;
    })();
    res.status(201).json(toCompany(db.prepare(`${COMPANY_SELECT} WHERE ac.id = ?`).get(companyId)));
  });

  // Restore a backup (JSON file from GET /companies/:id/backup) into a new company for a client.
  const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 5 } });
  r.post("/restore", requireCap("admin"), backupUpload.single("file"), (req, res) => {
    if (!req.file) throw badRequest("file: attach the backup JSON.");
    const b = parse(z.object({ clientId: id(), name: requiredText(160) }), req.body);
    if (req.acct.clients && !req.acct.clients.has(b.clientId)) throw notFound("Client not found.");
    let backup;
    try {
      backup = JSON.parse(req.file.buffer.toString("utf8"));
    } catch {
      throw badRequest("The backup file is not valid JSON.");
    }
    res.status(201).json(restoreCompany(db, req, backup, b));
  });

  const c = Router({ mergeParams: true });
  c.use((req, _res, next) => {
    req.company = loadCompany(db, req, req.params.companyId);
    next();
  });
  c.get("/", (req, res) => {
    const row = db.prepare(`${COMPANY_SELECT} WHERE ac.id = ?`).get(req.company.id);
    const fys = db.prepare("SELECT * FROM financial_years WHERE company_id = ? ORDER BY start_date").all(req.company.id);
    res.json({
      ...toCompany(row),
      financialYears: fys.map((f) => ({ id: f.id, label: f.label, startDate: f.start_date, endDate: f.end_date, status: f.status })),
    });
  });

  masterRoutes(c, ctx);
  voucherRoutes(c, ctx);
  reportRoutes(c, ctx);
  gstRoutes(c, ctx);
  inventoryRoutes(c, ctx);
  bankingRoutes(c, ctx);
  payrollRoutes(c, ctx);
  miscRoutes(c, ctx);
  dashboardRoutes(c, ctx);
  r.use("/companies/:companyId", c);
  return r;
}
