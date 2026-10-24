import { FormEvent, useState } from "react";
import { CalendarDays, CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Client, ComplianceItem } from "../types";

const CATS: ComplianceItem["category"][] = ["Tax", "Audit", "Filing", "Deliverable", "Internal"];
const tone = (s: ComplianceItem["status"]) => (s === "Overdue" ? "danger" : s === "Due Soon" ? "warning" : s === "Completed" ? "success" : "info");

export default function Compliance() {
  const { data, setData, error, loading, reload } = useAsync(async () => {
    const [items, clients] = await Promise.all([api.get<ComplianceItem[]>("/compliance"), api.get<Client[]>("/clients")]);
    return { items, clients };
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", clientId: "", category: "Tax", dueDate: "" });
  const [actionError, setActionError] = useState("");
  const items = data?.items ?? [];
  const setItems = (next: ComplianceItem[]) => setData((cur) => cur && { ...cur, items: next });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const item = await api.post<ComplianceItem>("/compliance", { ...form, clientId: form.clientId || null });
      setItems([...items, item].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      setOpen(false);
      setForm({ title: "", clientId: "", category: "Tax", dueDate: "" });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const toggle = async (c: ComplianceItem) => {
    try {
      const updated = await api.patch<ComplianceItem>(`/compliance/${c.id}`, { completed: c.status !== "Completed" });
      setItems(items.map((x) => (x.id === c.id ? { ...updated, client: c.client } : x)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const remove = async (c: ComplianceItem) => {
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    try {
      await api.del(`/compliance/${c.id}`);
      setItems(items.filter((x) => x.id !== c.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const count = (s: ComplianceItem["status"]) => items.filter((c) => c.status === s).length;
  return (
    <>
      <PageHeader
        eyebrow="DEADLINE MANAGEMENT"
        title="Compliance Calendar"
        description="Track tax, audit, filing and client deadlines. Confirm statutory due dates against official notifications."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> Add deadline
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      <ErrorBox message={actionError} />
      <div className="calendar-summary">
        <div>
          <span>Overdue</span>
          <strong>{count("Overdue")}</strong>
        </div>
        <div>
          <span>Due in 7 days</span>
          <strong>{count("Due Soon")}</strong>
        </div>
        <div>
          <span>Upcoming</span>
          <strong>{count("Upcoming")}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{count("Completed")}</strong>
        </div>
      </div>
      <div className="table-panel">
        {loading && !data ? (
          <Spinner />
        ) : items.length ? (
          <table>
            <thead>
              <tr>
                <th>Deadline</th>
                <th>Client</th>
                <th>Category</th>
                <th>Due date</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="table-primary">
                      <div className="table-avatar">
                        <CalendarDays size={15} />
                      </div>
                      <strong>{c.title}</strong>
                    </div>
                  </td>
                  <td>{c.client || "—"}</td>
                  <td>{c.category}</td>
                  <td>{formatDate(c.dueDate)}</td>
                  <td>
                    <Badge tone={tone(c.status)}>{c.status}</Badge>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="icon-btn" onClick={() => void toggle(c)} aria-label={c.status === "Completed" ? "Reopen" : "Mark complete"}>
                        {c.status === "Completed" ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
                      </button>
                      <button className="icon-btn danger" onClick={() => void remove(c)} aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No deadlines" description="Add filing, audit and client deliverable dates to track them here." />
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add deadline">
        <form className="form-stack" onSubmit={create}>
          <label>
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Client
            <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Internal</option>
              {data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add deadline</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
