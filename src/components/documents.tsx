import { ChangeEvent, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Trash2, UploadCloud } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { DocumentRecord } from "../types";
import { Badge, EmptyState } from "./ui";

export const ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx,.txt,.json,.png,.jpg,.jpeg";

export async function uploadDocument(file: File, opts: { projectId?: string | null; category?: string } = {}) {
  const form = new FormData();
  form.append("file", file);
  if (opts.projectId) form.append("projectId", opts.projectId);
  if (opts.category) form.append("category", opts.category);
  return api.post<DocumentRecord>("/documents", form);
}

export function UploadButton({
  projectId,
  category,
  onUploaded,
  onError,
  label = "Upload file",
  variant = "primary",
}: {
  projectId?: string | null;
  category?: string;
  onUploaded: (doc: DocumentRecord) => void;
  onError: (message: string) => void;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const { meta } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const change = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    onError("");
    try {
      for (const file of files) {
        if (meta && file.size > meta.maxUploadBytes) throw new Error(`${file.name} is larger than ${formatBytes(meta.maxUploadBytes)}.`);
        onUploaded(await uploadDocument(file, { projectId, category }));
      }
    } catch (err) {
      onError(errorMessage(err, "Upload failed."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`btn btn-${variant}`} type="button" onClick={() => input.current?.click()} disabled={busy}>
        <UploadCloud size={16} /> {busy ? "Uploading…" : label}
      </button>
      <input ref={input} type="file" hidden multiple accept={ACCEPT} onChange={change} />
    </>
  );
}

export function DocumentTable({
  rows,
  onDeleted,
  onError,
  showProject = true,
}: {
  rows: DocumentRecord[];
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
  showProject?: boolean;
}) {
  const remove = async (d: DocumentRecord) => {
    if (!window.confirm(`Delete ${d.name}? This cannot be undone.`)) return;
    try {
      await api.del(`/documents/${d.id}`);
      onDeleted(d.id);
    } catch (err) {
      onError(errorMessage(err));
    }
  };
  if (!rows.length) return <EmptyState title="No documents" description="Upload statements, Form 16, ledgers, spreadsheets or reports." />;
  return (
    <table>
      <thead>
        <tr>
          <th>File</th>
          {showProject && <th>Project</th>}
          <th>Category</th>
          <th>Size</th>
          <th>Uploaded</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <td>
              <div className="table-primary">
                <div className="table-avatar">{["XLSX", "XLS", "CSV"].includes(d.type) ? <FileSpreadsheet size={15} /> : <FileText size={15} />}</div>
                <div>
                  <strong>{d.name}</strong>
                  <span>
                    {d.type} · {d.uploadedBy}
                  </span>
                </div>
              </div>
            </td>
            {showProject && <td>{d.projectName || "—"}</td>}
            <td>
              <Badge>{d.category}</Badge>
            </td>
            <td>{formatBytes(d.sizeBytes)}</td>
            <td>{formatDate(d.uploadedAt)}</td>
            <td>
              <div className="table-actions">
                <a className="icon-btn" href={api.url(`/documents/${d.id}/download`)} aria-label={`Download ${d.name}`}>
                  <Download size={15} />
                </a>
                <button className="icon-btn danger" onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
