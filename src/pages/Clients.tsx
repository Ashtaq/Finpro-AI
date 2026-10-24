import { FormEvent, useState } from "react";
import { Building2, Pencil, Plus, Search } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { currentFY } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Client } from "../types";

type Form = Partial<Client>;
const blank = (): Form => ({
  clientType: "Business",
  country: "India",
  priority: "Medium",
  communicationPreference: "Email",
  industry: "Other",
  status: "Onboarding",
  fy: currentFY().fy,
});
const EDITABLE: (keyof Client)[] = [
  "name",
  "company",
  "industry",
  "email",
  "phone",
  "alternatePhone",
  "clientType",
  "legalName",
  "contactPerson",
  "pan",
  "gstin",
  "cin",
  "address",
  "city",
  "state",
  "country",
  "pinCode",
  "professionActivity",
  "gstRegistrationType",
  "taxRegime",
  "priority",
  "communicationPreference",
  "notes",
  "fy",
  "status",
  "team",
];

export default function Clients() {
  const { data: rows = [], setData, error, loading, reload } = useAsync(() => api.get<Client[]>("/clients"));
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(blank());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Client, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const openCreate = () => {
    setEditing(null);
    setForm(blank());
    setFormError("");
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditing(c);
    setForm(c);
    setFormError("");
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    const payload = Object.fromEntries(EDITABLE.filter((k) => form[k] !== undefined).map((k) => [k, form[k]]));
    try {
      if (editing) {
        const updated = await api.patch<Client>(`/clients/${editing.id}`, payload);
        setData(rows.map((r) => (r.id === updated.id ? updated : r)));
      } else {
        const created = await api.post<Client>("/clients", payload);
        setData([created, ...rows]);
      }
      setOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter(
    (c) => (showArchived || c.status !== "Archived") && `${c.company} ${c.name} ${c.industry} ${c.pan} ${c.gstin}`.toLowerCase().includes(q.toLowerCase()),
  );
  const text = (key: keyof Client, label: string, opts: { full?: boolean; upper?: boolean; type?: string; required?: boolean } = {}) => (
    <label className={opts.full ? "full" : undefined}>
      {label}
      <input
        type={opts.type || "text"}
        required={opts.required}
        value={String(form[key] ?? "")}
        onChange={(e) => set(key, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </label>
  );
  const select = (key: keyof Client, label: string, options: string[]) => (
    <label>
      {label}
      <select value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || "Select"}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Clients"
        description="Client identity, tax registrations, projects and documents."
        action={
          <Button onClick={openCreate}>
            <Plus size={16} /> New client
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      <div className="toolbar">
        <div className="search-box light">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, PAN or GSTIN…" aria-label="Search clients" />
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      <div className="table-panel">
        {loading && !rows.length ? (
          <Spinner />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Industry</th>
                <th>PAN / GSTIN</th>
                <th>FY</th>
                <th>Status</th>
                <th>Projects</th>
                <th>Documents</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="table-primary">
                      <div className="table-avatar">
                        <Building2 size={15} />
                      </div>
                      <div>
                        <strong>{c.company}</strong>
                        <span>{[c.contactPerson || c.name, c.email].filter(Boolean).join(" · ")}</span>
                      </div>
                    </div>
                  </td>
                  <td>{c.industry}</td>
                  <td>
                    <span>{c.pan || "—"}</span>
                    <br />
                    <span>{c.gstin || "—"}</span>
                  </td>
                  <td>{c.fy || "—"}</td>
                  <td>
                    <Badge tone={c.status === "Active" ? "success" : c.status === "Onboarding" ? "warning" : "default"}>{c.status}</Badge>
                  </td>
                  <td>{c.projects}</td>
                  <td>{c.documents}</td>
                  <td>
                    <button className="icon-btn" onClick={() => openEdit(c)} aria-label={`Edit ${c.company}`}>
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !filtered.length && (
          <EmptyState
            title={rows.length ? "No matching clients" : "No clients yet"}
            description={rows.length ? "Try a different search." : "Add your first client to start a project."}
          />
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.company}` : "New client"}>
        <form className="form-grid" onSubmit={save}>
          {text("company", "Company / legal name", { required: true })}
          {text("contactPerson", "Contact person")}
          {select("clientType", "Client type", ["Individual", "Business", "Company", "LLP", "Trust", "Other"])}
          {select("industry", "Industry", ["Technology", "Manufacturing", "Retail", "Infrastructure", "Professional Services", "Healthcare", "Other"])}
          {text("email", "Email", { type: "email" })}
          {text("phone", "Phone", { type: "tel" })}
          {text("pan", "PAN", { upper: true })}
          {text("gstin", "GSTIN", { upper: true })}
          {text("cin", "CIN / LLPIN", { upper: true })}
          {select("gstRegistrationType", "GST registration", ["", "Regular", "Composition", "Unregistered", "Other"])}
          {select("taxRegime", "Tax regime", ["", "Old Regime", "New Regime", "Corporate", "Not Applicable"])}
          {text("fy", "Financial year")}
          {select("status", "Status", ["Onboarding", "Active", "Prospect", "Inactive", "Archived"])}
          {select("priority", "Priority", ["High", "Medium", "Low"])}
          {text("city", "City")}
          {text("state", "State")}
          <label className="full">
            Address
            <textarea value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
          </label>
          <label className="full">
            Notes
            <textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} />
          </label>
          {formError && (
            <div className="full">
              <ErrorBox message={formError} />
            </div>
          )}
          <div className="modal-actions full">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create client"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
