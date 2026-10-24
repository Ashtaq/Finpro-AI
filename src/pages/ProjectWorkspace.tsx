import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, ArrowLeft, BarChart3, FileText, ListTodo, MessageSquareText } from "lucide-react";
import { DocumentTable, UploadButton } from "../components/documents";
import { Badge, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { DocumentRecord, Project, Task } from "../types";

interface Detail {
  project: Project;
  documents: DocumentRecord[];
  tasks: Task[];
  activity: { actor: string; action: string; resource: string; timestamp: string }[];
  conversations: number;
}

const TABS = [
  ["Overview", BarChart3],
  ["Documents", FileText],
  ["Tasks", ListTodo],
  ["Activity", Activity],
] as const;

export default function ProjectWorkspace() {
  const { projectId = "" } = useParams();
  const { data, setData, error, loading, reload } = useAsync(() => api.get<Detail>(`/projects/${projectId}`), [projectId]);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("Overview");
  const [actionError, setActionError] = useState("");

  if (loading && !data) return <Spinner />;
  if (!data)
    return (
      <>
        <ErrorBox message={error || "Project not found."} onRetry={reload} />
        <Link to="/projects" className="text-link">
          Back to projects
        </Link>
      </>
    );
  const { project: p, documents, tasks, activity } = data;
  const open = tasks.filter((t) => t.status !== "Completed").length;

  return (
    <>
      <div className="breadcrumb">
        <Link to="/projects">
          <ArrowLeft size={15} /> Projects
        </Link>
        <span>/</span>
        <span>{p.name}</span>
      </div>
      <PageHeader
        eyebrow={p.clientName || "INTERNAL PROJECT"}
        title={p.name}
        description={[p.type, p.fy, p.currency, p.startDate && p.endDate ? `${formatDate(p.startDate)} → ${formatDate(p.endDate)}` : ""]
          .filter(Boolean)
          .join(" · ")}
        action={
          <>
            <Link className="btn btn-secondary" to={`/ai-assistant?project=${p.id}`}>
              <MessageSquareText size={15} /> Ask AI
            </Link>
            <UploadButton projectId={p.id} onError={setActionError} onUploaded={(d) => setData({ ...data, documents: [d, ...documents] })} />
          </>
        }
      />
      <ErrorBox message={actionError} />
      <div className="workspace-tabs" role="tablist">
        {TABS.map(([t, Icon]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "workspace-tab active" : "workspace-tab"} onClick={() => setTab(t)}>
            <Icon size={15} />
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <div className="grid-3">
          <div className="panel span-2">
            <div className="panel-head">
              <div>
                <h2>Project pulse</h2>
                <p>Live counts for this engagement</p>
              </div>
              <Badge tone={p.status === "Active" ? "success" : "default"}>{p.status}</Badge>
            </div>
            <div className="analysis-cards">
              <div>
                <span>Documents</span>
                <strong>{documents.length}</strong>
              </div>
              <div>
                <span>Open tasks</span>
                <strong>{open}</strong>
              </div>
              <div>
                <span>AI conversations</span>
                <strong>{data.conversations}</strong>
              </div>
              <div>
                <span>Priority</span>
                <strong>{p.priority}</strong>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Project team</h2>
            </div>
            {p.team.length ? (
              p.team.map((name) => (
                <div className="list-row" key={name}>
                  <div>
                    <strong>{name}</strong>
                  </div>
                  <div className="avatar small">{name.slice(0, 1)}</div>
                </div>
              ))
            ) : (
              <p className="muted">No team members listed.</p>
            )}
          </div>
        </div>
      )}
      {tab === "Documents" && (
        <div className="table-panel">
          <DocumentTable
            rows={documents}
            showProject={false}
            onError={setActionError}
            onDeleted={(id) => setData({ ...data, documents: documents.filter((d) => d.id !== id) })}
          />
        </div>
      )}
      {tab === "Tasks" && (
        <div className="panel">
          <div className="panel-head">
            <h2>Project tasks</h2>
            <Link className="text-link" to="/tasks">
              Open board
            </Link>
          </div>
          {tasks.length ? (
            tasks.map((t) => (
              <div className="list-row" key={t.id}>
                <div>
                  <strong>{t.title}</strong>
                  <span>
                    {t.assignee} · {t.due ? `due ${formatDate(t.due)}` : "no due date"}
                  </span>
                </div>
                <Badge tone={t.status === "Completed" ? "success" : "default"}>{t.status}</Badge>
              </div>
            ))
          ) : (
            <EmptyState title="No tasks" description="Add tasks for this project from the task board." />
          )}
        </div>
      )}
      {tab === "Activity" && (
        <div className="panel">
          {activity.length ? (
            activity.map((a, i) => (
              <div className="list-row" key={i}>
                <div>
                  <strong>{a.action}</strong>
                  <span>
                    {a.actor} · {a.resource}
                  </span>
                </div>
                <span className="muted">{formatDateTime(a.timestamp)}</span>
              </div>
            ))
          ) : (
            <p className="muted">No activity recorded yet.</p>
          )}
        </div>
      )}
    </>
  );
}
