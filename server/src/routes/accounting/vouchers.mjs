// Vouchers: list / create / modify / cancel / approve, revisions, printing, attachments, recurring.

import { z } from "zod";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import { renderVoucherHtml, renderVoucherPdf } from "../../accounting/invoice.mjs";
import { toVoucherDetail, toVoucherSummary } from "../../accounting/mappers.mjs";
import { fromPaise } from "../../accounting/money.mjs";
import { buildVoucher, cancelVoucher, createVoucher, decideApproval, loadVoucherRow, updateVoucher, voucherSchema } from "../../accounting/vouchers.mjs";
import { badRequest, conflict, notFound } from "../../lib/errors.mjs";
import { id, isoDate, parse, requiredText, text } from "../../lib/validate.mjs";
import { A, page, patchSchema, str, W } from "./helpers.mjs";

const LIST = `SELECT v.*, pl.name AS party_name, u.name AS created_by_name FROM vouchers v
  LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id LEFT JOIN users u ON u.id = v.created_by`;
const SORTS = { date: "v.date", number: "v.voucher_number", total: "v.total_paise", type: "v.voucher_type", created: "v.created_at" };

const recurringFields = {
  name: requiredText(120),
  frequency: z.enum(["Weekly", "Monthly", "Quarterly", "Yearly"]),
  nextRunDate: isoDate().refine((v) => v !== "", "is required"),
  endDate: isoDate().nullable().default(null),
  template: z.record(z.string(), z.unknown()),
  active: z.boolean().default(true),
};
const recurringSchema = z.object(recurringFields);

export function advance(date, frequency) {
  if (frequency === "Weekly") return new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const months = { Monthly: 1, Quarterly: 3, Yearly: 12 }[frequency];
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function runRecurring(db, req, company, asOf) {
  const due = db
    .prepare("SELECT * FROM recurring_vouchers WHERE company_id = ? AND active = 1 AND next_run_date <= ? ORDER BY next_run_date")
    .all(company.id, asOf);
  const created = [];
  const errors = [];
  for (const r of due) {
    let next = r.next_run_date;
    let guard = 0;
    while (next <= asOf && (!r.end_date || next <= r.end_date) && guard++ < 60) {
      try {
        const input = parse(voucherSchema, { ...JSON.parse(r.template_json), date: next });
        const { id: vid } = createVoucher(db, req, company, input, { source: "recurring", sourceRef: r.id });
        created.push({ recurringId: r.id, name: r.name, voucherId: vid, date: next });
      } catch (err) {
        errors.push({ recurringId: r.id, name: r.name, date: next, error: err.message });
        break;
      }
      next = advance(next, r.frequency);
    }
    db.prepare(
      "UPDATE recurring_vouchers SET next_run_date = ?, last_run_at = ?, active = CASE WHEN ? IS NOT NULL AND ? > ? THEN 0 ELSE active END, updated_at = ? WHERE id = ?",
    ).run(next, nowIso(), r.end_date, next, r.end_date, nowIso(), r.id);
  }
  return { created, errors };
}

export default function voucherRoutes(c, { db }) {
  const detail = (company, vid) => toVoucherDetail(db, db.prepare(`${LIST} WHERE v.id = ? AND v.company_id = ?`).get(vid, company.id));

  c.get("/vouchers", (req, res) => {
    const q = req.query;
    const where = ["v.company_id = ?"];
    const args = [req.company.id];
    if (str(q.type)) (where.push("v.voucher_type = ?"), args.push(q.type));
    if (str(q.status)) (where.push("v.status = ?"), args.push(q.status));
    if (str(q.from)) (where.push("v.date >= ?"), args.push(q.from));
    if (str(q.to)) (where.push("v.date <= ?"), args.push(q.to));
    if (str(q.partyLedgerId)) (where.push("v.party_ledger_id = ?"), args.push(q.partyLedgerId));
    if (str(q.ledgerId)) (where.push("EXISTS (SELECT 1 FROM voucher_entries e WHERE e.voucher_id = v.id AND e.ledger_id = ?)"), args.push(q.ledgerId));
    if (str(q.search)) {
      where.push("(v.voucher_number LIKE ? OR v.narration LIKE ? OR v.reference_no LIKE ? OR pl.name LIKE ?)");
      const s = `%${String(q.search).slice(0, 100)}%`;
      args.push(s, s, s, s);
    }
    if (str(q.minAmount)) (where.push("v.total_paise >= ?"), args.push(Math.round(Number(q.minAmount) * 100) || 0));
    const p = page(q);
    const sort = SORTS[str(q.sort) || "date"] || "v.date";
    const dir = q.dir === "asc" ? "ASC" : "DESC";
    const total = db.prepare(`SELECT COUNT(*) c FROM vouchers v LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id WHERE ${where.join(" AND ")}`).get(...args).c;
    const rows = db
      .prepare(`${LIST} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${dir}, v.created_at ${dir} LIMIT ? OFFSET ?`)
      .all(...args, p.limit, p.offset);
    res.json({ rows: rows.map(toVoucherSummary), total, page: p.page, pageSize: p.pageSize });
  });

  c.get("/vouchers/pending-approval", (req, res) =>
    res.json(db.prepare(`${LIST} WHERE v.company_id = ? AND v.status = 'PendingApproval' ORDER BY v.date`).all(req.company.id).map(toVoucherSummary)),
  );

  c.get("/vouchers/:voucherId", (req, res) => {
    loadVoucherRow(db, req.company, req.params.voucherId);
    res.json(detail(req.company, req.params.voucherId));
  });

  // Compute a voucher (GST, TDS, entries) without saving — used for live preview in the entry screen.
  c.post("/vouchers/preview", W, (req, res) => {
    const input = parse(voucherSchema, req.body);
    let built;
    const rollback = new Error("preview");
    try {
      db.transaction(() => {
        built = buildVoucher(db, req, req.company, input);
        throw rollback;
      })();
    } catch (err) {
      if (err !== rollback) throw err;
    }
    const names = new Map(
      db
        .prepare("SELECT id, name FROM ledgers WHERE company_id = ?")
        .all(req.company.id)
        .map((l) => [l.id, l.name]),
    );
    res.json({
      total: fromPaise(built.header.total_paise),
      placeOfSupply: built.header.place_of_supply,
      isInterState: !!built.header.is_inter_state,
      gstInvoiceType: built.header.gst_invoice_type,
      entries: built.entries.map((e) => ({
        ledgerId: e.ledger_id,
        ledgerName: names.get(e.ledger_id),
        debit: fromPaise(e.debit_paise),
        credit: fromPaise(e.credit_paise),
      })),
      items: built.items.map((i) => ({
        description: i.description,
        taxable: fromPaise(i.taxable_paise),
        gstRate: i.gst_rate_bp / 100,
        cgst: fromPaise(i.cgst_paise),
        sgst: fromPaise(i.sgst_paise),
        igst: fromPaise(i.igst_paise),
        cess: fromPaise(i.cess_paise),
      })),
      tds: built.tds ? { amount: fromPaise(built.tds.tax_paise), rate: built.tds.rate_bp / 100 } : null,
      warnings: built.warnings,
    });
  });

  c.post("/vouchers", W, (req, res) => {
    const input = parse(voucherSchema, req.body);
    const { id: vid, warnings } = createVoucher(db, req, req.company, input);
    res.status(201).json({ ...detail(req.company, vid), warnings });
  });

  c.put("/vouchers/:voucherId", W, (req, res) => {
    const { reason = "", ...rest } = req.body || {};
    const input = parse(voucherSchema, rest);
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    const { warnings } = updateVoucher(db, req, req.company, v.id, input, String(reason).slice(0, 500));
    res.json({ ...detail(req.company, v.id), warnings });
  });

  c.post("/vouchers/:voucherId/cancel", W, (req, res) => {
    const b = parse(z.object({ reason: requiredText(500) }), req.body);
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    if (v.status === "Posted" && !req.acct.can("approve")) throw badRequest("Only reviewers or admins can cancel posted vouchers.");
    cancelVoucher(db, req, req.company, v.id, b.reason);
    res.json(detail(req.company, v.id));
  });

  c.post("/vouchers/:voucherId/approve", A, (req, res) => {
    const b = parse(z.object({ comment: text(500).default("") }), req.body);
    decideApproval(db, req, req.company, req.params.voucherId, true, b.comment);
    res.json(detail(req.company, req.params.voucherId));
  });
  c.post("/vouchers/:voucherId/reject", A, (req, res) => {
    const b = parse(z.object({ comment: requiredText(500) }), req.body);
    decideApproval(db, req, req.company, req.params.voucherId, false, b.comment);
    res.json(detail(req.company, req.params.voucherId));
  });

  c.delete("/vouchers/:voucherId", W, (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    if (!["Draft", "Rejected"].includes(v.status)) throw conflict("Only draft or rejected vouchers can be deleted. Cancel posted vouchers instead.");
    db.transaction(() => {
      for (const t of [
        "gst_transactions",
        "stock_movements",
        "tds_transactions",
        "voucher_items",
        "stock_transfers",
        "voucher_approval_workflows",
        "document_attachments",
        "e_invoice_records",
        "eway_bill_records",
      ])
        db.prepare(`DELETE FROM ${t} WHERE ${t === "document_attachments" ? "entity_id" : "voucher_id"} = ?`).run(v.id);
      db.prepare("DELETE FROM voucher_cost_allocations WHERE entry_id IN (SELECT id FROM voucher_entries WHERE voucher_id = ?)").run(v.id);
      db.prepare("DELETE FROM voucher_entries WHERE voucher_id = ?").run(v.id);
      if (db.prepare("SELECT 1 FROM voucher_revisions WHERE voucher_id = ?").get(v.id))
        throw conflict("This voucher has revision history and cannot be deleted; cancel it instead.");
      db.prepare("DELETE FROM vouchers WHERE id = ?").run(v.id);
      acctAudit(db, req, {
        companyId: req.company.id,
        action: "voucher.delete",
        entityType: "Voucher",
        entityId: v.id,
        summary: `${v.voucher_type} draft deleted`,
      });
    })();
    res.status(204).end();
  });

  c.get("/vouchers/:voucherId/revisions", (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    const rows = db
      .prepare(
        "SELECT r.*, u.name changed_by_name FROM voucher_revisions r LEFT JOIN users u ON u.id = r.changed_by WHERE r.voucher_id = ? ORDER BY r.revision",
      )
      .all(v.id);
    res.json(
      rows.map((r) => ({ revision: r.revision, reason: r.reason, changedBy: r.changed_by_name, at: r.created_at, snapshot: JSON.parse(r.snapshot_json) })),
    );
  });

  c.get("/vouchers/:voucherId/print", (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    if (req.query.format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${(v.voucher_number || v.id).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf"`);
      return res.send(renderVoucherPdf(db, req.company, v));
    }
    // The printable page is self-contained; it is served with a strict CSP (no scripts).
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type("html").send(renderVoucherHtml(db, req.company, v, str(req.query.template)));
  });

  // Attachments link existing workspace documents (uploaded through /api/documents) to a voucher.
  c.post("/vouchers/:voucherId/attachments", W, (req, res) => {
    const b = parse(z.object({ documentId: id() }), req.body);
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    const doc = db.prepare("SELECT id, name FROM documents WHERE id = ? AND organization_id = ?").get(b.documentId, req.user.organization_id);
    if (!doc) throw notFound("Document not found.");
    const aid = uuid();
    db.prepare(
      "INSERT OR IGNORE INTO document_attachments(id, organization_id, company_id, document_id, entity_type, entity_id, created_by) VALUES (?,?,?,?,?,?,?)",
    ).run(aid, req.company.organization_id, req.company.id, doc.id, "Voucher", v.id, req.user.id);
    acctAudit(db, req, { companyId: req.company.id, action: "voucher.attach", entityType: "Voucher", entityId: v.id, summary: doc.name });
    res.status(201).json(detail(req.company, v.id));
  });
  c.delete("/vouchers/:voucherId/attachments/:attachmentId", W, (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    db.prepare("DELETE FROM document_attachments WHERE id = ? AND entity_id = ? AND company_id = ?").run(req.params.attachmentId, v.id, req.company.id);
    res.status(204).end();
  });

  // Recurring vouchers ---------------------------------------------------------------------------------
  const toRecurring = (r) => ({
    id: r.id,
    name: r.name,
    frequency: r.frequency,
    nextRunDate: r.next_run_date,
    endDate: r.end_date,
    template: JSON.parse(r.template_json),
    active: !!r.active,
    lastRunAt: r.last_run_at,
  });
  c.get("/recurring", (req, res) =>
    res.json(db.prepare("SELECT * FROM recurring_vouchers WHERE company_id = ? ORDER BY next_run_date").all(req.company.id).map(toRecurring)),
  );
  c.post("/recurring", W, (req, res) => {
    const b = parse(recurringSchema, req.body);
    // Validate the template now so bad templates are caught at set-up, not at run time.
    parse(voucherSchema, { ...b.template, date: b.nextRunDate });
    const rid = uuid();
    db.prepare(
      "INSERT INTO recurring_vouchers(id, organization_id, company_id, name, frequency, next_run_date, end_date, template_json, active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      rid,
      req.company.organization_id,
      req.company.id,
      b.name,
      b.frequency,
      b.nextRunDate,
      b.endDate,
      JSON.stringify(b.template),
      b.active ? 1 : 0,
      req.user.id,
    );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "recurring.create",
      entityType: "RecurringVoucher",
      entityId: rid,
      summary: `${b.name} (${b.frequency})`,
    });
    res.status(201).json(toRecurring(db.prepare("SELECT * FROM recurring_vouchers WHERE id = ?").get(rid)));
  });
  c.patch("/recurring/:rid", W, (req, res) => {
    const b = parse(patchSchema(z, recurringFields), req.body);
    const r = db.prepare("SELECT * FROM recurring_vouchers WHERE id = ? AND company_id = ?").get(req.params.rid, req.company.id);
    if (!r) throw notFound("Recurring voucher not found.");
    if (b.template) parse(voucherSchema, { ...b.template, date: b.nextRunDate || r.next_run_date });
    db.prepare(
      "UPDATE recurring_vouchers SET name = COALESCE(?, name), frequency = COALESCE(?, frequency), next_run_date = COALESCE(?, next_run_date), end_date = ?, template_json = COALESCE(?, template_json), active = COALESCE(?, active), updated_at = ? WHERE id = ?",
    ).run(
      b.name ?? null,
      b.frequency ?? null,
      b.nextRunDate ?? null,
      b.endDate === undefined ? r.end_date : b.endDate,
      b.template ? JSON.stringify(b.template) : null,
      b.active === undefined ? null : b.active ? 1 : 0,
      nowIso(),
      r.id,
    );
    res.json(toRecurring(db.prepare("SELECT * FROM recurring_vouchers WHERE id = ?").get(r.id)));
  });
  c.delete("/recurring/:rid", W, (req, res) => {
    db.prepare("DELETE FROM recurring_vouchers WHERE id = ? AND company_id = ?").run(req.params.rid, req.company.id);
    res.status(204).end();
  });
  c.post("/recurring/run", W, (req, res) => {
    const b = parse(z.object({ asOf: isoDate().default("") }), req.body);
    res.json(runRecurring(db, req, req.company, b.asOf || new Date().toISOString().slice(0, 10)));
  });
}
