import { useState } from "react";
import { Search } from "lucide-react";
import { DocumentTable, UploadButton } from "../components/documents";
import { ErrorBox, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { DocumentRecord, Project } from "../types";

const INDIVIDUAL_CATEGORIES = ["Form 16", "Form 26AS / AIS", "Bank statement", "Investment statement", "Rent / HRA", "Insurance", "Capital gains", "Other"];
const WORKSPACE_CATEGORIES = ["General", "Financial statements", "Ledger", "Tax", "Audit", "Contract", "Report", "Other"];

export default function Documents() {
  const { user } = useAuth();
  const individual = user?.role === "Individual";
  const { data, setData, error, loading, reload } = useAsync(async () => {
    const [docs, projects] = await Promise.all([api.get<DocumentRecord[]>("/documents"), individual ? Promise.resolve([]) : api.get<Project[]>("/projects")]);
    return { docs, projects };
  });
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState("");
  const categories = individual ? INDIVIDUAL_CATEGORIES : WORKSPACE_CATEGORIES;
  const [category, setCategory] = useState(categories[0]);
  const [actionError, setActionError] = useState("");

  const docs = (data?.docs ?? []).filter((d) => `${d.name} ${d.category} ${d.projectName}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader
        eyebrow={individual ? "TAX DOCUMENTS" : "DOCUMENT INTELLIGENCE"}
        title="Documents"
        description="Files are stored privately in your workspace and only downloadable by its members."
      />
      <ErrorBox message={error} onRetry={reload} />
      <ErrorBox message={actionError} />
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="inline-form">
          {!individual && (
            <label>
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {data?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <UploadButton
            projectId={projectId || null}
            category={category}
            onError={setActionError}
            onUploaded={(d) => setData((cur) => cur && { ...cur, docs: [d, ...cur.docs] })}
          />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          PDF, Excel, CSV, Word, text, JSON and images. Maximum size is set by your administrator.
        </p>
      </div>
      <div className="toolbar">
        <div className="search-box light">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" aria-label="Search documents" />
        </div>
      </div>
      <div className="table-panel">
        {loading && !data ? (
          <Spinner />
        ) : (
          <DocumentTable
            rows={docs}
            showProject={!individual}
            onError={setActionError}
            onDeleted={(id) => setData((cur) => cur && { ...cur, docs: cur.docs.filter((d) => d.id !== id) })}
          />
        )}
      </div>
    </>
  );
}
