// Voucher entry for every voucher type: ledger-entry mode (journal / payment / receipt / contra),
// invoice mode with automatic GST (sales / purchase / notes), inventory notes and stock journals.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, ErrorBox, Notice } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Amount, Field, LedgerSelect } from "./components";
import { useCompany } from "./context";
import { addAmounts, INVOICE_TYPES, Ledger, STATES, today, toPaise, typeLabel, VOUCHER_TYPES, VoucherDetail } from "./lib";

interface EntryRow {
  ledgerId: string;
  side: "Dr" | "Cr";
  amount: string;
  narration: string;
  billType: string;
  billRef: string;
  instrumentNo: string;
  cc: { costCentreId: string; amount: string }[];
}
interface ItemRow {
  stockItemId: string;
  ledgerId: string;
  description: string;
  hsnSac: string;
  qty: string;
  rate: string;
  amount: string;
  discount: string;
  gstRate: string;
  godownId: string;
  batchNo: string;
  expiryDate: string;
  serialNumbers: string;
}
interface StockItem {
  id: string;
  name: string;
  hsnSac: string;
  gstRate: string;
  standardSaleRate: string;
  trackBatches: boolean;
  trackExpiry: boolean;
  trackSerials: boolean;
}
interface Preview {
  total: string;
  placeOfSupply: string;
  isInterState: boolean;
  entries: { ledgerName: string; debit: string; credit: string }[];
  tds: { amount: string; rate: number } | null;
}

const blankEntry = (side: "Dr" | "Cr" = "Dr"): EntryRow => ({
  ledgerId: "",
  side,
  amount: "",
  narration: "",
  billType: "",
  billRef: "",
  instrumentNo: "",
  cc: [],
});
const blankItem = (): ItemRow => ({
  stockItemId: "",
  ledgerId: "",
  description: "",
  hsnSac: "",
  qty: "",
  rate: "",
  amount: "",
  discount: "",
  gstRate: "",
  godownId: "",
  batchNo: "",
  expiryDate: "",
  serialNumbers: "",
});

export default function VoucherForm({
  initialType = "Journal",
  existing,
  onSaved,
  onCancel,
}: {
  initialType?: string;
  existing?: VoucherDetail | null;
  onSaved: (v: VoucherDetail) => void;
  onCancel: () => void;
}) {
  const { capi, company } = useCompany();
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const items = useAsync(() => capi.get<StockItem[]>("/items"), [company.id]);
  const godowns = useAsync(() => capi.get<{ id: string; name: string }[]>("/warehouses"), [company.id]);
  const centres = useAsync(() => capi.get<{ id: string; name: string }[]>("/cost-centres"), [company.id]);
  const sections = useAsync(
    () => (company.tdsEnabled ? capi.get<{ id: string; kind: string; section: string; rate: string }[]>("/tds/sections") : Promise.resolve([])),
    [company.id],
  );
  const boms = useAsync(() => capi.get<{ id: string; name: string }[]>("/boms"), [company.id]);

  const [type, setType] = useState(existing?.type || initialType);
  const [date, setDate] = useState(existing?.date || today());
  const [referenceNo, setReferenceNo] = useState(existing?.referenceNo || "");
  const [narration, setNarration] = useState(existing?.narration || "");
  const [partyLedgerId, setParty] = useState(existing?.partyLedgerId || "");
  const [placeOfSupply, setPos] = useState(existing?.placeOfSupply || "");
  const [reverseCharge, setRcm] = useState(existing?.reverseCharge || false);
  const [originalInvoiceNo, setOrig] = useState(existing?.originalInvoiceNo || "");
  const [tdsSection, setTdsSection] = useState(existing?.tds?.sectionId || "");
  const [tdsBase, setTdsBase] = useState(existing?.tds?.base || "");
  const [saveAsDraft, setDraft] = useState(false);
  const [reason, setReason] = useState("");
  const [entries, setEntries] = useState<EntryRow[]>(
    existing && !INVOICE_TYPES.includes(existing.type) && existing.entries.length
      ? existing.entries.map((e) => ({
          ledgerId: e.ledgerId,
          side: Number(e.debit) > 0 ? "Dr" : "Cr",
          amount: Number(e.debit) > 0 ? e.debit : e.credit,
          narration: e.narration || "",
          billType: e.billType || "",
          billRef: e.billRef || "",
          instrumentNo: e.instrumentNo || "",
          cc: (e.costAllocations || []).map((c) => ({ costCentreId: c.costCentreId, amount: c.amount })),
        }))
      : [blankEntry("Dr"), blankEntry("Cr")],
  );
  const [lines, setLines] = useState<ItemRow[]>(
    existing?.items.length
      ? existing.items.map((i) => ({
          ...blankItem(),
          stockItemId: i.stockItemId || "",
          ledgerId: i.ledgerId || "",
          description: i.description,
          hsnSac: i.hsnSac,
          qty: Number(i.qty) ? i.qty : "",
          rate: Number(i.rate) ? i.rate : "",
          amount: Number(i.qty) ? "" : i.taxable,
          discount: Number(i.discount) ? i.discount : "",
          gstRate: i.gstRate,
          godownId: i.godownId || "",
          batchNo: i.batchNo || "",
        }))
      : [blankItem()],
  );
  const [stock, setStock] = useState({ mode: "Transfer", fromGodownId: "", toGodownId: "", bomId: "", outputQty: "", additionalCost: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggest, setSuggest] = useState<{ ledgerId: string; ledger: string; confidence: number }[]>([]);

  const invoice = INVOICE_TYPES.includes(type);
  const note = type === "DeliveryNote" || type === "ReceiptNote";
  const L = ledgers.data || [];
  const outward = type === "Sales" || type === "CreditNote";
  const lineLedgers = (l: Ledger) => l.kind === "General" && (l.nature === "Income" || l.nature === "Expenses" || l.nature === "Assets");

  useEffect(() => setPreview(null), [type, date, partyLedgerId, placeOfSupply, reverseCharge, lines, tdsSection, tdsBase]);

  const totals = useMemo(() => {
    const dr = addAmounts(entries.filter((e) => e.side === "Dr").map((e) => e.amount));
    const cr = addAmounts(entries.filter((e) => e.side === "Cr").map((e) => e.amount));
    return { dr, cr, diff: toPaise(dr) - toPaise(cr) };
  }, [entries]);

  const payload = () => {
    const base: Record<string, unknown> = { type, date, referenceNo, narration, saveAsDraft };
    if (invoice || note) {
      Object.assign(base, {
        partyLedgerId: partyLedgerId || undefined,
        placeOfSupply: placeOfSupply || undefined,
        reverseCharge: type === "Purchase" ? reverseCharge : false,
        originalInvoiceNo: (type === "CreditNote" || type === "DebitNote") && originalInvoiceNo ? originalInvoiceNo : "",
        items: lines
          .filter((l) => l.stockItemId || l.ledgerId || l.amount || l.qty)
          .map((l) => ({
            stockItemId: l.stockItemId || undefined,
            ledgerId: l.ledgerId || undefined,
            description: l.description,
            hsnSac: l.hsnSac,
            qty: l.qty || undefined,
            rate: l.rate || undefined,
            amount: !l.qty && l.amount ? l.amount : undefined,
            discount: l.discount || undefined,
            gstRate: l.gstRate === "" ? undefined : l.gstRate,
            godownId: l.godownId || undefined,
            batchNo: l.batchNo || undefined,
            expiryDate: l.expiryDate || undefined,
            serialNumbers: l.serialNumbers,
          })),
      });
      if (tdsSection) base.tds = { sectionId: tdsSection, base: tdsBase || undefined };
    } else if (type === "StockJournal") {
      base.stock =
        stock.mode === "Manufacture"
          ? {
              mode: "Manufacture",
              bomId: stock.bomId,
              outputQty: stock.outputQty,
              fromGodownId: stock.fromGodownId || undefined,
              toGodownId: stock.toGodownId || undefined,
              additionalCost: stock.additionalCost || undefined,
            }
          : {
              mode: stock.mode,
              fromGodownId: stock.fromGodownId || undefined,
              toGodownId: stock.toGodownId || undefined,
              lines: lines
                .filter((l) => l.stockItemId && l.qty)
                .map((l) => ({
                  stockItemId: l.stockItemId,
                  qty: l.qty,
                  rate: l.rate || undefined,
                  direction: stock.mode === "Adjustment" ? (l.description === "In" ? "In" : "Out") : undefined,
                  batchNo: l.batchNo || undefined,
                })),
            };
    } else {
      base.entries = entries
        .filter((e) => e.ledgerId && e.amount)
        .map((e) => ({
          ledgerId: e.ledgerId,
          [e.side === "Dr" ? "debit" : "credit"]: e.amount,
          narration: e.narration,
          billType: e.billType || undefined,
          billRef: e.billRef || undefined,
          instrumentNo: e.instrumentNo || undefined,
          instrumentType: e.instrumentNo ? "Cheque" : undefined,
          costAllocations: e.cc.filter((c) => c.costCentreId && c.amount),
        }));
      if (tdsSection) base.tds = { sectionId: tdsSection, base: tdsBase, partyLedgerId: partyLedgerId || undefined };
    }
    return base;
  };

  const runPreview = async () => {
    setErr("");
    try {
      setPreview(await capi.post<Preview>("/vouchers/preview", payload()));
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      const v = existing
        ? await capi.put<VoucherDetail>(`/vouchers/${existing.id}`, { ...payload(), reason })
        : await capi.post<VoucherDetail>("/vouchers", payload());
      onSaved(v);
    } catch (ex) {
      setErr(errorMessage(ex));
    } finally {
      setSaving(false);
    }
  };

  const askSuggest = async () => {
    try {
      const r = await api.post<{ suggestions: { ledgerId: string; ledger: string; confidence: number }[] }>(`${capi.base}/ai/suggest-ledger`, {
        narration,
        type,
      });
      setSuggest(r.suggestions);
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  const setEntry = (i: number, patch: Partial<EntryRow>) => setEntries((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setLine = (i: number, patch: Partial<ItemRow>) => setLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickItem = (i: number, id: string) => {
    const it = items.data?.find((x) => x.id === id);
    setLine(i, {
      stockItemId: id,
      description: it?.name || "",
      hsnSac: it?.hsnSac || "",
      gstRate: it ? it.gstRate : "",
      rate: outward && it && Number(it.standardSaleRate) ? it.standardSaleRate : "",
    });
  };
  const partyFilter = (l: Ledger) =>
    type === "Sales" || type === "CreditNote" || type === "DeliveryNote"
      ? l.kind === "Debtor" || l.kind === "Cash" || l.kind === "Bank"
      : l.kind === "Creditor" || l.kind === "Cash" || l.kind === "Bank";
  const tdsKind = type === "Sales" ? "TCS" : "TDS";

  return (
    <form className="voucher-form" onSubmit={submit}>
      <div className="form-grid four">
        <Field label="Voucher type">
          <select value={type} disabled={!!existing} onChange={(e) => setType(e.target.value)}>
            {VOUCHER_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={type === "Purchase" ? "Supplier invoice no." : "Reference no."}>
          <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
        </Field>
        {(invoice || note) && (
          <Field label={outward || type === "DeliveryNote" ? "Customer (party)" : "Supplier (party)"}>
            <LedgerSelect ledgers={L} value={partyLedgerId} onChange={setParty} filter={partyFilter} required />
          </Field>
        )}
        {invoice && company.gstEnabled && (
          <Field label="Place of supply">
            <select value={placeOfSupply} onChange={(e) => setPos(e.target.value)}>
              <option value="">Automatic</option>
              {Object.entries(STATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} – {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(type === "CreditNote" || type === "DebitNote") && (
          <Field label="Against invoice no.">
            <input value={originalInvoiceNo} onChange={(e) => setOrig(e.target.value)} />
          </Field>
        )}
        {type === "Purchase" && company.gstEnabled && (
          <label className="checkbox-label">
            <input type="checkbox" checked={reverseCharge} onChange={(e) => setRcm(e.target.checked)} /> Reverse charge
          </label>
        )}
      </div>

      {invoice || note || type === "StockJournal" ? (
        <>
          {type === "StockJournal" && (
            <div className="form-grid four">
              <Field label="Mode">
                <select value={stock.mode} onChange={(e) => setStock((s) => ({ ...s, mode: e.target.value }))}>
                  <option>Transfer</option>
                  <option>Manufacture</option>
                  <option>Adjustment</option>
                </select>
              </Field>
              <Field label="From godown">
                <select value={stock.fromGodownId} onChange={(e) => setStock((s) => ({ ...s, fromGodownId: e.target.value }))}>
                  <option value="">Default</option>
                  {(godowns.data || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To godown">
                <select value={stock.toGodownId} onChange={(e) => setStock((s) => ({ ...s, toGodownId: e.target.value }))}>
                  <option value="">Default</option>
                  {(godowns.data || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              {stock.mode === "Manufacture" && (
                <>
                  <Field label="Bill of materials">
                    <select value={stock.bomId} onChange={(e) => setStock((s) => ({ ...s, bomId: e.target.value }))}>
                      <option value="">Select BOM</option>
                      {(boms.data || []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity to produce">
                    <input inputMode="decimal" value={stock.outputQty} onChange={(e) => setStock((s) => ({ ...s, outputQty: e.target.value }))} />
                  </Field>
                  <Field label="Additional cost (₹)">
                    <input inputMode="decimal" value={stock.additionalCost} onChange={(e) => setStock((s) => ({ ...s, additionalCost: e.target.value }))} />
                  </Field>
                </>
              )}
            </div>
          )}
          {!(type === "StockJournal" && stock.mode === "Manufacture") && (
            <div className="table-panel acct-table line-table">
              <table>
                <thead>
                  <tr>
                    <th>Stock item</th>
                    {invoice && <th>Ledger</th>}
                    <th>Description{type === "StockJournal" && stock.mode === "Adjustment" ? " (In/Out)" : ""}</th>
                    {invoice && <th>HSN/SAC</th>}
                    <th>Qty</th>
                    <th>Rate</th>
                    {invoice && <th>Amount</th>}
                    {invoice && <th>Disc %</th>}
                    {invoice && company.gstEnabled && <th>GST %</th>}
                    <th>Godown / batch</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const it = items.data?.find((x) => x.id === l.stockItemId);
                    return (
                      <tr key={i}>
                        <td>
                          <select aria-label="Stock item" value={l.stockItemId} onChange={(e) => pickItem(i, e.target.value)}>
                            <option value="">{invoice ? "— service / non-stock —" : "Select item"}</option>
                            {(items.data || []).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        {invoice && (
                          <td>
                            <LedgerSelect
                              ledgers={L}
                              value={l.ledgerId}
                              onChange={(v) => setLine(i, { ledgerId: v })}
                              filter={lineLedgers}
                              placeholder="Default"
                            />
                          </td>
                        )}
                        <td>
                          <input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                        </td>
                        {invoice && (
                          <td>
                            <input aria-label="HSN/SAC" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} style={{ width: 80 }} />
                          </td>
                        )}
                        <td>
                          <input
                            aria-label="Quantity"
                            inputMode="decimal"
                            value={l.qty}
                            onChange={(e) => setLine(i, { qty: e.target.value })}
                            style={{ width: 70 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Rate"
                            inputMode="decimal"
                            value={l.rate}
                            onChange={(e) => setLine(i, { rate: e.target.value })}
                            style={{ width: 90 }}
                          />
                        </td>
                        {invoice && (
                          <td>
                            <input
                              aria-label="Amount"
                              inputMode="decimal"
                              disabled={!!l.qty}
                              value={l.amount}
                              onChange={(e) => setLine(i, { amount: e.target.value })}
                              style={{ width: 100 }}
                            />
                          </td>
                        )}
                        {invoice && (
                          <td>
                            <input
                              aria-label="Discount %"
                              inputMode="decimal"
                              value={l.discount}
                              onChange={(e) => setLine(i, { discount: e.target.value })}
                              style={{ width: 55 }}
                            />
                          </td>
                        )}
                        {invoice && company.gstEnabled && (
                          <td>
                            <input
                              aria-label="GST rate"
                              inputMode="decimal"
                              value={l.gstRate}
                              onChange={(e) => setLine(i, { gstRate: e.target.value })}
                              style={{ width: 55 }}
                            />
                          </td>
                        )}
                        <td>
                          {l.stockItemId && (
                            <div className="mini-stack">
                              <select aria-label="Godown" value={l.godownId} onChange={(e) => setLine(i, { godownId: e.target.value })}>
                                <option value="">Default godown</option>
                                {(godowns.data || []).map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                              {it?.trackBatches && <input placeholder="Batch" value={l.batchNo} onChange={(e) => setLine(i, { batchNo: e.target.value })} />}
                              {it?.trackExpiry && (
                                <input type="date" aria-label="Expiry" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} />
                              )}
                              {it?.trackSerials && (
                                <input
                                  placeholder="Serials, comma separated"
                                  value={l.serialNumbers}
                                  onChange={(e) => setLine(i, { serialNumbers: e.target.value })}
                                />
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-btn danger"
                            aria-label="Remove line"
                            onClick={() => setLines((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r))}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="pager">
                <button type="button" className="btn btn-secondary" onClick={() => setLines((r) => [...r, blankItem()])}>
                  <Plus size={14} /> Add line
                </button>
              </div>
            </div>
          )}
          {invoice && company.tdsEnabled && (type === "Purchase" || type === "Sales") && (
            <div className="form-grid four">
              <Field label={`${tdsKind} section`}>
                <select value={tdsSection} onChange={(e) => setTdsSection(e.target.value)}>
                  <option value="">None</option>
                  {(sections.data || [])
                    .filter((s) => s.kind === tdsKind)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.section} @ {s.rate}%
                      </option>
                    ))}
                </select>
              </Field>
              {tdsSection && (
                <Field label={`${tdsKind} base (blank = automatic)`}>
                  <input inputMode="decimal" value={tdsBase} onChange={(e) => setTdsBase(e.target.value)} />
                </Field>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="table-panel acct-table line-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Dr/Cr</th>
                <th>Ledger</th>
                <th>Amount</th>
                <th>Bill / cheque</th>
                <th>Cost centres</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const led = L.find((l) => l.id === e.ledgerId);
                return (
                  <tr key={i}>
                    <td>
                      <select aria-label="Debit or credit" value={e.side} onChange={(ev) => setEntry(i, { side: ev.target.value as "Dr" | "Cr" })}>
                        <option>Dr</option>
                        <option>Cr</option>
                      </select>
                    </td>
                    <td>
                      <LedgerSelect ledgers={L} value={e.ledgerId} onChange={(v) => setEntry(i, { ledgerId: v })} />
                    </td>
                    <td>
                      <input
                        aria-label="Amount"
                        inputMode="decimal"
                        value={e.amount}
                        onChange={(ev) => setEntry(i, { amount: ev.target.value })}
                        style={{ width: 120 }}
                      />
                    </td>
                    <td>
                      <div className="mini-stack">
                        {led?.billWise && (
                          <>
                            <select aria-label="Bill type" value={e.billType} onChange={(ev) => setEntry(i, { billType: ev.target.value })}>
                              <option value="">On account</option>
                              <option value="Against">Against ref</option>
                              <option value="New">New ref</option>
                              <option value="Advance">Advance</option>
                            </select>
                            {e.billType && e.billType !== "OnAccount" && (
                              <input placeholder="Bill ref" value={e.billRef} onChange={(ev) => setEntry(i, { billRef: ev.target.value })} />
                            )}
                          </>
                        )}
                        {(led?.kind === "Bank" || led?.kind === "Cash") && (
                          <input placeholder="Cheque / UTR no." value={e.instrumentNo} onChange={(ev) => setEntry(i, { instrumentNo: ev.target.value })} />
                        )}
                      </div>
                    </td>
                    <td>
                      {led?.costCentresApplicable && (
                        <div className="mini-stack">
                          {e.cc.map((c, k) => (
                            <div key={k} className="inline-pair">
                              <select
                                aria-label="Cost centre"
                                value={c.costCentreId}
                                onChange={(ev) => setEntry(i, { cc: e.cc.map((x, j) => (j === k ? { ...x, costCentreId: ev.target.value } : x)) })}
                              >
                                <option value="">Cost centre</option>
                                {(centres.data || []).map((cc) => (
                                  <option key={cc.id} value={cc.id}>
                                    {cc.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                aria-label="Allocation"
                                inputMode="decimal"
                                value={c.amount}
                                onChange={(ev) => setEntry(i, { cc: e.cc.map((x, j) => (j === k ? { ...x, amount: ev.target.value } : x)) })}
                                style={{ width: 90 }}
                              />
                            </div>
                          ))}
                          <button type="button" className="text-link" onClick={() => setEntry(i, { cc: [...e.cc, { costCentreId: "", amount: "" }] })}>
                            + allocate
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label="Remove entry"
                        onClick={() => setEntries((r) => (r.length > 2 ? r.filter((_, j) => j !== i) : r))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td colSpan={2}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEntries((r) => [...r, blankEntry(totals.diff > 0 ? "Cr" : "Dr")])}>
                    <Plus size={14} /> Add entry
                  </button>
                </td>
                <td colSpan={4}>
                  Dr <Amount value={totals.dr} /> · Cr <Amount value={totals.cr} />{" "}
                  {totals.diff !== 0 && Number.isFinite(totals.diff) && (
                    <span className="negative"> · Difference {(Math.abs(totals.diff) / 100).toFixed(2)}</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          {company.tdsEnabled && (type === "Journal" || type === "Payment") && (
            <div className="form-grid four" style={{ padding: 12 }}>
              <Field label="TDS section (optional)">
                <select value={tdsSection} onChange={(e) => setTdsSection(e.target.value)}>
                  <option value="">None</option>
                  {(sections.data || [])
                    .filter((s) => s.kind === "TDS")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.section} @ {s.rate}%
                      </option>
                    ))}
                </select>
              </Field>
              {tdsSection && (
                <>
                  <Field label="Deductee">
                    <LedgerSelect ledgers={L} value={partyLedgerId} onChange={setParty} filter={(l) => l.kind === "Creditor" || l.kind === "General"} />
                  </Field>
                  <Field label="TDS base amount">
                    <input inputMode="decimal" value={tdsBase} onChange={(e) => setTdsBase(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="form-grid">
        <Field label="Narration" full>
          <textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
        {!invoice && !note && type !== "StockJournal" && (
          <div className="full">
            <button type="button" className="text-link" onClick={askSuggest}>
              <Sparkles size={13} /> Suggest ledgers from narration
            </button>
            {suggest.length > 0 && (
              <span className="muted">
                {" "}
                AI suggestions (verify):{" "}
                {suggest.map((s) => (
                  <button
                    type="button"
                    key={s.ledgerId}
                    className="chip"
                    onClick={() => setEntries((rows) => rows.map((r, j) => (j === rows.findIndex((x) => !x.ledgerId) ? { ...r, ledgerId: s.ledgerId } : r)))}
                  >
                    {s.ledger} ({s.confidence}%)
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        {existing && existing.status === "Posted" && (
          <Field label="Reason for change (kept in the revision history)" full>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>

      {preview && (
        <Notice
          title={`Computed posting — total ₹${preview.total}${preview.placeOfSupply ? ` · POS ${preview.placeOfSupply} · ${preview.isInterState ? "IGST" : "CGST + SGST"}` : ""}`}
        >
          {preview.entries.map((e) => `${e.ledgerName}: ${Number(e.debit) ? `Dr ${e.debit}` : `Cr ${e.credit}`}`).join(" · ")}
          {preview.tds ? ` · TDS/TCS ₹${preview.tds.amount}` : ""}
        </Notice>
      )}
      <ErrorBox message={err || ledgers.error} />
      <div className="modal-actions">
        {!existing && (
          <label className="checkbox-label">
            <input type="checkbox" checked={saveAsDraft} onChange={(e) => setDraft(e.target.checked)} /> Save as draft
          </label>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {(invoice || type === "Journal" || type === "Payment") && (
          <Button variant="secondary" onClick={runPreview}>
            Preview posting
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Save voucher"}
        </Button>
      </div>
    </form>
  );
}
