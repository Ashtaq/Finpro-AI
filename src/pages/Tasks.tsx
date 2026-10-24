import { DragEvent, FormEvent, useState } from "react";
import { CheckCircle2, Clock3, GripVertical, Plus, Trash2 } from "lucide-react";
import { Badge, Button, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Project, Task, TaskStatus, User } from "../types";

const COLS: TaskStatus[] = ["To Do", "In Progress", "Review", "Completed"];

export default function Tasks() {
  const { user } = useAuth();
  const pro = user?.role === "Professional User";
  const { data, setData, error, loading, reload } = useAsync(async () => {
    const [tasks, projects, users] = await Promise.all([
      api.get<Task[]>("/tasks"),
      api.get<Project[]>("/projects"),
      pro ? api.get<User[]>("/users") : Promise.resolve([]),
    ]);
    return { tasks, projects, users };
  });
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [actionError, setActionError] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", projectId: "", assigneeId: "", priority: "Medium", due: "", status: "To Do" as TaskStatus });
  const tasks = data?.tasks ?? [];
  const setTasks = (next: Task[]) => setData((cur) => cur && { ...cur, tasks: next });

  const move = async (id: string, status: TaskStatus) => {
    const previous = tasks;
    setTasks(tasks.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.patch<Task>(`/tasks/${id}`, { status });
      setActionError("");
    } catch (err) {
      setTasks(previous);
      setActionError(errorMessage(err));
    }
  };
  const remove = async (t: Task) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try {
      await api.del(`/tasks/${t.id}`);
      setTasks(tasks.filter((x) => x.id !== t.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const t = await api.post<Task>("/tasks", { ...form, projectId: form.projectId || null, assigneeId: form.assigneeId || null });
      setTasks([...tasks, t]);
      setOpen(false);
      setForm((f) => ({ ...f, title: "", due: "" }));
      setActionError("");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, status: TaskStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/task-id");
    if (id) void move(id, status);
    setDragOver(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Tasks"
        description="Drag cards between columns or use the move buttons."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> New task
          </Button>
        }
      />
      <ErrorBox message={error} onRetry={reload} />
      <ErrorBox message={actionError} />
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="task-board">
          {COLS.map((status) => (
            <div
              key={status}
              className={dragOver === status ? "task-col drag-over" : "task-col"}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, status)}
            >
              <div className="task-col-head">
                <div>
                  <strong>{status}</strong>
                  <span>{tasks.filter((t) => t.status === status).length} tasks</span>
                </div>
              </div>
              {tasks
                .filter((t) => t.status === status)
                .map((t) => (
                  <div key={t.id} className="task-card" draggable onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}>
                    <div className="task-card-top">
                      <div className="drag-handle">
                        <GripVertical size={14} />
                        <Badge tone={t.priority === "High" ? "danger" : t.priority === "Medium" ? "warning" : "default"}>{t.priority}</Badge>
                      </div>
                      <button className="icon-btn" onClick={() => void remove(t)} aria-label={`Delete ${t.title}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <h3>{t.title}</h3>
                    <p>{t.project || "No project"}</p>
                    <div className="task-meta">
                      <span>{t.assignee}</span>
                      {t.due && (
                        <span>
                          <Clock3 size={13} /> {formatDate(t.due)}
                        </span>
                      )}
                    </div>
                    {status === "Completed" ? (
                      <div className="completed">
                        <CheckCircle2 size={14} /> Completed
                      </div>
                    ) : (
                      <div className="task-next">
                        {COLS.filter((c) => c !== status).map((next) => (
                          <button key={next} onClick={() => void move(t.id, next)}>
                            → {next}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New task">
        <form className="form-stack" onSubmit={create}>
          <label>
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Project
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">No project</option>
              {data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {pro && (
            <label>
              Assignee
              <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Me</option>
                {data?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create task"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
