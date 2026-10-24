import { useMemo, useState } from "react";
import { BarChart3, Calculator, Printer, ShieldAlert } from "lucide-react";
import { Button, MetricCard, Notice, PageHeader } from "../components/ui";

// Deterministic ratio calculator. Every metric is a transparent formula over the inputs — no AI.
const FIELDS = [
  ["revenue", "Revenue from operations"],
  ["operatingExpenses", "Operating expenses (excl. D&A)"],
  ["depreciation", "Depreciation & amortisation"],
  ["interest", "Finance costs"],
  ["tax", "Tax expense"],
  ["currentAssets", "Current assets"],
  ["inventory", "Inventory"],
  ["currentLiabilities", "Current liabilities"],
  ["totalDebt", "Total borrowings"],
  ["equity", "Shareholders' equity"],
  ["operatingCashFlow", "Cash flow from operations"],
  ["capex", "Capital expenditure"],
] as const;
type Key = (typeof FIELDS)[number][0];

const ratio = (a: number, b: number) => (b ? a / b : NaN);
const fmt = (v: number, digits = 2, suffix = "") => (Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : "—");

export default function FinancialAnalysis() {
  const [unit, setUnit] = useState("₹ Cr");
  const [v, setV] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, ""])) as Record<Key, string>);
  const n = (k: Key) => Number(v[k]) || 0;

  const r = useMemo(() => {
    const ebitda = n("revenue") - n("operatingExpenses");
    const ebit = ebitda - n("depreciation");
    const pbt = ebit - n("interest");
    const pat = pbt - n("tax");
    return {
      ebitda,
      pat,
      rows: [
        ["EBITDA margin", fmt(ratio(ebitda, n("revenue")) * 100, 1, "%"), "(Revenue − Operating expenses) ÷ Revenue"],
        ["Net profit margin", fmt(ratio(pat, n("revenue")) * 100, 1, "%"), "PAT ÷ Revenue"],
        ["Current ratio", fmt(ratio(n("currentAssets"), n("currentLiabilities"))), "Current assets ÷ Current liabilities"],
        ["Quick ratio", fmt(ratio(n("currentAssets") - n("inventory"), n("currentLiabilities"))), "(Current assets − Inventory) ÷ Current liabilities"],
        ["Debt / Equity", fmt(ratio(n("totalDebt"), n("equity"))), "Total borrowings ÷ Equity"],
        ["Interest coverage", fmt(ratio(ebit, n("interest")), 1, "x"), "EBIT ÷ Finance costs"],
        ["Return on equity", fmt(ratio(pat, n("equity")) * 100, 1, "%"), "PAT ÷ Equity"],
        [
          "Free cash flow",
          Number.isFinite(n("operatingCashFlow") - n("capex")) ? `${(n("operatingCashFlow") - n("capex")).toFixed(2)} ${unit}` : "—",
          "Operating cash flow − Capex",
        ],
      ] as const,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, unit]);

  const hasInput = Object.values(v).some((x) => x !== "");
  return (
    <>
      <PageHeader
        eyebrow="FINANCIAL INTELLIGENCE"
        title="Financial Analysis"
        description="Enter figures from audited statements to compute standard ratios. Every result shows its formula."
        action={
          <Button variant="secondary" onClick={() => window.print()} disabled={!hasInput}>
            <Printer size={15} /> Print
          </Button>
        }
      />
      <div className="analysis-layout">
        <div className="panel no-print">
          <div className="panel-head">
            <div>
              <h2>Inputs</h2>
              <p>Use one unit consistently for all figures.</p>
            </div>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
              <option>₹ Cr</option>
              <option>₹ Lakh</option>
              <option>₹</option>
            </select>
          </div>
          <div className="form-grid single">
            {FIELDS.map(([k, label]) => (
              <label key={k}>
                {label}
                <input type="number" inputMode="decimal" step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
        <div className="analysis-results">
          <div className="metric-grid compact">
            <MetricCard label="Revenue" value={`${n("revenue").toFixed(2)} ${unit}`} icon={<BarChart3 size={18} />} />
            <MetricCard label="EBITDA" value={`${r.ebitda.toFixed(2)} ${unit}`} icon={<Calculator size={18} />} />
            <MetricCard label="Profit after tax" value={`${r.pat.toFixed(2)} ${unit}`} icon={<Calculator size={18} />} />
            <MetricCard label="Debt / Equity" value={r.rows[4][1]} icon={<ShieldAlert size={18} />} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Ratios</h2>
              <p>Blank where the denominator is zero</p>
            </div>
            <div className="ratio-list">
              {r.rows.map(([label, value, formula]) => (
                <div className="ratio-row" key={label}>
                  <div>
                    <strong>{label}</strong>
                    <span>{formula}</span>
                  </div>
                  <b>{value}</b>
                </div>
              ))}
            </div>
          </div>
          <Notice title="Interpretation is yours">
            These are arithmetic results only. Benchmarks vary by industry; review against the source statements before drawing conclusions.
          </Notice>
        </div>
      </div>
    </>
  );
}
