import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Button, ErrorBox, Spinner, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, Sheet, StatusBadge } from "../components";
import { useCompany } from "../context";
import { fyStart, today, typeLabel, VOUCHER_TYPES, VoucherDetail, VoucherSummary } from "../lib";
import VoucherForm from "../VoucherForm";
import VoucherView from "../VoucherView";

export function useVoucherSheet() {
  const { capi } = useCompany();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<VoucherDetail | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new" | null>(null);
  const [newType, setNewType] = useState("Journal");
  const [err, setErr] = useState("");
  const openId = params.get("open");
  useEffect(() => {
    if (!openId) return;
    capi
      .get<VoucherDetail>(`/vouchers/${openId}`)
      .then((v) => {
        setView(v);
        setMode("view");
      })
      .catch((e) => setErr(errorMessage(e)));
  }, [openId, capi]);
  const open = async (id: string) => {
    setErr("");
    try {
      setView(await capi.get<VoucherDetail>(`/vouchers/${id}`));
      setMode("view");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const close = () => {
    setMode(null);
    if (openId) {
      params.delete("open");
      setParams(params, { replace: true });
    }
  };
  const create = (type: string) => {
    setNewType(type);
    setView(null);
    setMode("new");
  };
  return { view, setView, mode, setMode, open, close, create, newType, err };
}

export function VoucherSheets({ sheet, onChange }: { sheet: ReturnType<typeof useVoucherSheet>; onChange: () => void }) {
  const { view, mode, setMode, setView, close, newType } = sheet;
  return (
    <>
      <Sheet
        open={mode === "new" || mode === "edit"}
        title={mode === "edit" && view ? `Edit ${typeLabel(view.type)} ${view.number || ""}` : "New voucher"}
        onClose={close}
      >
        <VoucherForm
          initialType={newType}
          existing={mode === "edit" ? view : null}
          onCancel={() => (mode === "edit" ? setMode("view") : close())}
          onSaved={(v) => {
            setView(v);
            setMode("view");
            onChange();
          }}
        />
      </Sheet>
      <Sheet open={mode === "view" && !!view} title={view ? `${typeLabel(view.type)} ${view.number || "(unnumbered)"}` : ""} onClose={close}>
        {view && (
          <>
            {view.warnings?.length ? <SuccessBox message={view.warnings.join(" ")} /> : null}
            <VoucherView
              voucher={view}
              onEdit={() => setMode("edit")}
              onChanged={(v) => {
                if (v) setView(v);
                else close();
                onChange();
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}

export default function Vouchers() {
  const { capi, company, can } = useCompany();
  const [filters, setFilters] = useState({ type: "", status: "", from: fyStart(today(), company.fyStartMonth), to: today(), search: "" });
  const [page, setPage] = useState(1);
  const [runMsg, setRunMsg] = useState("");
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: String(page), pageSize: "100" }).toString();
  const list = useAsync(() => capi.get<{ rows: VoucherSummary[]; total: number; page: number; pageSize: number }>(`/vouchers?${qs}`), [qs, company.id]);
  const pending = useAsync(() => capi.get<VoucherSummary[]>("/vouchers/pending-approval"), [company.id]);
  const sheet = useVoucherSheet();
  const set = (k: string, v: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  const runRecurring = async () => {
    try {
      const r = await capi.post<{ created: unknown[]; errors: { name: string; error: string }[] }>("/recurring/run", {});
      setRunMsg(
        `${r.created.length} recurring voucher(s) created.${r.errors.length ? ` Errors: ${r.errors.map((e) => `${e.name}: ${e.error}`).join("; ")}` : ""}`,
      );
      await list.reload();
    } catch (e) {
      setRunMsg(errorMessage(e));
    }
  };
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <>
      <div className="toolbar">
        <div className="filter-row">
          <select aria-label="Voucher type" value={filters.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">All types</option>
            {[...VOUCHER_TYPES, "Payroll"].map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
          <select aria-label="Status" value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">All statuses</option>
            {["Posted", "PendingApproval", "Draft", "Rejected", "Cancelled"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/([a-z])([A-Z])/g, "$1 $2")}
              </option>
            ))}
          </select>
          <input type="date" aria-label="From" value={filters.from} onChange={(e) => set("from", e.target.value)} />
          <input type="date" aria-label="To" value={filters.to} onChange={(e) => set("to", e.target.value)} />
          <div className="search-box light">
            <Search size={15} />
            <input
              placeholder="Number, party, narration…"
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              aria-label="Search vouchers"
            />
          </div>
        </div>
        {can("write") && (
          <div className="page-actions">
            <Button variant="secondary" onClick={runRecurring}>
              <RefreshCw size={14} /> Run recurring
            </Button>
            {["Sales", "Purchase", "Receipt", "Payment", "Journal"].map((t) => (
              <Button key={t} variant={t === "Journal" ? "primary" : "secondary"} onClick={() => sheet.create(t)}>
                <Plus size={14} /> {t}
              </Button>
            ))}
          </div>
        )}
      </div>
      <SuccessBox message={runMsg} />
      <ErrorBox message={list.error || sheet.err} onRetry={list.reload} />
      {pending.data && pending.data.length > 0 && can("approve") && (
        <div className="notice notice-warning">
          <div>
            <strong>{pending.data.length} voucher(s) awaiting your approval</strong>
            <span>
              {pending.data.slice(0, 5).map((p) => (
                <button key={p.id} className="text-link" onClick={() => sheet.open(p.id)}>
                  {typeLabel(p.type)} {p.date} ₹{p.total}
                </button>
              ))}
            </span>
          </div>
        </div>
      )}
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        <>
          <DataTable
            rowKey={(r) => r.id}
            rows={list.data?.rows || []}
            pageSize={100}
            empty="No vouchers in this period. Use the buttons above to record one."
            onRowClick={(r) => sheet.open(r.id)}
            columns={[
              { key: "date", label: "Date" },
              { key: "type", label: "Type", render: (r) => typeLabel(r.type) },
              { key: "number", label: "Number", render: (r) => r.number || "—" },
              { key: "partyName", label: "Party" },
              { key: "narration", label: "Narration", render: (r) => <span className="truncate">{r.narration}</span> },
              { key: "total", label: "Amount", align: "right", render: (r) => <Amount value={r.total} /> },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
          {list.data && list.data.total > list.data.pageSize && (
            <div className="pager">
              <span>
                Page {page} of {totalPages} · {list.data.total} vouchers
              </span>
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
      <VoucherSheets sheet={sheet} onChange={() => void list.reload()} />
    </>
  );
}
