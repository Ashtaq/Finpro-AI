import { useNavigate } from "react-router-dom";
import { AlertTriangle, Banknote, FileClock, Landmark, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorBox, MetricCard, Spinner } from "../../components/ui";
import { monthLabel } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, StatusBadge } from "../components";
import { useCompany } from "../context";
import { money, toPaise, typeLabel } from "../lib";

interface DashboardData {
  period: { from: string; to: string; label: string };
  kpis: Record<string, string | null>;
  ageing: Record<string, string>;
  counts: Record<string, number>;
  trend: { month: string; income: string; expenses: string }[];
  recent: { id: string; type: string; number: string | null; date: string; party: string; total: string; status: string }[];
}

export default function Dashboard() {
  const { capi, company } = useCompany();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => capi.get<DashboardData>("/dashboard"), [company.id]);
  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;
  const k = data.kpis;
  const chart = data.trend.map((t) => ({ month: monthLabel(t.month), Income: toPaise(t.income) / 100, Expenses: toPaise(t.expenses) / 100 }));
  const alerts = [
    data.counts.pendingApprovals ? [`${data.counts.pendingApprovals} voucher(s) awaiting approval`, "/accounting/vouchers"] : null,
    data.counts.unreconciledBankLines ? [`${data.counts.unreconciledBankLines} bank statement line(s) to reconcile`, "/accounting/banking"] : null,
    data.counts.dueRecurring ? [`${data.counts.dueRecurring} recurring voucher(s) due`, "/accounting/vouchers"] : null,
    data.counts.lowStockItems ? [`${data.counts.lowStockItems} item(s) at or below reorder level`, "/accounting/inventory"] : null,
    data.counts.drafts ? [`${data.counts.drafts} draft voucher(s)`, "/accounting/vouchers"] : null,
  ].filter(Boolean) as [string, string][];
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Cash & bank" value={money(k.cashAndBank)} icon={<Wallet size={18} />} delta={`As at ${data.period.to}`} />
        <MetricCard label="Receivables" value={money(k.receivables)} icon={<Receipt size={18} />} delta={`90+ days: ${money(data.ageing["90+"])}`} />
        <MetricCard label="Payables" value={money(k.payables)} icon={<Banknote size={18} />} />
        <MetricCard
          label={`Net profit ${data.period.label}`}
          value={money(k.netProfit)}
          icon={<TrendingUp size={18} />}
          delta={`Revenue ${money(k.revenue)}`}
        />
      </div>
      <div className="metric-grid">
        <MetricCard label="Gross profit" value={money(k.grossProfit)} icon={<TrendingUp size={18} />} />
        <MetricCard label="Closing stock" value={money(k.closingStock)} icon={<Landmark size={18} />} />
        <MetricCard
          label="GST payable (this month)"
          value={k.gstPayableThisMonth === null ? "GST off" : money(k.gstPayableThisMonth)}
          icon={<FileClock size={18} />}
        />
        <MetricCard label="Items needing attention" value={alerts.length} icon={<AlertTriangle size={18} />} />
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Income vs expenses</h2>
              <p>Last 12 months, posted vouchers</p>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} tickFormatter={(v: number) => (Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : String(v))} />
                <Tooltip formatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} />
                <Legend />
                <Bar dataKey="Income" fill="#3d5afe" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#12c2b9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Needs attention</h2>
              <p>Approvals, reconciliation, stock and recurring entries</p>
            </div>
          </div>
          {alerts.length ? (
            alerts.map(([text, to]) => (
              <div key={text} className="list-row">
                <div>
                  <strong>{text}</strong>
                </div>
                <button className="text-link" onClick={() => navigate(to)}>
                  Open
                </button>
              </div>
            ))
          ) : (
            <p className="muted">All clear.</p>
          )}
          <h3 className="sub-head">Receivables ageing</h3>
          {Object.entries(data.ageing).map(([b, v]) => (
            <div key={b} className="list-row">
              <div>
                <strong>{b === "Not due" ? b : `${b} days overdue`}</strong>
              </div>
              <Amount value={v} />
            </div>
          ))}
        </div>
      </div>
      <h2 className="section-title">Recent vouchers</h2>
      <DataTable
        rowKey={(r) => r.id}
        rows={data.recent}
        onRowClick={(r) => navigate(`/accounting/vouchers?open=${r.id}`)}
        columns={[
          { key: "date", label: "Date" },
          { key: "type", label: "Type", render: (r) => typeLabel(r.type) },
          { key: "number", label: "Number", render: (r) => r.number || "—" },
          { key: "party", label: "Party" },
          { key: "total", label: "Amount", align: "right", render: (r) => <Amount value={r.total} /> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
