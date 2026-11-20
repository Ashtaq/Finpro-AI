import { FormEvent, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Button, ErrorBox, Notice, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { DataTable, Tabs } from "../components";
import { useCompany } from "../context";
import { useVoucherSheet, VoucherSheets } from "./Vouchers";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "ask" | "risks" | "explain" | "trail" | "extract";
const EXAMPLES = [
  "Show all transactions above ₹1 lakh for this client",
  "Identify duplicate purchase invoices",
  "Find ledger mismatches for this financial year",
  "Show all unreconciled bank transactions",
  "Generate a financial summary for this company",
  "Identify unusual expenses compared with previous months",
];

function ResultTable({ data, openVoucher }: { data: any; openVoucher: (id: string) => void }) {
  if (Array.isArray(data)) {
    if (!data.length) return <p className="muted">Nothing found.</p>;
    const keys = Object.keys(data[0]).filter((k) => !["id", "voucherId", "ledgerId", "vouchers"].includes(k) && typeof data[0][k] !== "object");
    return (
      <DataTable
        rowKey={(r: any) => r.id || JSON.stringify(r)}
        rows={data}
        onRowClick={(r: any) => (r.id && r.type ? openVoucher(r.id) : r.vouchers?.[0]?.id ? openVoucher(r.vouchers[0].id) : undefined)}
        columns={[
          ...keys.map((k) => ({ key: k, label: k.replace(/([A-Z])/g, " $1") })),
          ...(data[0].vouchers
            ? [{ key: "vouchers", label: "Vouchers", render: (r: any) => r.vouchers.map((v: any) => v.number || v.id.slice(0, 8)).join(", ") }]
            : []),
        ]}
      />
    );
  }
  if (data?.points)
    return (
      <ul className="explain-list">
        {data.points.map((p: string) => (
          <li key={p}>{p}</li>
        ))}
        {data.receivables && (
          <li>
            Receivables outstanding ₹{data.receivables}; payables ₹{data.payables}.
          </li>
        )}
      </ul>
    );
  if (data?.parties)
    return (
      <p>
        Outstanding ₹{data.total} across {data.parties.length} parties.
      </p>
    );
  if (data?.findings)
    return (
      <p>
        {data.findings.length} finding(s); risk level {data.riskLevel}.
      </p>
    );
  return <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>;
}

export default function Audit() {
  const { capi, company } = useCompany();
  const [tab, setTab] = useState<Tab>("ask");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [narrative, setNarrative] = useState(false);
  const [text, setText] = useState("");
  const [fields, setFields] = useState<any>(null);
  const risks = useAsync(() => (tab === "risks" ? capi.get<any>("/ai/anomalies") : Promise.resolve(null)), [tab, company.id]);
  const explain = useAsync(
    () => (tab === "explain" ? capi.get<any>(`/ai/explain${narrative ? "?narrative=1" : ""}`) : Promise.resolve(null)),
    [tab, narrative, company.id],
  );
  const trail = useAsync(() => (tab === "trail" ? capi.get<any>(`/audit-logs?page=${page}&pageSize=50`) : Promise.resolve(null)), [tab, page, company.id]);
  const sheet = useVoucherSheet();

  const ask = async (question: string, e?: FormEvent) => {
    e?.preventDefault();
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setErr("");
    try {
      setAnswer(await capi.post<any>("/ai/query", { question }));
    } catch (ex) {
      setErr(errorMessage(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tabs
        tabs={[
          ["ask", "Ask the books"],
          ["risks", "Audit risk indicators"],
          ["explain", "Statement explanation"],
          ["trail", "Audit trail"],
          ["extract", "Invoice data extraction"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err} />
      {tab === "ask" && (
        <>
          <form className="panel inline-form" onSubmit={(e) => ask(q, e)}>
            <Sparkles size={16} />
            <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this company's books…" aria-label="Question" />
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : "Ask"}
            </Button>
          </form>
          <div className="chip-row">
            {EXAMPLES.map((x) => (
              <button key={x} className="chip" onClick={() => ask(x)}>
                {x}
              </button>
            ))}
          </div>
          {answer && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{answer.title}</h2>
                  <p>{answer.disclaimer}</p>
                </div>
                {answer.model && <Badge tone="info">{answer.model}</Badge>}
              </div>
              {answer.answer ? <p className="chat-content">{answer.answer}</p> : <ResultTable data={answer.data} openVoucher={sheet.open} />}
              {answer.suggestions && (
                <div className="chip-row">
                  {answer.suggestions.map((s: string) => (
                    <button key={s} className="chip" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {tab === "risks" &&
        (risks.data ? (
          <>
            <div className="analysis-cards">
              <div>
                <span>Risk score</span>
                <strong>{risks.data.riskScore}/100</strong>
              </div>
              <div>
                <span>Level</span>
                <strong>{risks.data.riskLevel}</strong>
              </div>
              {["High", "Medium", "Low"].map((s) => (
                <div key={s}>
                  <span>{s} findings</span>
                  <strong>{risks.data.counts[s] || 0}</strong>
                </div>
              ))}
            </div>
            {risks.data.findings.map((f: any, i: number) => (
              <div key={i} className="list-row">
                <div>
                  <strong>
                    <Badge tone={f.severity === "High" ? "danger" : f.severity === "Medium" ? "warning" : "default"}>{f.severity}</Badge> {f.title}
                  </strong>
                  <span>{f.detail}</span>
                </div>
                {f.vouchers?.[0]?.id && (
                  <button className="text-link" onClick={() => sheet.open(f.vouchers[0].id)}>
                    Review
                  </button>
                )}
              </div>
            ))}
            <Notice title="Assistive only">{risks.data.disclaimer} AI-generated observations must be reviewed and concluded by the engagement team.</Notice>
          </>
        ) : (
          <Spinner />
        ))}
      {tab === "explain" &&
        (explain.data ? (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>
                  {explain.data.from} to {explain.data.to}
                </h2>
                <p>{explain.data.disclaimer}</p>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={narrative} onChange={(e) => setNarrative(e.target.checked)} /> Add AI narrative (if the AI service is
                configured)
              </label>
            </div>
            <ul className="explain-list">
              {explain.data.points.map((p: string) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {explain.data.narrative && (
              <Notice title={`AI narrative${explain.data.narrative.model ? ` · ${explain.data.narrative.model}` : ""}`}>
                <span style={{ whiteSpace: "pre-wrap" }}>{explain.data.narrative.content}</span>
              </Notice>
            )}
          </div>
        ) : (
          <Spinner />
        ))}
      {tab === "trail" && trail.data && (
        <>
          <DataTable
            rowKey={(r: any) => r.id}
            rows={trail.data.rows}
            pageSize={50}
            onRowClick={(r: any) => r.entityType === "Voucher" && r.entityId && sheet.open(r.entityId)}
            columns={[
              { key: "at", label: "When", render: (r: any) => formatDateTime(r.at) },
              { key: "actor", label: "User" },
              { key: "action", label: "Action" },
              { key: "entityType", label: "Record" },
              { key: "summary", label: "Details" },
            ]}
          />
          <div className="pager">
            <span>{trail.data.total} events · the audit trail is append-only and cannot be edited or deleted</span>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <button className="btn btn-secondary" disabled={page * 50 >= trail.data.total} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        </>
      )}
      {tab === "extract" && (
        <div className="grid-2">
          <div className="panel form-stack">
            <p className="muted">Paste text from a text-based invoice (or e-mail). Scanned images need an OCR provider, which is not configured.</p>
            <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} aria-label="Invoice text" />
            <Button
              onClick={async () => {
                setErr("");
                try {
                  setFields((await capi.post<any>("/ai/extract-invoice", { text })).fields);
                } catch (ex) {
                  setErr(errorMessage(ex));
                }
              }}
            >
              Extract fields
            </Button>
          </div>
          {fields && (
            <div className="panel">
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="list-row">
                  <div>
                    <strong>{k}</strong>
                  </div>
                  <span>{String(v) || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <VoucherSheets sheet={sheet} onChange={() => undefined} />
    </>
  );
}
