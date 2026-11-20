// Shared building blocks for the accounting workspace, built on the existing Finpro design system.
import { ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Badge, EmptyState } from "../components/ui";
import { download, Ledger, money, statusTone } from "./lib";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number;
  align?: "right";
  width?: number;
}

/** Sortable, paginated table with an optional text filter. */
export function DataTable<T>({
  columns,
  rows,
  pageSize = 25,
  empty = "Nothing here yet.",
  onRowClick,
  filter,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  pageSize?: number;
  empty?: string;
  onRowClick?: (row: T) => void;
  filter?: string;
  rowKey: (row: T) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const q = (filter || "").toLowerCase();
    let list = q
      ? rows.filter((r) =>
          columns.some((c) =>
            String(c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] ?? ""))
              .toLowerCase()
              .includes(q),
          ),
        )
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r: T) => (col?.value ? col.value(r) : ((r as Record<string, unknown>)[sort.key] as string | number));
      list = [...list].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const nx = typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x;
        const ny = typeof y === "string" && /^-?\d+(\.\d+)?$/.test(y) ? Number(y) : y;
        return (nx > ny ? 1 : nx < ny ? -1 : 0) * sort.dir;
      });
    }
    return list;
  }, [rows, columns, sort, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);
  if (!rows.length) return <EmptyState title="No records" description={empty} />;
  return (
    <div className="table-panel acct-table">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align, width: c.width, cursor: "pointer" }}
                onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? "clickable" : undefined}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <span>
            {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length}
          </span>
          <button className="btn btn-secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <button className="btn btn-secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export const Amount = ({ value, strong }: { value?: string | null; strong?: boolean }) => (
  <span className={`amount${value?.startsWith("-") ? " negative" : ""}`} style={strong ? { fontWeight: 700 } : undefined}>
    {money(value)}
  </span>
);

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={statusTone(status) as "success" | "warning" | "danger" | "default"}>{status.replace(/([a-z])([A-Z])/g, "$1 $2")}</Badge>
);

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="workspace-tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "workspace-tab active" : "workspace-tab"} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function LedgerSelect({
  ledgers,
  value,
  onChange,
  filter,
  placeholder = "Select ledger",
  required,
  label,
}: {
  ledgers: Ledger[];
  value: string;
  onChange: (id: string) => void;
  filter?: (l: Ledger) => boolean;
  placeholder?: string;
  required?: boolean;
  label?: string;
}) {
  const list = filter ? ledgers.filter(filter) : ledgers;
  return (
    <select aria-label={label || placeholder} required={required} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.groupName ? ` — ${l.groupName}` : ""}
        </option>
      ))}
    </select>
  );
}

export function ExportButtons({ url }: { url: (format: string) => string }) {
  return (
    <div className="page-actions">
      {["pdf", "xlsx", "csv"].map((f) => (
        <button key={f} className="btn btn-secondary" onClick={() => download(url(f))} title={`Export as ${f.toUpperCase()}`}>
          <Download size={14} /> {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export interface TreeNode {
  id: string | null;
  kind: string;
  name: string;
  depth: number;
  amount: string;
  children: TreeNode[];
}

/** Collapsible statement tree (groups → ledgers) with drill-down on ledgers. */
export function StatementTree({ nodes, onLedger, title, total }: { nodes: TreeNode[]; onLedger?: (id: string) => void; title: string; total?: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const rows: ReactNode[] = [];
  const walk = (list: TreeNode[], path: string) => {
    for (const n of list) {
      const k = `${path}/${n.name}`;
      const open = !closed.has(k);
      rows.push(
        <tr key={k} className={`tree-row depth-${Math.min(n.depth, 4)} kind-${n.kind}`}>
          <td style={{ paddingLeft: 12 + n.depth * 16 }}>
            {n.children.length > 0 ? (
              <button className="tree-toggle" onClick={() => toggle(k)} aria-label={open ? "Collapse" : "Expand"}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            {n.kind === "ledger" && n.id && onLedger ? (
              <button className="text-link" onClick={() => onLedger(n.id as string)}>
                {n.name}
              </button>
            ) : (
              <span style={{ fontWeight: n.kind === "group" && n.depth === 0 ? 700 : 500 }}>{n.name}</span>
            )}
          </td>
          <td style={{ textAlign: "right" }}>
            <Amount value={n.amount} strong={n.depth === 0} />
          </td>
        </tr>,
      );
      if (open && n.children.length) walk(n.children, k);
    }
  };
  walk(nodes, "");
  return (
    <div className="table-panel acct-table">
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            <th style={{ textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows}
          {total !== undefined && (
            <tr className="total-row">
              <td>Total</td>
              <td style={{ textAlign: "right" }}>
                <Amount value={total} strong />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children, full, hint }: { label: string; children: ReactNode; full?: boolean; hint?: string }) {
  return (
    <label className={full ? "full" : undefined}>
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="kv-grid">
      {items.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** Wide dialog for voucher entry and detail views. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
