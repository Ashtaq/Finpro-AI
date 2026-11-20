// Accounting intelligence: anomaly detection, audit-risk indicators, ledger suggestions, statement
// explanations and natural-language queries. Everything here is ASSISTIVE: it flags and explains, it never
// posts, approves or certifies entries. Deterministic rules run on the books; the optional AI service is
// used only to phrase explanations / answer free-form questions over figures computed here.

import { fyBounds } from "./chart.mjs";
import { fromPaise, toPaise } from "./money.mjs";
import { balanceSheet, financialRatios, outstanding, profitAndLossRaw, trialBalance } from "./reports.mjs";
import { isCashOrBank, isCreditor, isDebtor, loadTree } from "./tree.mjs";

const POSTED = "v.company_id = ? AND v.status = 'Posted'";
const normRef = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+/, "");

export function duplicateInvoices(db, company, { from, to }) {
  const rows = db
    .prepare(
      `SELECT v.id, v.voucher_type, v.voucher_number, v.date, v.reference_no, v.total_paise, v.party_ledger_id, l.name party FROM vouchers v
       JOIN ledgers l ON l.id = v.party_ledger_id WHERE ${POSTED} AND v.voucher_type = 'Purchase' AND v.date BETWEEN ? AND ? ORDER BY v.date`,
    )
    .all(company.id, from, to);
  const groups = new Map();
  for (const r of rows) {
    const keys = [];
    if (normRef(r.reference_no)) keys.push(`ref|${r.party_ledger_id}|${normRef(r.reference_no)}`);
    keys.push(`amt|${r.party_ledger_id}|${r.total_paise}`);
    for (const k of keys) groups.set(k, [...(groups.get(k) || []), r]);
  }
  const out = [];
  const seen = new Set();
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    if (k.startsWith("amt|")) {
      // Same party & amount only counts when dated within 7 days of each other.
      const close = list.filter((a, i) => list.some((b, j) => i !== j && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 7 * 86400000));
      if (close.length < 2) continue;
      list.splice(0, list.length, ...close);
    }
    const sig = list
      .map((r) => r.id)
      .sort()
      .join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({
      reason: k.startsWith("ref|") ? "Same supplier invoice number" : "Same supplier and amount within 7 days",
      party: list[0].party,
      amount: fromPaise(list[0].total_paise),
      vouchers: list.map((r) => ({ id: r.id, number: r.voucher_number, date: r.date, referenceNo: r.reference_no, amount: fromPaise(r.total_paise) })),
    });
  }
  return out;
}

function monthlyExpenseSpikes(db, company, to) {
  const rows = db
    .prepare(
      `SELECT ve.ledger_id, l.name, substr(v.date,1,7) ym, SUM(ve.debit_paise - ve.credit_paise) n FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       JOIN ledgers l ON l.id = ve.ledger_id JOIN account_groups g ON g.id = l.group_id
       WHERE ${POSTED} AND v.date <= ? AND g.nature = 'Expenses' GROUP BY ve.ledger_id, ym ORDER BY ym`,
    )
    .all(company.id, to);
  const byLedger = new Map();
  for (const r of rows) byLedger.set(r.ledger_id, [...(byLedger.get(r.ledger_id) || []), r]);
  const target = to.slice(0, 7);
  const out = [];
  for (const list of byLedger.values()) {
    const cur = list.find((r) => r.ym === target);
    const prior = list.filter((r) => r.ym < target).slice(-3);
    if (!cur || prior.length < 2) continue;
    const avg = prior.reduce((a, r) => a + r.n, 0) / prior.length;
    if (cur.n > 1000000 && avg > 0 && cur.n > avg * 1.5)
      out.push({
        ledgerId: cur.ledger_id,
        ledger: cur.name,
        month: target,
        amount: fromPaise(cur.n),
        priorAverage: fromPaise(Math.round(avg)),
        increasePct: Math.round(((cur.n - avg) / avg) * 100),
      });
  }
  return out.sort((a, b) => b.increasePct - a.increasePct);
}

export function anomalies(db, company, q = {}) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const from = q.from || fyBounds(to, company.fy_start_month).start;
  const tree = loadTree(db, company.id);
  const findings = [];
  const push = (f) => findings.push(f);

  for (const d of duplicateInvoices(db, company, { from, to }))
    push({
      type: "DuplicateInvoice",
      severity: "High",
      title: `Possible duplicate purchase invoice — ${d.party}`,
      detail: `${d.reason}; ₹${d.amount}.`,
      vouchers: d.vouchers,
    });

  // Statistical outliers per expense ledger (amount > mean + 3σ with at least 6 observations).
  const lines = db
    .prepare(
      `SELECT ve.ledger_id, ve.debit_paise d, v.id vid, v.voucher_number num, v.date FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       JOIN ledgers l ON l.id = ve.ledger_id JOIN account_groups g ON g.id = l.group_id WHERE ${POSTED} AND v.date BETWEEN ? AND ? AND g.nature = 'Expenses' AND ve.debit_paise > 0`,
    )
    .all(company.id, from, to);
  const per = new Map();
  for (const l of lines) per.set(l.ledger_id, [...(per.get(l.ledger_id) || []), l]);
  for (const [lid, list] of per) {
    if (list.length < 6) continue;
    const mean = list.reduce((a, x) => a + x.d, 0) / list.length;
    const sd = Math.sqrt(list.reduce((a, x) => a + (x.d - mean) ** 2, 0) / list.length);
    for (const x of list)
      if (sd > 0 && x.d > mean + 3 * sd && x.d > 500000)
        push({
          type: "UnusualAmount",
          severity: "Medium",
          title: `Unusually large entry in ${tree.ledgerInfo.get(lid)?.name}`,
          detail: `₹${fromPaise(x.d)} vs typical ₹${fromPaise(Math.round(mean))} (3σ above mean).`,
          vouchers: [{ id: x.vid, number: x.num, date: x.date, amount: fromPaise(x.d) }],
        });
  }

  // Cash payments above ₹10,000 to one party in a day (s.40A(3) disallowance risk).
  const cashIds = tree.ledgers.filter((l) => isCashOrBank(tree.info.get(l.group_id)) && tree.info.get(l.group_id).codes.has("CASH")).map((l) => l.id);
  if (cashIds.length) {
    const rows = db
      .prepare(
        `SELECT v.date, v.party_ledger_id, pl.name party, SUM(ve.credit_paise) paid, group_concat(v.id) ids FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
         LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id WHERE ${POSTED} AND v.date BETWEEN ? AND ? AND ve.ledger_id IN (${cashIds.map(() => "?").join(",")}) AND ve.credit_paise > 0
         AND v.voucher_type IN ('Payment','Journal') GROUP BY v.date, COALESCE(v.party_ledger_id, v.id) HAVING paid > 1000000`,
      )
      .all(company.id, from, to, ...cashIds);
    for (const r of rows)
      push({
        type: "CashPaymentLimit",
        severity: "High",
        title: `Cash payment above ₹10,000 in a day${r.party ? ` — ${r.party}` : ""}`,
        detail: `₹${fromPaise(r.paid)} paid in cash on ${r.date}. Expenditure may be disallowed u/s 40A(3).`,
        vouchers: String(r.ids)
          .split(",")
          .map((id) => ({ id })),
      });
    // Negative cash balance on any day.
    for (const cid of cashIds) {
      const l = tree.ledgerInfo.get(cid);
      const days = db
        .prepare(
          `SELECT v.date, SUM(ve.debit_paise - ve.credit_paise) n FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ${POSTED} AND ve.ledger_id = ? GROUP BY v.date ORDER BY v.date`,
        )
        .all(company.id, cid);
      let bal = l.opening_balance_paise;
      for (const d of days) {
        bal += d.n;
        if (bal < 0 && d.date >= from && d.date <= to) {
          push({
            type: "NegativeCash",
            severity: "High",
            title: `Negative cash balance — ${l.name}`,
            detail: `Balance fell to ₹${fromPaise(bal)} on ${d.date}.`,
            ledgerId: cid,
          });
          break;
        }
      }
    }
  }

  // Round-figure large entries and Sunday postings.
  const big = db
    .prepare(
      `SELECT v.id, v.voucher_type, v.voucher_number, v.date, v.total_paise, v.narration FROM vouchers v WHERE ${POSTED} AND v.is_accounting = 1 AND v.date BETWEEN ? AND ?`,
    )
    .all(company.id, from, to);
  for (const v of big) {
    if (v.total_paise >= 10000000 && v.total_paise % 1000000 === 0 && v.voucher_type !== "Payroll")
      push({
        type: "RoundAmount",
        severity: "Low",
        title: `Round-figure ${v.voucher_type} of ₹${fromPaise(v.total_paise)}`,
        detail: "Large round amounts merit supporting evidence.",
        vouchers: [{ id: v.id, number: v.voucher_number, date: v.date }],
      });
    if (new Date(`${v.date}T00:00:00Z`).getUTCDay() === 0 && v.total_paise >= 5000000)
      push({
        type: "SundayPosting",
        severity: "Low",
        title: `${v.voucher_type} dated on a Sunday`,
        detail: `₹${fromPaise(v.total_paise)} on ${v.date}.`,
        vouchers: [{ id: v.id, number: v.voucher_number, date: v.date }],
      });
    if (!v.narration.trim() && v.total_paise >= 5000000 && ["Journal", "Payment"].includes(v.voucher_type))
      push({
        type: "MissingNarration",
        severity: "Low",
        title: `${v.voucher_type} ${v.voucher_number} has no narration`,
        detail: `₹${fromPaise(v.total_paise)} without an explanation.`,
        vouchers: [{ id: v.id, number: v.voucher_number, date: v.date }],
      });
  }

  for (const s of monthlyExpenseSpikes(db, company, to))
    push({
      type: "ExpenseSpike",
      severity: "Medium",
      title: `${s.ledger} up ${s.increasePct}% in ${s.month}`,
      detail: `₹${s.amount} vs 3-month average ₹${s.priorAverage}.`,
      ledgerId: s.ledgerId,
    });

  for (const m of ledgerMismatches(db, company, { from, to }))
    push({ type: "LedgerMismatch", severity: m.severity, title: m.title, detail: m.detail, ledgerId: m.ledgerId });

  const stale = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(debit_paise + credit_paise),0) t FROM bank_statement_transactions WHERE company_id = ? AND status = 'Unmatched' AND txn_date <= date(?, '-30 days')",
    )
    .get(company.id, to);
  if (stale.c)
    push({
      type: "StaleUnreconciled",
      severity: "Medium",
      title: `${stale.c} bank statement line(s) unreconciled for over 30 days`,
      detail: `Total ₹${fromPaise(stale.t)}.`,
    });

  const order = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {});
  const score = Math.min(100, (counts.High || 0) * 15 + (counts.Medium || 0) * 6 + (counts.Low || 0) * 2);
  return {
    from,
    to,
    riskScore: score,
    riskLevel: score >= 60 ? "High" : score >= 25 ? "Medium" : "Low",
    counts,
    findings,
    disclaimer: "Indicators are generated by rules over the books to direct review. They are not audit conclusions.",
  };
}

export function ledgerMismatches(db, company, { from, to }) {
  const tree = loadTree(db, company.id);
  const out = [];
  const tb = trialBalance(db, company, { from, to });
  if (!tb.balanced)
    out.push({ severity: "High", title: "Trial balance does not tally", detail: `Closing Dr ₹${tb.totals.closingDr} vs Cr ₹${tb.totals.closingCr}.` });
  if (tb.openingDifference !== "0.00")
    out.push({ severity: "High", title: "Difference in opening balances", detail: `₹${tb.openingDifference} — opening Dr and Cr balances do not agree.` });
  const bal = new Map(tb.rows.filter((r) => r.ledgerId).map((r) => [r.ledgerId, toPaise(r.closing)]));
  for (const l of tree.ledgers) {
    const gi = tree.info.get(l.group_id);
    const b = bal.get(l.id) || 0;
    if (isDebtor(gi) && b < 0)
      out.push({
        severity: "Low",
        ledgerId: l.id,
        title: `Debtor with credit balance — ${l.name}`,
        detail: `₹${fromPaise(-b)} Cr. Check advances or misposted receipts.`,
      });
    if (isCreditor(gi) && b > 0)
      out.push({
        severity: "Low",
        ledgerId: l.id,
        title: `Creditor with debit balance — ${l.name}`,
        detail: `₹${fromPaise(b)} Dr. Check advances or duplicate payments.`,
      });
    if (l.gstin && !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(l.gstin))
      out.push({ severity: "Medium", ledgerId: l.id, title: `Invalid GSTIN on ${l.name}`, detail: l.gstin });
    if (l.gstin && l.state_code && l.gstin.slice(0, 2) !== l.state_code)
      out.push({
        severity: "Medium",
        ledgerId: l.id,
        title: `State code differs from GSTIN — ${l.name}`,
        detail: `GSTIN state ${l.gstin.slice(0, 2)}, ledger state ${l.state_code}. Place of supply may be wrong.`,
      });
  }
  // GST register vs duty ledgers for the period.
  const gst = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN g.doc_type='Invoice' THEN 1 ELSE -1 END * (g.cgst_paise+g.sgst_paise+g.igst_paise+g.cess_paise)),0) t FROM gst_transactions g
       JOIN vouchers v ON v.id = g.voucher_id AND v.status = 'Posted' WHERE g.company_id = ? AND g.direction = 'Outward' AND g.date BETWEEN ? AND ?`,
    )
    .get(company.id, from, to).t;
  const outLedgers = tree.ledgers.filter((l) => l.gst_duty_direction === "Output").map((l) => l.id);
  if (outLedgers.length) {
    const led = db
      .prepare(
        `SELECT COALESCE(SUM(ve.credit_paise - ve.debit_paise),0) t FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
         WHERE ${POSTED} AND v.date BETWEEN ? AND ? AND v.voucher_type IN ('Sales','CreditNote') AND ve.ledger_id IN (${outLedgers.map(() => "?").join(",")})`,
      )
      .get(company.id, from, to, ...outLedgers).t;
    if (led !== gst)
      out.push({
        severity: "Medium",
        title: "Output GST ledgers differ from the GST register",
        detail: `Ledgers ₹${fromPaise(led)} vs register ₹${fromPaise(gst)}.`,
      });
  }
  return out;
}

export function suggestLedgers(db, company, { narration = "", type, amount }) {
  const tokens = [
    ...new Set(
      narration
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3),
    ),
  ];
  if (!tokens.length) return [];
  const rows = db
    .prepare(
      `SELECT v.narration, ve.ledger_id, l.name, ve.debit_paise, ve.credit_paise FROM vouchers v JOIN voucher_entries ve ON ve.voucher_id = v.id JOIN ledgers l ON l.id = ve.ledger_id
       JOIN account_groups g ON g.id = l.group_id WHERE ${POSTED} ${type ? "AND v.voucher_type = ?" : ""} AND g.system_code IS NOT 'CASH' AND g.system_code IS NOT 'BANK'
       ORDER BY v.date DESC LIMIT 3000`,
    )
    .all(company.id, ...(type ? [type] : []));
  const score = new Map();
  for (const r of rows) {
    const words = new Set(r.narration.toLowerCase().split(/[^a-z0-9]+/));
    const hits = tokens.filter((t) => words.has(t)).length;
    if (!hits) continue;
    const s = score.get(r.ledger_id) || { ledgerId: r.ledger_id, ledger: r.name, score: 0, uses: 0, side: r.debit_paise ? "Dr" : "Cr" };
    s.score += hits / tokens.length;
    s.uses += 1;
    if (amount && toPaise(amount) === (r.debit_paise || r.credit_paise)) s.score += 0.5;
    score.set(r.ledger_id, s);
  }
  return [...score.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({ ...s, confidence: Math.min(99, Math.round((s.score / Math.max(1, s.uses)) * 100)) }));
}

/** Plain-language explanation of the statements (deterministic). */
export function explainStatements(db, company, q = {}) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const cur = fyBounds(to, company.fy_start_month);
  const from = q.from || (cur.start < company.books_start_date ? company.books_start_date : cur.start);
  const pl = profitAndLossRaw(db, company, from, to);
  const bs = balanceSheet(db, company, { to });
  const ratios = financialRatios(db, company, { from, to });
  const r = Object.fromEntries(ratios.ratios.map((x) => [x.key, x.value]));
  const points = [];
  points.push(
    `Revenue (sales and direct income) for ${from} to ${to} is ₹${fromPaise(pl.revenue)}, with gross profit of ₹${fromPaise(pl.grossProfit)}${r.grossMargin ? ` (${r.grossMargin}% margin)` : ""}.`,
  );
  points.push(
    `${pl.netProfit >= 0 ? "Net profit" : "Net loss"} for the period is ₹${fromPaise(Math.abs(pl.netProfit))}${r.netMargin ? `, a net margin of ${r.netMargin}%` : ""}.`,
  );
  if (r.currentRatio)
    points.push(
      `Current ratio is ${r.currentRatio}x${Number(r.currentRatio) < 1 ? " — current liabilities exceed current assets, so short-term liquidity needs attention" : ""}.`,
    );
  if (r.debtorDays) points.push(`Customers take about ${Math.round(Number(r.debtorDays))} days to pay on average.`);
  if (r.debtEquity) points.push(`Debt to equity stands at ${r.debtEquity}x.`);
  const top = [...pl.plDr, ...pl.tradingDr].flatMap((n) => (n.children.length ? n.children : [n])).sort((a, b) => b.amount - a.amount)[0];
  if (top) points.push(`The largest cost head is ${top.name} at ₹${fromPaise(top.amount)}.`);
  if (!bs.balanced) points.push("The balance sheet does not tally — resolve the opening balance difference before relying on these figures.");
  return {
    from,
    to,
    points,
    figures: { revenue: fromPaise(pl.revenue), grossProfit: fromPaise(pl.grossProfit), netProfit: fromPaise(pl.netProfit) },
    ratios: ratios.ratios,
  };
}

export function financialSummary(db, company, q = {}) {
  const e = explainStatements(db, company, q);
  const rec = outstanding(db, company, { kind: "receivable", to: e.to });
  const pay = outstanding(db, company, { kind: "payable", to: e.to });
  return { ...e, receivables: rec.total, payables: pay.total };
}

// Natural-language queries -------------------------------------------------------------------------

function parseAmount(text) {
  const m = /(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(crore|cr|lakhs?|lacs?|l|k|thousand)?/i.exec(text.replace(/above|over|more than|greater than|exceeding/gi, " "));
  if (!m) return null;
  const base = toPaise(m[1].replace(/,/g, ""));
  if (base === null) return null;
  const unit = (m[2] || "").toLowerCase();
  const mult = unit.startsWith("cr") ? 10000000 : unit.startsWith("l") ? 100000 : unit === "k" || unit === "thousand" ? 1000 : 1;
  return base * mult;
}

export function naturalQuery(db, company, text) {
  const t = text.toLowerCase();
  const to = new Date().toISOString().slice(0, 10);
  const fy = fyBounds(to, company.fy_start_month);
  const range = { from: fy.start < company.books_start_date ? company.books_start_date : fy.start, to };
  if (/duplicate/.test(t)) return { intent: "duplicate_invoices", title: "Possible duplicate purchase invoices", data: duplicateInvoices(db, company, range) };
  if (/mismatch/.test(t)) return { intent: "ledger_mismatches", title: "Ledger mismatches", data: ledgerMismatches(db, company, range) };
  if (/unreconcil|bank.*(pending|unmatched)/.test(t)) {
    const lines = db
      .prepare(
        "SELECT bt.id, bt.txn_date, bt.description, bt.debit_paise, bt.credit_paise, l.name bank FROM bank_statement_transactions bt JOIN ledgers l ON l.id = bt.bank_ledger_id WHERE bt.company_id = ? AND bt.status = 'Unmatched' ORDER BY bt.txn_date",
      )
      .all(company.id);
    return {
      intent: "unreconciled_bank",
      title: "Unreconciled bank transactions",
      data: lines.map((x) => ({
        id: x.id,
        bank: x.bank,
        date: x.txn_date,
        description: x.description,
        withdrawal: fromPaise(x.debit_paise),
        deposit: fromPaise(x.credit_paise),
      })),
    };
  }
  if (/unusual|spike|abnormal/.test(t))
    return { intent: "unusual_expenses", title: "Expenses unusual against the previous three months", data: monthlyExpenseSpikes(db, company, to) };
  if (/summary|overview|snapshot/.test(t)) return { intent: "financial_summary", title: "Financial summary", data: financialSummary(db, company, range) };
  if (/(above|over|more than|greater than|exceeding)/.test(t)) {
    const amount = parseAmount(t);
    if (amount) {
      const typeMatch = /(payment|receipt|sales|purchase|journal|contra)/.exec(t)?.[1];
      const type = typeMatch ? typeMatch[0].toUpperCase() + typeMatch.slice(1) : null;
      const rows = db
        .prepare(
          `SELECT v.id, v.date, v.voucher_type, v.voucher_number, v.total_paise, v.narration, pl.name party FROM vouchers v LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id
           WHERE ${POSTED} AND v.is_accounting = 1 AND v.total_paise > ? AND v.date BETWEEN ? AND ? ${type ? "AND v.voucher_type = ?" : ""} ORDER BY v.total_paise DESC LIMIT 500`,
        )
        .all(company.id, amount, range.from, range.to, ...(type ? [type] : []));
      return {
        intent: "transactions_above",
        title: `${type || "Transactions"} above ₹${fromPaise(amount)} (${range.from} to ${range.to})`,
        data: rows.map((r) => ({
          id: r.id,
          date: r.date,
          type: r.voucher_type,
          number: r.voucher_number,
          party: r.party || "",
          amount: fromPaise(r.total_paise),
          narration: r.narration,
        })),
      };
    }
  }
  if (/receivable|debtor|owe us|outstanding from/.test(t))
    return { intent: "receivables", title: "Outstanding receivables", data: outstanding(db, company, { kind: "receivable", to }) };
  if (/payable|creditor|we owe/.test(t)) return { intent: "payables", title: "Outstanding payables", data: outstanding(db, company, { kind: "payable", to }) };
  if (/anomal|risk|audit/.test(t)) return { intent: "anomalies", title: "Audit risk indicators", data: anomalies(db, company, range) };
  return {
    intent: "unknown",
    title: "I could not map that question to the books yet",
    data: [],
    suggestions: [
      "Show all transactions above ₹1 lakh",
      "Identify duplicate purchase invoices",
      "Find ledger mismatches for this financial year",
      "Show all unreconciled bank transactions",
      "Generate a financial summary for this company",
      "Identify unusual expenses compared with previous months",
    ],
  };
}

/** Extract invoice fields from plain text (e.g. a text-based PDF's extracted text or an e-mail). */
export function extractInvoiceFields(text) {
  const g = (re) => re.exec(text)?.[1]?.trim() || "";
  const gstins = [...new Set(text.toUpperCase().match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) || [])];
  const amounts = [
    ...text.matchAll(/(?:grand\s*total|total\s*amount|invoice\s*(?:value|total)|amount\s*payable|total)\s*[:-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+\.\d{2}|[\d,]+)/gi),
  ].map((m) => m[1].replace(/,/g, ""));
  return {
    invoiceNo: g(/invoice\s*(?:no|number|#)\.?\s*[:-]?\s*([A-Z0-9/-]+)/i),
    invoiceDate: g(/(?:invoice\s*)?date\s*[:-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i),
    supplierGstin: gstins[0] || "",
    buyerGstin: gstins[1] || "",
    total: amounts.length ? amounts[amounts.length - 1] : "",
    taxableValue: g(/taxable\s*(?:value|amount)\s*[:-]?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i).replace(/,/g, ""),
    cgst: g(/cgst[^\d\n]*([\d,]+\.\d{2})/i).replace(/,/g, ""),
    sgst: g(/sgst[^\d\n]*([\d,]+\.\d{2})/i).replace(/,/g, ""),
    igst: g(/igst[^\d\n]*([\d,]+\.\d{2})/i).replace(/,/g, ""),
    note: "Fields were read from text and must be verified before posting.",
  };
}
