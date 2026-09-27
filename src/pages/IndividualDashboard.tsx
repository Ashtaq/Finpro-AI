import { Link } from "react-router-dom";
import { ArrowRight, BriefcaseBusiness, FileCheck2, Landmark, ShieldCheck, TrendingUp, WalletCards } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const cards = [
  { label: "Gross income", value: "₹12.84L", note: "FY 2025-26", icon: TrendingUp },
  { label: "Taxable income", value: "₹9.72L", note: "Current estimate", icon: FileCheck2 },
  { label: "Assets tracked", value: "₹38.6L", note: "Across 8 assets", icon: Landmark },
  { label: "Tax payable", value: "₹42,180", note: "Before final validation", icon: WalletCards },
];

export default function IndividualDashboard() {
  const { user } = useAuth();
  return <div className="page">
    <div className="page-header">
      <div><div className="eyebrow">INDIVIDUAL TAX WORKSPACE</div><h1>Welcome back, {user?.name.split(" ")[0]}</h1><p className="page-subtitle">Manage your finances, assets and annual income-tax return from one workspace.</p></div>
      <Link to="/itr-filing" className="btn btn-primary"><FileCheck2 size={16}/> Continue ITR filing</Link>
    </div>

    <div className="stat-grid">
      {cards.map(({label,value,note,icon:Icon}) => <div className="stat-card" key={label}><div className="stat-icon"><Icon size={19}/></div><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div></div>)}
    </div>

    <div className="content-grid">
      <section className="panel">
        <div className="panel-header"><div><h2>ITR filing progress</h2><p className="panel-subtitle">Assessment Year 2026-27</p></div><span className="status-badge">Data collection</span></div>
        <div className="progress-track"><div className="progress-fill" style={{width:"62%"}}/></div>
        <div className="step-list">
          {["Personal profile","Income & TDS","Deductions","Assets & capital gains","Review & validation","File & e-Verify"].map((step,i)=><div className="step-row" key={step}><div className={i < 4 ? "step-dot done" : "step-dot"}>{i < 4 ? "✓" : i+1}</div><span>{step}</span>{i < 4 && <small>Completed</small>}</div>)}
        </div>
        <Link className="text-link" to="/itr-filing">Open ITR workspace <ArrowRight size={15}/></Link>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Financial profile</h2><p className="panel-subtitle">Keep this updated throughout the year</p></div></div>
        <div className="profile-actions">
          <Link to="/assets" className="quick-action"><Landmark size={19}/><div><strong>Manage assets</strong><span>Investments, property and liabilities</span></div><ArrowRight size={15}/></Link>
          <Link to="/documents" className="quick-action"><BriefcaseBusiness size={19}/><div><strong>Tax documents</strong><span>Form 16, statements and supporting files</span></div><ArrowRight size={15}/></Link>
          <div className="quick-action"><ShieldCheck size={19}/><div><strong>Data & consent</strong><span>Review access before any tax integration</span></div><ArrowRight size={15}/></div>
        </div>
      </section>
    </div>

    <div className="panel">
      <div className="panel-header"><div><h2>What Finpro can do next</h2><p className="panel-subtitle">Tax preparation is assisted by deterministic calculations and document evidence.</p></div></div>
      <div className="feature-grid">
        <div><strong>Income aggregation</strong><span>Combine salary, business, interest, dividends and other income.</span></div>
        <div><strong>Capital gains</strong><span>Track transactions and prepare capital-gain inputs for your return.</span></div>
        <div><strong>Tax review</strong><span>Identify missing information, inconsistent entries and filing checks.</span></div>
        <div><strong>Filing lifecycle</strong><span>Prepare → validate → submit → e-verify → acknowledgement.</span></div>
      </div>
    </div>
  </div>;
}
