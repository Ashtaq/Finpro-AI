// Company settings, financial years, groups, ledgers, cost centres, numbering series, closing stock.

import { z } from "zod";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import { addDays, ensureFinancialYear, ensureSystemLedgers, seedTdsSections } from "../../accounting/chart.mjs";
import { toFy, toGroup, toLedger } from "../../accounting/mappers.mjs";
import { fromPaise, money, nonNegMoney, percent, toPaise } from "../../accounting/money.mjs";
import { ensurePayrollSetup } from "../../accounting/payroll.mjs";
import { sumsBy } from "../../accounting/reports.mjs";
import { isParty, isPL, loadTree } from "../../accounting/tree.mjs";
import { parseCsv } from "../../accounting/banking.mjs";
import { badRequest, conflict, notFound } from "../../lib/errors.mjs";
import { email, gstin, id, isoDate, pan, parse, requiredText, text } from "../../lib/validate.mjs";
import { ADMIN, patchSchema, str, W } from "./helpers.mjs";

const stateCode = () =>
  z
    .string()
    .regex(/^(\d{2})?$/, "must be a 2-digit GST state code")
    .default("");

const settingsSchema = z
  .object({
    name: requiredText(160).optional(),
    legalName: text(200).optional(),
    pan: pan().optional(),
    tan: text(10).optional(),
    cin: text(30).optional(),
    address: text(500).optional(),
    stateCode: z
      .string()
      .regex(/^(\d{2})?$/)
      .optional(),
    gstEnabled: z.boolean().optional(),
    inventoryEnabled: z.boolean().optional(),
    payrollEnabled: z.boolean().optional(),
    tdsEnabled: z.boolean().optional(),
    requireVoucherApproval: z.boolean().optional(),
    lockDate: isoDate().nullable().optional(),
    invoiceTemplate: z
      .object({
        title: text(60).optional(),
        format: z.enum(["standard", "compact", "detailed"]).optional(),
        showHsn: z.boolean().optional(),
        showBankDetails: z.boolean().optional(),
        bankLedgerId: id().nullable().optional(),
        terms: text(2000).optional(),
        footer: text(500).optional(),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .optional(),
    status: z.enum(["Active", "Archived"]).optional(),
  })
  .strict();

const COLS = {
  name: "name",
  legalName: "legal_name",
  pan: "pan",
  tan: "tan",
  cin: "cin",
  address: "address",
  stateCode: "state_code",
  gstEnabled: "gst_enabled",
  inventoryEnabled: "inventory_enabled",
  payrollEnabled: "payroll_enabled",
  tdsEnabled: "tds_enabled",
  requireVoucherApproval: "require_voucher_approval",
  lockDate: "lock_date",
  invoiceTemplate: "invoice_template_json",
  status: "status",
};

const groupSchema = z.object({
  name: requiredText(120),
  parentId: id(),
  cashFlowClass: z.enum(["Operating", "Investing", "Financing", "Cash"]).optional(),
});

const ledgerFields = {
  name: requiredText(160),
  alias: text(160).default(""),
  code: text(40).default(""),
  groupId: id(),
  openingBalance: nonNegMoney().default(0),
  openingSide: z.enum(["Dr", "Cr"]).default("Dr"),
  gstin: gstin().default(""),
  pan: pan().default(""),
  stateCode: stateCode(),
  gstRegistrationType: z.enum(["Regular", "Composition", "Unregistered", "Consumer", "SEZ", "Overseas"]).default("Regular"),
  address: text(500).default(""),
  email: z.union([z.literal(""), email()]).default(""),
  phone: text(30).default(""),
  creditLimit: nonNegMoney().nullable().default(null),
  creditDays: z.number().int().min(0).max(3650).nullable().default(null),
  billWise: z.boolean().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  gstApplicable: z.boolean().default(false),
  defaultGstRate: percent().nullable().default(null),
  defaultHsn: text(12).default(""),
  tdsSectionId: id().nullable().default(null),
  costCentresApplicable: z.boolean().default(false),
  bankName: text(120).default(""),
  bankAccountNumber: text(40).default(""),
  bankIfsc: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "must be a valid IFSC")
    .default(""),
  bankBranch: text(120).default(""),
  active: z.boolean().default(true),
};
const ledgerCreate = z.object(ledgerFields);
const ledgerUpdate = patchSchema(z, ledgerFields);

const LEDGER_COLS = {
  name: "name",
  alias: "alias",
  code: "code",
  groupId: "group_id",
  gstin: "gstin",
  pan: "pan",
  stateCode: "state_code",
  gstRegistrationType: "gst_registration_type",
  address: "address",
  email: "email",
  phone: "phone",
  creditLimit: "credit_limit_paise",
  creditDays: "credit_days",
  billWise: "bill_wise",
  currency: "currency",
  gstApplicable: "gst_applicable",
  defaultGstRate: "default_gst_rate_bp",
  defaultHsn: "default_hsn",
  tdsSectionId: "tds_section_id",
  costCentresApplicable: "cost_centres_applicable",
  bankName: "bank_name",
  bankAccountNumber: "bank_account_number",
  bankIfsc: "bank_ifsc",
  bankBranch: "bank_branch",
  active: "active",
};
const dbVal = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

export default function masterRoutes(c, { db }) {
  // Company settings ---------------------------------------------------------------------------------
  c.patch("/", ADMIN, (req, res) => {
    const b = parse(settingsSchema, req.body);
    const co = req.company;
    db.transaction(() => {
      const keys = Object.keys(b);
      if (!keys.length) return;
      const values = keys.map((k) => (k === "invoiceTemplate" ? JSON.stringify({ ...JSON.parse(co.invoice_template_json || "{}"), ...b[k] }) : dbVal(b[k])));
      db.prepare(`UPDATE accounting_companies SET ${keys.map((k) => `${COLS[k]} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).run(
        ...values,
        req.user.id,
        nowIso(),
        co.id,
      );
      const fresh = db.prepare("SELECT * FROM accounting_companies WHERE id = ?").get(co.id);
      if (b.gstEnabled) ensureSystemLedgers(db, fresh, "gst", req.user.id);
      if (b.tdsEnabled) {
        ensureSystemLedgers(db, fresh, "tds", req.user.id);
        if (!db.prepare("SELECT 1 FROM tds_sections WHERE company_id = ?").get(co.id)) seedTdsSections(db, fresh, fresh.books_start_date);
      }
      if (b.payrollEnabled) ensurePayrollSetup(db, fresh, req.user.id);
      acctAudit(db, req, {
        companyId: co.id,
        action: "company.update",
        entityType: "Company",
        entityId: co.id,
        summary: `Settings: ${keys.join(", ")}`,
        before: co,
        after: b,
      });
    })();
    res.json({ ok: true });
  });

  // Financial years ----------------------------------------------------------------------------------
  c.get("/financial-years", (req, res) =>
    res.json(db.prepare("SELECT * FROM financial_years WHERE company_id = ? ORDER BY start_date").all(req.company.id).map(toFy)),
  );

  c.post("/financial-years", W, (req, res) => {
    const last = db.prepare("SELECT * FROM financial_years WHERE company_id = ? ORDER BY start_date DESC LIMIT 1").get(req.company.id);
    const fy = db.transaction(() => ensureFinancialYear(db, req.company, addDays(last.end_date, 1), { allowClosed: true }))();
    acctAudit(db, req, { companyId: req.company.id, action: "fy.create", entityType: "FinancialYear", entityId: fy.id, summary: fy.label });
    res.status(201).json(toFy(fy));
  });

  const fyAction = (status) => (req, res) => {
    const fy = db.prepare("SELECT * FROM financial_years WHERE id = ? AND company_id = ?").get(req.params.fyId, req.company.id);
    if (!fy) throw notFound("Financial year not found.");
    if (status === "Closed") {
      const pending = db.prepare("SELECT COUNT(*) c FROM vouchers WHERE financial_year_id = ? AND status IN ('PendingApproval','Draft')").get(fy.id).c;
      if (pending) throw conflict(`${pending} draft or pending voucher(s) remain in ${fy.label}. Post, reject or delete them first.`);
      const earlierOpen = db
        .prepare("SELECT 1 FROM financial_years WHERE company_id = ? AND start_date < ? AND status = 'Open'")
        .get(req.company.id, fy.start_date);
      if (earlierOpen) throw conflict("Close earlier financial years first.");
    } else {
      const laterClosed = db
        .prepare("SELECT 1 FROM financial_years WHERE company_id = ? AND start_date > ? AND status = 'Closed'")
        .get(req.company.id, fy.start_date);
      if (laterClosed) throw conflict("Reopen later financial years first.");
    }
    db.prepare("UPDATE financial_years SET status = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(
      status,
      req.user.id,
      status === "Closed" ? nowIso() : null,
      fy.id,
    );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: status === "Closed" ? "fy.close" : "fy.reopen",
      entityType: "FinancialYear",
      entityId: fy.id,
      summary: fy.label,
    });
    res.json(toFy(db.prepare("SELECT * FROM financial_years WHERE id = ?").get(fy.id)));
  };
  c.post("/financial-years/:fyId/close", ADMIN, fyAction("Closed"));
  c.post("/financial-years/:fyId/reopen", ADMIN, fyAction("Open"));

  // Groups -------------------------------------------------------------------------------------------
  c.get("/groups", (req, res) => {
    const tree = loadTree(db, req.company.id);
    res.json(tree.groups.map((g) => toGroup(g, tree.info.get(g.id))));
  });

  c.post("/groups", W, (req, res) => {
    const b = parse(groupSchema, req.body);
    const tree = loadTree(db, req.company.id);
    const parent = tree.byId.get(b.parentId);
    if (!parent) throw badRequest("parentId: group not found.");
    const pi = tree.info.get(parent.id);
    const gid = uuid();
    db.prepare(
      "INSERT INTO account_groups(id, organization_id, company_id, name, parent_id, nature, affects_gross_profit, cash_flow_class, sort_order, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      gid,
      req.company.organization_id,
      req.company.id,
      b.name,
      parent.id,
      pi.nature,
      pi.affectsGrossProfit ? 1 : 0,
      b.cashFlowClass || "Operating",
      1000,
      req.user.id,
      req.user.id,
    );
    acctAudit(db, req, { companyId: req.company.id, action: "group.create", entityType: "Group", entityId: gid, summary: `${b.name} under ${parent.name}` });
    const t2 = loadTree(db, req.company.id);
    res.status(201).json(toGroup(t2.byId.get(gid), t2.info.get(gid)));
  });

  c.patch("/groups/:groupId", W, (req, res) => {
    const b = parse(groupSchema.partial().strict(), req.body);
    const tree = loadTree(db, req.company.id);
    const g = tree.byId.get(req.params.groupId);
    if (!g) throw notFound("Group not found.");
    if (g.is_system && b.parentId && b.parentId !== g.parent_id) throw badRequest("Reserved groups cannot be moved.");
    if (b.parentId) {
      const p = tree.byId.get(b.parentId);
      if (!p) throw badRequest("parentId: group not found.");
      let cur = p;
      while (cur) {
        if (cur.id === g.id) throw badRequest("parentId: a group cannot be moved under itself.");
        cur = cur.parent_id ? tree.byId.get(cur.parent_id) : null;
      }
      if (tree.info.get(p.id).nature !== tree.info.get(g.id).nature)
        throw badRequest("parentId: the new parent has a different nature (assets/liabilities/income/expenses).");
    }
    db.prepare(
      "UPDATE account_groups SET name = COALESCE(?, name), parent_id = COALESCE(?, parent_id), cash_flow_class = COALESCE(?, cash_flow_class), updated_by = ?, updated_at = ? WHERE id = ?",
    ).run(b.name ?? null, b.parentId ?? null, b.cashFlowClass ?? null, req.user.id, nowIso(), g.id);
    acctAudit(db, req, { companyId: req.company.id, action: "group.update", entityType: "Group", entityId: g.id, summary: g.name, before: g, after: b });
    const t2 = loadTree(db, req.company.id);
    res.json(toGroup(t2.byId.get(g.id), t2.info.get(g.id)));
  });

  c.delete("/groups/:groupId", W, (req, res) => {
    const g = db.prepare("SELECT * FROM account_groups WHERE id = ? AND company_id = ?").get(req.params.groupId, req.company.id);
    if (!g) throw notFound("Group not found.");
    if (g.is_system) throw badRequest("Reserved groups cannot be deleted.");
    if (db.prepare("SELECT 1 FROM account_groups WHERE parent_id = ?").get(g.id) || db.prepare("SELECT 1 FROM ledgers WHERE group_id = ?").get(g.id))
      throw conflict("Move or delete the sub-groups and ledgers in this group first.");
    db.prepare("DELETE FROM account_groups WHERE id = ?").run(g.id);
    acctAudit(db, req, { companyId: req.company.id, action: "group.delete", entityType: "Group", entityId: g.id, summary: g.name });
    res.status(204).end();
  });

  // Ledgers ------------------------------------------------------------------------------------------
  c.get("/ledgers", (req, res) => {
    const tree = loadTree(db, req.company.id);
    const q = (str(req.query.search) || "").toLowerCase();
    const kind = str(req.query.kind);
    const sums = req.query.withBalances === "1" ? sumsBy(db, req.company.id, "0000-01-01", str(req.query.to) || "9999-12-31") : null;
    let list = tree.ledgers
      .map((l) =>
        toLedger(l, tree.info.get(l.group_id), sums ? (isPL(tree.info.get(l.group_id)) ? 0 : l.opening_balance_paise) + (sums.get(l.id)?.net || 0) : undefined),
      )
      .filter((l) => (!q || `${l.name} ${l.alias} ${l.code} ${l.gstin}`.toLowerCase().includes(q)) && (!kind || l.kind === kind));
    if (str(req.query.groupId)) list = list.filter((l) => l.groupId === req.query.groupId);
    if (req.query.active !== "all") list = list.filter((l) => l.active);
    res.json(list);
  });

  const getLedger = (req) => {
    const l = db.prepare("SELECT * FROM ledgers WHERE id = ? AND company_id = ?").get(req.params.ledgerId, req.company.id);
    if (!l) throw notFound("Ledger not found.");
    return l;
  };

  function checkLedger(tree, b, existing, companyId) {
    const gid = b.groupId ?? existing?.group_id;
    const gi = tree.info.get(gid);
    if (!gi) throw badRequest("groupId: group not found.");
    const opening = b.openingBalance === undefined ? undefined : b.openingSide === "Cr" ? -b.openingBalance : b.openingBalance;
    if (isPL(gi) && (opening ?? existing?.opening_balance_paise ?? 0) !== 0) throw badRequest("Income and expense ledgers cannot have opening balances.");
    if (b.gstin && b.stateCode && b.gstin.slice(0, 2) !== b.stateCode) throw badRequest("stateCode: does not match the GSTIN.");
    if (b.tdsSectionId && !db.prepare("SELECT 1 FROM tds_sections WHERE id = ? AND company_id = ?").get(b.tdsSectionId, companyId))
      throw badRequest("tdsSectionId: unknown section.");
    return { gi, opening };
  }

  c.post("/ledgers", W, (req, res) => {
    const b = parse(ledgerCreate, req.body);
    const tree = loadTree(db, req.company.id);
    const { gi, opening } = checkLedger(tree, b, undefined, req.company.id);
    const lid = uuid();
    const billWise = b.billWise ?? isParty(gi);
    const stateFromGstin = b.stateCode || (b.gstin ? b.gstin.slice(0, 2) : "");
    db.prepare(
      `INSERT INTO ledgers(id, organization_id, company_id, group_id, name, alias, code, opening_balance_paise, gstin, pan, state_code, gst_registration_type, address, email, phone,
         credit_limit_paise, credit_days, bill_wise, currency, gst_applicable, default_gst_rate_bp, default_hsn, tds_section_id, cost_centres_applicable, bank_name, bank_account_number,
         bank_ifsc, bank_branch, active, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      lid,
      req.company.organization_id,
      req.company.id,
      b.groupId,
      b.name,
      b.alias,
      b.code,
      opening,
      b.gstin,
      b.pan,
      stateFromGstin,
      b.gstin ? (b.gstRegistrationType === "Unregistered" ? "Regular" : b.gstRegistrationType) : b.gstRegistrationType,
      b.address,
      b.email,
      b.phone,
      b.creditLimit,
      b.creditDays,
      billWise ? 1 : 0,
      b.currency,
      b.gstApplicable ? 1 : 0,
      b.defaultGstRate,
      b.defaultHsn,
      b.tdsSectionId,
      b.costCentresApplicable ? 1 : 0,
      b.bankName,
      b.bankAccountNumber,
      b.bankIfsc,
      b.bankBranch,
      b.active ? 1 : 0,
      req.user.id,
      req.user.id,
    );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "ledger.create",
      entityType: "Ledger",
      entityId: lid,
      summary: `${b.name} (${gi.name}) opening ₹${fromPaise(opening)}`,
    });
    const t2 = loadTree(db, req.company.id);
    res.status(201).json(toLedger(t2.ledgerInfo.get(lid), t2.info.get(b.groupId)));
  });

  c.get("/ledgers/:ledgerId", (req, res) => {
    const l = getLedger(req);
    const tree = loadTree(db, req.company.id);
    const sums = sumsBy(db, req.company.id, "0000-01-01", "9999-12-31");
    res.json(toLedger(l, tree.info.get(l.group_id), l.opening_balance_paise + (sums.get(l.id)?.net || 0)));
  });

  c.patch("/ledgers/:ledgerId", W, (req, res) => {
    const l = getLedger(req);
    const b = parse(ledgerUpdate, req.body);
    if (l.system_code && (b.groupId || b.name)) throw badRequest("System ledgers cannot be renamed or regrouped.");
    const tree = loadTree(db, req.company.id);
    const { opening } = checkLedger(tree, b, l, req.company.id);
    if (opening !== undefined && opening !== l.opening_balance_paise) {
      const firstFy = db.prepare("SELECT status FROM financial_years WHERE company_id = ? ORDER BY start_date LIMIT 1").get(req.company.id);
      if (firstFy?.status === "Closed") throw badRequest("Opening balances cannot change after the first financial year is closed.");
    }
    if (b.openingSide && b.openingBalance === undefined) throw badRequest("openingBalance: provide the amount with its side.");
    const keys = Object.keys(b).filter((k) => LEDGER_COLS[k]);
    const sets = keys.map((k) => `${LEDGER_COLS[k]} = ?`);
    const vals = keys.map((k) => dbVal(b[k]));
    if (opening !== undefined) (sets.push("opening_balance_paise = ?"), vals.push(opening));
    if (sets.length) db.prepare(`UPDATE ledgers SET ${sets.join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).run(...vals, req.user.id, nowIso(), l.id);
    acctAudit(db, req, { companyId: req.company.id, action: "ledger.update", entityType: "Ledger", entityId: l.id, summary: l.name, before: l, after: b });
    const t2 = loadTree(db, req.company.id);
    const fresh = t2.ledgerInfo.get(l.id);
    res.json(toLedger(fresh, t2.info.get(fresh.group_id)));
  });

  c.delete("/ledgers/:ledgerId", W, (req, res) => {
    const l = getLedger(req);
    if (l.system_code) throw badRequest("System ledgers cannot be deleted.");
    const used =
      db.prepare("SELECT 1 FROM voucher_entries WHERE ledger_id = ? LIMIT 1").get(l.id) ||
      db.prepare("SELECT 1 FROM voucher_items WHERE ledger_id = ? LIMIT 1").get(l.id) ||
      db.prepare("SELECT 1 FROM vouchers WHERE party_ledger_id = ? LIMIT 1").get(l.id);
    if (used || l.opening_balance_paise) throw conflict("This ledger has transactions or an opening balance. Mark it inactive instead.");
    db.prepare("DELETE FROM ledgers WHERE id = ?").run(l.id);
    acctAudit(db, req, { companyId: req.company.id, action: "ledger.delete", entityType: "Ledger", entityId: l.id, summary: l.name });
    res.status(204).end();
  });

  // CSV import: name, group, opening, side(Dr/Cr), gstin, pan, state, email, phone
  c.post("/ledgers/import", W, (req, res) => {
    const b = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
    const rows = parseCsv(b.csv);
    const header = rows.shift().map((h) => h.trim().toLowerCase());
    const col = (n) => header.indexOf(n);
    if (col("name") < 0 || col("group") < 0) throw badRequest("CSV needs at least name and group columns.");
    const tree = loadTree(db, req.company.id);
    const groupByName = new Map(tree.groups.map((g) => [g.name.toLowerCase(), g]));
    const result = db.transaction(() => {
      let created = 0;
      const errors = [];
      rows.forEach((r, i) => {
        const name = (r[col("name")] || "").trim();
        const g = groupByName.get((r[col("group")] || "").trim().toLowerCase());
        if (!name || !g) return errors.push({ row: i + 2, error: !name ? "name missing" : `unknown group "${r[col("group")]}"` });
        if (db.prepare("SELECT 1 FROM ledgers WHERE company_id = ? AND lower(name) = lower(?)").get(req.company.id, name))
          return errors.push({ row: i + 2, error: "ledger exists" });
        const amt = col("opening") >= 0 && r[col("opening")] ? toPaise(r[col("opening")]) : 0;
        if (amt === null) return errors.push({ row: i + 2, error: "invalid opening amount" });
        const gi = tree.info.get(g.id);
        const opening = (col("side") >= 0 && /^cr/i.test(r[col("side")] || "") ? -1 : 1) * Math.abs(amt);
        if (isPL(gi) && opening) return errors.push({ row: i + 2, error: "income/expense ledgers cannot have openings" });
        const gstinVal = col("gstin") >= 0 ? (r[col("gstin")] || "").trim().toUpperCase() : "";
        db.prepare(
          "INSERT INTO ledgers(id, organization_id, company_id, group_id, name, opening_balance_paise, gstin, pan, state_code, email, phone, bill_wise, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          uuid(),
          req.company.organization_id,
          req.company.id,
          g.id,
          name.slice(0, 160),
          opening,
          gstinVal,
          col("pan") >= 0 ? (r[col("pan")] || "").trim().toUpperCase() : "",
          col("state") >= 0 ? (r[col("state")] || "").trim() : gstinVal.slice(0, 2),
          col("email") >= 0 ? (r[col("email")] || "").trim() : "",
          col("phone") >= 0 ? (r[col("phone")] || "").trim() : "",
          isParty(gi) ? 1 : 0,
          req.user.id,
          req.user.id,
        );
        created += 1;
      });
      db.prepare("INSERT INTO data_jobs(id, organization_id, company_id, direction, kind, status, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?)").run(
        uuid(),
        req.company.organization_id,
        req.company.id,
        "Import",
        "Ledgers",
        "Completed",
        JSON.stringify({ created, errors: errors.length }),
        req.user.id,
      );
      acctAudit(db, req, {
        companyId: req.company.id,
        action: "ledger.import",
        entityType: "Ledger",
        summary: `${created} ledgers imported, ${errors.length} rows skipped`,
      });
      return { created, errors };
    })();
    res.json(result);
  });

  // Cost categories & centres ---------------------------------------------------------------------------
  c.get("/cost-categories", (req, res) => res.json(db.prepare("SELECT id, name FROM cost_categories WHERE company_id = ? ORDER BY name").all(req.company.id)));
  c.post("/cost-categories", W, (req, res) => {
    const b = parse(z.object({ name: requiredText(120) }), req.body);
    const cid = uuid();
    db.prepare("INSERT INTO cost_categories(id, organization_id, company_id, name) VALUES (?,?,?,?)").run(
      cid,
      req.company.organization_id,
      req.company.id,
      b.name,
    );
    res.status(201).json({ id: cid, name: b.name });
  });
  c.get("/cost-centres", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT cc.*, cat.name category FROM cost_centres cc LEFT JOIN cost_categories cat ON cat.id = cc.category_id WHERE cc.company_id = ? ORDER BY cc.name",
        )
        .all(req.company.id)
        .map((r) => ({ id: r.id, name: r.name, categoryId: r.category_id, category: r.category, parentId: r.parent_id, active: !!r.active })),
    ),
  );
  c.post("/cost-centres", W, (req, res) => {
    const b = parse(z.object({ name: requiredText(120), categoryId: id().nullable().default(null), parentId: id().nullable().default(null) }), req.body);
    if (b.categoryId && !db.prepare("SELECT 1 FROM cost_categories WHERE id = ? AND company_id = ?").get(b.categoryId, req.company.id))
      throw badRequest("categoryId: not found.");
    if (b.parentId && !db.prepare("SELECT 1 FROM cost_centres WHERE id = ? AND company_id = ?").get(b.parentId, req.company.id))
      throw badRequest("parentId: not found.");
    const cid = uuid();
    db.prepare("INSERT INTO cost_centres(id, organization_id, company_id, category_id, parent_id, name) VALUES (?,?,?,?,?,?)").run(
      cid,
      req.company.organization_id,
      req.company.id,
      b.categoryId,
      b.parentId,
      b.name,
    );
    res.status(201).json({ id: cid, ...b, active: true });
  });
  c.patch("/cost-centres/:ccId", W, (req, res) => {
    const b = parse(z.object({ name: requiredText(120).optional(), active: z.boolean().optional() }).strict(), req.body);
    const r = db
      .prepare("UPDATE cost_centres SET name = COALESCE(?, name), active = COALESCE(?, active) WHERE id = ? AND company_id = ?")
      .run(b.name ?? null, b.active === undefined ? null : b.active ? 1 : 0, req.params.ccId, req.company.id);
    if (!r.changes) throw notFound("Cost centre not found.");
    res.json({ ok: true });
  });

  // Voucher numbering ------------------------------------------------------------------------------
  c.get("/voucher-series", (req, res) => {
    const fyId = str(req.query.fyId);
    const rows = db
      .prepare(
        `SELECT s.*, fy.label FROM voucher_series s JOIN financial_years fy ON fy.id = s.financial_year_id WHERE s.company_id = ? ${fyId ? "AND s.financial_year_id = ?" : ""} ORDER BY fy.start_date, s.voucher_type`,
      )
      .all(req.company.id, ...(fyId ? [fyId] : []));
    res.json(
      rows.map((s) => ({
        id: s.id,
        financialYearId: s.financial_year_id,
        financialYear: s.label,
        voucherType: s.voucher_type,
        prefix: s.prefix,
        suffix: s.suffix,
        nextNumber: s.next_number,
        padLength: s.pad_length,
        numberingMethod: s.numbering_method,
        preview: `${s.prefix}${String(s.next_number).padStart(s.pad_length, "0")}${s.suffix}`,
      })),
    );
  });
  c.patch("/voucher-series/:seriesId", ADMIN, (req, res) => {
    const b = parse(
      z
        .object({
          prefix: text(20).optional(),
          suffix: text(20).optional(),
          nextNumber: z.number().int().min(1).max(1e9).optional(),
          padLength: z.number().int().min(1).max(10).optional(),
          numberingMethod: z.enum(["Automatic", "Manual"]).optional(),
        })
        .strict(),
      req.body,
    );
    const s = db.prepare("SELECT * FROM voucher_series WHERE id = ? AND company_id = ?").get(req.params.seriesId, req.company.id);
    if (!s) throw notFound("Series not found.");
    db.prepare(
      "UPDATE voucher_series SET prefix = COALESCE(?, prefix), suffix = COALESCE(?, suffix), next_number = COALESCE(?, next_number), pad_length = COALESCE(?, pad_length), numbering_method = COALESCE(?, numbering_method) WHERE id = ?",
    ).run(b.prefix ?? null, b.suffix ?? null, b.nextNumber ?? null, b.padLength ?? null, b.numberingMethod ?? null, s.id);
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "series.update",
      entityType: "VoucherSeries",
      entityId: s.id,
      summary: s.voucher_type,
      before: s,
      after: b,
    });
    res.json({ ok: true });
  });

  // Manual closing stock (non-integrated inventory) -------------------------------------------------
  c.get("/closing-stock", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM closing_stock_entries WHERE company_id = ? ORDER BY as_of_date DESC")
        .all(req.company.id)
        .map((r) => ({ id: r.id, asOfDate: r.as_of_date, value: fromPaise(r.value_paise) })),
    ),
  );
  c.post("/closing-stock", W, (req, res) => {
    const b = parse(z.object({ asOfDate: isoDate().refine((v) => v !== "", "is required"), value: money({ min: 0 }) }), req.body);
    if (req.company.inventory_enabled) throw badRequest("Closing stock is computed from inventory for this company.");
    db.prepare(
      "INSERT INTO closing_stock_entries(id, organization_id, company_id, as_of_date, value_paise, created_by) VALUES (?,?,?,?,?,?) ON CONFLICT(company_id, as_of_date) DO UPDATE SET value_paise = excluded.value_paise",
    ).run(uuid(), req.company.organization_id, req.company.id, b.asOfDate, b.value, req.user.id);
    acctAudit(db, req, { companyId: req.company.id, action: "closingstock.set", entityType: "ClosingStock", summary: `${b.asOfDate}: ₹${fromPaise(b.value)}` });
    res.status(201).json({ asOfDate: b.asOfDate, value: fromPaise(b.value) });
  });
}
