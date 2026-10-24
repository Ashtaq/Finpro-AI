import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, FileCheck2, LockKeyhole, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Notice, PageHeader, Spinner, SuccessBox } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { currentFY, formatDateTime, formatINR } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { ItrPayload, ItrReturn, ItrValidation } from "../types";

const STEPS = ["Profile", "Income", "Deductions", "Taxes paid", "Review"] as const;
const INCOME: [keyof ItrPayload["income"], string, string?][] = [
  ["salary", "Salary (after standard deduction as per Form 16)"],
  ["houseProperty", "Income from house property", "Enter a loss as a negative number"],
  ["interest", "Interest (savings, FD, bonds)"],
  ["dividends", "Dividends"],
  ["capitalGainsShortTerm", "Short-term capital gains"],
  ["capitalGainsLongTerm", "Long-term capital gains"],
  ["business", "Business / profession income"],
  ["other", "Other income"],
];
const DEDUCTIONS: [keyof ItrPayload["deductions"], string][] = [
  ["sec80C", "Section 80C (PF, ELSS, LIC, tuition…)"],
  ["sec80D", "Section 80D (health insurance)"],
  ["sec80CCD1B", "Section 80CCD(1B) (NPS)"],
  ["sec80TTA", "Section 80TTA / 80TTB (interest)"],
  ["other", "Other Chapter VI-A deductions"],
];
const TAXES: [keyof ItrPayload["taxesPaid"], string][] = [
  ["tds", "TDS (Form 16 / 16A / 26AS)"],
  ["tcs", "TCS"],
  ["advanceTax", "Advance tax"],
  ["selfAssessmentTax", "Self-assessment tax"],
];
const STATUS_TONE = { DRAFT: "default", READY_TO_FILE: "success", SUBMITTED: "info", E_VERIFIED: "info", ACKNOWLEDGED: "success" } as const;

function Money({
  value,
  onChange,
  label,
  hint,
  allowNegative,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  hint?: string;
  allowNegative?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={allowNegative ? undefined : 0}
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Editor({ initial, onBack, onChanged }: { initial: ItrReturn; onBack: () => void; onChanged: () => void }) {
  const { meta } = useAuth();
  const [ret, setRet] = useState(initial);
  const [payload, setPayload] = useState<ItrPayload>(initial.payload);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<ItrValidation>(initial.validation);
  const [confirm, setConfirm] = useState(false);
  const locked = !["DRAFT", "READY_TO_FILE"].includes(ret.status);

  const update = <K extends keyof ItrPayload>(section: K, patch: Partial<ItrPayload[K]>) => {
    setPayload((p) => ({ ...p, [section]: typeof p[section] === "object" ? { ...(p[section] as object), ...patch } : patch }));
    setDirty(true);
  };
  const save = async (extra: Partial<Pick<ItrReturn, "itrType">> = {}) => {
    if (!dirty && !extra.itrType) return ret;
    const r = await api.patch<ItrReturn>(`/individual/itr/${ret.id}`, { payload, ...extra });
    setRet((cur) => ({ ...cur, ...r, consent: null }));
    setValidation({});
    setDirty(false);
    onChanged();
    return r;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const next = () =>
    run(async () => {
      await save();
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    });
  const validate = () =>
    run(async () => {
      await save();
      const v = await api.post<ItrValidation>(`/individual/itr/${ret.id}/validate`);
      setValidation(v);
      setRet((r) => ({ ...r, status: v.passed ? "READY_TO_FILE" : "DRAFT" }));
      onChanged();
    });
  const giveConsent = () =>
    run(async () => {
      await api.post(`/individual/itr/${ret.id}/consent`, { confirm: true });
      setRet((r) => ({ ...r, consent: { status: "Granted", grantedAt: new Date().toISOString() } }));
      setMessage("Consent recorded for this draft.");
    });
  const submit = () =>
    run(async () => {
      await api.post(`/individual/itr/${ret.id}/submit`);
    });

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            AY {ret.assessmentYear} · {ret.itrType}
          </div>
          <h1>Prepare your return</h1>
          <p className="page-subtitle">Saved automatically when you continue. Last saved {formatDateTime(ret.updatedAt)}.</p>
        </div>
        <div className="page-actions">
          <Badge tone={STATUS_TONE[ret.status]}>{ret.status.replace(/_/g, " ")}</Badge>
          <Button variant="secondary" onClick={() => run(async () => (await save(), onBack()))}>
            All returns
          </Button>
        </div>
      </div>
      <div className="itr-stepper">
        {STEPS.map((s, i) => (
          <button
            type="button"
            className={i <= step ? "itr-step active" : "itr-step"}
            key={s}
            onClick={() => run(async () => (await save(), setStep(i)))}
            style={{ background: "none", border: 0 }}
          >
            <div className="itr-number">{i < step ? "✓" : i + 1}</div>
            <span>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight size={14} />}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      <SuccessBox message={message} />
      <section className="panel">
        {step === 0 && (
          <>
            <h2>Taxpayer profile</h2>
            <p className="panel-subtitle">Pre-filled from your tax profile in Settings.</p>
            <div className="form-grid">
              <label>
                PAN
                <input
                  value={payload.profile.pan}
                  maxLength={10}
                  onChange={(e) => update("profile", { pan: e.target.value.toUpperCase() })}
                  disabled={locked}
                />
              </label>
              <label>
                ITR form
                <select
                  value={ret.itrType}
                  disabled={locked}
                  onChange={(e) => run(async () => void (await save({ itrType: e.target.value as ItrReturn["itrType"] })))}
                >
                  <option value="ITR-1">ITR-1 (Sahaj)</option>
                  <option value="ITR-2">ITR-2</option>
                  <option value="ITR-3">ITR-3</option>
                  <option value="ITR-4">ITR-4 (Sugam)</option>
                </select>
              </label>
              <label>
                Residential status
                <select
                  value={payload.profile.residentialStatus}
                  disabled={locked}
                  onChange={(e) => update("profile", { residentialStatus: e.target.value as ItrPayload["profile"]["residentialStatus"] })}
                >
                  <option value="">Select</option>
                  <option value="Resident">Resident</option>
                  <option value="RNOR">Resident but not ordinarily resident</option>
                  <option value="Non-resident">Non-resident</option>
                </select>
              </label>
              <label>
                Taxpayer type
                <select
                  value={payload.profile.taxpayerType}
                  disabled={locked}
                  onChange={(e) => update("profile", { taxpayerType: e.target.value as ItrPayload["profile"]["taxpayerType"] })}
                >
                  <option value="Individual">Individual</option>
                  <option value="Individual with business/profession">Individual with business / profession</option>
                </select>
              </label>
              <label>
                Tax regime
                <select
                  value={payload.regime}
                  disabled={locked}
                  onChange={(e) => (setPayload({ ...payload, regime: e.target.value as ItrPayload["regime"] }), setDirty(true))}
                >
                  <option value="new">New regime (default)</option>
                  <option value="old">Old regime</option>
                </select>
              </label>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Income</h2>
            <p className="panel-subtitle">Annual figures for the financial year. Cross-check with Form 16, AIS and 26AS.</p>
            <div className="form-grid">
              {INCOME.map(([k, label, hint]) => (
                <Money
                  key={k}
                  label={label}
                  hint={hint}
                  allowNegative={k === "houseProperty"}
                  value={payload.income[k]}
                  onChange={(v) => update("income", { [k]: v })}
                />
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Deductions</h2>
            <p className="panel-subtitle">
              {payload.regime === "new" ? "Most of these are not available under the new regime." : "Claim only what you can support with documents."}
            </p>
            <div className="form-grid">
              {DEDUCTIONS.map(([k, label]) => (
                <Money key={k} label={label} value={payload.deductions[k]} onChange={(v) => update("deductions", { [k]: v })} />
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>Taxes already paid</h2>
            <p className="panel-subtitle">These should match Form 26AS / AIS.</p>
            <div className="form-grid">
              {TAXES.map(([k, label]) => (
                <Money key={k} label={label} value={payload.taxesPaid[k]} onChange={(v) => update("taxesPaid", { [k]: v })} />
              ))}
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h2>Review & checks</h2>
            <p className="panel-subtitle">
              Deterministic pre-checks. Tax liability is not computed in this version — confirm it with your CA or the e-filing portal.
            </p>
            <Button variant="secondary" onClick={() => void validate()} disabled={busy || locked}>
              <RefreshCw size={15} /> {busy ? "Checking…" : "Run checks"}
            </Button>
            {validation.checkedAt && (
              <div className="validation-box" style={{ marginTop: 14 }}>
                <div>
                  {validation.passed ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
                  <div>
                    <strong>{validation.passed ? "All required checks passed" : `${validation.errors?.length} issue(s) to fix`}</strong>
                    <span>
                      Gross total income {formatINR(validation.totals?.grossTotalIncome || 0)} · deductions{" "}
                      {formatINR(validation.totals?.deductionsClaimed || 0)} · taxes paid {formatINR(validation.totals?.taxesPaid || 0)}
                    </span>
                    {!!validation.errors?.length && (
                      <ul className="issue-list errors">
                        {validation.errors.map((e, i) => (
                          <li key={i}>{e.message}</li>
                        ))}
                      </ul>
                    )}
                    {!!validation.warnings?.length && (
                      <ul className="issue-list warnings">
                        {validation.warnings.map((w, i) => (
                          <li key={i}>{w.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
            {ret.status === "READY_TO_FILE" && (
              <div className="filing-timeline" style={{ marginTop: 16 }}>
                <div>
                  <FileCheck2 size={20} />
                  <strong>Consent</strong>
                  {ret.consent ? (
                    <span>Recorded {formatDateTime(ret.consent.grantedAt)}</span>
                  ) : (
                    <>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm these details are correct and
                        consent to prefill and filing through an approved intermediary.
                      </label>
                      <Button variant="secondary" disabled={!confirm || busy} onClick={() => void giveConsent()}>
                        Record consent
                      </Button>
                    </>
                  )}
                </div>
                <div>
                  <Send size={20} />
                  <strong>Submit</strong>
                  <span>
                    {meta?.itrFiling.enabled
                      ? "Submit through the approved filing provider."
                      : "Electronic filing is not enabled. File on the Income Tax portal using these figures."}
                  </span>
                  <Button disabled={!ret.consent || busy || !meta?.itrFiling.enabled} onClick={() => void submit()}>
                    Submit return
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <div className="wizard-actions">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 && (
          <Button onClick={() => void next()} disabled={busy}>
            {busy ? "Saving…" : "Continue"} <ChevronRight size={15} />
          </Button>
        )}
      </div>
    </>
  );
}

export default function ITRFiling() {
  const { data: returns = [], error, loading, reload } = useAsync(() => api.get<ItrReturn[]>("/individual/itr"));
  const [active, setActive] = useState<ItrReturn | null>(null);
  const [actionError, setActionError] = useState("");
  const { ay, previousAy } = currentFY();
  const [newAy, setNewAy] = useState(previousAy);
  useEffect(() => {
    document.title = "ITR Preparation · Finpro AI";
  }, []);

  const open = async (id: string) => {
    try {
      setActive(await api.get<ItrReturn>(`/individual/itr/${id}`));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const create = async () => {
    setActionError("");
    try {
      const r = await api.post<ItrReturn>("/individual/itr", { assessmentYear: newAy, itrType: "ITR-1" });
      await reload();
      await open(r.id);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const remove = async (r: ItrReturn) => {
    if (!window.confirm(`Delete the AY ${r.assessmentYear} draft?`)) return;
    try {
      await api.del(`/individual/itr/${r.id}`);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  if (active) return <Editor initial={active} onBack={() => (setActive(null), void reload())} onChanged={() => undefined} />;
  return (
    <div className="page">
      <PageHeader
        eyebrow="ITR PREPARATION"
        title="Income Tax Returns"
        description="Prepare and check your return with reviewable figures."
        action={
          <div className="secure-pill">
            <LockKeyhole size={14} /> Private to your account
          </div>
        }
      />
      <ErrorBox message={error || actionError} onRetry={error ? reload : undefined} />
      <section className="panel">
        <div className="inline-form">
          <label>
            Assessment year
            <select value={newAy} onChange={(e) => setNewAy(e.target.value)}>
              <option value={previousAy}>AY {previousAy}</option>
              <option value={ay}>AY {ay}</option>
            </select>
          </label>
          <Button onClick={() => void create()}>
            <Plus size={15} /> New draft
          </Button>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        {loading && !returns.length ? (
          <Spinner />
        ) : returns.length ? (
          returns.map((r) => (
            <div className="list-row" key={r.id}>
              <div>
                <strong>
                  AY {r.assessmentYear} · {r.itrType}
                </strong>
                <span>Updated {formatDateTime(r.updatedAt)}</span>
              </div>
              <div className="table-actions">
                <Badge tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
                <Button variant="secondary" onClick={() => void open(r.id)}>
                  Open
                </Button>
                {["DRAFT", "READY_TO_FILE"].includes(r.status) && (
                  <button className="icon-btn danger" onClick={() => void remove(r)} aria-label="Delete draft">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="No returns yet" description="Create a draft for the assessment year you're filing." />
        )}
      </section>
      <Notice title="Filing boundary">
        Finpro does not submit returns to the Income Tax Department yet. Submission requires an approved e-Return Intermediary integration.
      </Notice>
    </div>
  );
}
