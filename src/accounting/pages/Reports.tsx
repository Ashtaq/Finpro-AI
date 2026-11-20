import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge, ErrorBox, Notice, Spinner } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, ExportButtons, StatementTree, TreeNode } from "../components";
import { useCompany } from "../context";
import { fyStart, Ledger, money, today, typeLabel } from "../lib";
import { useVoucherSheet, VoucherSheets } from "./Vouchers";

const REPORTS: [string, string, string][] = [
  ["balance-sheet", "Balance Sheet", "Statements"],
  ["profit-loss", "Profit & Loss", "Statements"],
  ["trading-account", "Trading Account", "Statements"],
  ["cash-flow", "Cash Flow", "Statements"],
  ["trial-balance", "Trial Balance", "Statements"],
  ["ratios", "Financial Ratios", "Analysis"],
  ["fy-comparison", "Year Comparison", "Analysis"],
  ["expenses", "Expense Report", "Analysis"],
  ["income", "Income Report", "Analysis"],
  ["cost-centres", "Cost Centres", "Analysis"],
  ["budget-vs-actual", "Budget vs Actual", "Analysis"],
  ["day-book", "Day Book", "Books"],
  ["ledger", "Ledger Statement", "Books"],
  ["general-ledger", "General Ledger", "Books"],
  ["cash-bank-books", "Cash & Bank Books", "Books"],
  ["receivables", "Receivables (AR)", "Outstanding"],
  ["payables", "Payables (AP)", "Outstanding"],
];
const POINT_IN_TIME = new Set(["balance-sheet", "receivables", "payables", "fy-comparison"]);

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Reports() {
  const { capi, company } = useCompany();
  const [params, setParams] = useSearchParams();
  const report = params.get("report") || "balance-sheet";
  const ledgerId = params.get("ledgerId") || "";
  const [from, setFrom] = useState(
    fyStart(today(), company.fyStartMonth) < company.booksStartDate ? company.booksStartDate : fyStart(today(), company.fyStartMonth),
  );
  const [to, setTo] = useState(today());
  const [budgetId, setBudgetId] = useState("");
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers?active=all"), [company.id]);
  const budgets = useAsync(() => capi.get<{ id: string; name: string }[]>("/budgets"), [company.id]);
  const qs = new URLSearchParams({ from, to, ...(ledgerId ? { ledgerId } : {}), ...(budgetId ? { budgetId } : {}) }).toString();
  const needs = (report === "ledger" && !ledgerId) || (report === "budget-vs-actual" && !budgetId);
  const data = useAsync(() => (needs ? Promise.resolve(null) : capi.get<any>(`/reports/${report}?${qs}`)), [report, qs, company.id]);
  const sheet = useVoucherSheet();
  const go = (r: string, extra: Record<string, string> = {}) => setParams({ report: r, ...extra });
  const drill = (id: string) => go("ledger", { ledgerId: id });
  const d = data.data;

  return (
    <div className="report-layout">
      <aside className="report-menu panel">
        {["Statements", "Analysis", "Books", "Outstanding"].map((g) => (
          <div key={g}>
            <div className="nav-label dark">{g}</div>
            {REPORTS.filter((r) => r[2] === g).map(([k, label]) => (
              <button key={k} className={k === report ? "report-link active" : "report-link"} onClick={() => go(k)}>
                {label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section>
        <div className="toolbar">
          <div className="filter-row">
            {report === "ledger" && params.get("ledgerId") && (
              <button className="btn btn-ghost" onClick={() => window.history.back()}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            {!POINT_IN_TIME.has(report) && <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />}
            <input type="date" aria-label={POINT_IN_TIME.has(report) ? "As at" : "To"} value={to} onChange={(e) => setTo(e.target.value)} />
            {report === "ledger" && (
              <select aria-label="Ledger" value={ledgerId} onChange={(e) => go("ledger", { ledgerId: e.target.value })}>
                <option value="">Select ledger</option>
                {(ledgers.data || []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {report === "budget-vs-actual" && (
              <select aria-label="Budget" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                <option value="">Select budget</option>
                {(budgets.data || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!needs && !["cash-bank-books"].includes(report) && <ExportButtons url={(f) => capi.url(`/reports/${report}?${qs}&format=${f}`)} />}
        </div>
        <ErrorBox message={data.error} onRetry={data.reload} />
        {needs ? (
          <Notice title="Choose what to show">
            {report === "ledger" ? "Select a ledger to view its statement." : "Select a budget, or create one under Settings › Budgets."}
          </Notice>
        ) : data.loading && !d ? (
          <Spinner />
        ) : d ? (
          <ReportBody report={report} d={d} drill={drill} openVoucher={sheet.open} />
        ) : null}
      </section>
      <VoucherSheets sheet={sheet} onChange={() => void data.reload()} />
    </div>
  );
}

function ReportBody({ report, d, drill, openVoucher }: { report: string; d: any; drill: (id: string) => void; openVoucher: (id: string) => void }) {
  switch (report) {
    case "balance-sheet":
      return (
        <>
          <ReconcileBadge ok={d.balanced} text={d.balanced ? "Assets equal liabilities" : `Not balanced — opening difference ₹${d.openingDifference}`} />
          <div className="grid-2">
            <StatementTree title="Liabilities" nodes={d.liabilities as TreeNode[]} onLedger={drill} total={d.totals.liabilities} />
            <StatementTree title="Assets" nodes={d.assets as TreeNode[]} onLedger={drill} total={d.totals.assets} />
          </div>
        </>
      );
    case "profit-loss":
    case "trading-account":
      return (
        <>
          <div className="grid-2">
            <StatementTree title="Trading — Dr" nodes={d.trading.debit} onLedger={drill} />
            <StatementTree title="Trading — Cr" nodes={d.trading.credit} onLedger={drill} />
          </div>
          <Notice title={`Gross ${d.grossProfit.startsWith("-") ? "loss" : "profit"}: ${money(d.grossProfit.replace("-", ""))}`}>
            Opening stock {money(d.totals.openingStock)} · Closing stock {money(d.totals.closingStock)}
          </Notice>
          {report === "profit-loss" && (
            <>
              <div className="grid-2" style={{ marginTop: 18 }}>
                <StatementTree title="Indirect expenses" nodes={d.profitAndLoss.debit} onLedger={drill} total={d.totals.indirectExpenses} />
                <StatementTree title="Indirect incomes" nodes={d.profitAndLoss.credit} onLedger={drill} total={d.totals.indirectIncome} />
              </div>
              <Notice title={`Net ${d.netProfit.startsWith("-") ? "loss" : "profit"}: ${money(d.netProfit.replace("-", ""))}`}>
                For {d.from} to {d.to}
              </Notice>
            </>
          )}
        </>
      );
    case "cash-flow":
      return (
        <>
          <ReconcileBadge ok={d.reconciles} text={d.reconciles ? "Reconciles with cash & bank balances" : "Does not reconcile"} />
          <div className="table-panel acct-table">
            <table>
              <tbody>
                <tr className="total-row">
                  <td>Opening cash & bank</td>
                  <td style={{ textAlign: "right" }}>
                    <Amount value={d.openingCash} />
                  </td>
                </tr>
                {d.sections.map((s: any) => [
                  <tr key={s.name} className="tree-row depth-0">
                    <td style={{ fontWeight: 700 }}>{s.name}</td>
                    <td />
                  </tr>,
                  ...s.lines.map((l: any) => (
                    <tr key={s.name + l.label}>
                      <td style={{ paddingLeft: 28 }}>{l.label}</td>
                      <td style={{ textAlign: "right" }}>
                        <Amount value={l.amount} />
                      </td>
                    </tr>
                  )),
                  <tr key={s.name + "t"}>
                    <td style={{ paddingLeft: 12, fontWeight: 600 }}>Net cash from {s.name.toLowerCase()}</td>
                    <td style={{ textAlign: "right" }}>
                      <Amount value={s.total} strong />
                    </td>
                  </tr>,
                ])}
                <tr className="total-row">
                  <td>Closing cash & bank</td>
                  <td style={{ textAlign: "right" }}>
                    <Amount value={d.closingCash} strong />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      );
    case "trial-balance":
      return (
        <>
          <ReconcileBadge
            ok={d.balanced}
            text={d.balanced ? `Balanced — Dr ₹${d.totals.closingDr} = Cr ₹${d.totals.closingCr}` : "Trial balance does not tally"}
          />
          <DataTable
            rowKey={(r: any) => r.ledgerId || r.ledger}
            rows={d.rows}
            pageSize={200}
            onRowClick={(r: any) => r.ledgerId && drill(r.ledgerId)}
            columns={[
              { key: "ledger", label: "Ledger" },
              { key: "group", label: "Group" },
              { key: "opening", label: "Opening", align: "right", render: (r: any) => <Amount value={r.opening} /> },
              { key: "debit", label: "Debit", align: "right", render: (r: any) => <Amount value={r.debit} /> },
              { key: "credit", label: "Credit", align: "right", render: (r: any) => <Amount value={r.credit} /> },
              { key: "closingDr", label: "Closing Dr", align: "right", render: (r: any) => (Number(r.closingDr) ? <Amount value={r.closingDr} /> : "") },
              { key: "closingCr", label: "Closing Cr", align: "right", render: (r: any) => (Number(r.closingCr) ? <Amount value={r.closingCr} /> : "") },
            ]}
          />
          <p className="muted">
            Totals — Debit ₹{d.totals.debit} · Credit ₹{d.totals.credit} · Closing Dr ₹{d.totals.closingDr} · Closing Cr ₹{d.totals.closingCr}
          </p>
        </>
      );
    case "ledger":
      return (
        <>
          <h2 className="section-title">
            {d.ledger.name} <span className="muted">{d.ledger.group}</span>
          </h2>
          <DataTable
            rowKey={(r: any) => r.entryId}
            rows={d.rows}
            pageSize={200}
            empty="No transactions in this period."
            onRowClick={(r: any) => openVoucher(r.voucherId)}
            columns={[
              { key: "date", label: "Date" },
              { key: "type", label: "Voucher", render: (r: any) => `${typeLabel(r.type)} ${r.number || ""}` },
              { key: "particulars", label: "Particulars" },
              { key: "debit", label: "Debit", align: "right", render: (r: any) => (Number(r.debit) ? <Amount value={r.debit} /> : "") },
              { key: "credit", label: "Credit", align: "right", render: (r: any) => (Number(r.credit) ? <Amount value={r.credit} /> : "") },
              { key: "balance", label: "Balance (Dr+)", align: "right", render: (r: any) => <Amount value={r.balance} /> },
            ]}
          />
          <p className="muted">
            Opening ₹{d.opening} · Debits ₹{d.totals.debit} · Credits ₹{d.totals.credit} · Closing ₹{d.closing}
          </p>
        </>
      );
    case "day-book":
      return (
        <DataTable
          rowKey={(r: any) => r.id}
          rows={d.rows}
          pageSize={200}
          onRowClick={(r: any) => openVoucher(r.id)}
          columns={[
            { key: "date", label: "Date" },
            { key: "type", label: "Type", render: (r: any) => typeLabel(r.type) },
            { key: "number", label: "Number" },
            { key: "party", label: "Party" },
            { key: "narration", label: "Narration" },
            { key: "amount", label: "Amount", align: "right", render: (r: any) => <Amount value={r.amount} /> },
          ]}
        />
      );
    case "general-ledger":
      return (
        <DataTable
          rowKey={(r: any) => r.ledgerId}
          rows={d.rows}
          pageSize={200}
          onRowClick={(r: any) => drill(r.ledgerId)}
          columns={[
            { key: "ledger", label: "Ledger" },
            { key: "group", label: "Group" },
            { key: "opening", label: "Opening", align: "right", render: (r: any) => <Amount value={r.opening} /> },
            { key: "debit", label: "Debit", align: "right", render: (r: any) => <Amount value={r.debit} /> },
            { key: "credit", label: "Credit", align: "right", render: (r: any) => <Amount value={r.credit} /> },
            { key: "closing", label: "Closing", align: "right", render: (r: any) => <Amount value={r.closing} /> },
          ]}
        />
      );
    case "cash-bank-books":
      return (
        <>
          {d.books.map((b: any) => (
            <div key={b.ledger.id} className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <div>
                  <h2>
                    {b.ledger.name} <Badge>{b.kind}</Badge>
                  </h2>
                  <p>
                    Opening ₹{b.opening} · Receipts ₹{b.totals.debit} · Payments ₹{b.totals.credit} · Closing ₹{b.closing}
                  </p>
                </div>
                <button className="text-link" onClick={() => drill(b.ledger.id)}>
                  Open book
                </button>
              </div>
            </div>
          ))}
        </>
      );
    case "receivables":
    case "payables":
      return (
        <>
          <div className="analysis-cards">
            {Object.entries(d.ageing).map(([k, v]) => (
              <div key={k}>
                <span>{k === "Not due" ? k : `${k} days`}</span>
                <strong>
                  <Amount value={v as string} />
                </strong>
              </div>
            ))}
          </div>
          <DataTable
            rowKey={(r: any) => r.party + r.ref}
            rows={d.parties.flatMap((p: any) => p.bills.map((b: any) => ({ ...b, party: p.party, ledgerId: p.ledgerId })))}
            pageSize={200}
            onRowClick={(r: any) => drill(r.ledgerId)}
            columns={[
              { key: "party", label: "Party" },
              { key: "ref", label: "Bill" },
              { key: "date", label: "Bill date" },
              { key: "dueDate", label: "Due" },
              { key: "overdueDays", label: "Overdue days", align: "right" },
              { key: "bucket", label: "Ageing" },
              { key: "pending", label: "Pending", align: "right", render: (r: any) => <Amount value={r.pending} /> },
            ]}
          />
          <p className="muted">Total outstanding ₹{d.total}</p>
        </>
      );
    case "expenses":
    case "income":
      return (
        <DataTable
          rowKey={(r: any) => r.ledgerId}
          rows={d.rows}
          pageSize={200}
          onRowClick={(r: any) => drill(r.ledgerId)}
          columns={[
            { key: "ledger", label: "Ledger" },
            { key: "group", label: "Group" },
            { key: "total", label: "Total", align: "right", render: (r: any) => <Amount value={r.total} /> },
            { key: "share", label: "Share %", align: "right" },
            ...d.months.slice(-6).map((m: string) => ({
              key: m,
              label: m,
              align: "right" as const,
              value: (r: any) => r.months[m] || "0",
              render: (r: any) => <Amount value={r.months[m] || "0.00"} />,
            })),
          ]}
        />
      );
    case "ratios":
      return (
        <div className="panel ratio-list">
          {d.ratios.map((r: any) => (
            <div key={r.key} className="ratio-row">
              <div>
                <strong>{r.label}</strong>
                <span>{r.unit === "x" ? "times" : r.unit}</span>
              </div>
              <b>{r.value === null ? "n/a" : r.unit === "₹" ? <Amount value={r.value} /> : `${r.value}${r.unit === "%" ? "%" : r.unit === "x" ? "x" : ""}`}</b>
            </div>
          ))}
        </div>
      );
    case "cost-centres":
      return (
        <DataTable
          rowKey={(r: any) => r.costCentreId + r.ledgerId}
          rows={d.centres.flatMap((c: any) => c.ledgers.map((l: any) => ({ ...l, costCentreId: c.costCentreId, centre: c.name })))}
          empty="No cost centre allocations in this period."
          columns={[
            { key: "centre", label: "Cost centre" },
            { key: "ledger", label: "Ledger" },
            { key: "amount", label: "Amount (Dr+)", align: "right", render: (r: any) => <Amount value={r.amount} /> },
          ]}
        />
      );
    case "budget-vs-actual":
      return (
        <DataTable
          rowKey={(r: any) => r.id}
          rows={d.rows}
          columns={[
            { key: "name", label: "Head" },
            { key: "budget", label: "Budget", align: "right", render: (r: any) => <Amount value={r.budget} /> },
            { key: "actual", label: "Actual", align: "right", render: (r: any) => <Amount value={r.actual} /> },
            { key: "variance", label: "Variance", align: "right", render: (r: any) => <Amount value={r.variance} /> },
            { key: "variancePct", label: "Variance %", align: "right" },
          ]}
        />
      );
    case "fy-comparison":
      return (
        <>
          {!d.previous.available && <Notice title="No previous year">The books start in the current financial year.</Notice>}
          <DataTable
            rowKey={(r: any) => r.section + r.name}
            rows={[
              ...["directIncome", "directExpenses", "indirectIncome", "indirectExpenses"].flatMap((k) =>
                d.profitAndLoss[k].map((r: any) => ({ ...r, section: k.replace(/([A-Z])/g, " $1") })),
              ),
              { section: "Result", name: "Gross profit", ...d.profitAndLoss.grossProfit },
              { section: "Result", name: "Net profit", ...d.profitAndLoss.netProfit },
              ...d.balanceSheet.liabilities.map((r: any) => ({ ...r, section: "Liabilities" })),
              ...d.balanceSheet.assets.map((r: any) => ({ ...r, section: "Assets" })),
            ]}
            pageSize={200}
            columns={[
              { key: "section", label: "Section" },
              { key: "name", label: "Particulars" },
              { key: "current", label: d.current.label, align: "right", render: (r: any) => <Amount value={r.current} /> },
              { key: "previous", label: d.previous.label, align: "right", render: (r: any) => <Amount value={r.previous} /> },
            ]}
          />
        </>
      );
    default:
      return <pre className="code-block">{JSON.stringify(d, null, 2)}</pre>;
  }
}

const ReconcileBadge = ({ ok, text }: { ok: boolean; text: string }) => (
  <div className={ok ? "reconcile ok" : "reconcile bad"} role="status">
    {ok ? "✓" : "!"} {text}
  </div>
);
