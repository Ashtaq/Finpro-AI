import { useState } from "react";
import { FileText, Paperclip, Printer } from "lucide-react";
import { Button, ErrorBox, Notice } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Amount, KeyValue, StatusBadge } from "./components";
import { useCompany } from "./context";
import { download, typeLabel, VoucherDetail } from "./lib";

export default function VoucherView({
  voucher,
  onChanged,
  onEdit,
}: {
  voucher: VoucherDetail;
  onChanged: (v: VoucherDetail | null) => void;
  onEdit: () => void;
}) {
  const { capi, can } = useCompany();
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [docId, setDocId] = useState("");
  const docs = useAsync(() => api.get<{ id: string; name: string }[]>("/documents"), []);
  const act = async (fn: () => Promise<VoucherDetail | null>) => {
    setErr("");
    try {
      onChanged(await fn());
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const ask = (q: string) => window.prompt(q)?.trim();
  const v = voucher;
  const editable = v.status !== "Cancelled" && can("write") && v.source !== "payroll" && v.eInvoice?.status !== "Generated";
  return (
    <div className="voucher-view">
      <KeyValue
        items={[
          ["Type", typeLabel(v.type)],
          ["Number", v.number || "Not yet numbered"],
          ["Date", v.date],
          ["Status", <StatusBadge key="s" status={v.status} />],
          ["Party", v.partyName || "—"],
          ["Reference", v.referenceNo || "—"],
          ["Total", <Amount key="t" value={v.total} />],
          ["Revision", String(v.revision)],
        ]}
      />
      {v.statusReason && <Notice title="Status note">{v.statusReason}</Notice>}
      {v.placeOfSupply && (
        <p className="muted">
          Place of supply {v.placeOfSupply} · {v.isInterState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST/UTGST)"}{" "}
          {v.reverseCharge ? "· Reverse charge" : ""} {v.gstInvoiceType ? `· ${v.gstInvoiceType}` : ""}
        </p>
      )}
      {v.items.length > 0 && (
        <div className="table-panel acct-table">
          <table>
            <thead>
              <tr>
                <th>Item / description</th>
                <th>HSN</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th style={{ textAlign: "right" }}>Taxable</th>
                <th style={{ textAlign: "right" }}>GST</th>
                <th style={{ textAlign: "right" }}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {v.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.itemName || i.description}
                    {i.batchNo ? ` · batch ${i.batchNo}` : ""}
                  </td>
                  <td>{i.hsnSac}</td>
                  <td style={{ textAlign: "right" }}>{Number(i.qty) ? i.qty : ""}</td>
                  <td style={{ textAlign: "right" }}>{Number(i.rate) ? <Amount value={i.rate} /> : ""}</td>
                  <td style={{ textAlign: "right" }}>
                    <Amount value={i.taxable} />
                  </td>
                  <td style={{ textAlign: "right" }}>{i.gstRate}%</td>
                  <td style={{ textAlign: "right" }}>
                    {Number(i.igst) ? `IGST ${i.igst}` : Number(i.cgst) ? `C ${i.cgst} / S ${i.sgst}` : "—"}
                    {Number(i.cess) ? ` · Cess ${i.cess}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.entries.length > 0 && (
        <div className="table-panel acct-table">
          <table>
            <thead>
              <tr>
                <th>Ledger</th>
                <th>Bill / instrument</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {v.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.ledgerName}
                    {e.costAllocations?.length ? <div className="muted">{e.costAllocations.map((c) => `${c.costCentre}: ${c.amount}`).join(", ")}</div> : null}
                  </td>
                  <td>
                    {[
                      e.billType && `${e.billType}${e.billRef ? ` ${e.billRef}` : ""}`,
                      e.instrumentNo && `Chq ${e.instrumentNo}`,
                      e.bankDate && `cleared ${e.bankDate}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td style={{ textAlign: "right" }}>{Number(e.debit) ? <Amount value={e.debit} /> : ""}</td>
                  <td style={{ textAlign: "right" }}>{Number(e.credit) ? <Amount value={e.credit} /> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.tds && (
        <p className="muted">
          {v.tds.kind} u/s {v.tds.section} @ {v.tds.rate}% on ₹{v.tds.base} = ₹{v.tds.amount}
        </p>
      )}
      {v.narration && <p>{v.narration}</p>}
      {v.eInvoice && (
        <Notice title={`E-invoice: ${v.eInvoice.status}`}>
          {v.eInvoice.irn
            ? `IRN ${v.eInvoice.irn} · Ack ${v.eInvoice.ackNo} (${v.eInvoice.ackDate})`
            : "Payload prepared — upload on the IRP and record the IRN in GST › E-invoices."}
        </Notice>
      )}
      {(v.approvals.length > 0 || v.revisions.length > 0) && (
        <div className="history">
          {v.approvals.map((a, i) => (
            <div key={`a${i}`} className="muted">
              {formatDateTime(a.at)} · {a.action} by {a.actor}
              {a.comment ? ` — ${a.comment}` : ""}
            </div>
          ))}
          {v.revisions.map((r) => (
            <div key={`r${r.revision}`} className="muted">
              {formatDateTime(r.at)} · revision {r.revision} saved{r.reason ? ` — ${r.reason}` : ""}
            </div>
          ))}
        </div>
      )}
      {v.attachments.length > 0 && (
        <p className="muted">
          <Paperclip size={12} /> {v.attachments.map((a) => a.name).join(", ")}
        </p>
      )}
      <ErrorBox message={err} />
      <div className="modal-actions wrap">
        <Button variant="secondary" onClick={() => window.open(capi.url(`/vouchers/${v.id}/print`), "_blank", "noopener")}>
          <Printer size={14} /> Print
        </Button>
        <Button variant="secondary" onClick={() => download(capi.url(`/vouchers/${v.id}/print?format=pdf`))}>
          <FileText size={14} /> PDF
        </Button>
        {editable && <Button onClick={onEdit}>Edit</Button>}
        {v.status === "PendingApproval" && can("approve") && (
          <>
            <Button onClick={() => act(() => capi.post<VoucherDetail>(`/vouchers/${v.id}/approve`, { comment: note }))}>Approve</Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = ask("Reason for rejection");
                if (c) void act(() => capi.post<VoucherDetail>(`/vouchers/${v.id}/reject`, { comment: c }));
              }}
            >
              Reject
            </Button>
          </>
        )}
        {(v.status === "Draft" || v.status === "Rejected") && can("write") && (
          <Button
            variant="danger"
            onClick={() =>
              act(async () => {
                await capi.del(`/vouchers/${v.id}`);
                return null;
              })
            }
          >
            Delete draft
          </Button>
        )}
        {v.status === "Posted" && can("approve") && v.source !== "payroll" && (
          <Button
            variant="danger"
            onClick={() => {
              const r = ask("Reason for cancelling this voucher");
              if (r) void act(() => capi.post<VoucherDetail>(`/vouchers/${v.id}/cancel`, { reason: r }));
            }}
          >
            Cancel voucher
          </Button>
        )}
      </div>
      {v.status === "PendingApproval" && can("approve") && (
        <input className="approval-note" placeholder="Approval comment (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      {can("write") && (
        <div className="inline-form">
          <select aria-label="Attach document" value={docId} onChange={(e) => setDocId(e.target.value)}>
            <option value="">Attach a workspace document…</option>
            {(docs.data || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!docId}
            onClick={() => act(() => capi.post<VoucherDetail>(`/vouchers/${v.id}/attachments`, { documentId: docId }))}
          >
            Attach
          </Button>
        </div>
      )}
    </div>
  );
}
