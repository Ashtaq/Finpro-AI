import { FormEvent, useState } from "react";
import { Building2, Car, Landmark, Pencil, Plus, Trash2, TrendingUp, WalletCards } from "lucide-react";
import { Button, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatINR, formatINRCompact } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { IndividualAsset } from "../types";

const CATEGORIES = ["Bank", "Investments", "Property", "Vehicle", "Gold", "Retirement", "Liability", "Other"];
const ICONS: Record<string, typeof Landmark> = { Bank: Landmark, Investments: TrendingUp, Property: Building2, Vehicle: Car };
const blank = { name: "", category: "Bank", value: "", institution: "", asOf: new Date().toISOString().slice(0, 10) };

export default function Assets() {
  const { data: assets = [], setData, error, loading, reload } = useAsync(() => api.get<IndividualAsset[]>("/individual/assets"));
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<IndividualAsset | null>(null);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState("");

  const sum = (f: (a: IndividualAsset) => boolean) => assets.filter(f).reduce((s, a) => s + a.value, 0);
  const liabilities = sum((a) => a.category === "Liability");
  const total = sum((a) => a.category !== "Liability");

  const openCreate = () => {
    setEdit(null);
    setForm(blank);
    setFormError("");
    setOpen(true);
  };
  const openEdit = (a: IndividualAsset) => {
    setEdit(a);
    setForm({ name: a.name, category: a.category, value: String(a.value), institution: a.institution, asOf: a.asOf });
    setFormError("");
    setOpen(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, value: Number(form.value) };
    try {
      if (edit) {
        const a = await api.patch<IndividualAsset>(`/individual/assets/${edit.id}`, body);
        setData(assets.map((x) => (x.id === a.id ? a : x)));
      } else {
        const a = await api.post<IndividualAsset>("/individual/assets", body);
        setData([a, ...assets]);
      }
      setOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };
  const remove = async (a: IndividualAsset) => {
    if (!window.confirm(`Delete ${a.name}?`)) return;
    try {
      await api.del(`/individual/assets/${a.id}`);
      setData(assets.filter((x) => x.id !== a.id));
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="PERSONAL FINANCES"
        title="My Assets"
        description="A year-round register of assets and liabilities to support tax preparation."
        action={
          <Button onClick={openCreate}>
            <Plus size={16} /> Add record
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      {!open && <ErrorBox message={formError} />}
      <div className="stat-grid">
        {[
          ["Net worth", formatINRCompact(total - liabilities), `${assets.length} records`, WalletCards],
          ["Assets", formatINRCompact(total), "Declared values", TrendingUp],
          ["Liabilities", formatINRCompact(liabilities), "Loans and dues", Building2],
        ].map(([label, value, note, Icon]) => {
          const I = Icon as typeof Landmark;
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
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Register</h2>
            <p className="panel-subtitle">Values are self-declared; keep supporting statements in Documents.</p>
          </div>
        </div>
        <div className="table-wrap">
          {loading && !assets.length ? (
            <Spinner />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Category</th>
                  <th>Institution</th>
                  <th>As of</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="asset-empty">
                        <div className="asset-empty-icon">
                          <Landmark size={19} />
                        </div>
                        <strong>No records yet</strong>
                        <span>Add bank balances, investments, property or loans.</span>
                        <Button variant="secondary" onClick={openCreate}>
                          <Plus size={15} /> Add your first record
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  assets.map((a) => {
                    const Icon = ICONS[a.category] || WalletCards;
                    return (
                      <tr key={a.id}>
                        <td>
                          <div className="cell-main">
                            <Icon size={16} />
                            <strong>{a.name}</strong>
                          </div>
                        </td>
                        <td>{a.category}</td>
                        <td>{a.institution || "—"}</td>
                        <td>{formatDate(a.asOf)}</td>
                        <td>{a.category === "Liability" ? `−${formatINR(a.value)}` : formatINR(a.value)}</td>
                        <td>
                          <div className="table-actions">
                            <button className="icon-btn" onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`}>
                              <Pencil size={14} />
                            </button>
                            <button className="icon-btn danger" onClick={() => void remove(a)} aria-label={`Delete ${a.name}`}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Edit record" : "Add record"}>
        <form className="form-stack" onSubmit={save}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={120}
              placeholder="e.g. HDFC savings, Home loan"
            />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            {form.category === "Liability" ? "Outstanding amount (₹)" : "Value (₹)"}
            <input type="number" min={0} step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
          </label>
          <label>
            Institution / location
            <input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} maxLength={120} />
          </label>
          <label>
            Value as of
            <input type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} />
          </label>
          <ErrorBox message={formError} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
