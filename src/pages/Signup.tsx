import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorBox } from "../components/ui";
import { homePath, useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { PROFESSIONAL_ROLES, ProfessionalRole, Role } from "../types";
import { AuthBrand } from "./Login";

const TYPES: { role: Role; title: string; text: string }[] = [
  { role: "Individual", title: "Individual", text: "Salaried individuals managing income, assets, investments and ITR preparation." },
  { role: "Finance User", title: "Business", text: "Shop owners, freelancers and small businesses managing their own finances." },
  { role: "Professional User", title: "Professional", text: "CAs, CSs, auditors and CFAs managing clients, projects and teams." },
];

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>("Individual");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [professionalRole, setProfessionalRole] = useState<ProfessionalRole>("CA");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "Create account · Finpro AI";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    if (!terms) return setError("Please accept the terms to continue.");
    setBusy(true);
    try {
      const user = await signup({
        name,
        email,
        password,
        role,
        professionalRole: role === "Professional User" ? professionalRole : "Other",
        organizationName: role === "Individual" ? undefined : organizationName || undefined,
        acceptTerms: true,
      });
      navigate(homePath(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Sign up failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <div className="auth-card wide-card">
        <Link className="back-link" to="/login">
          <ArrowLeft size={15} /> Back to sign in
        </Link>
        <div className="eyebrow">CREATE ACCOUNT</div>
        <h1>Choose your workspace</h1>
        <div className="account-type-grid" role="radiogroup" aria-label="Account type">
          {TYPES.map((t) => (
            <button
              type="button"
              role="radio"
              aria-checked={role === t.role}
              key={t.role}
              className={role === t.role ? "account-type selected" : "account-type"}
              onClick={() => setRole(t.role)}
            >
              <strong>{t.title}</strong>
              <span>{t.text}</span>
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="form-grid">
          <label>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          {role !== "Individual" && (
            <label>
              {role === "Professional User" ? "Firm / practice name" : "Business name"}
              <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} maxLength={120} placeholder="Optional" />
            </label>
          )}
          {role === "Professional User" && (
            <label>
              Professional role
              <select value={professionalRole} onChange={(e) => setProfessionalRole(e.target.value as ProfessionalRole)}>
                {PROFESSIONAL_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} autoComplete="new-password" required />
            <span className="field-hint">At least 10 characters.</span>
          </label>
          <label>
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} autoComplete="new-password" required />
          </label>
          <label className="checkbox-label full">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I agree to the terms of service and privacy policy, and
            understand that AI and tax outputs must be reviewed before use.
          </label>
          {error && (
            <div className="full">
              <ErrorBox message={error} />
            </div>
          )}
          <button className="btn btn-primary wide full" type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>
      <div className="auth-footer">Your account type controls the workspace and permissions you receive.</div>
    </div>
  );
}
