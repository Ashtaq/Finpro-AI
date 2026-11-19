// Banking: bank accounts, statement import, matching (auto / rule / manual / AI-assisted), BRS, cheques.

import multer from "multer";
import { z } from "zod";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import * as B from "../../accounting/banking.mjs";
import { fromPaise, positiveMoney } from "../../accounting/money.mjs";
import { isBank, loadTree } from "../../accounting/tree.mjs";
import { createVoucher } from "../../accounting/vouchers.mjs";
import { badRequest, notFound } from "../../lib/errors.mjs";
import { id, isoDate, parse, requiredText, text } from "../../lib/validate.mjs";
import { str, W } from "./helpers.mjs";

const reqDate = () => isoDate().refine((v) => v !== "", "is required");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });

export default function bankingRoutes(c, { db }) {
  const txn = (req) => {
    const t = db.prepare("SELECT * FROM bank_statement_transactions WHERE id = ? AND company_id = ?").get(req.params.txnId, req.company.id);
    if (!t) throw notFound("Statement line not found.");
    return t;
  };

  c.get("/bank-accounts", (req, res) => {
    const tree = loadTree(db, req.company.id);
    const banks = tree.ledgers.filter((l) => isBank(tree.info.get(l.group_id)));
    res.json(
      banks.map((l) => {
        const books =
          l.opening_balance_paise +
          db
            .prepare(
              "SELECT COALESCE(SUM(ve.debit_paise - ve.credit_paise),0) b FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.ledger_id = ? AND v.status = 'Posted'",
            )
            .get(l.id).b;
        const stmt = db
          .prepare(
            "SELECT balance_paise, txn_date FROM bank_statement_transactions WHERE bank_ledger_id = ? AND balance_paise IS NOT NULL ORDER BY txn_date DESC, rowid DESC LIMIT 1",
          )
          .get(l.id);
        const unmatched = db.prepare("SELECT COUNT(*) c FROM bank_statement_transactions WHERE bank_ledger_id = ? AND status = 'Unmatched'").get(l.id).c;
        const uncleared = db
          .prepare(
            "SELECT COUNT(*) c FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.ledger_id = ? AND v.status = 'Posted' AND ve.bank_date IS NULL",
          )
          .get(l.id).c;
        return {
          ledgerId: l.id,
          name: l.name,
          bankName: l.bank_name,
          accountNumber: l.bank_account_number ? `••••${l.bank_account_number.slice(-4)}` : "",
          ifsc: l.bank_ifsc,
          balancePerBooks: fromPaise(books),
          lastStatementBalance: stmt ? fromPaise(stmt.balance_paise) : null,
          lastStatementDate: stmt?.txn_date ?? null,
          unmatchedStatementLines: unmatched,
          unclearedBookEntries: uncleared,
        };
      }),
    );
  });

  // Upload: multipart/form-data with file + bankLedgerId (+ dateFormat).
  c.post("/bank/statements", W, upload.single("file"), (req, res) => {
    if (!req.file) throw badRequest("file: attach a CSV or XLSX bank statement.");
    const b = parse(z.object({ bankLedgerId: id(), dateFormat: z.enum(["auto", "DD/MM/YYYY", "MM/DD/YYYY"]).default("auto") }), req.body);
    if (!/\.(csv|xlsx)$/i.test(req.file.originalname)) throw badRequest("Only .csv and .xlsx statements are supported.");
    res.status(201).json(
      B.importStatement(db, req, req.company, {
        bankLedgerId: b.bankLedgerId,
        fileName: req.file.originalname,
        buffer: req.file.buffer,
        dateFormat: b.dateFormat,
      }),
    );
  });

  c.get("/bank/statements", (req, res) => {
    const lid = str(req.query.bankLedgerId);
    res.json(
      db
        .prepare(`SELECT * FROM bank_statements WHERE company_id = ? ${lid ? "AND bank_ledger_id = ?" : ""} ORDER BY created_at DESC`)
        .all(req.company.id, ...(lid ? [lid] : []))
        .map((s) => ({
          id: s.id,
          bankLedgerId: s.bank_ledger_id,
          fileName: s.file_name,
          from: s.period_from,
          to: s.period_to,
          closingBalance: s.closing_balance_paise === null ? null : fromPaise(s.closing_balance_paise),
          lines: s.line_count,
          duplicatesSkipped: s.duplicate_count,
          importedAt: s.created_at,
        })),
    );
  });

  c.get("/bank/transactions", (req, res) => {
    const lid = str(req.query.bankLedgerId);
    if (!lid) throw badRequest("bankLedgerId is required.");
    const status = str(req.query.status);
    const rows = db
      .prepare(
        `SELECT t.*, m.method, m.confidence, ve.voucher_id, v.voucher_type, v.voucher_number FROM bank_statement_transactions t
         LEFT JOIN bank_reconciliation_matches m ON m.statement_txn_id = t.id LEFT JOIN voucher_entries ve ON ve.id = m.entry_id LEFT JOIN vouchers v ON v.id = ve.voucher_id
         WHERE t.company_id = ? AND t.bank_ledger_id = ? ${status ? "AND t.status = ?" : ""} ORDER BY t.txn_date DESC, t.rowid DESC LIMIT 2000`,
      )
      .all(req.company.id, lid, ...(status ? [status] : []));
    res.json(
      rows.map((t) => ({
        id: t.id,
        date: t.txn_date,
        valueDate: t.value_date,
        description: t.description,
        reference: t.reference,
        withdrawal: fromPaise(t.debit_paise),
        deposit: fromPaise(t.credit_paise),
        balance: t.balance_paise === null ? null : fromPaise(t.balance_paise),
        status: t.status,
        isBankCharge: !!t.is_bank_charge,
        match: t.method
          ? { method: t.method, confidence: t.confidence, voucherId: t.voucher_id, voucher: `${t.voucher_type} ${t.voucher_number || ""}`.trim() }
          : null,
      })),
    );
  });

  c.get("/bank/transactions/:txnId/candidates", (req, res) => {
    const t = txn(req);
    const entries = db
      .prepare(
        `SELECT ve.*, v.date, v.voucher_number, v.voucher_type, v.reference_no, pl.name party FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
         LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id WHERE ve.ledger_id = ? AND v.status = 'Posted' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.entry_id = ve.id)`,
      )
      .all(t.bank_ledger_id);
    const scored = entries
      .map((e) => ({ e, s: B.scoreMatch(t, e, 45) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10);
    res.json(
      scored.map(({ e, s }) => ({
        entryId: e.id,
        voucherId: e.voucher_id,
        voucher: `${e.voucher_type} ${e.voucher_number || ""}`.trim(),
        date: e.date,
        party: e.party || "",
        amount: fromPaise(e.debit_paise || e.credit_paise),
        score: s,
      })),
    );
  });

  c.post("/bank/auto-match", W, (req, res) => {
    const b = parse(z.object({ bankLedgerId: id(), windowDays: z.number().int().min(0).max(60).default(7) }), req.body);
    res.json(B.autoMatch(db, req, req.company, b.bankLedgerId, { windowDays: b.windowDays }));
  });
  c.post("/bank/transactions/:txnId/match", W, (req, res) => {
    const b = parse(z.object({ entryId: id() }), req.body);
    B.manualMatch(db, req, req.company, txn(req).id, b.entryId);
    res.json({ ok: true });
  });
  c.delete("/bank/transactions/:txnId/match", W, (req, res) => {
    B.unmatch(db, req, req.company, txn(req).id);
    res.status(204).end();
  });
  c.post("/bank/transactions/:txnId/ignore", W, (req, res) => {
    const t = txn(req);
    if (t.status === "Matched") throw badRequest("Unmatch the line first.");
    db.prepare("UPDATE bank_statement_transactions SET status = ? WHERE id = ?").run(t.status === "Ignored" ? "Unmatched" : "Ignored", t.id);
    res.json({ ok: true });
  });
  // Create the missing book entry (e.g. bank charges, interest) for a statement line and match it.
  c.post("/bank/transactions/:txnId/create-voucher", W, (req, res) => {
    const b = parse(z.object({ ledgerId: id(), narration: text(500).default("") }), req.body);
    const t = txn(req);
    if (t.status !== "Unmatched") throw badRequest("Only unmatched lines can be posted.");
    const deposit = t.credit_paise > 0;
    const amount = t.credit_paise || t.debit_paise;
    const result = db.transaction(() => {
      const { id: vid } = createVoucher(
        db,
        req,
        req.company,
        {
          type: deposit ? "Receipt" : "Payment",
          date: t.txn_date,
          referenceNo: t.reference.slice(0, 60),
          referenceDate: "",
          narration: (b.narration || t.description).slice(0, 2000),
          reverseCharge: false,
          itcEligible: true,
          originalInvoiceNo: "",
          originalInvoiceDate: "",
          currency: "INR",
          dueDate: "",
          roundOff: false,
          items: [],
          saveAsDraft: false,
          overrideCreditLimit: false,
          entries: deposit
            ? [
                { ledgerId: t.bank_ledger_id, debit: amount, narration: "", costAllocations: [] },
                { ledgerId: b.ledgerId, credit: amount, narration: "", costAllocations: [] },
              ]
            : [
                { ledgerId: b.ledgerId, debit: amount, narration: "", costAllocations: [] },
                { ledgerId: t.bank_ledger_id, credit: amount, narration: "", costAllocations: [] },
              ],
        },
        { source: "bank", sourceRef: t.id },
      );
      const v = db.prepare("SELECT status FROM vouchers WHERE id = ?").get(vid);
      if (v.status === "Posted") {
        const e = db.prepare("SELECT id FROM voucher_entries WHERE voucher_id = ? AND ledger_id = ?").get(vid, t.bank_ledger_id);
        B.manualMatch(db, req, req.company, t.id, e.id);
      }
      return { voucherId: vid, matched: v.status === "Posted" };
    })();
    res.status(201).json(result);
  });

  // Rules ------------------------------------------------------------------------------------------
  const toRule = (r) => ({
    id: r.id,
    name: r.name,
    matchText: r.match_text,
    direction: r.direction,
    ledgerId: r.ledger_id,
    isBankCharge: !!r.is_bank_charge,
    priority: r.priority,
    active: !!r.active,
  });
  c.get("/bank/rules", (req, res) =>
    res.json(db.prepare("SELECT * FROM bank_rules WHERE company_id = ? ORDER BY priority, name").all(req.company.id).map(toRule)),
  );
  c.post("/bank/rules", W, (req, res) => {
    const b = parse(
      z.object({
        name: requiredText(120),
        matchText: requiredText(120),
        direction: z.enum(["Any", "Debit", "Credit"]).default("Any"),
        ledgerId: id(),
        isBankCharge: z.boolean().default(false),
        priority: z.number().int().min(1).max(1000).default(100),
      }),
      req.body,
    );
    if (!db.prepare("SELECT 1 FROM ledgers WHERE id = ? AND company_id = ?").get(b.ledgerId, req.company.id)) throw badRequest("ledgerId: not found.");
    const rid = uuid();
    db.prepare(
      "INSERT INTO bank_rules(id, organization_id, company_id, name, match_text, direction, ledger_id, is_bank_charge, priority) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(rid, req.company.organization_id, req.company.id, b.name, b.matchText, b.direction, b.ledgerId, b.isBankCharge ? 1 : 0, b.priority);
    res.status(201).json(toRule(db.prepare("SELECT * FROM bank_rules WHERE id = ?").get(rid)));
  });
  c.delete("/bank/rules/:ruleId", W, (req, res) => {
    db.prepare("DELETE FROM bank_rules WHERE id = ? AND company_id = ?").run(req.params.ruleId, req.company.id);
    res.status(204).end();
  });
  c.post("/bank/apply-rules", W, (req, res) => {
    const b = parse(z.object({ bankLedgerId: id() }), req.body);
    res.json(B.applyRules(db, req, req.company, b.bankLedgerId));
  });

  // Bank reconciliation statement ------------------------------------------------------------------
  c.get("/bank/brs", (req, res) => {
    const lid = str(req.query.bankLedgerId);
    if (!lid) throw badRequest("bankLedgerId is required.");
    const { raw: _raw, ...r } = B.bankReconciliation(db, req.company, lid, str(req.query.asOf) || new Date().toISOString().slice(0, 10));
    res.json(r);
  });
  c.post("/bank/brs", W, (req, res) => {
    const b = parse(z.object({ bankLedgerId: id(), asOf: reqDate() }), req.body);
    const { raw: _raw, ...r } = B.saveReconciliation(db, req, req.company, b.bankLedgerId, b.asOf);
    res.status(201).json(r);
  });
  c.get("/bank/brs/history", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT r.*, l.name bank FROM bank_reconciliations r JOIN ledgers l ON l.id = r.bank_ledger_id WHERE r.company_id = ? ORDER BY r.as_of_date DESC, r.created_at DESC",
        )
        .all(req.company.id)
        .map((r) => ({
          id: r.id,
          bank: r.bank,
          bankLedgerId: r.bank_ledger_id,
          asOf: r.as_of_date,
          balancePerBooks: fromPaise(r.balance_per_books_paise),
          balancePerBank: fromPaise(r.balance_per_bank_paise),
          unreconciled: fromPaise(r.unreconciled_paise),
          savedAt: r.created_at,
        })),
    ),
  );

  // Manual clearing of a book entry (classic BRS without a statement file).
  c.patch("/entries/:entryId/bank-date", W, (req, res) => {
    const b = parse(z.object({ bankDate: isoDate().nullable() }), req.body);
    const e = db
      .prepare(
        "SELECT ve.*, v.date FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.id = ? AND ve.company_id = ? AND v.status = 'Posted'",
      )
      .get(req.params.entryId, req.company.id);
    if (!e) throw notFound("Entry not found.");
    if (db.prepare("SELECT 1 FROM bank_reconciliation_matches WHERE entry_id = ?").get(e.id))
      throw badRequest("This entry is matched to a statement line; unmatch it instead.");
    if (b.bankDate && b.bankDate < e.date) throw badRequest("bankDate cannot be before the voucher date.");
    db.prepare("UPDATE voucher_entries SET bank_date = ? WHERE id = ?").run(b.bankDate || null, e.id);
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "bank.clear",
      entityType: "VoucherEntry",
      entityId: e.id,
      summary: b.bankDate ? `Cleared ${b.bankDate}` : "Uncleared",
    });
    res.json({ ok: true });
  });

  // Cheques ----------------------------------------------------------------------------------------
  const toCheque = (r, today) => ({
    id: r.id,
    bankLedgerId: r.bank_ledger_id,
    bank: r.bank,
    direction: r.direction,
    chequeNo: r.cheque_no,
    chequeDate: r.cheque_date,
    partyName: r.party_name,
    amount: fromPaise(r.amount_paise),
    status:
      ["Issued", "Deposited"].includes(r.status) && new Date(Date.parse(`${r.cheque_date}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10) < today
        ? "Stale"
        : r.status,
    voucherId: r.voucher_id,
    clearedDate: r.cleared_date,
  });
  c.get("/cheques", (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const status = str(req.query.status);
    const rows = db
      .prepare("SELECT c.*, l.name bank FROM cheque_records c JOIN ledgers l ON l.id = c.bank_ledger_id WHERE c.company_id = ? ORDER BY c.cheque_date DESC")
      .all(req.company.id)
      .map((r) => toCheque(r, today));
    res.json(status ? rows.filter((r) => r.status === status) : rows);
  });
  c.post("/cheques", W, (req, res) => {
    const b = parse(
      z.object({
        bankLedgerId: id(),
        direction: z.enum(["Issued", "Received"]),
        chequeNo: z.string().regex(/^\d{6}$/, "must be 6 digits"),
        chequeDate: reqDate(),
        partyName: text(160).default(""),
        amount: positiveMoney(),
        voucherId: id().nullable().default(null),
      }),
      req.body,
    );
    const tree = loadTree(db, req.company.id);
    const l = tree.ledgerInfo.get(b.bankLedgerId);
    if (!l || !isBank(l.g)) throw badRequest("bankLedgerId: choose a bank ledger.");
    if (b.voucherId && !db.prepare("SELECT 1 FROM vouchers WHERE id = ? AND company_id = ?").get(b.voucherId, req.company.id))
      throw badRequest("voucherId: not found.");
    const cid = uuid();
    db.prepare(
      "INSERT INTO cheque_records(id, organization_id, company_id, bank_ledger_id, direction, cheque_no, cheque_date, party_name, amount_paise, status, voucher_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      cid,
      req.company.organization_id,
      req.company.id,
      b.bankLedgerId,
      b.direction,
      b.chequeNo,
      b.chequeDate,
      b.partyName,
      b.amount,
      b.direction === "Issued" ? "Issued" : "Deposited",
      b.voucherId,
    );
    res.status(201).json({ id: cid });
  });
  c.patch("/cheques/:chequeId", W, (req, res) => {
    const b = parse(
      z.object({ status: z.enum(["Issued", "Deposited", "Cleared", "Bounced", "Cancelled"]), clearedDate: isoDate().nullable().default(null) }),
      req.body,
    );
    if (b.status === "Cleared" && !b.clearedDate) throw badRequest("clearedDate: required when the cheque is cleared.");
    const r = db
      .prepare("UPDATE cheque_records SET status = ?, cleared_date = ?, updated_at = ? WHERE id = ? AND company_id = ?")
      .run(b.status, b.clearedDate, nowIso(), req.params.chequeId, req.company.id);
    if (!r.changes) throw notFound("Cheque not found.");
    acctAudit(db, req, { companyId: req.company.id, action: "cheque.status", entityType: "Cheque", entityId: req.params.chequeId, summary: b.status });
    res.json({ ok: true });
  });
}
