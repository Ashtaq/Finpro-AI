import { FormEvent, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button, ErrorBox, Modal, Spinner, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, Field, LedgerSelect, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { fyStart, Ledger, money, today, typeLabel, VoucherSummary } from "../lib";
import { useVoucherSheet, VoucherSheets } from "./Vouchers";

type Tab = "sales" | "purchase" | "orders" | "receivables" | "payables";
interface Order {
  id: string;
  orderType: string;
  orderNumber: string;
  date: string;
  party: string;
  dueDate: string;
  status: string;
  total: string;
  lines: { itemId: string; description: string; qty: string; rate: string; fulfilled: string }[];
}
interface Outstanding {
  total: string;
  ageing: Record<string, string>;
  parties: {
    ledgerId: string;
    party: string;
    total: string;
    creditLimit: string | null;
    bills: { ref: string; date: string; dueDate: string; overdueDays: number; pending: string }[];
  }[];
}

export default function SalesPurchase() {
  const { capi, company, can } = useCompany();
  const [tab, setTab] = useState<Tab>("sales");
  const sheet = useVoucherSheet();
  const from = fyStart(today(), company.fyStartMonth);
  const docs = useAsync(
    () =>
      tab === "sales" || tab === "purchase"
        ? Promise.all(
            (tab === "sales" ? ["Sales", "CreditNote", "DeliveryNote"] : ["Purchase", "DebitNote", "ReceiptNote"]).map((t) =>
              capi.get<{ rows: VoucherSummary[] }>(`/vouchers?type=${t}&from=${from}&pageSize=200`).then((r) => r.rows),
            ),
          ).then((x) => x.flat().sort((a, b) => b.date.localeCompare(a.date)))
        : Promise.resolve([] as VoucherSummary[]),
    [tab, company.id],
  );
  const orders = useAsync(() => (tab === "orders" ? capi.get<Order[]>("/orders") : Promise.resolve([] as Order[])), [tab, company.id]);
  const out = useAsync(
    () => (tab === "receivables" || tab === "payables" ? capi.get<Outstanding>(`/reports/${tab}`) : Promise.resolve(null)),
    [tab, company.id],
  );
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const items = useAsync(() => capi.get<{ id: string; name: string; standardSaleRate: string }[]>("/items"), [company.id]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [order, setOrder] = useState({
    orderType: "SalesOrder",
    orderNumber: "",
    date: today(),
    partyLedgerId: "",
    dueDate: "",
    lines: [{ itemId: "", qty: "", rate: "" }],
  });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const saveOrder = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await capi.post("/orders", { ...order, lines: order.lines.filter((l) => l.itemId && l.qty) });
      setOrderOpen(false);
      await orders.reload();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const reminder = (p: Outstanding["parties"][number]) => {
    const overdue = p.bills.filter((b) => b.overdueDays > 0);
    const text = `Dear ${p.party},\n\nThis is a gentle reminder that ${money(p.total)} is outstanding on your account with ${company.legalName || company.name}.${
      overdue.length
        ? `\n\nOverdue bills:\n${overdue.map((b) => `• ${b.ref} dated ${b.date} — ${money(b.pending)} (${b.overdueDays} days overdue)`).join("\n")}`
        : ""
    }\n\nKindly arrange payment at the earliest. Please ignore this note if already paid.\n\nRegards,\n${company.legalName || company.name}`;
    void navigator.clipboard?.writeText(text).then(
      () => setMsg(`Reminder for ${p.party} copied to the clipboard.`),
      () => setMsg(text),
    );
  };

  return (
    <>
      <Tabs
        tabs={[
          ["sales", "Sales"],
          ["purchase", "Purchases"],
          ["orders", "Orders"],
          ["receivables", "Receivables"],
          ["payables", "Payables"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err || docs.error || orders.error || out.error} />
      <SuccessBox message={msg} />
      {(tab === "sales" || tab === "purchase") && (
        <>
          {can("write") && (
            <div className="page-actions" style={{ marginBottom: 12 }}>
              {(tab === "sales" ? ["Sales", "CreditNote", "DeliveryNote"] : ["Purchase", "DebitNote", "ReceiptNote"]).map((t) => (
                <Button key={t} variant={t === "Sales" || t === "Purchase" ? "primary" : "secondary"} onClick={() => sheet.create(t)}>
                  <Plus size={14} /> {typeLabel(t)}
                </Button>
              ))}
            </div>
          )}
          {docs.loading && !docs.data ? (
            <Spinner />
          ) : (
            <DataTable
              rowKey={(r) => r.id}
              rows={docs.data || []}
              onRowClick={(r) => sheet.open(r.id)}
              empty={`No ${tab} documents this financial year.`}
              columns={[
                { key: "date", label: "Date" },
                { key: "type", label: "Type", render: (r) => typeLabel(r.type) },
                { key: "number", label: "Number", render: (r) => r.number || "—" },
                { key: "referenceNo", label: "Reference" },
                { key: "partyName", label: "Party" },
                { key: "total", label: "Amount", align: "right", render: (r) => <Amount value={r.total} /> },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </>
      )}
      {tab === "orders" && (
        <>
          {can("write") && (
            <div className="page-actions" style={{ marginBottom: 12 }}>
              <Button onClick={() => setOrderOpen(true)}>
                <Plus size={14} /> New order
              </Button>
            </div>
          )}
          <DataTable
            rowKey={(o) => o.id}
            rows={orders.data || []}
            empty="Sales and purchase orders track quantities until delivery notes or invoices fulfil them."
            columns={[
              { key: "date", label: "Date" },
              { key: "orderType", label: "Type", render: (o) => (o.orderType === "SalesOrder" ? "Sales order" : "Purchase order") },
              { key: "orderNumber", label: "Number" },
              { key: "party", label: "Party" },
              { key: "lines", label: "Fulfilled", render: (o) => o.lines.map((l) => `${l.fulfilled}/${l.qty}`).join(", ") },
              { key: "total", label: "Value", align: "right", render: (o) => <Amount value={o.total} /> },
              { key: "status", label: "Status", render: (o) => <StatusBadge status={o.status} /> },
            ]}
          />
        </>
      )}
      {(tab === "receivables" || tab === "payables") &&
        (out.loading && !out.data ? (
          <Spinner />
        ) : out.data ? (
          <>
            <div className="analysis-cards">
              {Object.entries(out.data.ageing).map(([k, v]) => (
                <div key={k}>
                  <span>{k === "Not due" ? k : `${k} days`}</span>
                  <strong>{money(v)}</strong>
                </div>
              ))}
            </div>
            <DataTable
              rowKey={(p) => p.ledgerId}
              rows={out.data.parties}
              columns={[
                { key: "party", label: "Party" },
                { key: "bills", label: "Open bills", render: (p) => p.bills.length },
                { key: "overdue", label: "Oldest overdue", render: (p) => `${Math.max(0, ...p.bills.map((b) => b.overdueDays))} days` },
                { key: "creditLimit", label: "Credit limit", align: "right", render: (p) => (p.creditLimit ? <Amount value={p.creditLimit} /> : "—") },
                { key: "total", label: "Outstanding", align: "right", render: (p) => <Amount value={p.total} /> },
                {
                  key: "remind",
                  label: "",
                  render: (p) =>
                    tab === "receivables" ? (
                      <button className="text-link" onClick={() => reminder(p)}>
                        <Copy size={12} /> Reminder
                      </button>
                    ) : null,
                },
              ]}
            />
            <p className="muted">Total ₹{out.data.total}</p>
          </>
        ) : null)}

      <Modal open={orderOpen} title="New order" onClose={() => setOrderOpen(false)}>
        <form className="form-grid" onSubmit={saveOrder}>
          <Field label="Type">
            <select value={order.orderType} onChange={(e) => setOrder((o) => ({ ...o, orderType: e.target.value }))}>
              <option value="SalesOrder">Sales order</option>
              <option value="PurchaseOrder">Purchase order</option>
            </select>
          </Field>
          <Field label="Order number">
            <input required value={order.orderNumber} onChange={(e) => setOrder((o) => ({ ...o, orderNumber: e.target.value }))} />
          </Field>
          <Field label="Date">
            <input type="date" value={order.date} onChange={(e) => setOrder((o) => ({ ...o, date: e.target.value }))} />
          </Field>
          <Field label="Due date">
            <input type="date" value={order.dueDate} onChange={(e) => setOrder((o) => ({ ...o, dueDate: e.target.value }))} />
          </Field>
          <Field label="Party" full>
            <LedgerSelect
              ledgers={ledgers.data || []}
              value={order.partyLedgerId}
              onChange={(v) => setOrder((o) => ({ ...o, partyLedgerId: v }))}
              filter={(l) => l.kind === "Debtor" || l.kind === "Creditor"}
              required
            />
          </Field>
          {order.lines.map((l, i) => (
            <div key={i} className="full inline-form">
              <select
                aria-label="Item"
                value={l.itemId}
                onChange={(e) => setOrder((o) => ({ ...o, lines: o.lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)) }))}
              >
                <option value="">Item</option>
                {(items.data || []).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Qty"
                value={l.qty}
                onChange={(e) => setOrder((o) => ({ ...o, lines: o.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) }))}
              />
              <input
                placeholder="Rate"
                value={l.rate}
                onChange={(e) => setOrder((o) => ({ ...o, lines: o.lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) }))}
              />
              <button
                type="button"
                className="icon-btn danger"
                aria-label="Remove"
                onClick={() => setOrder((o) => ({ ...o, lines: o.lines.filter((_, j) => j !== i) }))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="full">
            <button type="button" className="text-link" onClick={() => setOrder((o) => ({ ...o, lines: [...o.lines, { itemId: "", qty: "", rate: "" }] }))}>
              + Add line
            </button>
          </div>
          <div className="full">
            <ErrorBox message={err} />
          </div>
          <div className="modal-actions full">
            <Button type="submit">Save order</Button>
          </div>
        </form>
      </Modal>
      <VoucherSheets sheet={sheet} onChange={() => void docs.reload()} />
    </>
  );
}
