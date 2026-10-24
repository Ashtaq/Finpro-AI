import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Sparkles } from "lucide-react";
import { ErrorBox } from "../components/ui";
import { homePath, useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";

const DEMO = [
  ["Professional User", "professional@finpro.demo"],
  ["Finance User", "finance@finpro.demo"],
  ["Individual", "individual@finpro.demo"],
];

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="brand-mark large">
        <Sparkles size={22} />
      </div>
      <div>
        <div className="brand-name">FINPRO AI</div>
        <div className="brand-sub">FINANCE WORKSPACE</div>
      </div>
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { login, meta } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "Sign in · Finpro AI";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(email, password);
      navigate(homePath(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Sign in failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <div className="auth-card">
        <div className="auth-icon">
          <ShieldCheck size={23} />
        </div>
        <div className="eyebrow">SECURE WORKSPACE</div>
        <h1>Sign in to Finpro AI</h1>
        <p className="auth-muted">Your account type decides the workspace you see.</p>
        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required autoFocus />
          </label>
          <label>
            Password
            <div className="password-wrap">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <ErrorBox message={error} />
          <button className="btn btn-primary wide" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="auth-divider">or</div>
        <Link to="/signup" className="btn btn-secondary wide">
          Create an account
        </Link>
        {meta?.demo && (
          <div className="demo-note">
            <strong>Demo environment.</strong> Password for all demo accounts: <code>Demo@Finpro2026</code>
            <div className="role-picker" style={{ marginTop: 8 }}>
              {DEMO.map(([role, demoEmail]) => (
                <button
                  type="button"
                  key={role}
                  className={email === demoEmail ? "role-chip selected" : "role-chip"}
                  onClick={() => {
                    setEmail(demoEmail);
                    setPassword("Demo@Finpro2026");
                  }}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="auth-footer">Personal finance, small-business finance and professional advisory workflows in one platform.</div>
    </div>
  );
}
