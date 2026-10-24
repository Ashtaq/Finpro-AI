import { FormEvent, useState } from "react";
import { Edit3, KeyRound, Mail, Plus, UserMinus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner, SuccessBox } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { PROFESSIONAL_ROLES, ProfessionalRole, Role, User } from "../types";

type Form = { name: string; email: string; professionalRole: ProfessionalRole; role: Role; password: string };
const blank: Form = { name: "", email: "", professionalRole: "Accountant", role: "Finance User", password: "" };

export default function Team() {
  const { data: rows = [], setData, error, loading, reload } = useAsync(() => api.get<User[]>("/users"));
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState<Form>(blank);
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");

  const openCreate = () => {
    setEdit(null);
    setForm(blank);
    setFormError("");
    setOpen(true);
  };
  const openEdit = (u: User) => {
    setEdit(u);
    setForm({ name: u.name, email: u.email, professionalRole: u.professionalRole, role: u.role, password: "" });
    setFormError("");
    setOpen(true);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    try {
      if (edit) {
        const u = await api.patch<User>(`/users/${edit.id}`, { name: form.name, email: form.email, professionalRole: form.professionalRole, role: form.role });
        setData(rows.map((r) => (r.id === u.id ? u : r)));
      } else {
        const u = await api.post<User>("/users", form);
        setData([u, ...rows]);
        setMessage(`Account created for ${u.email}. Share the initial password securely and ask them to change it.`);
      }
      setOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };
  const deactivate = async (u: User) => {
    if (!window.confirm(`Deactivate ${u.name}? They will be signed out immediately.`)) return;
    try {
      await api.del(`/users/${u.id}`);
      setData(rows.filter((r) => r.id !== u.id));
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };
  const doReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!reset) return;
    try {
      await api.post(`/users/${reset.id}/reset-password`, { password: newPassword });
      setMessage(`Password reset for ${reset.name}. Their existing sessions were signed out.`);
      setReset(null);
      setNewPassword("");
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE ADMINISTRATION"
        title="Team"
        description="Invite and manage Finance and Professional users in your organization."
        action={
          <Button onClick={openCreate}>
            <Plus size={15} /> Add user
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      <SuccessBox message={message} />
      {!open && <ErrorBox message={formError} />}
      {loading && !rows.length ? (
        <Spinner />
      ) : rows.length ? (
        <div className="team-grid">
          {rows.map((u) => (
            <div className="team-card" key={u.id}>
              <div className="team-card-top">
                <div className="avatar large">{u.name.slice(0, 1)}</div>
                <Badge tone={u.role === "Professional User" ? "info" : "default"}>{u.role}</Badge>
              </div>
              <h3>{u.name}</h3>
              <p>
                {u.professionalRole} · last sign-in {u.lastLoginAt ? formatDate(u.lastLoginAt) : "never"}
              </p>
              <span>
                <Mail size={13} /> {u.email}
              </span>
              <div className="team-actions">
                <button onClick={() => openEdit(u)}>
                  <Edit3 size={14} /> Edit
                </button>
                <button onClick={() => setReset(u)}>
                  <KeyRound size={14} /> Reset password
                </button>
                <button onClick={() => void deactivate(u)}>
                  <UserMinus size={14} /> Deactivate
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState title="Just you so far" description="Add colleagues so they can work on projects with you." />
        </div>
      )}
      <Modal open={open} title={edit ? "Edit user" : "Add user"} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="form-stack">
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label>
            Professional role
            <select value={form.professionalRole} onChange={(e) => setForm({ ...form, professionalRole: e.target.value as ProfessionalRole })}>
              {PROFESSIONAL_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Access level
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="Finance User">Finance User — projects, documents, tasks</option>
              <option value="Professional User">Professional User — full workspace administration</option>
            </select>
          </label>
          {!edit && (
            <label>
              Initial password
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={10}
                required
                autoComplete="new-password"
              />
              <span className="field-hint">At least 10 characters. Share it securely.</span>
            </label>
          )}
          <ErrorBox message={formError} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{edit ? "Save changes" : "Create account"}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!reset} title={`Reset password — ${reset?.name}`} onClose={() => setReset(null)}>
        <form onSubmit={doReset} className="form-stack">
          <label>
            New password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setReset(null)}>
              Cancel
            </Button>
            <Button type="submit">Reset password</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
