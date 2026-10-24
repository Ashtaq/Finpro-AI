import { Link } from "react-router-dom";
import { Activity, BrainCircuit, CalendarDays, FileText, FolderOpen, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, EmptyState, ErrorBox, MetricCard, Notice, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatDate, monthLabel } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { DashboardData } from "../types";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get<DashboardData>("/dashboard"));
  const pro = user?.role === "Professional User";
  const m = data?.metrics;

  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title={`${greeting()}, ${user?.name.split(" ")[0]}.`}
        description="Projects, documents, AI activity and upcoming work for your workspace."
      />
      <ErrorBox message={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : m ? (
        <>
          <div className="metric-grid">
            {pro && <MetricCard label="Clients" value={m.clients} icon={<Users size={18} />} />}
            <MetricCard label="Active projects" value={m.activeProjects} icon={<FolderOpen size={18} />} />
            <MetricCard label="Documents" value={m.documents} icon={<FileText size={18} />} />
            <MetricCard label="AI analyses" value={m.aiAnalyses} icon={<BrainCircuit size={18} />} />
            <MetricCard
              label="Open tasks"
              value={m.pendingTasks}
              icon={<Activity size={18} />}
              delta={m.highPriorityTasks ? `${m.highPriorityTasks} high priority` : undefined}
            />
            {pro && (
              <MetricCard
                label="Deadlines"
                value={m.upcomingDeadlines}
                icon={<CalendarDays size={18} />}
                delta={m.overdueDeadlines ? `${m.overdueDeadlines} overdue` : "none overdue"}
              />
            )}
          </div>
          <div className="grid-2">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Workspace activity</h2>
                  <p>Audited events over the last six months</p>
                </div>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data!.activity.map((p) => ({ month: monthLabel(p.month), value: p.value }))}>
                    <CartesianGrid vertical={false} stroke="#edf1f6" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" name="Events" fill="rgba(55,132,255,.15)" stroke="#3784ff" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Upcoming work</h2>
                <Link className="text-link" to="/tasks">
                  All tasks
                </Link>
              </div>
              {data!.upcomingTasks.length ? (
                data!.upcomingTasks.map((t) => (
                  <div className="list-row" key={t.id}>
                    <div>
                      <strong>{t.title}</strong>
                      <span>
                        {t.assignee} · {t.due ? `due ${formatDate(t.due)}` : "no due date"}
                      </span>
                    </div>
                    <Badge tone={t.priority === "High" ? "danger" : t.priority === "Medium" ? "warning" : "default"}>{t.priority}</Badge>
                  </div>
                ))
              ) : (
                <p className="muted">No open tasks.</p>
              )}
            </div>
          </div>
          <div className={pro ? "grid-2" : ""}>
            <div className="panel">
              <div className="panel-head">
                <h2>Recent projects</h2>
                <Link className="text-link" to="/projects">
                  All projects
                </Link>
              </div>
              {data!.recentProjects.length ? (
                data!.recentProjects.map((p) => (
                  <Link to={`/projects/${p.id}`} className="list-row" key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <span>{p.clientName || p.type}</span>
                    </div>
                    <Badge tone={p.status === "Active" ? "success" : "warning"}>{p.status}</Badge>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No projects yet"
                  description="Create a project to organize documents, tasks and AI conversations."
                  action={
                    <Link className="btn btn-primary" to="/projects">
                      Create project
                    </Link>
                  }
                />
              )}
            </div>
            {pro && (
              <div className="panel">
                <div className="panel-head">
                  <h2>Recent clients</h2>
                  <Link className="text-link" to="/clients">
                    All clients
                  </Link>
                </div>
                {data!.recentClients.length ? (
                  data!.recentClients.map((c) => (
                    <div className="list-row" key={c.id}>
                      <div>
                        <strong>{c.company}</strong>
                        <span>{c.industry}</span>
                      </div>
                      <Badge>{c.status}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="muted">No clients yet.</p>
                )}
              </div>
            )}
          </div>
          <Notice title="Professional review required">
            AI output is assistive. Validate calculations, assumptions, sources and regulatory interpretations before client delivery or decisions.
          </Notice>
        </>
      ) : null}
    </>
  );
}
