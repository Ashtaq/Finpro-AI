import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, ErrorBox, Modal, Notice, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, ExportButtons, Field, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { today } from "../lib";
import { useVoucherSheet, VoucherSheets } from "./Vouchers";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "summary" | "items" | "movements" | "batches" | "boms" | "godowns";

const blankItem = {
  name: "",
  sku: "",
  unitId: "",
  hsnSac: "",
  gstRate: "",
  valuationMethod: "WeightedAverage",
  reorderLevel: "",
  openingQty: "",
  openingRate: "",
  standardSaleRate: "",
  trackBatches: false,
  trackExpiry: false,
  trackSerials: false,
};

export default function Inventory() {
  const { capi, company, can } = useCompany();
  const [tab, setTab] = useState<Tab>("summary");
  const [to, setTo] = useState(today());
  const summary = useAsync(() => capi.get<any>(`/stock/summary?to=${to}`), [to, company.id]);
  const units = useAsync(() => capi.get<{ id: string; symbol: string }[]>("/units"), [company.id]);
  const godowns = useAsync(() => capi.get<any[]>("/warehouses"), [company.id]);
  const items = useAsync(() => capi.get<any[]>("/items"), [company.id]);
  const movements = useAsync(() => (tab === "movements" ? capi.get<any>(`/stock/movements?to=${to}`) : Promise.resolve(null)), [tab, to, company.id]);
  const batches = useAsync(() => (tab === "batches" ? capi.get<any>(`/stock/batches?to=${to}`) : Promise.resolve(null)), [tab, to, company.id]);
  const boms = useAsync(() => (tab === "boms" ? capi.get<any[]>("/boms") : Promise.resolve([])), [tab, company.id]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string | boolean>>(blankItem);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [gName, setGName] = useState("");
  const [unit, setUnit] = useState({ symbol: "", name: "", uqc: "NOS" });
  const [bom, setBom] = useState({ name: "", itemId: "", outputQty: "1", components: [{ itemId: "", qty: "" }] });
  const sheet = useVoucherSheet();

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => unknown) => {
    setErr("");
    try {
      await fn();
      setMsg(ok);
      await after?.();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const saveItem = (e: FormEvent) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
    void run(
      () => capi.post("/items", body),
      "Item created.",
      async () => {
        setOpen(false);
        setF(blankItem);
        await Promise.all([items.reload(), summary.reload()]);
      },
    );
  };

  return (
    <>
      <div className="toolbar">
        <Tabs
          tabs={[
            ["summary", "Stock summary"],
            ["items", "Stock items"],
            ["movements", "Movements"],
            ["batches", "Batches & expiry"],
            ["boms", "Bills of materials"],
            ["godowns", "Godowns & units"],
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="page-actions">
          <input type="date" aria-label="As at" value={to} onChange={(e) => setTo(e.target.value)} />
          {can("write") && (
            <>
              <Button variant="secondary" onClick={() => sheet.create("StockJournal")}>
                Stock journal
              </Button>
              <Button onClick={() => setOpen(true)}>
                <Plus size={14} /> New item
              </Button>
            </>
          )}
        </div>
      </div>
      {!company.inventoryEnabled && (
        <Notice title="Inventory is tracked but not integrated">
          Closing stock in the financial statements comes from manual closing-stock entries. Turn on “Integrate inventory” in Settings to value closing stock
          from these items.
        </Notice>
      )}
      <ErrorBox message={err || summary.error} />
      <SuccessBox message={msg} />

      {tab === "summary" && summary.data && (
        <>
          <DataTable
            rowKey={(r: any) => r.itemId}
            rows={summary.data.rows}
            empty="Add stock items to start tracking quantities and values."
            columns={[
              {
                key: "item",
                label: "Item",
                render: (r: any) => (
                  <span>
                    {r.item} {r.lowStock && <Badge tone="warning">Reorder</Badge>}
                  </span>
                ),
              },
              { key: "quantity", label: "Quantity", align: "right", render: (r: any) => `${r.quantity} ${r.unit}` },
              { key: "rate", label: "Rate", align: "right", render: (r: any) => <Amount value={r.rate} /> },
              { key: "value", label: "Value", align: "right", render: (r: any) => <Amount value={r.value} /> },
              { key: "valuationMethod", label: "Method", render: (r: any) => (r.valuationMethod === "FIFO" ? "FIFO" : "Wtd. avg") },
              { key: "outwardQty", label: "Out this FY", align: "right" },
              { key: "godowns", label: "Godowns", render: (r: any) => r.godowns.map((g: any) => `${g.warehouse}: ${g.quantity}`).join(" · ") },
            ]}
          />
          <p className="muted">
            Closing stock value as at {summary.data.to}: <Amount value={summary.data.totalValue} />
          </p>
          <ExportButtons url={(fmt) => capi.url(`/reports/stock-summary?to=${to}&format=${fmt}`)} />
        </>
      )}
      {tab === "items" && (
        <DataTable
          rowKey={(r: any) => r.id}
          rows={items.data || []}
          columns={[
            { key: "name", label: "Item" },
            { key: "sku", label: "SKU" },
            { key: "hsnSac", label: "HSN" },
            { key: "gstRate", label: "GST %", align: "right" },
            { key: "unit", label: "Unit" },
            { key: "openingQty", label: "Opening", align: "right" },
            {
              key: "flags",
              label: "Tracking",
              render: (r: any) => [r.trackBatches && "Batch", r.trackExpiry && "Expiry", r.trackSerials && "Serial"].filter(Boolean).join(", ") || "—",
            },
          ]}
        />
      )}
      {tab === "movements" && (
        <DataTable
          rowKey={(r: any) => `${r.date}${r.itemId}${r.voucherId}${r.type}${r.inward}${r.outward}`}
          rows={movements.data?.rows || []}
          onRowClick={(r: any) => r.voucherId && sheet.open(r.voucherId)}
          columns={[
            { key: "date", label: "Date" },
            { key: "item", label: "Item" },
            { key: "warehouse", label: "Godown" },
            { key: "voucher", label: "Voucher" },
            { key: "type", label: "Movement" },
            { key: "inward", label: "In", align: "right" },
            { key: "outward", label: "Out", align: "right" },
            { key: "value", label: "Inward value", align: "right", render: (r: any) => (r.value ? <Amount value={r.value} /> : "") },
          ]}
        />
      )}
      {tab === "batches" && (
        <DataTable
          rowKey={(r: any) => r.batchId}
          rows={batches.data?.rows || []}
          empty="No batch-tracked stock on hand."
          columns={[
            { key: "item", label: "Item" },
            { key: "batchNo", label: "Batch" },
            { key: "mfgDate", label: "Mfg" },
            { key: "expiryDate", label: "Expiry" },
            { key: "quantity", label: "Qty", align: "right" },
            {
              key: "status",
              label: "Status",
              render: (r: any) => <StatusBadge status={r.status === "Expired" ? "Cancelled" : r.status === "Expiring soon" ? "Draft" : "Posted"} />,
            },
          ]}
        />
      )}
      {tab === "boms" && (
        <div className="grid-2">
          <DataTable
            rowKey={(r: any) => r.id}
            rows={boms.data || []}
            empty="Define bills of materials to manufacture finished goods through stock journals."
            columns={[
              { key: "name", label: "BOM" },
              { key: "item", label: "Produces" },
              { key: "outputQty", label: "Output qty", align: "right" },
              {
                key: "components",
                label: "Components",
                render: (r: any) =>
                  r.components.map((c: any) => `${(items.data || []).find((i: any) => i.id === c.itemId)?.name || "?"} × ${c.qty}`).join(", "),
              },
            ]}
          />
          {can("write") && (
            <form
              className="panel form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => capi.post("/boms", { ...bom, components: bom.components.filter((c) => c.itemId && c.qty) }),
                  "Bill of materials saved.",
                  boms.reload,
                );
              }}
            >
              <Field label="BOM name">
                <input required value={bom.name} onChange={(e) => setBom((b) => ({ ...b, name: e.target.value }))} />
              </Field>
              <Field label="Finished item">
                <select required value={bom.itemId} onChange={(e) => setBom((b) => ({ ...b, itemId: e.target.value }))}>
                  <option value="">Select</option>
                  {(items.data || []).map((i: any) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Output quantity">
                <input value={bom.outputQty} onChange={(e) => setBom((b) => ({ ...b, outputQty: e.target.value }))} />
              </Field>
              {bom.components.map((c, i) => (
                <div key={i} className="inline-form">
                  <select
                    aria-label="Component"
                    value={c.itemId}
                    onChange={(e) => setBom((b) => ({ ...b, components: b.components.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)) }))}
                  >
                    <option value="">Component</option>
                    {(items.data || []).map((it: any) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Qty"
                    value={c.qty}
                    onChange={(e) => setBom((b) => ({ ...b, components: b.components.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) }))}
                  />
                </div>
              ))}
              <button type="button" className="text-link" onClick={() => setBom((b) => ({ ...b, components: [...b.components, { itemId: "", qty: "" }] }))}>
                + Add component
              </button>
              <Button type="submit">Save BOM</Button>
            </form>
          )}
        </div>
      )}
      {tab === "godowns" && (
        <div className="grid-2">
          <div>
            <DataTable
              rowKey={(r: any) => r.id}
              rows={godowns.data || []}
              columns={[
                { key: "name", label: "Godown" },
                { key: "isDefault", label: "", render: (r: any) => (r.isDefault ? "Default" : "") },
              ]}
            />
            {can("write") && (
              <form
                className="panel inline-form"
                onSubmit={(e) => (e.preventDefault(), void run(() => capi.post("/warehouses", { name: gName }), "Godown added.", godowns.reload))}
              >
                <input required placeholder="Godown name" value={gName} onChange={(e) => setGName(e.target.value)} />
                <Button type="submit">Add godown</Button>
              </form>
            )}
          </div>
          <div>
            <DataTable
              rowKey={(r: any) => r.id}
              rows={units.data || []}
              columns={[
                { key: "symbol", label: "Unit" },
                { key: "uqc", label: "GST UQC" },
              ]}
            />
            {can("write") && (
              <form
                className="panel inline-form"
                onSubmit={(e) => (e.preventDefault(), void run(() => capi.post("/units", unit), "Unit added.", units.reload))}
              >
                <input required placeholder="Symbol (e.g. Kg)" value={unit.symbol} onChange={(e) => setUnit((u) => ({ ...u, symbol: e.target.value }))} />
                <input placeholder="UQC (e.g. KGS)" value={unit.uqc} onChange={(e) => setUnit((u) => ({ ...u, uqc: e.target.value.toUpperCase() }))} />
                <Button type="submit">Add unit</Button>
              </form>
            )}
          </div>
        </div>
      )}

      <Modal open={open} title="New stock item" onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={saveItem}>
          <Field label="Name">
            <input required value={String(f.name)} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
          </Field>
          <Field label="Unit">
            <select required value={String(f.unitId)} onChange={(e) => setF((x) => ({ ...x, unitId: e.target.value }))}>
              <option value="">Select</option>
              {(units.data || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["sku", "SKU"],
              ["hsnSac", "HSN/SAC"],
              ["gstRate", "GST %"],
              ["reorderLevel", "Reorder level"],
              ["openingQty", "Opening quantity"],
              ["openingRate", "Opening rate (₹)"],
              ["standardSaleRate", "Standard selling rate (₹)"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input value={String(f[k])} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
            </Field>
          ))}
          <Field label="Valuation">
            <select value={String(f.valuationMethod)} onChange={(e) => setF((x) => ({ ...x, valuationMethod: e.target.value }))}>
              <option value="WeightedAverage">Weighted average</option>
              <option value="FIFO">FIFO</option>
            </select>
          </Field>
          {(
            [
              ["trackBatches", "Batches"],
              ["trackExpiry", "Expiry dates"],
              ["trackSerials", "Serial numbers"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="checkbox-label">
              <input type="checkbox" checked={!!f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))} /> Track {label.toLowerCase()}
            </label>
          ))}
          <div className="full">
            <ErrorBox message={err} />
          </div>
          <div className="modal-actions full">
            <Button type="submit">Create item</Button>
          </div>
        </form>
      </Modal>
      <VoucherSheets sheet={sheet} onChange={() => void summary.reload()} />
    </>
  );
}
