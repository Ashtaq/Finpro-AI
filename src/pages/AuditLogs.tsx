import { useState } from "react";
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { AuditLog } from "../types";

const PAGE = 100;

export default function AuditLogs() {
  const [action, setAction] = useState("");
  const {
    data: rows = [],
    setData,
    error,
    loading,
    reload,
  } = useAsync(() => api.get<AuditLog[]>(`/audit-logs?limit=${PAGE}${action ? `&action=${encodeURIComponent(action)}` : ""}`), [action]);
  const [more, setMore] = useState(true);
  const [moreError, setMoreError] = useState("");
  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    try {
      const next = await api.get<AuditLog[]>(
        `/audit-logs?limit=${PAGE}&before=${encodeURIComponent(last.timestamp)}${action ? `&action=${encodeURIComponent(action)}` : ""}`,
      );
      setData([...rows, ...next]);
      setMore(next.length === PAGE);
    } catch (err) {
      setMoreError(errorMessage(err));
    }
  };
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();

  return (
    <>
      <PageHeader
        eyebrow="CONTROL & AUDIT"
        title="Audit Logs"
        description="Sign-ins, uploads, downloads, AI requests and permission changes in your organization."
        action={
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All actions</option>
            {action && !actions.includes(action) && <option>{action}</option>}
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        }
      />
      <ErrorBox message={error || moreError} onRetry={reload} />
      <div className="table-panel">
        {loading && !rows.length ? (
          <Spinner />
        ) : rows.length ? (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.timestamp)}</td>
                  <td>
                    <strong>{a.actor}</strong>
                  </td>
                  <td>
                    <Badge tone="info">{a.action}</Badge>
                  </td>
                  <td>{a.resource}</td>
                  <td className="muted">{a.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No events" description="Activity will appear here as your team works." />
        )}
      </div>
      {rows.length >= PAGE && more && (
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" onClick={() => void loadMore()}>
            Load older events
          </Button>
        </div>
      )}
    </>
  );
}
