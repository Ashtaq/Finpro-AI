import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { BadgeCheck, FlaskConical, Lock, ShieldCheck } from "lucide-react";
import { Badge, Button, ErrorBox, Notice, PageHeader, Spinner, SuccessBox } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { KycStatusInfo } from "../types";

const REASONS: Record<string, string> = {
  name_mismatch: "The name on your Aadhaar does not match your account name. Update your name in Settings to match Aadhaar exactly, then try again.",
  dob_mismatch: "Your date of birth does not match Aadhaar/PAN. Correct it below and try again.",
  pan_mismatch: "The PAN in your DigiLocker does not match the PAN you entered. Correct it below and try again.",
  pan_missing: "No PAN card was found in your DigiLocker. Link your PAN in DigiLocker first, then try again.",
  aadhaar_missing: "Aadhaar is not linked to your DigiLocker account.",
  consent_denied: "You declined to share your documents. Verification needs your consent.",
  pan_in_use: "This PAN is already verified on another Finpro account.",
  provider_error: "DigiLocker could not complete the request. Please try again.",
  expired: "The verification session expired. Please start again.",
};

const SANDBOX_ACCOUNTS = [
  ["Rahul Verma", "ABCPV1234K", "1990-05-15", "succeeds"],
  ["Priya Sharma", "BQSPS5678L", "1988-11-02", "succeeds"],
  ["Amit Kumar", "CTKPK9012M", "1995-01-20", "fails — no PAN in locker"],
];

export default function VerifyIdentity() {
  const { user, meta, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: kyc, error, loading, reload } = useAsync(() => api.get<KycStatusInfo>("/kyc/status"));
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const result = params.get("kyc");

  // Coming back from DigiLocker: refresh the session user so route guards unlock immediately.
  useEffect(() => {
    if (result) void refreshUser().catch(() => undefined);
  }, [result, refreshUser]);

  if (user?.role !== "Individual") return <Navigate to="/" replace />;
  if (meta && !meta.kyc.enabled) return <Navigate to="/individual" replace />;

  const verified = kyc?.status === "VERIFIED";
  const needDetails = kyc && (!kyc.panMasked || !kyc.hasDob);
  const failure = result === "expired" ? REASONS.expired : kyc?.lastFailure ? REASONS[kyc.lastFailure.reason] || "Verification failed. Please try again." : "";

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    setActionError("");
    try {
      await api.patch("/individual/profile", { ...(pan ? { pan } : {}), ...(dob ? { dob } : {}) });
      setPan("");
      setDob("");
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const start = async () => {
    setBusy(true);
    setActionError("");
    try {
      const r = await api.post<{ status: string; authorizationUrl?: string }>("/kyc/start");
      if (r.authorizationUrl) {
        window.location.assign(r.authorizationUrl);
        return;
      }
      await refreshUser();
      setParams({ kyc: "verified" });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHeader
        eyebrow="IDENTITY VERIFICATION"
        title="Verify your identity"
        description="Finpro verifies your Aadhaar and PAN through DigiLocker before you prepare tax returns."
      />
      {meta?.kyc.mode === "sandbox" && (
        <div className="notice notice-warning" style={{ marginBottom: 16 }}>
          <FlaskConical size={18} />
          <div>
            <strong>Sandbox mode — test data only</strong>
            <span>
              DigiLocker is simulated locally. On the DigiLocker screen pick a test account (or "Custom" with the same name, DOB and PAN as this account). OTP
              is <b>123456</b>.
            </span>
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Sign up with name</th>
                  <th>PAN</th>
                  <th>DOB</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {SANDBOX_ACCOUNTS.map(([n, p, d, r]) => (
                  <tr key={p}>
                    <td>{n}</td>
                    <td>{p}</td>
                    <td>{d}</td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ErrorBox message={error} onRetry={reload} />
      {loading && !kyc ? (
        <Spinner />
      ) : kyc ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>DigiLocker verification</h2>
              <p>
                Account name: <b>{user.name}</b>
              </p>
            </div>
            <Badge tone={verified ? "success" : kyc.status === "FAILED" ? "danger" : "default"}>
              {verified ? "Verified" : kyc.status === "FAILED" ? "Failed" : kyc.status === "PENDING" ? "In progress" : "Not verified"}
            </Badge>
          </div>

          {verified ? (
            <>
              <SuccessBox message={result === "verified" ? "Your identity has been verified." : undefined} />
              <div className="validation-box">
                <div>
                  <BadgeCheck size={20} />
                  <div>
                    <strong>Aadhaar verified</strong>
                    <span>xxxx xxxx {kyc.aadhaarLast4 || "····"}</span>
                  </div>
                </div>
                <div>
                  <BadgeCheck size={20} />
                  <div>
                    <strong>PAN verified</strong>
                    <span>{kyc.panMasked}</span>
                  </div>
                </div>
              </div>
              <p className="muted">Verified on {formatDate(kyc.verifiedAt)}. Your PAN and date of birth are now locked.</p>
              <Button onClick={() => navigate("/individual", { replace: true })}>Continue to dashboard</Button>
            </>
          ) : (
            <>
              {failure && <ErrorBox message={failure} />}
              <div className="list-row">
                <div>
                  <strong>PAN</strong>
                  <span>{kyc.panMasked || "Not added"}</span>
                </div>
              </div>
              <div className="list-row">
                <div>
                  <strong>Date of birth</strong>
                  <span>{kyc.hasDob ? "Added" : "Not added"}</span>
                </div>
              </div>
              {(needDetails || ["pan_mismatch", "dob_mismatch"].includes(kyc.lastFailure?.reason || "")) && (
                <form className="inline-form" onSubmit={saveDetails} style={{ marginTop: 12 }}>
                  <label>
                    {kyc.panMasked ? "Correct PAN" : "PAN"}
                    <input
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      maxLength={10}
                      placeholder="ABCDE1234F"
                    />
                  </label>
                  <label>
                    Date of birth
                    <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                  </label>
                  <Button type="submit" variant="secondary" disabled={!pan && !dob}>
                    Save
                  </Button>
                </form>
              )}
              <ErrorBox message={actionError} />
              <div className="filing-timeline" style={{ marginTop: 16 }}>
                <div>
                  <Lock size={20} />
                  <strong>1. Sign in to DigiLocker</strong>
                  <span>With your Aadhaar-linked mobile and OTP.</span>
                </div>
                <div>
                  <ShieldCheck size={20} />
                  <strong>2. Allow access</strong>
                  <span>Share Aadhaar and PAN with Finpro for verification.</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <Button onClick={() => void start()} disabled={busy || Boolean(needDetails)}>
                  <ShieldCheck size={15} /> {busy ? "Opening DigiLocker…" : kyc.status === "FAILED" ? "Try again with DigiLocker" : "Verify with DigiLocker"}
                </Button>
                <Link className="btn btn-secondary" to="/settings">
                  Edit account name
                </Link>
              </div>
              <Notice title="What Finpro stores">
                Only your verification status, masked PAN and the last 4 digits of Aadhaar. Aadhaar documents and DigiLocker access tokens are never stored.
              </Notice>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
