import { Printer } from "lucide-react";
import { Button, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatDate, formatDateTime, formatINR } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { ComplianceItem, IndividualAsset, ItrReturn, Project, Task } from "../types";

function WorkspaceReport() {
  const { user } = useAuth();
  const pro = user?.role === "Professional User";
  const { data, error, loading, reload } = useAsync(async () => {
    const [projects, tasks, compliance] = await Promise.all([
      api.get<Project[]>("/projects"),
      api.get<Task[]>("/tasks"),
      pro ? api.get<ComplianceItem[]>("/compliance") : Promise.resolve([] as ComplianceItem[]),
    ]);
    return { projects, tasks, compliance };
  });
  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;
  const open = data.tasks.filter((t) => t.status !== "Completed");
  return (
    <>
      <h2>Projects ({data.projects.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Type</th>
            <th>Status</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {data.projects.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.clientName || "—"}</td>
              <td>{p.type}</td>
              <td>{p.status}</td>
              <td>{formatDate(p.endDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Open tasks ({open.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Project</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {open.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.project || "—"}</td>
              <td>{t.assignee}</td>
              <td>{t.priority}</td>
              <td>{formatDate(t.due)}</td>
              <td>{t.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pro && (
        <>
          <h2>Compliance deadlines</h2>
          <table>
            <thead>
              <tr>
                <th>Deadline</th>
                <th>Client</th>
                <th>Category</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.compliance
                .filter((c) => c.status !== "Completed")
                .map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.client || "—"}</td>
                    <td>{c.category}</td>
                    <td>{formatDate(c.dueDate)}</td>
                    <td>{c.status}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function PersonalReport() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [assets, returns] = await Promise.all([api.get<IndividualAsset[]>("/individual/assets"), api.get<ItrReturn[]>("/individual/itr")]);
    return { assets, returns };
  });
  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;
  const liab = data.assets.filter((a) => a.category === "Liability").reduce((s, a) => s + a.value, 0);
  const total = data.assets.filter((a) => a.category !== "Liability").reduce((s, a) => s + a.value, 0);
  return (
    <>
      <h2>Assets & liabilities</h2>
      <table>
        <thead>
          <tr>
            <th>Record</th>
            <th>Category</th>
            <th>Institution</th>
            <th>As of</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.assets.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.category}</td>
              <td>{a.institution || "—"}</td>
              <td>{formatDate(a.asOf)}</td>
              <td>{a.category === "Liability" ? `−${formatINR(a.value)}` : formatINR(a.value)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <strong>Net worth</strong>
            </td>
            <td>
              <strong>{formatINR(total - liab)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <h2>Income-tax returns</h2>
      <table>
        <thead>
          <tr>
            <th>Assessment year</th>
            <th>Form</th>
            <th>Status</th>
            <th>Gross total income</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {data.returns.map((r) => (
            <tr key={r.id}>
              <td>{r.assessmentYear}</td>
              <td>{r.itrType}</td>
              <td>{r.status.replace(/_/g, " ")}</td>
              <td>{r.validation?.totals ? formatINR(r.validation.totals.grossTotalIncome) : "Not checked"}</td>
              <td>{formatDateTime(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const individual = user?.role === "Individual";
  return (
    <>
      <PageHeader
        eyebrow="REPORTING"
        title={individual ? "Personal Summary" : "Workspace Report"}
        description="A live summary of your data. Print or save it as PDF from your browser."
        action={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={15} /> Print / Save PDF
          </Button>
        }
      />
      <div className="report-sheet">
        <div className="eyebrow">{user?.organizationName}</div>
        <h1 style={{ margin: "4px 0 2px", fontFamily: "Space Grotesk" }}>{individual ? "Personal finance summary" : "Workspace status report"}</h1>
        <p className="muted">
          Prepared for {user?.name} on {formatDateTime(new Date().toISOString())}
        </p>
        {individual ? <PersonalReport /> : <WorkspaceReport />}
        <p className="muted" style={{ marginTop: 24 }}>
          Generated from data recorded in Finpro AI. Verify against source documents before relying on it.
        </p>
      </div>
    </>
  );
}
