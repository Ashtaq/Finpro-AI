// Financial reporting engine. All figures are computed from posted vouchers and opening balances —
// nothing is cached — so reports always reconcile with the books.
//
// Sign convention internally: Dr positive, Cr negative (paise). Presentation layers flip signs per side.

import { badRequest, notFound } from "../lib/errors.mjs";
import { addDays, fyBounds } from "./chart.mjs";
import { fromPaise, mulDiv } from "./money.mjs";
import { bookOpeningStock, stockValueAt } from "./stock.mjs";
import { isBank, isCashOrBank, isCreditor, isDebtor, isPL, isStock, isUnder, loadTree } from "./tree.mjs";

const MIN_DATE = "0000-01-01";
const dayBefore = (d) => addDays(d, -1);

export function sumsBy(db, companyId, from, to) {
  const rows = db
    .prepare(
      `SELECT ve.ledger_id, SUM(ve.debit_paise) dr, SUM(ve.credit_paise) cr FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.date >= ? AND v.date <= ? GROUP BY ve.ledger_id`,
    )
    .all(companyId, from, to);
  return new Map(rows.map((r) => [r.ledger_id, { dr: r.dr, cr: r.cr, net: r.dr - r.cr }]));
}
const net = (m, id) => m.get(id)?.net || 0;

export function periodDefaults(company, q) {
  const today = new Date().toISOString().slice(0, 10);
  const to = q.to || today;
  const from = q.from || fyBounds(to, company.fy_start_month).start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest("from/to must be dates (YYYY-MM-DD).");
  if (from > to) throw badRequest("from must be on or before to.");
  return { from: from < company.books_start_date ? company.books_start_date : from, to };
}

function openingDifference(db, company, tree) {
  let total = bookOpeningStock(db, company);
  for (const l of tree.ledgers) if (!isStock(tree.info.get(l.group_id))) total += l.opening_balance_paise;
  return total;
}

/** Accumulated P&L A/c balance (Dr positive) as at end of `to`, split into own entries, P&L ledgers and stock. */
function plAccountBalance(db, company, tree, all, to) {
  let pl = 0;
  for (const l of tree.ledgers) if (isPL(tree.info.get(l.group_id))) pl += net(all, l.id);
  const stockAdj = stockValueAt(db, company, to) - bookOpeningStock(db, company);
  return pl - stockAdj;
}

// Trial balance --------------------------------------------------------------------------------------

export function trialBalance(db, company, q) {
  const { from, to } = periodDefaults(company, q);
  const tree = loadTree(db, company.id);
  const fyStart = fyBounds(from, company.fy_start_month).start;
  const pre = sumsBy(db, company.id, MIN_DATE, dayBefore(from));
  const preFy = sumsBy(db, company.id, MIN_DATE, dayBefore(fyStart));
  const per = sumsBy(db, company.id, from, to);
  const openStockFy = fyStart <= company.books_start_date ? bookOpeningStock(db, company) : stockValueAt(db, company, dayBefore(fyStart));
  const bookOpen = bookOpeningStock(db, company);
  let priorPl = 0;
  for (const l of tree.ledgers) if (isPL(tree.info.get(l.group_id))) priorPl += net(preFy, l.id);

  const rows = [];
  for (const l of tree.ledgers) {
    const g = tree.info.get(l.group_id);
    if (isStock(g)) continue;
    let opening = isPL(g) ? net(pre, l.id) - net(preFy, l.id) : l.opening_balance_paise + net(pre, l.id);
    if (l.system_code === "PL_ACCOUNT") opening += priorPl - (openStockFy - bookOpen);
    const p = per.get(l.id) || { dr: 0, cr: 0 };
    const closing = opening + p.dr - p.cr;
    if (!opening && !p.dr && !p.cr) continue;
    rows.push({ ledgerId: l.id, ledger: l.name, group: g.path.join(" › "), nature: g.nature, opening, debit: p.dr, credit: p.cr, closing });
  }
  if (openStockFy)
    rows.push({
      ledgerId: null,
      ledger: "Opening Stock",
      group: "Stock-in-Hand",
      nature: "Assets",
      opening: openStockFy,
      debit: 0,
      credit: 0,
      closing: openStockFy,
    });
  const diff = openingDifference(db, company, tree);
  if (diff) rows.push({ ledgerId: null, ledger: "Difference in opening balances", group: "", nature: "", opening: -diff, debit: 0, credit: 0, closing: -diff });
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.ledger.localeCompare(b.ledger));
  const t = { openingDr: 0, openingCr: 0, debit: 0, credit: 0, closingDr: 0, closingCr: 0 };
  for (const r of rows) {
    if (r.opening > 0) t.openingDr += r.opening;
    else t.openingCr -= r.opening;
    t.debit += r.debit;
    t.credit += r.credit;
    if (r.closing > 0) t.closingDr += r.closing;
    else t.closingCr -= r.closing;
  }
  return {
    from,
    to,
    rows: rows.map((r) => ({
      ...r,
      opening: fromPaise(r.opening),
      debit: fromPaise(r.debit),
      credit: fromPaise(r.credit),
      closing: fromPaise(r.closing),
      closingDr: r.closing > 0 ? fromPaise(r.closing) : "0.00",
      closingCr: r.closing < 0 ? fromPaise(-r.closing) : "0.00",
    })),
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fromPaise(v)])),
    balanced: t.closingDr === t.closingCr && t.debit === t.credit,
    openingDifference: fromPaise(diff),
  };
}

// Group roll-ups ---------------------------------------------------------------------------------------

/** Build a group tree with amounts for ledgers selected by `amountOf` (return null to skip). */
function rollup(tree, rootFilter, amountOf, extraLedgers = []) {
  const nodes = new Map();
  const node = (gid) => {
    if (nodes.has(gid)) return nodes.get(gid);
    const g = tree.byId.get(gid);
    const n = { id: gid, kind: "group", name: g.name, amount: 0, children: [] };
    nodes.set(gid, n);
    if (g.parent_id) node(g.parent_id).children.push(n);
    return n;
  };
  const roots = new Set();
  const addLeaf = (gid, leaf) => {
    let cur = tree.byId.get(gid);
    node(gid).children.push(leaf);
    while (cur) {
      node(cur.id).amount += leaf.amount;
      if (!cur.parent_id) roots.add(cur.id);
      cur = cur.parent_id ? tree.byId.get(cur.parent_id) : null;
    }
  };
  for (const l of tree.ledgers) {
    const gi = tree.info.get(l.group_id);
    if (!rootFilter(gi, l)) continue;
    const amt = amountOf(l, gi);
    if (amt === null || amt === 0) continue;
    addLeaf(l.group_id, { id: l.id, kind: "ledger", name: l.name, amount: amt, children: [] });
  }
  for (const x of extraLedgers)
    if (x.amount) addLeaf(x.groupId, { id: x.id ?? null, kind: x.kind ?? "ledger", name: x.name, amount: x.amount, children: x.children ?? [] });
  const sortTree = (n) => {
    n.children.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "group" ? -1 : 1) || a.name.localeCompare(b.name));
    n.children.forEach(sortTree);
    return n;
  };
  const out = [...roots].map((id) => sortTree(nodes.get(id)));
  out.sort((a, b) => (tree.byId.get(a.id).sort_order ?? 0) - (tree.byId.get(b.id).sort_order ?? 0));
  return out;
}

const fmtTree = (nodes, depth = 0) =>
  nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name, depth, amount: fromPaise(n.amount), children: fmtTree(n.children, depth + 1) }));
const total = (nodes) => nodes.reduce((a, n) => a + n.amount, 0);

// Profit & loss / trading ------------------------------------------------------------------------------

export function profitAndLossRaw(db, company, from, to, tree = loadTree(db, company.id)) {
  const per = sumsBy(db, company.id, from, to);
  const openingStock = from <= company.books_start_date ? bookOpeningStock(db, company) : stockValueAt(db, company, dayBefore(from));
  const closingStock = stockValueAt(db, company, to);
  const sel = (nature, gp) => (gi) => gi.nature === nature && gi.affectsGrossProfit === gp;
  const exp = (l) => net(per, l.id); // Dr positive
  const inc = (l) => -net(per, l.id); // Cr positive
  const tradingDr = rollup(tree, sel("Expenses", true), exp);
  const tradingCr = rollup(tree, sel("Income", true), inc);
  const plDr = rollup(tree, sel("Expenses", false), exp);
  const plCr = rollup(tree, sel("Income", false), inc);
  const grossProfit = total(tradingCr) + closingStock - (total(tradingDr) + openingStock);
  const netProfit = grossProfit + total(plCr) - total(plDr);
  return { from, to, tradingDr, tradingCr, plDr, plCr, openingStock, closingStock, grossProfit, netProfit, revenue: total(tradingCr) };
}

export function profitAndLoss(db, company, q) {
  const { from, to } = periodDefaults(company, q);
  const r = profitAndLossRaw(db, company, from, to);
  return {
    from,
    to,
    trading: {
      debit: [{ id: null, kind: "stock", name: "Opening Stock", depth: 0, amount: fromPaise(r.openingStock), children: [] }, ...fmtTree(r.tradingDr)],
      credit: [...fmtTree(r.tradingCr), { id: null, kind: "stock", name: "Closing Stock", depth: 0, amount: fromPaise(r.closingStock), children: [] }],
      grossProfit: fromPaise(r.grossProfit),
    },
    profitAndLoss: { debit: fmtTree(r.plDr), credit: fmtTree(r.plCr) },
    totals: {
      directExpenses: fromPaise(total(r.tradingDr)),
      directIncome: fromPaise(total(r.tradingCr)),
      indirectExpenses: fromPaise(total(r.plDr)),
      indirectIncome: fromPaise(total(r.plCr)),
      openingStock: fromPaise(r.openingStock),
      closingStock: fromPaise(r.closingStock),
    },
    grossProfit: fromPaise(r.grossProfit),
    netProfit: fromPaise(r.netProfit),
  };
}

// Balance sheet ----------------------------------------------------------------------------------------

export function balanceSheetRaw(db, company, to, tree = loadTree(db, company.id)) {
  const all = sumsBy(db, company.id, MIN_DATE, to);
  const closingStock = stockValueAt(db, company, to);
  const plAcc = tree.ledgers.find((l) => l.system_code === "PL_ACCOUNT");
  const plBalance = (plAcc ? plAcc.opening_balance_paise + net(all, plAcc.id) : 0) + plAccountBalance(db, company, tree, all, to);
  const fyStart = fyBounds(to, company.fy_start_month).start;
  const current = profitAndLossRaw(db, company, fyStart < company.books_start_date ? company.books_start_date : fyStart, to, tree);
  const bal = (l) => l.opening_balance_paise + net(all, l.id);
  const stockGroup = tree.groups.find((g) => g.system_code === "STOCK");
  const assets = rollup(
    tree,
    (gi, l) => gi.nature === "Assets" && !isStock(gi) && l.system_code !== "PL_ACCOUNT",
    (l) => bal(l),
    closingStock && stockGroup ? [{ groupId: stockGroup.id, name: "Closing Stock", kind: "stock", amount: closingStock }] : [],
  );
  const plGroup = plAcc ? plAcc.group_id : null;
  const liabilities = rollup(
    tree,
    (gi, l) => gi.nature === "Liabilities" && l.system_code !== "PL_ACCOUNT",
    (l) => -bal(l),
    plAcc
      ? [
          {
            groupId: plGroup,
            id: plAcc.id,
            name: plAcc.name,
            kind: "ledger",
            amount: -plBalance || 0,
            children: [
              { id: null, kind: "info", name: "Opening balance", amount: -plBalance - current.netProfit, children: [] },
              { id: null, kind: "info", name: "Current period", amount: current.netProfit, children: [] },
            ],
          },
        ]
      : [],
  );
  // P&L A/c with a zero balance still shows its split when there is profit; keep it simple when zero.
  const diff = openingDifference(db, company, tree);
  const totalAssets = total(assets);
  const totalLiab = total(liabilities);
  return { to, assets, liabilities, totalAssets, totalLiab, diff, closingStock, currentProfit: current.netProfit, plBalance };
}

export function balanceSheet(db, company, q) {
  const { to } = periodDefaults(company, q);
  const r = balanceSheetRaw(db, company, to);
  const liabilities = fmtTree(r.liabilities);
  const assets = fmtTree(r.assets);
  if (r.diff > 0) liabilities.push({ id: null, kind: "diff", name: "Difference in opening balances", depth: 0, amount: fromPaise(r.diff), children: [] });
  if (r.diff < 0) assets.push({ id: null, kind: "diff", name: "Difference in opening balances", depth: 0, amount: fromPaise(-r.diff), children: [] });
  const ta = r.totalAssets + (r.diff < 0 ? -r.diff : 0);
  const tl = r.totalLiab + (r.diff > 0 ? r.diff : 0);
  return {
    to,
    liabilities,
    assets,
    totals: { assets: fromPaise(ta), liabilities: fromPaise(tl) },
    balanced: ta === tl && r.diff === 0,
    openingDifference: fromPaise(r.diff),
    currentPeriodProfit: fromPaise(r.currentProfit),
    closingStock: fromPaise(r.closingStock),
  };
}

// Cash flow (direct method) ----------------------------------------------------------------------------

export function cashFlow(db, company, q) {
  const { from, to } = periodDefaults(company, q);
  const tree = loadTree(db, company.id);
  const cashIds = new Set(tree.ledgers.filter((l) => isCashOrBank(tree.info.get(l.group_id))).map((l) => l.id));
  const cashBalance = (date) => {
    const s = sumsBy(db, company.id, MIN_DATE, date);
    let t = 0;
    for (const l of tree.ledgers) if (cashIds.has(l.id)) t += l.opening_balance_paise + net(s, l.id);
    return t;
  };
  const opening = cashBalance(dayBefore(from));
  const closing = cashBalance(to);
  const entries = db
    .prepare(
      `SELECT ve.voucher_id, ve.ledger_id, ve.debit_paise, ve.credit_paise FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.date BETWEEN ? AND ? ORDER BY ve.voucher_id, ve.line_no`,
    )
    .all(company.id, from, to);
  const byVoucher = new Map();
  for (const e of entries) {
    if (!byVoucher.has(e.voucher_id)) byVoucher.set(e.voucher_id, []);
    byVoucher.get(e.voucher_id).push(e);
  }
  const buckets = { Operating: new Map(), Investing: new Map(), Financing: new Map() };
  for (const lines of byVoucher.values()) {
    const cashNet = lines.filter((e) => cashIds.has(e.ledger_id)).reduce((a, e) => a + e.debit_paise - e.credit_paise, 0);
    if (!cashNet) continue;
    // Counter legs on the opposite side of the cash movement explain it.
    const counter = lines.filter((e) => !cashIds.has(e.ledger_id) && (cashNet > 0 ? e.credit_paise > 0 : e.debit_paise > 0));
    const base = counter.reduce((a, e) => a + (e.debit_paise || e.credit_paise), 0);
    let allocated = 0;
    counter.forEach((e, i) => {
      const share = i === counter.length - 1 ? cashNet - allocated : mulDiv(cashNet, e.debit_paise || e.credit_paise, base);
      allocated += share;
      const gi = tree.info.get(tree.ledgerInfo.get(e.ledger_id).group_id);
      const cls = gi.cashFlowClass === "Cash" ? "Operating" : gi.cashFlowClass;
      const label = gi.primary.name === gi.name ? gi.name : `${gi.primary.name} — ${gi.name}`;
      buckets[cls].set(label, (buckets[cls].get(label) || 0) + share);
    });
  }
  const sections = Object.entries(buckets).map(([name, m]) => {
    const lines = [...m.entries()].map(([label, amt]) => ({ label, amount: fromPaise(amt) })).sort((a, b) => a.label.localeCompare(b.label));
    const t = [...m.values()].reduce((a, b) => a + b, 0);
    return { name: `${name} activities`, lines, total: fromPaise(t), raw: t };
  });
  const netChange = sections.reduce((a, s) => a + s.raw, 0);
  return {
    from,
    to,
    openingCash: fromPaise(opening),
    sections: sections.map(({ raw: _raw, ...s }) => s),
    netChange: fromPaise(netChange),
    closingCash: fromPaise(closing),
    reconciles: opening + netChange === closing,
  };
}

// Registers --------------------------------------------------------------------------------------------

const VOUCHER_LIST = `SELECT v.*, pl.name AS party_name, u.name AS created_by_name FROM vouchers v
  LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id LEFT JOIN users u ON u.id = v.created_by`;

export function dayBook(db, company, q) {
  const { from, to } = periodDefaults(company, { from: q.from || q.to || new Date().toISOString().slice(0, 10), to: q.to });
  const where = ["v.company_id = ?", "v.date BETWEEN ? AND ?"];
  const args = [company.id, from, to];
  if (q.type) (where.push("v.voucher_type = ?"), args.push(q.type));
  where.push(q.status ? "v.status = ?" : "v.status = 'Posted'");
  if (q.status) args.push(q.status);
  const rows = db.prepare(`${VOUCHER_LIST} WHERE ${where.join(" AND ")} ORDER BY v.date, v.created_at`).all(...args);
  return {
    from,
    to,
    rows: rows.map((v) => ({
      id: v.id,
      date: v.date,
      type: v.voucher_type,
      number: v.voucher_number,
      party: v.party_name || "",
      narration: v.narration,
      amount: fromPaise(v.total_paise),
      status: v.status,
    })),
    total: fromPaise(rows.reduce((a, v) => a + (v.is_accounting ? v.total_paise : 0), 0)),
  };
}

export function ledgerStatement(db, company, ledgerId, q) {
  const tree = loadTree(db, company.id);
  const l = tree.ledgerInfo.get(ledgerId);
  if (!l) throw notFound("Ledger not found.");
  const { from, to } = periodDefaults(company, q);
  let opening;
  if (isPL(l.g)) {
    const fyStart = fyBounds(from, company.fy_start_month).start;
    opening = net(sumsBy(db, company.id, fyStart, dayBefore(from)), l.id);
  } else opening = l.opening_balance_paise + net(sumsBy(db, company.id, MIN_DATE, dayBefore(from)), l.id);
  const rows = db
    .prepare(
      `SELECT ve.*, v.date, v.voucher_type, v.voucher_number, v.narration AS v_narration, v.id AS vid,
         (SELECT group_concat(l2.name, ', ') FROM voucher_entries e2 JOIN ledgers l2 ON l2.id = e2.ledger_id WHERE e2.voucher_id = v.id AND e2.ledger_id <> ve.ledger_id) AS particulars
       FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date BETWEEN ? AND ? ORDER BY v.date, v.created_at, ve.line_no`,
    )
    .all(l.id, from, to);
  let run = opening;
  let dr = 0;
  let cr = 0;
  const out = rows.map((r) => {
    run += r.debit_paise - r.credit_paise;
    dr += r.debit_paise;
    cr += r.credit_paise;
    return {
      voucherId: r.vid,
      entryId: r.id,
      date: r.date,
      type: r.voucher_type,
      number: r.voucher_number,
      particulars: r.particulars || "",
      narration: r.narration || r.v_narration,
      billRef: r.bill_ref,
      instrumentNo: r.instrument_no,
      bankDate: r.bank_date,
      debit: fromPaise(r.debit_paise),
      credit: fromPaise(r.credit_paise),
      balance: fromPaise(run),
    };
  });
  return {
    ledger: { id: l.id, name: l.name, group: l.g.path.join(" › ") },
    from,
    to,
    opening: fromPaise(opening),
    rows: out,
    totals: { debit: fromPaise(dr), credit: fromPaise(cr) },
    closing: fromPaise(run),
  };
}

export function cashBankBooks(db, company, q) {
  const tree = loadTree(db, company.id);
  const books = tree.ledgers.filter((l) => isCashOrBank(tree.info.get(l.group_id)));
  return { books: books.map((l) => ({ ...ledgerStatement(db, company, l.id, q), kind: isBank(tree.info.get(l.group_id)) ? "Bank" : "Cash" })) };
}

/** Group summary / general ledger: every ledger with opening, movement and closing. */
export function generalLedger(db, company, q) {
  const tb = trialBalance(db, company, q);
  return { from: tb.from, to: tb.to, rows: tb.rows.filter((r) => r.ledgerId) };
}

// Receivables / payables -------------------------------------------------------------------------------

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const bucketOf = (days) => (days <= 0 ? "Not due" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");
export const AGEING = ["Not due", "1-30", "31-60", "61-90", "90+"];

export function outstanding(db, company, q) {
  const kind = q.kind === "payable" ? "payable" : "receivable";
  const asOf = q.to || new Date().toISOString().slice(0, 10);
  const tree = loadTree(db, company.id);
  const parties = tree.ledgers.filter((l) => (kind === "receivable" ? isDebtor : isCreditor)(tree.info.get(l.group_id)));
  const sign = kind === "receivable" ? 1 : -1;
  const result = [];
  const buckets = Object.fromEntries(AGEING.map((b) => [b, 0]));
  for (const p of parties) {
    const entries = db
      .prepare(
        `SELECT ve.*, v.date, v.voucher_number, v.voucher_type FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
         WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date <= ? ORDER BY v.date`,
      )
      .all(p.id, asOf);
    const bills = new Map();
    const bill = (ref, date, due) => {
      if (!bills.has(ref)) bills.set(ref, { ref, date, dueDate: due || date, amount: 0, pending: 0 });
      return bills.get(ref);
    };
    if (p.opening_balance_paise) bill("Opening balance", company.books_start_date).pending += p.opening_balance_paise;
    for (const e of entries) {
      const amt = e.debit_paise - e.credit_paise;
      if (p.bill_wise && e.bill_ref && e.bill_type !== "OnAccount") {
        const b = bill(e.bill_ref, e.date, e.bill_due_date);
        if (e.bill_type === "New" || e.bill_type === "Advance") {
          b.date = e.date;
          b.dueDate = e.bill_due_date || e.date;
          b.amount += amt;
        }
        b.pending += amt;
      } else {
        bill(p.bill_wise ? "On account" : "Balance", e.date).pending += amt;
      }
    }
    const open = [...bills.values()]
      .map((b) => ({ ...b, pending: b.pending * sign }))
      .filter((b) => b.pending !== 0)
      .map((b) => {
        const overdue = daysBetween(b.dueDate, asOf);
        const bucket = bucketOf(overdue);
        buckets[bucket] += b.pending;
        return { ...b, overdueDays: Math.max(0, overdue), bucket, amount: fromPaise(b.amount * sign), pending: fromPaise(b.pending), raw: b.pending };
      });
    if (!open.length) continue;
    const t = open.reduce((a, b) => a + b.raw, 0);
    result.push({
      ledgerId: p.id,
      party: p.name,
      gstin: p.gstin,
      creditLimit: p.credit_limit_paise === null ? null : fromPaise(p.credit_limit_paise),
      total: fromPaise(t),
      bills: open.map(({ raw: _r, ...b }) => b),
      raw: t,
    });
  }
  result.sort((a, b) => b.raw - a.raw);
  return {
    kind,
    asOf,
    parties: result.map(({ raw: _r, ...r }) => r),
    total: fromPaise(result.reduce((a, r) => a + r.raw, 0)),
    ageing: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, fromPaise(v)])),
  };
}

// Income / expense analysis ----------------------------------------------------------------------------

export function natureReport(db, company, nature, q) {
  const { from, to } = periodDefaults(company, q);
  const tree = loadTree(db, company.id);
  const rows = db
    .prepare(
      `SELECT ve.ledger_id, substr(v.date,1,7) ym, SUM(ve.debit_paise - ve.credit_paise) n FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.date BETWEEN ? AND ? GROUP BY ve.ledger_id, ym`,
    )
    .all(company.id, from, to);
  const sign = nature === "Expenses" ? 1 : -1;
  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const byLedger = new Map();
  for (const r of rows) {
    const l = tree.ledgerInfo.get(r.ledger_id);
    if (!l || l.g.nature !== nature) continue;
    const x = byLedger.get(l.id) || { ledgerId: l.id, ledger: l.name, group: l.g.name, total: 0, months: {} };
    x.total += r.n * sign;
    x.months[r.ym] = (x.months[r.ym] || 0) + r.n * sign;
    byLedger.set(l.id, x);
  }
  const list = [...byLedger.values()].sort((a, b) => b.total - a.total);
  const grand = list.reduce((a, r) => a + r.total, 0);
  return {
    from,
    to,
    months,
    rows: list.map((r) => ({
      ...r,
      total: fromPaise(r.total),
      share: grand ? fromPaise(mulDiv(r.total, 10000, grand)) : "0.00",
      months: Object.fromEntries(Object.entries(r.months).map(([k, v]) => [k, fromPaise(v)])),
    })),
    total: fromPaise(grand),
  };
}

// Ratios ---------------------------------------------------------------------------------------------

const ratio = (a, b) => (b ? fromPaise(mulDiv(a, 100, b)) : null); // two decimals
const pct = (a, b) => (b ? fromPaise(mulDiv(a, 10000, b)) : null);

export function financialRatios(db, company, q) {
  const { from, to } = periodDefaults(company, q);
  const tree = loadTree(db, company.id);
  const bs = balanceSheetRaw(db, company, to, tree);
  const pl = profitAndLossRaw(db, company, from, to, tree);
  const groupTotal = (nodes, code) => {
    const gid = tree.groups.find((g) => g.system_code === code)?.id;
    const find = (ns) => {
      for (const n of ns) {
        if (n.id === gid) return n.amount;
        const f = find(n.children);
        if (f !== null) return f;
      }
      return null;
    };
    return find(nodes) || 0;
  };
  const ca = groupTotal(bs.assets, "CURRENT_ASSETS");
  const cl = groupTotal(bs.liabilities, "CURRENT_LIABILITIES");
  const stock = bs.closingStock;
  const equity = groupTotal(bs.liabilities, "CAPITAL");
  const debt = groupTotal(bs.liabilities, "LOANS_LIABILITY");
  const debtors = groupTotal(bs.assets, "SUNDRY_DEBTORS");
  const creditors = groupTotal(bs.liabilities, "SUNDRY_CREDITORS");
  const per = sumsBy(db, company.id, from, to);
  let sales = 0;
  let purchases = 0;
  for (const l of tree.ledgers) {
    const gi = tree.info.get(l.group_id);
    if (gi.codes.has("SALES")) sales -= net(per, l.id);
    if (gi.codes.has("PURCHASE")) purchases += net(per, l.id);
  }
  const days = daysBetween(from, to) + 1;
  const cogs = pl.openingStock + purchases - pl.closingStock;
  const avgStock = Math.round((pl.openingStock + pl.closingStock) / 2);
  return {
    from,
    to,
    inputs: Object.fromEntries(
      Object.entries({
        currentAssets: ca,
        currentLiabilities: cl,
        closingStock: stock,
        equity,
        debt,
        debtors,
        creditors,
        sales,
        purchases,
        grossProfit: pl.grossProfit,
        netProfit: pl.netProfit,
      }).map(([k, v]) => [k, fromPaise(v)]),
    ),
    ratios: [
      { key: "currentRatio", label: "Current ratio", value: ratio(ca, cl), unit: "x" },
      { key: "quickRatio", label: "Quick ratio", value: ratio(ca - stock, cl), unit: "x" },
      { key: "debtEquity", label: "Debt to equity", value: ratio(debt, equity), unit: "x" },
      { key: "grossMargin", label: "Gross profit margin", value: pct(pl.grossProfit, sales), unit: "%" },
      { key: "netMargin", label: "Net profit margin", value: pct(pl.netProfit, sales), unit: "%" },
      { key: "roe", label: "Return on equity", value: pct(pl.netProfit, equity), unit: "%" },
      { key: "debtorDays", label: "Debtor days", value: sales ? fromPaise(mulDiv(debtors * days, 100, sales)) : null, unit: "days" },
      { key: "creditorDays", label: "Creditor days", value: purchases ? fromPaise(mulDiv(creditors * days, 100, purchases)) : null, unit: "days" },
      { key: "inventoryTurnover", label: "Inventory turnover", value: ratio(cogs, avgStock), unit: "x" },
      { key: "workingCapital", label: "Working capital", value: fromPaise(ca - cl), unit: "₹" },
    ],
  };
}

// Cost centres ---------------------------------------------------------------------------------------

export function costCentreReport(db, company, q) {
  const { from, to } = periodDefaults(company, q);
  const rows = db
    .prepare(
      `SELECT cc.id cc_id, cc.name cc_name, cat.name category, l.id ledger_id, l.name ledger,
         SUM(CASE WHEN ve.debit_paise > 0 THEN ca.amount_paise ELSE -ca.amount_paise END) n
       FROM voucher_cost_allocations ca JOIN voucher_entries ve ON ve.id = ca.entry_id JOIN vouchers v ON v.id = ve.voucher_id
       JOIN cost_centres cc ON cc.id = ca.cost_centre_id LEFT JOIN cost_categories cat ON cat.id = cc.category_id JOIN ledgers l ON l.id = ve.ledger_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.date BETWEEN ? AND ? GROUP BY cc.id, l.id ORDER BY cc.name, l.name`,
    )
    .all(company.id, from, to);
  const centres = new Map();
  for (const r of rows) {
    const c = centres.get(r.cc_id) || { costCentreId: r.cc_id, name: r.cc_name, category: r.category || "", ledgers: [], total: 0 };
    c.ledgers.push({ ledgerId: r.ledger_id, ledger: r.ledger, amount: fromPaise(r.n) });
    c.total += r.n;
    centres.set(r.cc_id, c);
  }
  return { from, to, centres: [...centres.values()].map((c) => ({ ...c, total: fromPaise(c.total) })) };
}

// Budgets --------------------------------------------------------------------------------------------

export function budgetVsActual(db, company, budgetId, q) {
  const b = db
    .prepare("SELECT b.*, fy.start_date, fy.end_date FROM budgets b JOIN financial_years fy ON fy.id = b.financial_year_id WHERE b.id = ? AND b.company_id = ?")
    .get(budgetId, company.id);
  if (!b) throw notFound("Budget not found.");
  const from = q.from || b.start_date;
  const to = q.to || b.end_date;
  const tree = loadTree(db, company.id);
  const per = sumsBy(db, company.id, from, to);
  const lines = db.prepare("SELECT * FROM budget_entries WHERE budget_id = ?").all(b.id);
  const rows = lines.map((e) => {
    let actual = 0;
    let name;
    if (e.cost_centre_id) {
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN ve.debit_paise > 0 THEN ca.amount_paise ELSE -ca.amount_paise END),0) n FROM voucher_cost_allocations ca
           JOIN voucher_entries ve ON ve.id = ca.entry_id JOIN vouchers v ON v.id = ve.voucher_id
           WHERE ca.cost_centre_id = ? AND v.status = 'Posted' AND v.date BETWEEN ? AND ? ${e.ledger_id ? "AND ve.ledger_id = ?" : ""}`,
        )
        .get(e.cost_centre_id, from, to, ...(e.ledger_id ? [e.ledger_id] : []));
      actual = r.n;
    } else if (e.ledger_id) actual = net(per, e.ledger_id);
    else for (const l of tree.ledgers) if (isUnder(tree, l.group_id, e.group_id)) actual += net(per, l.id);
    if (e.ledger_id) name = tree.ledgerInfo.get(e.ledger_id)?.name;
    else if (e.group_id) name = tree.byId.get(e.group_id)?.name;
    if (e.cost_centre_id) name = `${name || "All ledgers"} @ ${db.prepare("SELECT name FROM cost_centres WHERE id = ?").get(e.cost_centre_id)?.name}`;
    const variance = actual - e.amount_paise;
    return {
      id: e.id,
      name,
      ledgerId: e.ledger_id,
      groupId: e.group_id,
      costCentreId: e.cost_centre_id,
      budget: fromPaise(e.amount_paise),
      actual: fromPaise(actual),
      variance: fromPaise(variance),
      variancePct: e.amount_paise ? fromPaise(mulDiv(variance, 10000, e.amount_paise)) : null,
    };
  });
  return { budget: { id: b.id, name: b.name }, from, to, rows };
}

// Year-on-year comparison ------------------------------------------------------------------------------

export function fyComparison(db, company, q) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const cur = fyBounds(to, company.fy_start_month);
  const prevEnd = dayBefore(cur.start);
  const prev = fyBounds(prevEnd, company.fy_start_month);
  const tree = loadTree(db, company.id);
  const clamp = (d) => (d < company.books_start_date ? company.books_start_date : d);
  const curPl = profitAndLossRaw(db, company, clamp(cur.start), to, tree);
  const prevAvailable = prevEnd >= company.books_start_date;
  const prevPl = prevAvailable ? profitAndLossRaw(db, company, clamp(prev.start), prevEnd, tree) : null;
  const flat = (nodes) => Object.fromEntries(nodes.map((n) => [n.name, n.amount]));
  const merge = (a, b) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => ({ name: k, current: fromPaise(a[k] || 0), previous: fromPaise(b[k] || 0) }));
  const section = (key) => merge(flat(curPl[key]), prevPl ? flat(prevPl[key]) : {});
  const curBs = balanceSheetRaw(db, company, to, tree);
  const prevBs = prevAvailable ? balanceSheetRaw(db, company, prevEnd, tree) : null;
  return {
    current: { label: cur.label, from: clamp(cur.start), to },
    previous: { label: prev.label, from: clamp(prev.start), to: prevEnd, available: prevAvailable },
    profitAndLoss: {
      directIncome: section("tradingCr"),
      directExpenses: section("tradingDr"),
      indirectIncome: section("plCr"),
      indirectExpenses: section("plDr"),
      grossProfit: { current: fromPaise(curPl.grossProfit), previous: fromPaise(prevPl?.grossProfit || 0) },
      netProfit: { current: fromPaise(curPl.netProfit), previous: fromPaise(prevPl?.netProfit || 0) },
    },
    balanceSheet: {
      assets: merge(flat(curBs.assets), prevBs ? flat(prevBs.assets) : {}),
      liabilities: merge(flat(curBs.liabilities), prevBs ? flat(prevBs.liabilities) : {}),
    },
  };
}
