// Budgets, accounting audit trail, AI assistance, and data backup / restore.

import crypto from "node:crypto";
import { z } from "zod";
import { acctAudit, uuid } from "../../accounting/access.mjs";
import * as AI from "../../accounting/intelligence.mjs";
import { fromPaise, money } from "../../accounting/money.mjs";
import { budgetVsActual } from "../../accounting/reports.mjs";
import { badRequest, notFound } from "../../lib/errors.mjs";
import { id, parse, requiredText, text } from "../../lib/validate.mjs";
import { ADMIN, page, str, W } from "./helpers.mjs";

// Company-scoped tables in dependency order, for backup / restore.
const DIRECT = [
  "accounting_companies",
  "financial_years",
  "account_groups",
  "cost_categories",
  "cost_centres",
  "tds_sections",
  "ledgers",
  "voucher_series",
  "units_of_measure",
  "inventory_categories",
  "warehouses",
  "inventory_items",
  "stock_batches",
  "bills_of_materials",
  "business_orders",
  "vouchers",
  "voucher_entries",
  "voucher_revisions",
  "voucher_approval_workflows",
  "recurring_vouchers",
  "closing_stock_entries",
  "gst_registrations",
  "hsn_sac_codes",
  "gst_tax_rates",
  "gst_transactions",
  "gst_returns",
  "gst_payments",
  "gst_reconciliations",
  "e_invoice_records",
  "eway_bill_records",
  "tds_transactions",
  "stock_movements",
  "stock_transfers",
  "budgets",
  "bank_statements",
  "bank_statement_transactions",
  "bank_reconciliation_matches",
  "bank_reconciliations",
  "bank_rules",
  "cheque_records",
  "payroll_departments",
  "employees",
  "payroll_components",
  "employee_salary_structures",
  "payroll_statutory_configs",
  "attendance_records",
  "leave_records",
  "payroll_runs",
  "salary_slips",
];
const CHILD = {
  voucher_cost_allocations: "SELECT x.* FROM voucher_cost_allocations x JOIN voucher_entries e ON e.id = x.entry_id WHERE e.company_id = ?",
  voucher_items: "SELECT x.* FROM voucher_items x JOIN vouchers v ON v.id = x.voucher_id WHERE v.company_id = ?",
  budget_entries: "SELECT x.* FROM budget_entries x JOIN budgets b ON b.id = x.budget_id WHERE b.company_id = ?",
  payroll_entries: "SELECT x.* FROM payroll_entries x JOIN payroll_runs r ON r.id = x.run_id WHERE r.company_id = ?",
};
// Foreign keys are deferred during restore, so insertion order only needs to be stable.
const ORDER = [...DIRECT, ...Object.keys(CHILD)];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function exportCompany(db, company) {
  const tables = {};
  for (const t of DIRECT) tables[t] = db.prepare(`SELECT * FROM ${t} WHERE ${t === "accounting_companies" ? "id" : "company_id"} = ?`).all(company.id);
  for (const [t, sql] of Object.entries(CHILD)) tables[t] = db.prepare(sql).all(company.id);
  const body = JSON.stringify(tables);
  return {
    format: "finpro-accounting-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    company: { id: company.id, name: company.name },
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    tables,
  };
}

export function restoreCompany(db, req, backup, { clientId, name }) {
  if (backup?.format !== "finpro-accounting-backup" || backup.version !== 1) throw badRequest("Not a Finpro accounting backup.");
  const body = JSON.stringify(backup.tables);
  if (crypto.createHash("sha256").update(body).digest("hex") !== backup.sha256)
    throw badRequest("Backup checksum does not match; the file is corrupt or was edited.");
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND organization_id = ?").get(clientId, req.user.organization_id);
  if (!client) throw notFound("Client not found.");
  const map = new Map();
  for (const rows of Object.values(backup.tables)) for (const r of rows) if (typeof r.id === "string") map.set(r.id.toLowerCase(), uuid());
  const swap = (v) => (typeof v === "string" ? v.replace(UUID_RE, (m) => map.get(m.toLowerCase()) || m) : v);
  const oldCompanyId = backup.tables.accounting_companies?.[0]?.id;
  if (!oldCompanyId) throw badRequest("Backup has no company.");
  const newCompanyId = map.get(oldCompanyId.toLowerCase());
  return db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    let rowsIn = 0;
    for (const t of ORDER) {
      const rows = backup.tables[t] || [];
      if (!rows.length) continue;
      const cols = db
        .prepare(`PRAGMA table_info(${t})`)
        .all()
        .map((c) => c.name);
      for (const r of rows) {
        const row = Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, swap(r[c])]));
        if ("organization_id" in row) row.organization_id = req.user.organization_id;
        if (t === "accounting_companies") Object.assign(row, { client_id: client.id, name, created_by: req.user.id, updated_by: req.user.id });
        if (t === "voucher_revisions") row.company_id = newCompanyId;
        const keys = Object.keys(row);
        db.prepare(`INSERT INTO ${t}(${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
        rowsIn += 1;
      }
    }
    db.prepare("INSERT INTO data_jobs(id, organization_id, company_id, direction, kind, status, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?)").run(
      uuid(),
      req.user.organization_id,
      newCompanyId,
      "Import",
      "Restore",
      "Completed",
      JSON.stringify({ from: backup.company, rows: rowsIn }),
      req.user.id,
    );
    acctAudit(db, req, {
      companyId: newCompanyId,
      action: "company.restore",
      entityType: "Company",
      entityId: newCompanyId,
      summary: `Restored from backup of ${backup.company?.name} (${rowsIn} rows)`,
    });
    return { companyId: newCompanyId, rows: rowsIn };
  })();
}

export default function miscRoutes(c, ctx) {
  const { db, ai } = ctx;

  // Budgets --------------------------------------------------------------------------------------------
  c.get("/budgets", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT b.*, fy.label FROM budgets b JOIN financial_years fy ON fy.id = b.financial_year_id WHERE b.company_id = ? ORDER BY fy.start_date DESC, b.name",
        )
        .all(req.company.id)
        .map((b) => ({ id: b.id, name: b.name, financialYearId: b.financial_year_id, financialYear: b.label })),
    ),
  );
  c.post("/budgets", W, (req, res) => {
    const b = parse(
      z.object({
        name: requiredText(120),
        financialYearId: id(),
        lines: z
          .array(z.object({ ledgerId: id().optional(), groupId: id().optional(), costCentreId: id().optional(), amount: money() }))
          .min(1)
          .max(1000),
      }),
      req.body,
    );
    if (!db.prepare("SELECT 1 FROM financial_years WHERE id = ? AND company_id = ?").get(b.financialYearId, req.company.id))
      throw badRequest("financialYearId: not found.");
    const bid = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO budgets(id, organization_id, company_id, financial_year_id, name) VALUES (?,?,?,?,?)").run(
        bid,
        req.company.organization_id,
        req.company.id,
        b.financialYearId,
        b.name,
      );
      const ins = db.prepare("INSERT INTO budget_entries(id, budget_id, ledger_id, group_id, cost_centre_id, amount_paise) VALUES (?,?,?,?,?,?)");
      b.lines.forEach((l, i) => {
        if (!l.ledgerId && !l.groupId) throw badRequest(`lines.${i}: choose a ledger or a group.`);
        if (l.ledgerId && !db.prepare("SELECT 1 FROM ledgers WHERE id = ? AND company_id = ?").get(l.ledgerId, req.company.id))
          throw badRequest(`lines.${i}.ledgerId: not found.`);
        if (l.groupId && !db.prepare("SELECT 1 FROM account_groups WHERE id = ? AND company_id = ?").get(l.groupId, req.company.id))
          throw badRequest(`lines.${i}.groupId: not found.`);
        if (l.costCentreId && !db.prepare("SELECT 1 FROM cost_centres WHERE id = ? AND company_id = ?").get(l.costCentreId, req.company.id))
          throw badRequest(`lines.${i}.costCentreId: not found.`);
        ins.run(uuid(), bid, l.ledgerId ?? null, l.groupId ?? null, l.costCentreId ?? null, l.amount);
      });
      acctAudit(db, req, { companyId: req.company.id, action: "budget.create", entityType: "Budget", entityId: bid, summary: b.name });
    })();
    res.status(201).json(budgetVsActual(db, req.company, bid, {}));
  });
  c.get("/budgets/:budgetId", (req, res) =>
    res.json(budgetVsActual(db, req.company, req.params.budgetId, { from: str(req.query.from), to: str(req.query.to) })),
  );
  c.delete("/budgets/:budgetId", W, (req, res) => {
    db.prepare("DELETE FROM budgets WHERE id = ? AND company_id = ?").run(req.params.budgetId, req.company.id);
    res.status(204).end();
  });

  // Audit trail ----------------------------------------------------------------------------------------
  c.get("/audit-logs", (req, res) => {
    const where = ["company_id = ?"];
    const args = [req.company.id];
    for (const [k, col] of [
      ["entityType", "entity_type"],
      ["entityId", "entity_id"],
      ["actorId", "actor_id"],
    ])
      if (str(req.query[k])) (where.push(`${col} = ?`), args.push(req.query[k]));
    if (str(req.query.action)) (where.push("action LIKE ?"), args.push(`${req.query.action}%`));
    const p = page(req.query);
    const total = db.prepare(`SELECT COUNT(*) c FROM accounting_audit_logs WHERE ${where.join(" AND ")}`).get(...args).c;
    const rows = db
      .prepare(`SELECT * FROM accounting_audit_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, p.limit, p.offset);
    res.json({
      total,
      page: p.page,
      pageSize: p.pageSize,
      rows: rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        actor: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: r.summary,
        hasChanges: !!(r.before_json || r.after_json),
        ...(req.query.withChanges === "1" ? { before: r.before_json && JSON.parse(r.before_json), after: r.after_json && JSON.parse(r.after_json) } : {}),
      })),
    });
  });

  // AI assistance (assistive only) --------------------------------------------------------------------
  const DISCLAIMER = "AI assistance: verify before relying on it. Finpro does not certify entries, returns or audits.";
  c.get("/ai/anomalies", (req, res) => res.json(AI.anomalies(db, req.company, { from: str(req.query.from), to: str(req.query.to) })));
  c.post("/ai/suggest-ledger", (req, res) => {
    const b = parse(
      z.object({ narration: text(500).default(""), type: z.string().max(20).optional(), amount: z.union([z.string(), z.number()]).optional() }),
      req.body,
    );
    res.json({ suggestions: AI.suggestLedgers(db, req.company, b), disclaimer: DISCLAIMER });
  });
  c.get("/ai/explain", async (req, res) => {
    const e = AI.explainStatements(db, req.company, { from: str(req.query.from), to: str(req.query.to) });
    let narrative = null;
    if (req.query.narrative === "1" && ai?.enabled) {
      const agent = { id: "finance", name: "Finance Analyst" };
      const r = await ai.reply({
        agent,
        history: [],
        message: `Explain these financial statements for ${req.company.name} to a chartered accountant in 5 short bullet points. Use only these figures:\n${e.points.join("\n")}\nRatios: ${JSON.stringify(e.ratios)}`,
        documents: [],
        ctx: { orgId: req.user.organization_id, userId: req.user.id, userRole: req.user.role, clientName: req.company.name },
      });
      narrative = { content: r.content, model: r.model };
    }
    res.json({ ...e, narrative, disclaimer: DISCLAIMER });
  });
  c.post("/ai/query", async (req, res) => {
    const b = parse(z.object({ question: requiredText(500) }), req.body);
    const result = AI.naturalQuery(db, req.company, b.question);
    if (result.intent === "unknown" && ai?.enabled) {
      const summary = AI.financialSummary(db, req.company, {});
      const r = await ai.reply({
        agent: { id: "finance", name: "Finance Analyst" },
        history: [],
        message: `${b.question}\n\nAnswer only from this data for ${req.company.name}; say if it is insufficient.\n${JSON.stringify(summary)}`,
        documents: [],
        ctx: { orgId: req.user.organization_id, userId: req.user.id, userRole: req.user.role, clientName: req.company.name },
      });
      return res.json({ ...result, intent: "ai_answer", title: "AI answer", answer: r.content, model: r.model, disclaimer: DISCLAIMER });
    }
    acctAudit(db, req, { companyId: req.company.id, action: "ai.query", entityType: "AI", summary: b.question });
    res.json({ ...result, disclaimer: DISCLAIMER });
  });
  c.post("/ai/extract-invoice", (req, res) => {
    const b = parse(z.object({ text: text(100000).optional(), documentId: id().optional() }), req.body);
    let content = b.text;
    if (!content && b.documentId) {
      const d = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(b.documentId, req.user.organization_id);
      if (!d) throw notFound("Document not found.");
      if (!/^text\/|csv|json/.test(d.mime_type))
        throw badRequest("Only text-based documents can be read here. Scanned images and PDFs need an OCR provider (not configured).");
      content = ctx.storage.readText ? ctx.storage.readText(d.storage_key) : null;
      if (!content) throw badRequest("Could not read the document text.");
    }
    if (!content) throw badRequest("Provide invoice text or a documentId.");
    res.json({ fields: AI.extractInvoiceFields(content), disclaimer: DISCLAIMER });
  });
  c.get("/ai/bank-suggestions", (req, res) => {
    const lid = str(req.query.bankLedgerId);
    if (!lid) throw badRequest("bankLedgerId is required.");
    const lines = db
      .prepare("SELECT * FROM bank_statement_transactions WHERE company_id = ? AND bank_ledger_id = ? AND status = 'Unmatched' ORDER BY txn_date LIMIT 200")
      .all(req.company.id, lid);
    res.json({
      suggestions: lines.map((t) => ({
        txnId: t.id,
        description: t.description,
        amount: fromPaise(t.credit_paise || t.debit_paise),
        direction: t.credit_paise ? "Deposit" : "Withdrawal",
        isBankCharge: !!t.is_bank_charge,
        ledgers: AI.suggestLedgers(db, req.company, { narration: t.description, amount: fromPaise(t.credit_paise || t.debit_paise) }).slice(0, 3),
      })),
      disclaimer: DISCLAIMER,
    });
  });

  // Backup / restore / jobs ---------------------------------------------------------------------------------
  c.get("/backup", ADMIN, (req, res) => {
    const data = exportCompany(db, req.company);
    db.prepare("INSERT INTO data_jobs(id, organization_id, company_id, direction, kind, status, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?)").run(
      uuid(),
      req.company.organization_id,
      req.company.id,
      "Export",
      "Backup",
      "Completed",
      JSON.stringify({ tables: Object.keys(data.tables).length }),
      req.user.id,
    );
    acctAudit(db, req, { companyId: req.company.id, action: "company.backup", entityType: "Company", entityId: req.company.id, summary: "Backup downloaded" });
    res.setHeader("Content-Disposition", `attachment; filename="${req.company.name.replace(/[^A-Za-z0-9-]+/g, "-")}-backup.json"`);
    res.json(data);
  });
  c.get("/data-jobs", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT j.*, u.name actor FROM data_jobs j LEFT JOIN users u ON u.id = j.created_by WHERE j.company_id = ? ORDER BY j.created_at DESC LIMIT 200",
        )
        .all(req.company.id)
        .map((j) => ({ id: j.id, direction: j.direction, kind: j.kind, status: j.status, summary: JSON.parse(j.summary_json), by: j.actor, at: j.created_at })),
    ),
  );
}
