import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, FolderKanban, Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { currentFY, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Client, Project } from "../types";

const TYPES = ["Financial Analysis", "Tax Analysis", "Audit", "Accounting", "Valuation", "Due Diligence", "Advisory", "Other"];

export default function Projects() {
  const { user } = useAuth();
  const pro = user?.role === "Professional User";
  const { data, setData, error, loading, reload } = useAsync(async () => {
    const [projects, clients] = await Promise.all([api.get<Project[]>("/projects"), pro ? api.get<Client[]>("/clients") : Promise.resolve([])]);
    return { projects, clients: clients.filter((c) => c.status !== "Archived") };
  });
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    clientId: "",
    type: "Financial Analysis",
    fy: currentFY().fy,
    priority: "Medium",
    startDate: "",
    endDate: "",
    tags: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const p = await api.post<Project>("/projects", {
        ...form,
        clientId: form.clientId || null,
        tags: form.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      setData({ ...data!, projects: [p, ...data!.projects] });
      setOpen(false);
      setForm((f) => ({ ...f, name: "", tags: "" }));
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const projects = data?.projects ?? [];
  return (
    <>
      <PageHeader
        eyebrow="WORK MANAGEMENT"
        title="Projects"
        description="Keep documents, tasks and AI conversations organized by engagement."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((p) => (
            <Link to={`/projects/${p.id}`} className="project-card" key={p.id}>
              <div className="project-top">
                <div className="project-icon">
                  <FolderKanban size={20} />
                </div>
                <Badge tone={p.status === "Active" ? "success" : p.status === "Under Review" ? "warning" : "default"}>{p.status}</Badge>
              </div>
              <h3>{p.name}</h3>
              <p>{p.clientName || "Internal"}</p>
              <div className="project-meta">
                <span>{p.type}</span>
                {p.fy && <span>{p.fy}</span>}
                {p.endDate && <span>Due {formatDate(p.endDate)}</span>}
              </div>
              <div className="tag-row">
                {p.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="project-footer">
                <span>Priority: {p.priority}</span>
                <ArrowUpRight size={16} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title="No projects yet"
            description="Projects keep a client's documents, tasks and AI conversations together."
            action={<Button onClick={() => setOpen(true)}>Create project</Button>}
          />
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <form className="form-grid" onSubmit={create}>
          <label>
            Project name
            <input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={160} />
          </label>
          {pro && (
            <label>
              Client
              <select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                <option value="">No client (internal)</option>
                {data?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Type
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Financial year
            <input value={form.fy} onChange={(e) => set("fy", e.target.value)} />
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </label>
          <label>
            Due date
            <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </label>
          <label className="full">
            Tags
            <input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="Tax, Annual, Ratios" />
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
              {saving ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
