import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, FileCheck2, FileText, Landmark, WalletCards } from "lucide-react";
import { ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { currentFY, formatDate, formatINRCompact } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { IndividualProfile, ItrReturn } from "../types";

interface Summary {
  assets: { total: number; liabilities: number; netWorth: number; count: number };
  documents: number;
  profile: IndividualProfile;
  latestReturn: ItrReturn | null;
}

const STATUS_LABEL: Record<ItrReturn["status"], string> = {
  DRAFT: "Draft",
  READY_TO_FILE: "Ready to file",
  SUBMITTED: "Submitted",
  E_VERIFIED: "e-Verified",
  ACKNOWLEDGED: "Acknowledged",
};

export default function IndividualDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get<Summary>("/individual/summary"));
  const { previousAy: ay } = currentFY(); // the return being filed this year

  const checklist = data
    ? [
        ["Add PAN and residential status", Boolean(data.profile.pan && data.profile.residentialStatus), "/settings"],
        ["Upload Form 16 / AIS / statements", data.documents > 0, "/documents"],
        ["Record assets and liabilities", data.assets.count > 0, "/assets"],
        ["Create an ITR draft", Boolean(data.latestReturn), "/itr-filing"],
        ["Pass validation checks", data.latestReturn?.status === "READY_TO_FILE", "/itr-filing"],
      ]
    : [];
  const done = checklist.filter(([, ok]) => ok).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="PERSONAL TAX WORKSPACE"
        title={`Welcome, ${user?.name.split(" ")[0]}`}
        description="Keep your finances organized through the year and prepare your income-tax return."
        action={
          <Link to="/itr-filing" className="btn btn-primary">
            <FileCheck2 size={16} /> {data?.latestReturn ? "Continue ITR" : "Start ITR"}
          </Link>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="stat-grid">
            {[
              ["Net worth", formatINRCompact(data.assets.netWorth), `${data.assets.count} records`, WalletCards],
              ["Assets", formatINRCompact(data.assets.total), "Excluding liabilities", Landmark],
              ["Documents", String(data.documents), "Stored securely", FileText],
              [
                "Latest return",
                data.latestReturn ? STATUS_LABEL[data.latestReturn.status] : "Not started",
                data.latestReturn ? `AY ${data.latestReturn.assessmentYear} · ${data.latestReturn.itrType}` : `AY ${ay}`,
                FileCheck2,
              ],
            ].map(([label, value, note, Icon]) => {
              const I = Icon as typeof WalletCards;
              return (
                <div className="stat-card" key={label as string}>
                  <div className="stat-icon">
                    <I size={19} />
                  </div>
                  <div>
                    <div className="stat-label">{label as string}</div>
                    <div className="stat-value">{value as string}</div>
                    <div className="stat-note">{note as string}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="content-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Return readiness</h2>
                  <p className="panel-subtitle">
                    {done} of {checklist.length} steps complete
                  </p>
                </div>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(done / checklist.length) * 100}%` }} />
              </div>
              <div className="step-list">
                {checklist.map(([label, ok, to], i) => (
                  <Link to={to as string} className="step-row" key={label as string}>
                    <div className={ok ? "step-dot done" : "step-dot"}>{ok ? "✓" : i + 1}</div>
                    <span>{label as string}</span>
                    {ok ? <small>Done</small> : <ArrowRight size={14} />}
                  </Link>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Identity</h2>
                  <p className="panel-subtitle">PAN and KYC status</p>
                </div>
              </div>
              <div className="profile-actions">
                <Link to="/settings" className="quick-action">
                  <BadgeCheck size={19} />
                  <div>
                    <strong>{data.profile.pan || "PAN not added"}</strong>
                    <span>{data.profile.kycStatus === "VERIFIED" ? `Verified ${formatDate(data.profile.kycVerifiedAt)}` : "Identity not verified"}</span>
                  </div>
                  <ArrowRight size={15} />
                </Link>
                <Link to="/assets" className="quick-action">
                  <Landmark size={19} />
                  <div>
                    <strong>Manage assets</strong>
                    <span>Bank, investments, property and loans</span>
                  </div>
                  <ArrowRight size={15} />
                </Link>
                <Link to="/documents" className="quick-action">
                  <FileText size={19} />
                  <div>
                    <strong>Tax documents</strong>
                    <span>Form 16, AIS, statements</span>
                  </div>
                  <ArrowRight size={15} />
                </Link>
              </div>
            </section>
          </div>
          <Notice title="Preparation, not filing">
            Finpro helps you prepare and check your return. Electronic filing requires an approved e-Return Intermediary and is not enabled yet.
          </Notice>
        </>
      ) : null}
    </div>
  );
}
