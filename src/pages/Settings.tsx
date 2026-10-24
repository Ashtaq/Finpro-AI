import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BadgeCheck, KeyRound, LockKeyhole, Save, SlidersHorizontal, UserRound } from "lucide-react";
import { Badge, Button, ErrorBox, PageHeader, SuccessBox } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { IndividualProfile, User } from "../types";

const ORG_SETTINGS = [
  ["evidenceFirst", "Evidence-first responses", "Ask assistants to cite source documents for every claim"],
  ["reviewNotices", "Professional review notices", "Show review warnings on high-impact outputs"],
  ["knowledgeForAi", "Organization knowledge", "Allow assistants to reference the knowledge base (when enabled)"],
] as const;

function useFlash() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return {
    message,
    error,
    ok: (m: string) => {
      setError("");
      setMessage(m);
    },
    fail: (e: unknown) => {
      setMessage("");
      setError(errorMessage(e));
    },
  };
}

function AccountPanel() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [saving, setSaving] = useState(false);
  const flash = useFlash();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { user: u } = await api.patch<{ user: User }>("/account", { name, email, phone });
      setUser(u);
      flash.ok("Account details saved.");
    } catch (err) {
      flash.fail(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Account details</h2>
          <p>Your name and contact details.</p>
        </div>
        <UserRound size={18} />
      </div>
      <form onSubmit={save} className="form-grid">
        <label>
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Mobile number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="+91 98765 43210" />
        </label>
        <label>
          Account type
          <input value={user?.role || ""} readOnly />
        </label>
        <div className="full">
          <SuccessBox message={flash.message} />
          <ErrorBox message={flash.error} />
        </div>
        <div className="full" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit" disabled={saving}>
            <Save size={15} />
            {saving ? "Saving…" : "Save account"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const flash = useFlash();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return flash.fail(new Error("New passwords do not match."));
    try {
      await api.post("/account/change-password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      flash.ok("Password changed. Other devices have been signed out.");
    } catch (err) {
      flash.fail(err);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Change password</h2>
          <p>At least 10 characters. Changing it signs out your other sessions.</p>
        </div>
        <KeyRound size={18} />
      </div>
      <form onSubmit={save} className="form-grid">
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
        <div className="full">
          <SuccessBox message={flash.message} />
          <ErrorBox message={flash.error} />
        </div>
        <div className="full" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit">
            <LockKeyhole size={15} />
            Change password
          </Button>
        </div>
      </form>
    </section>
  );
}

function TaxProfilePanel() {
  const { meta } = useAuth();
  const [params] = useSearchParams();
  const [profile, setProfile] = useState<IndividualProfile | null>(null);
  const flash = useFlash();
  useEffect(() => {
    api.get<IndividualProfile>("/individual/profile").then(setProfile, flash.fail);
    const kyc = params.get("kyc");
    if (kyc === "verified") flash.ok("Identity verified with DigiLocker.");
    else if (kyc)
      flash.fail(
        new Error(
          kyc === "expired"
            ? "Verification session expired. Please try again."
            : "Identity verification failed. Check that your PAN, name and date of birth match DigiLocker.",
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!profile) return null;
  const locked = profile.kycStatus === "VERIFIED";
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setProfile(
        await api.patch<IndividualProfile>("/individual/profile", {
          pan: locked ? undefined : profile.pan,
          dob: profile.dob,
          residentialStatus: profile.residentialStatus,
          address: profile.address,
        }),
      );
      flash.ok("Tax profile saved.");
    } catch (err) {
      flash.fail(err);
    }
  };
  const verify = async () => {
    try {
      const r = await api.post<{ status: string; authorizationUrl?: string }>("/kyc/start");
      if (r.authorizationUrl) window.location.assign(r.authorizationUrl);
      else {
        setProfile({ ...profile, kycStatus: r.status as IndividualProfile["kycStatus"] });
        flash.ok("Identity verified.");
      }
    } catch (err) {
      flash.fail(err);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Tax profile</h2>
          <p>Used to pre-fill your ITR drafts.</p>
        </div>
        <Badge tone={locked ? "success" : profile.kycStatus === "FAILED" ? "danger" : "default"}>
          {locked ? `Verified ${formatDate(profile.kycVerifiedAt)}` : profile.kycStatus === "NOT_STARTED" ? "Not verified" : profile.kycStatus.toLowerCase()}
        </Badge>
      </div>
      <form onSubmit={save} className="form-grid">
        <label>
          PAN
          <input
            value={profile.pan}
            onChange={(e) => setProfile({ ...profile, pan: e.target.value.toUpperCase() })}
            maxLength={10}
            readOnly={locked}
            placeholder="ABCDE1234F"
          />
          {locked && <span className="field-hint">Locked after identity verification.</span>}
        </label>
        <label>
          Date of birth
          <input type="date" value={profile.dob} onChange={(e) => setProfile({ ...profile, dob: e.target.value })} />
        </label>
        <label>
          Residential status
          <select
            value={profile.residentialStatus}
            onChange={(e) => setProfile({ ...profile, residentialStatus: e.target.value as IndividualProfile["residentialStatus"] })}
          >
            <option value="">Select</option>
            <option value="Resident">Resident</option>
            <option value="RNOR">Resident but not ordinarily resident</option>
            <option value="Non-resident">Non-resident</option>
          </select>
        </label>
        <label className="full">
          Address
          <textarea value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} maxLength={500} />
        </label>
        <div className="full">
          <SuccessBox message={flash.message} />
          <ErrorBox message={flash.error} />
        </div>
        <div className="full" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {meta?.kyc.enabled && !locked && (
            <Button variant="secondary" onClick={() => void verify()}>
              <BadgeCheck size={15} /> Verify with DigiLocker
            </Button>
          )}
          <Button type="submit">
            <Save size={15} /> Save profile
          </Button>
        </div>
      </form>
    </section>
  );
}

function OrganizationPanel() {
  const { user } = useAuth();
  const canEdit = user?.role === "Professional User";
  const [values, setValues] = useState<Record<string, boolean>>({});
  const flash = useFlash();
  useEffect(() => {
    api.get<Record<string, boolean>>("/settings").then(setValues, flash.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = async (key: string, value: boolean) => {
    const next = { ...values, [key]: value };
    setValues(next);
    try {
      await api.put("/settings", next);
      flash.ok("Organization settings saved.");
    } catch (err) {
      setValues(values);
      flash.fail(err);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>AI & workflow defaults</h2>
          <p>{canEdit ? "Applies to everyone in your organization." : "Managed by your Professional User."}</p>
        </div>
        <SlidersHorizontal size={18} />
      </div>
      {ORG_SETTINGS.map(([key, title, description]) => (
        <label className="setting-row" key={key}>
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <input type="checkbox" checked={values[key] ?? true} disabled={!canEdit} onChange={(e) => void toggle(key, e.target.checked)} />
        </label>
      ))}
      <SuccessBox message={flash.message} />
      <ErrorBox message={flash.error} />
    </section>
  );
}

export default function Settings() {
  const { user } = useAuth();
  return (
    <div className="individual-settings">
      <PageHeader eyebrow="ACCOUNT" title="Settings" description="Manage your account, security and workspace preferences." />
      <AccountPanel />
      {user?.role === "Individual" && <TaxProfilePanel />}
      <PasswordPanel />
      {user?.role !== "Individual" && <OrganizationPanel />}
    </div>
  );
}
