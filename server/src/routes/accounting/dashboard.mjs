// Accounting dashboard KPIs for the selected company (all computed from posted vouchers).

import { addDays, fyBounds } from "../../accounting/chart.mjs";
import { gstr3b } from "../../accounting/gst.mjs";
import { fromPaise, toPaise } from "../../accounting/money.mjs";
import { outstanding, profitAndLossRaw } from "../../accounting/reports.mjs";
import { stockSummary } from "../../accounting/inventory.mjs";
import { isCashOrBank, loadTree } from "../../accounting/tree.mjs";
import { str } from "./helpers.mjs";

export default function dashboardRoutes(c, { db }) {
  c.get("/dashboard", (req, res) => {
    const co = req.company;
    const to = str(req.query.to) || new Date().toISOString().slice(0, 10);
    const fy = fyBounds(to, co.fy_start_month);
    const from = fy.start < co.books_start_date ? co.books_start_date : fy.start;
    const tree = loadTree(db, co.id);
    const cashIds = tree.ledgers.filter((l) => isCashOrBank(tree.info.get(l.group_id)));
    let cash = 0;
    for (const l of cashIds)
      cash +=
        l.opening_balance_paise +
        db
          .prepare(
            "SELECT COALESCE(SUM(ve.debit_paise - ve.credit_paise),0) b FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date <= ?",
          )
          .get(l.id, to).b;
    const pl = profitAndLossRaw(db, co, from, to, tree);
    const rec = outstanding(db, co, { kind: "receivable", to });
    const pay = outstanding(db, co, { kind: "payable", to });
    let gstDue = null;
    if (co.gst_enabled) {
      const g = gstr3b(db, co, to.slice(0, 7));
      gstDue = fromPaise(Object.values(g.payment.balanceDue).reduce((a, v) => a + toPaise(v), 0));
    }
    // 12-month sales / expense trend
    const start = addDays(`${to.slice(0, 7)}-01`, -334).slice(0, 7);
    const months = new Map();
    // nature must come from the resolved tree (custom groups inherit their primary group's nature)
    const natureRows = db
      .prepare(
        `SELECT substr(v.date,1,7) ym, ve.ledger_id, SUM(ve.credit_paise - ve.debit_paise) n FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
         WHERE v.company_id = ? AND v.status = 'Posted' AND v.date >= ? AND v.date <= ? GROUP BY ym, ve.ledger_id`,
      )
      .all(co.id, `${start}-01`, to);
    for (const r of natureRows) {
      const gi = tree.info.get(tree.ledgerInfo.get(r.ledger_id)?.group_id);
      if (!gi) continue;
      const m = months.get(r.ym) || { month: r.ym, income: 0, expenses: 0 };
      if (gi.nature === "Income") m.income += r.n;
      if (gi.nature === "Expenses") m.expenses -= r.n;
      months.set(r.ym, m);
    }
    const count = (sql, ...a) => db.prepare(sql).get(...a).c;
    const recent = db
      .prepare(
        "SELECT v.*, pl.name party FROM vouchers v LEFT JOIN ledgers pl ON pl.id = v.party_ledger_id WHERE v.company_id = ? ORDER BY v.created_at DESC LIMIT 8",
      )
      .all(co.id);
    res.json({
      asOf: to,
      period: { from, to, label: fy.label },
      kpis: {
        cashAndBank: fromPaise(cash),
        receivables: rec.total,
        payables: pay.total,
        revenue: fromPaise(pl.revenue),
        grossProfit: fromPaise(pl.grossProfit),
        netProfit: fromPaise(pl.netProfit),
        closingStock: fromPaise(pl.closingStock),
        gstPayableThisMonth: gstDue,
      },
      ageing: rec.ageing,
      counts: {
        pendingApprovals: count("SELECT COUNT(*) c FROM vouchers WHERE company_id = ? AND status = 'PendingApproval'", co.id),
        drafts: count("SELECT COUNT(*) c FROM vouchers WHERE company_id = ? AND status = 'Draft'", co.id),
        unreconciledBankLines: count("SELECT COUNT(*) c FROM bank_statement_transactions WHERE company_id = ? AND status = 'Unmatched'", co.id),
        dueRecurring: count("SELECT COUNT(*) c FROM recurring_vouchers WHERE company_id = ? AND active = 1 AND next_run_date <= ?", co.id, to),
        lowStockItems:
          co.inventory_enabled || db.prepare("SELECT 1 FROM inventory_items WHERE company_id = ? LIMIT 1").get(co.id)
            ? stockSummary(db, co, { to }).rows.filter((r) => r.lowStock).length
            : 0,
      },
      trend: [...months.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((m) => ({ month: m.month, income: fromPaise(m.income), expenses: fromPaise(m.expenses) })),
      recent: recent.map((v) => ({
        id: v.id,
        type: v.voucher_type,
        number: v.voucher_number,
        date: v.date,
        party: v.party || "",
        total: fromPaise(v.total_paise),
        status: v.status,
      })),
    });
  });
}
