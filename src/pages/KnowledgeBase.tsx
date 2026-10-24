import { FormEvent, useState } from "react";
import { BookOpen, Plus, Search, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { KnowledgeItem } from "../types";

const KINDS: KnowledgeItem["kind"][] = ["SOP", "Template", "Policy", "Report", "Methodology"];

export default function KnowledgeBase() {
  const { data: rows = [], setData, error, loading, reload } = useAsync(() => api.get<KnowledgeItem[]>("/knowledge-base"));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<KnowledgeItem | null>(null);
  const [form, setForm] = useState({ title: "", kind: "SOP", body: "" });
  const [actionError, setActionError] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const item = await api.post<KnowledgeItem>("/knowledge-base", form);
      setData([item, ...rows]);
      setOpen(false);
      setForm({ title: "", kind: "SOP", body: "" });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const remove = async (k: KnowledgeItem) => {
    if (!window.confirm(`Delete "${k.title}"?`)) return;
    try {
      await api.del(`/knowledge-base/${k.id}`);
      setData(rows.filter((r) => r.id !== k.id));
      setView(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const filtered = rows.filter((k) => `${k.title} ${k.kind} ${k.body}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow="ORGANIZATION KNOWLEDGE"
        title="Knowledge Base"
        description="Internal SOPs, templates, policies and methodologies for your team."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> Add resource
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      <ErrorBox message={actionError} />
      <div className="toolbar">
        <div className="search-box light">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search knowledge…" aria-label="Search knowledge" />
        </div>
      </div>
      {loading && !rows.length ? (
        <Spinner />
      ) : filtered.length ? (
        <div className="knowledge-grid">
          {filtered.map((k) => (
            <button className="knowledge-card" key={k.id} onClick={() => setView(k)} style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}>
              <div className="knowledge-icon">
                <BookOpen size={18} />
              </div>
              <div>
                <Badge>{k.kind}</Badge>
                <h3>{k.title}</h3>
                <p>Owner: {k.owner}</p>
                <span>Updated {formatDate(k.updated)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState title={rows.length ? "No matches" : "No resources yet"} description="Add SOPs and templates your team relies on." />
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add resource">
        <form className="form-stack" onSubmit={create}>
          <label>
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Content
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} maxLength={20000} />
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title || ""}>
        <p className="muted">
          {view?.kind} · {view?.owner} · updated {formatDate(view?.updated)}
        </p>
        <div className="chat-content" style={{ fontSize: 13 }}>
          {view?.body || "No content."}
        </div>
        <div className="modal-actions">
          <Button variant="danger" onClick={() => view && void remove(view)}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button onClick={() => setView(null)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
