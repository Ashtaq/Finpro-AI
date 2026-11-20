// Bank statement import, duplicate detection, automatic / rule-based / manual matching and the
// bank reconciliation statement (BRS).

import crypto from "node:crypto";
import { badRequest, conflict, notFound } from "../lib/errors.mjs";
import { acctAudit, uuid } from "./access.mjs";
import { readXlsx } from "./export.mjs";
import { fromPaise, toPaise } from "./money.mjs";
import { isBank, loadTree } from "./tree.mjs";
import { createVoucher } from "./vouchers.mjs";

// Parsing --------------------------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^\ufeff/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') ((cell += '"'), i++);
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(v, format = "auto") {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const ok = (y, m, d) => {
    if (y < 100) y += 2000;
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const dt = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(dt.getTime()) && dt.getUTCMonth() + 1 === m ? iso : null;
  };
  let m;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) return format === "MM/DD/YYYY" ? ok(+m[3], +m[1], +m[2]) : ok(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[\s/-]([A-Za-z]{3})[A-Za-z]*[\s/-](\d{2,4})$/.exec(s)) && MONTHS[m[2].toLowerCase()]) return ok(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

const HEADERS = {
  date: ["date", "txn date", "transaction date", "tran date", "value date", "posting date"],
  valueDate: ["value date", "value dt"],
  description: ["description", "narration", "particulars", "remarks", "transaction details", "details"],
  reference: ["reference", "ref no", "ref no.", "chq/ref no", "chq/ref no.", "cheque no", "cheque no.", "chq no", "ref", "utr", "chq./ref.no."],
  debit: ["debit", "withdrawal", "withdrawal amt", "withdrawal amt.", "withdrawals", "dr", "debit amount", "debit amt"],
  credit: ["credit", "deposit", "deposit amt", "deposit amt.", "deposits", "cr", "credit amount", "credit amt"],
  amount: ["amount", "transaction amount"],
  drcr: ["dr/cr", "type", "cr/dr", "debit/credit"],
  balance: ["balance", "closing balance", "running balance", "balance amt"],
};

function detectColumns(header) {
  const h = header.map((c) =>
    String(c || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
  );
  const find = (keys, exclude = []) => h.findIndex((c, i) => keys.includes(c) && !exclude.includes(i));
  const cols = {};
  cols.date = find(HEADERS.date.filter((k) => k !== "value date"));
  if (cols.date < 0) cols.date = find(HEADERS.date);
  cols.valueDate = find(HEADERS.valueDate, [cols.date]);
  for (const k of ["description", "reference", "debit", "credit", "amount", "drcr", "balance"]) cols[k] = find(HEADERS[k]);
  return cols;
}

const money = (v) => {
  const s = String(v ?? "")
    .replace(/[₹,\s]/g, "")
    .replace(/(Cr|Dr)\.?$/i, "");
  if (!s || s === "-") return 0;
  const n = toPaise(s.startsWith("(") ? `-${s.replace(/[()]/g, "")}` : s);
  if (n === null) throw badRequest(`Cannot read amount "${v}".`);
  return n;
};

const CHARGE_RE = /\b(charges?|chrgs?|chg|fee|fees|sms|annual|amc|min(imum)? bal|penalty|commission|gst on|service tax|debit card|atm.*fee|interest on od)\b/i;

/** Parse a statement file (CSV or XLSX) into normalised rows. */
export function parseStatement(buffer, fileName, { dateFormat = "auto" } = {}) {
  const isXlsx = /\.xlsx$/i.test(fileName) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  const table = isXlsx ? readXlsx(buffer) : parseCsv(buffer.toString("utf8"));
  const headerIdx = table.findIndex((r) => {
    const c = detectColumns(r);
    return c.date >= 0 && (c.debit >= 0 || c.credit >= 0 || c.amount >= 0);
  });
  if (headerIdx < 0) throw badRequest("Could not find a header row with Date and Debit/Credit (or Amount) columns.");
  const cols = detectColumns(table[headerIdx]);
  const out = [];
  for (const [i, r] of table.slice(headerIdx + 1).entries()) {
    const date = parseDate(r[cols.date], dateFormat);
    if (!date) continue; // footer / summary lines
    let debit = cols.debit >= 0 ? Math.abs(money(r[cols.debit])) : 0;
    let credit = cols.credit >= 0 ? Math.abs(money(r[cols.credit])) : 0;
    if (cols.amount >= 0 && !debit && !credit) {
      const a = money(r[cols.amount]);
      const t = cols.drcr >= 0 ? String(r[cols.drcr]).trim().toUpperCase() : "";
      if (t.startsWith("D") || (!t && a < 0)) debit = Math.abs(a);
      else credit = Math.abs(a);
    }
    if (!debit && !credit) continue;
    if (debit && credit) throw badRequest(`Row ${headerIdx + i + 2}: both debit and credit are filled.`);
    const description = String(r[cols.description] ?? "").trim();
    out.push({
      txn_date: date,
      value_date: cols.valueDate >= 0 ? parseDate(r[cols.valueDate], dateFormat) : null,
      description,
      reference: cols.reference >= 0 ? String(r[cols.reference] ?? "").trim() : "",
      debit_paise: debit,
      credit_paise: credit,
      balance_paise: cols.balance >= 0 && String(r[cols.balance] ?? "").trim() !== "" ? signedBalance(r[cols.balance]) : null,
      is_bank_charge: debit > 0 && CHARGE_RE.test(description) ? 1 : 0,
    });
  }
  if (!out.length) throw badRequest("No transactions found in the statement.");
  return out;
}

const signedBalance = (v) => {
  const s = String(v);
  const n = money(s);
  return /Dr\.?\s*$/i.test(s.trim()) ? -Math.abs(n) : n;
};

function bankLedger(db, company, ledgerId) {
  const tree = loadTree(db, company.id);
  const l = tree.ledgerInfo.get(ledgerId);
  if (!l || !isBank(l.g)) throw badRequest("bankLedgerId: choose a ledger under Bank Accounts or Bank OD.");
  return l;
}

export function importStatement(db, req, company, { bankLedgerId, fileName, buffer, dateFormat }) {
  const bank = bankLedger(db, company, bankLedgerId);
  const parsed = parseStatement(buffer, fileName, { dateFormat });
  return db.transaction(() => {
    const sid = uuid();
    const seen = new Map();
    let dup = 0;
    let inserted = 0;
    db.prepare(
      "INSERT INTO bank_statements(id, organization_id, company_id, bank_ledger_id, file_name, period_from, period_to, opening_balance_paise, closing_balance_paise, imported_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(sid, company.organization_id, company.id, bank.id, fileName.slice(0, 200), null, null, null, null, req.user.id);
    const ins = db.prepare(
      `INSERT INTO bank_statement_transactions(id, organization_id, company_id, statement_id, bank_ledger_id, txn_date, value_date, description, reference, debit_paise, credit_paise,
         balance_paise, fingerprint, is_bank_charge) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of parsed) {
      const base = [r.txn_date, r.description.toLowerCase().replace(/\s+/g, " "), r.reference, r.debit_paise, r.credit_paise, r.balance_paise ?? ""].join("|");
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const fp = crypto.createHash("sha256").update(`${base}|${n}`).digest("hex");
      if (db.prepare("SELECT 1 FROM bank_statement_transactions WHERE bank_ledger_id = ? AND fingerprint = ?").get(bank.id, fp)) {
        dup += 1;
        continue;
      }
      ins.run(
        uuid(),
        company.organization_id,
        company.id,
        sid,
        bank.id,
        r.txn_date,
        r.value_date,
        r.description.slice(0, 500),
        r.reference.slice(0, 100),
        r.debit_paise,
        r.credit_paise,
        r.balance_paise,
        fp,
        r.is_bank_charge,
      );
      inserted += 1;
    }
    const dates = parsed.map((r) => r.txn_date).sort();
    const withBal = parsed.filter((r) => r.balance_paise !== null);
    db.prepare("UPDATE bank_statements SET period_from=?, period_to=?, closing_balance_paise=?, line_count=?, duplicate_count=? WHERE id=?").run(
      dates[0],
      dates.at(-1),
      withBal.length ? withBal.at(-1).balance_paise : null,
      inserted,
      dup,
      sid,
    );
    db.prepare("INSERT INTO data_jobs(id, organization_id, company_id, direction, kind, status, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?)").run(
      uuid(),
      company.organization_id,
      company.id,
      "Import",
      "BankStatement",
      "Completed",
      JSON.stringify({ fileName, inserted, duplicates: dup }),
      req.user.id,
    );
    acctAudit(db, req, {
      companyId: company.id,
      action: "bank.import",
      entityType: "BankStatement",
      entityId: sid,
      summary: `${fileName}: ${inserted} lines, ${dup} duplicates skipped`,
    });
    return { statementId: sid, imported: inserted, duplicates: dup, from: dates[0], to: dates.at(-1) };
  })();
}

// Matching -------------------------------------------------------------------------------------------

const daysApart = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

function unmatchedEntries(db, bankLedgerId) {
  return db
    .prepare(
      `SELECT ve.*, v.date, v.voucher_number, v.voucher_type, v.narration v_narration, v.reference_no, pl.name party
       FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id
       WHERE ve.ledger_id = ? AND v.status = 'Posted' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.entry_id = ve.id)`,
    )
    .all(bankLedgerId);
}

/** Score a book entry as the counterpart of a statement line (0 = not a candidate). */
export function scoreMatch(txn, e, windowDays = 7) {
  const deposit = txn.credit_paise > 0;
  const amount = deposit ? txn.credit_paise : txn.debit_paise;
  if (deposit ? e.debit_paise !== amount : e.credit_paise !== amount) return 0;
  const gap = daysApart(txn.txn_date, e.instrument_date || e.date);
  if (gap > windowDays) return 0;
  let score = 60 - Math.min(30, gap * 4);
  const hay = `${txn.description} ${txn.reference}`.toUpperCase();
  for (const ref of [e.instrument_no, e.reference_no].filter((x) => x && x.length >= 3)) if (hay.includes(String(ref).toUpperCase())) score += 35;
  if (e.party) {
    const tokens = e.party
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 4);
    if (tokens.some((t) => hay.includes(t))) score += 15;
  }
  return Math.min(100, score);
}

function recordMatch(db, req, company, txn, entry, method, confidence) {
  db.prepare(
    "INSERT INTO bank_reconciliation_matches(id, organization_id, company_id, statement_txn_id, entry_id, method, confidence, matched_by) VALUES (?,?,?,?,?,?,?,?)",
  ).run(uuid(), company.organization_id, company.id, txn.id, entry.id, method, confidence, req.user.id);
  db.prepare("UPDATE bank_statement_transactions SET status = 'Matched' WHERE id = ?").run(txn.id);
  db.prepare("UPDATE voucher_entries SET bank_date = ? WHERE id = ?").run(txn.txn_date, entry.id);
}

export function autoMatch(db, req, company, bankLedgerId, { windowDays = 7, minScore = 50 } = {}) {
  bankLedger(db, company, bankLedgerId);
  return db.transaction(() => {
    const txns = db.prepare("SELECT * FROM bank_statement_transactions WHERE bank_ledger_id = ? AND status = 'Unmatched' ORDER BY txn_date").all(bankLedgerId);
    const entries = unmatchedEntries(db, bankLedgerId);
    const taken = new Set();
    let matched = 0;
    for (const t of txns) {
      const scored = entries
        .filter((e) => !taken.has(e.id))
        .map((e) => ({ e, s: scoreMatch(t, e, windowDays) }))
        .filter((x) => x.s >= minScore)
        .sort((a, b) => b.s - a.s);
      if (!scored.length) continue;
      // Ambiguous: two equally good candidates and no reference to tell them apart.
      if (scored.length > 1 && scored[0].s === scored[1].s && scored[0].s < 90) continue;
      taken.add(scored[0].e.id);
      recordMatch(db, req, company, t, scored[0].e, "Auto", scored[0].s);
      matched += 1;
    }
    acctAudit(db, req, {
      companyId: company.id,
      action: "bank.automatch",
      entityType: "Ledger",
      entityId: bankLedgerId,
      summary: `${matched} statement lines matched automatically`,
    });
    return { matched, remaining: txns.length - matched };
  })();
}

export function manualMatch(db, req, company, txnId, entryId) {
  return db.transaction(() => {
    const t = db.prepare("SELECT * FROM bank_statement_transactions WHERE id = ? AND company_id = ?").get(txnId, company.id);
    if (!t) throw notFound("Statement line not found.");
    if (t.status === "Matched") throw conflict("This statement line is already matched.");
    const e = unmatchedEntries(db, t.bank_ledger_id).find((x) => x.id === entryId);
    if (!e) throw badRequest("entryId: no unmatched book entry with that id on this bank ledger.");
    const amount = t.credit_paise || t.debit_paise;
    if ((t.credit_paise ? e.debit_paise : e.credit_paise) !== amount)
      throw badRequest("Amounts differ: a statement line can only be matched to a book entry of the same amount and direction.");
    recordMatch(db, req, company, t, e, "Manual", 100);
    acctAudit(db, req, {
      companyId: company.id,
      action: "bank.match",
      entityType: "BankStatementLine",
      entityId: t.id,
      summary: `Matched to ${e.voucher_type} ${e.voucher_number}`,
    });
  })();
}

export function unmatch(db, req, company, txnId) {
  return db.transaction(() => {
    const m = db.prepare("SELECT * FROM bank_reconciliation_matches WHERE statement_txn_id = ? AND company_id = ?").get(txnId, company.id);
    if (!m) throw notFound("No match for this statement line.");
    db.prepare("DELETE FROM bank_reconciliation_matches WHERE id = ?").run(m.id);
    db.prepare("UPDATE bank_statement_transactions SET status = 'Unmatched' WHERE id = ?").run(txnId);
    db.prepare("UPDATE voucher_entries SET bank_date = NULL WHERE id = ?").run(m.entry_id);
    acctAudit(db, req, { companyId: company.id, action: "bank.unmatch", entityType: "BankStatementLine", entityId: txnId, summary: "Match removed" });
  })();
}

/** Create vouchers for unmatched lines that satisfy a bank rule (e.g. bank charges, interest). */
export function applyRules(db, req, company, bankLedgerId) {
  bankLedger(db, company, bankLedgerId);
  const rules = db.prepare("SELECT * FROM bank_rules WHERE company_id = ? AND active = 1 ORDER BY priority, created_at").all(company.id);
  const txns = db.prepare("SELECT * FROM bank_statement_transactions WHERE bank_ledger_id = ? AND status = 'Unmatched' ORDER BY txn_date").all(bankLedgerId);
  let created = 0;
  const errors = [];
  for (const t of txns) {
    const deposit = t.credit_paise > 0;
    const rule = rules.find(
      (r) => t.description.toLowerCase().includes(r.match_text.toLowerCase()) && (r.direction === "Any" || (r.direction === "Credit") === deposit),
    );
    if (!rule) continue;
    const amount = fromPaise(t.credit_paise || t.debit_paise);
    try {
      db.transaction(() => {
        const { id: vid } = createVoucher(
          db,
          req,
          company,
          {
            type: deposit ? "Receipt" : "Payment",
            date: t.txn_date,
            referenceNo: t.reference.slice(0, 60),
            referenceDate: "",
            narration: `${rule.name}: ${t.description}`.slice(0, 2000),
            reverseCharge: false,
            itcEligible: true,
            originalInvoiceNo: "",
            originalInvoiceDate: "",
            currency: "INR",
            dueDate: "",
            roundOff: false,
            entries: deposit
              ? [
                  { ledgerId: bankLedgerId, debit: toPaise(amount), narration: "", costAllocations: [] },
                  { ledgerId: rule.ledger_id, credit: toPaise(amount), narration: "", costAllocations: [] },
                ]
              : [
                  { ledgerId: rule.ledger_id, debit: toPaise(amount), narration: "", costAllocations: [] },
                  { ledgerId: bankLedgerId, credit: toPaise(amount), narration: "", costAllocations: [] },
                ],
            items: [],
            saveAsDraft: false,
            overrideCreditLimit: false,
          },
          { source: "bank", sourceRef: t.id },
        );
        const v = db.prepare("SELECT status FROM vouchers WHERE id = ?").get(vid);
        if (v.status === "Posted") {
          const e = db.prepare("SELECT * FROM voucher_entries WHERE voucher_id = ? AND ledger_id = ?").get(vid, bankLedgerId);
          recordMatch(db, req, company, t, e, "Rule", 100);
        }
        if (rule.is_bank_charge) db.prepare("UPDATE bank_statement_transactions SET is_bank_charge = 1 WHERE id = ?").run(t.id);
      })();
      created += 1;
    } catch (err) {
      errors.push({ line: t.id, error: err.message });
    }
  }
  return { created, errors };
}

// BRS ------------------------------------------------------------------------------------------------

export function bankReconciliation(db, company, bankLedgerId, asOf) {
  const bank = bankLedger(db, company, bankLedgerId);
  const books =
    bank.opening_balance_paise +
    db
      .prepare(
        "SELECT COALESCE(SUM(ve.debit_paise - ve.credit_paise),0) b FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date <= ?",
      )
      .get(bank.id, asOf).b;
  const pending = db
    .prepare(
      `SELECT ve.*, v.date, v.voucher_number, v.voucher_type, pl.name party FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id
       WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date <= ? AND (ve.bank_date IS NULL OR ve.bank_date > ?) ORDER BY v.date`,
    )
    .all(bank.id, asOf, asOf);
  const depositsNotCredited = pending.filter((e) => e.debit_paise > 0);
  const chequesNotPresented = pending.filter((e) => e.credit_paise > 0);
  const bankOnly = db
    .prepare("SELECT * FROM bank_statement_transactions WHERE bank_ledger_id = ? AND status = 'Unmatched' AND txn_date <= ? ORDER BY txn_date")
    .all(bank.id, asOf);
  const creditsNotInBooks = bankOnly.filter((t) => t.credit_paise > 0);
  const debitsNotInBooks = bankOnly.filter((t) => t.debit_paise > 0);
  const s = (list, k) => list.reduce((a, x) => a + x[k], 0);
  const computedBank =
    books -
    s(depositsNotCredited, "debit_paise") +
    s(chequesNotPresented, "credit_paise") +
    s(creditsNotInBooks, "credit_paise") -
    s(debitsNotInBooks, "debit_paise");
  const last = db
    .prepare(
      "SELECT balance_paise FROM bank_statement_transactions WHERE bank_ledger_id = ? AND txn_date <= ? AND balance_paise IS NOT NULL ORDER BY txn_date DESC, rowid DESC LIMIT 1",
    )
    .get(bank.id, asOf);
  const entryRow = (e) => ({
    entryId: e.id,
    voucherId: e.voucher_id,
    date: e.date,
    voucher: `${e.voucher_type} ${e.voucher_number || ""}`.trim(),
    party: e.party || "",
    instrumentNo: e.instrument_no || "",
    amount: fromPaise(e.debit_paise || e.credit_paise),
  });
  const txnRow = (t) => ({
    txnId: t.id,
    date: t.txn_date,
    description: t.description,
    reference: t.reference,
    amount: fromPaise(t.credit_paise || t.debit_paise),
    isBankCharge: !!t.is_bank_charge,
  });
  return {
    bank: { id: bank.id, name: bank.name },
    asOf,
    balancePerBooks: fromPaise(books),
    depositsNotCredited: depositsNotCredited.map(entryRow),
    chequesNotPresented: chequesNotPresented.map(entryRow),
    creditsInBankNotInBooks: creditsNotInBooks.map(txnRow),
    debitsInBankNotInBooks: debitsNotInBooks.map(txnRow),
    balancePerBankComputed: fromPaise(computedBank),
    balancePerStatement: last ? fromPaise(last.balance_paise) : null,
    difference: last ? fromPaise(last.balance_paise - computedBank) : null,
    reconciled: last ? last.balance_paise === computedBank && !bankOnly.length && !pending.length : false,
    raw: { books, computedBank, statement: last?.balance_paise ?? null },
  };
}

export function saveReconciliation(db, req, company, bankLedgerId, asOf) {
  const r = bankReconciliation(db, company, bankLedgerId, asOf);
  const id = uuid();
  db.prepare(
    "INSERT INTO bank_reconciliations(id, organization_id, company_id, bank_ledger_id, as_of_date, balance_per_books_paise, balance_per_bank_paise, unreconciled_paise, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    company.organization_id,
    company.id,
    bankLedgerId,
    asOf,
    r.raw.books,
    r.raw.statement ?? r.raw.computedBank,
    (r.raw.statement ?? r.raw.computedBank) - r.raw.computedBank,
    JSON.stringify({ ...r, raw: undefined }),
    req.user.id,
  );
  acctAudit(db, req, { companyId: company.id, action: "bank.brs.save", entityType: "Ledger", entityId: bankLedgerId, summary: `BRS saved as at ${asOf}` });
  return { id, ...r };
}
