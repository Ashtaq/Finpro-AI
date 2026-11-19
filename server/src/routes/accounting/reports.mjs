// GET /reports/:name?from&to&format=json|csv|xlsx|pdf — financial statements and registers.

import { uuid } from "../../accounting/access.mjs";
import { sendTable, tabulate } from "../../accounting/export.mjs";
import { inventoryReport } from "../../accounting/inventory.mjs";
import * as R from "../../accounting/reports.mjs";
import { badRequest } from "../../lib/errors.mjs";
import { str } from "./helpers.mjs";

export const REPORTS = {
  "trial-balance": (db, co, q) => R.trialBalance(db, co, q),
  "profit-loss": (db, co, q) => R.profitAndLoss(db, co, q),
  "trading-account": (db, co, q) => R.profitAndLoss(db, co, q),
  "balance-sheet": (db, co, q) => R.balanceSheet(db, co, q),
  "cash-flow": (db, co, q) => R.cashFlow(db, co, q),
  "day-book": (db, co, q) => R.dayBook(db, co, q),
  ledger: (db, co, q) => {
    if (!str(q.ledgerId)) throw badRequest("ledgerId is required.");
    return R.ledgerStatement(db, co, q.ledgerId, q);
  },
  "general-ledger": (db, co, q) => R.generalLedger(db, co, q),
  "cash-bank-books": (db, co, q) => R.cashBankBooks(db, co, q),
  receivables: (db, co, q) => R.outstanding(db, co, { ...q, kind: "receivable" }),
  payables: (db, co, q) => R.outstanding(db, co, { ...q, kind: "payable" }),
  expenses: (db, co, q) => R.natureReport(db, co, "Expenses", q),
  income: (db, co, q) => R.natureReport(db, co, "Income", q),
  ratios: (db, co, q) => R.financialRatios(db, co, q),
  "cost-centres": (db, co, q) => R.costCentreReport(db, co, q),
  "budget-vs-actual": (db, co, q) => {
    if (!str(q.budgetId)) throw badRequest("budgetId is required.");
    return R.budgetVsActual(db, co, q.budgetId, q);
  },
  "fy-comparison": (db, co, q) => R.fyComparison(db, co, q),
  "stock-summary": (db, co, q) => inventoryReport(db, co, "summary", q),
  "stock-movements": (db, co, q) => inventoryReport(db, co, "movements", q),
};

export default function reportRoutes(c, { db }) {
  c.get("/reports", (_req, res) => res.json(Object.keys(REPORTS)));
  c.get("/reports/:name", (req, res) => {
    const fn = REPORTS[req.params.name];
    if (!fn) throw badRequest(`Unknown report. Available: ${Object.keys(REPORTS).join(", ")}`);
    const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    const data = fn(db, req.company, q);
    const format = str(req.query.format) || "json";
    if (format === "json") return res.json(data);
    if (!["csv", "xlsx", "pdf"].includes(format)) throw badRequest("format must be json, csv, xlsx or pdf.");
    const table = tabulate(req.params.name, data);
    if (!table) throw badRequest("This report cannot be exported in that format.");
    db.prepare("INSERT INTO data_jobs(id, organization_id, company_id, direction, kind, status, summary_json, created_by) VALUES (?,?,?,?,?,?,?,?)").run(
      uuid(),
      req.company.organization_id,
      req.company.id,
      "Export",
      "Report",
      "Completed",
      JSON.stringify({ report: req.params.name, format, rows: table.rows.length }),
      req.user.id,
    );
    sendTable(res, table, format, `${req.company.name}-${req.params.name}`, `${req.company.legal_name || req.company.name}`);
  });
}
