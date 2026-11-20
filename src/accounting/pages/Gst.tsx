import { FormEvent, ReactNode, useState } from "react";
import { Button, ErrorBox, Notice, Spinner, SuccessBox } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, ExportButtons, Field, KeyValue, LedgerSelect, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { Ledger, today, VoucherSummary } from "../lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "returns" | "itc" | "payments" | "recon" | "einvoice" | "masters";
const heads = ["taxable", "igst", "cgst", "sgst", "cess"];

function TaxRow({ label, o }: { label: string; o: any }) {
  return (
    <tr>
      <td>{label}</td>
      {heads.map((h) => (
        <td key={h} style={{ textAlign: "right" }}>
          {o?.[h] !== undefined ? <Amount value={o[h]} /> : ""}
        </td>
      ))}
    </tr>
  );
}

export default function Gst() {
  const { capi, company, can } = useCompany();
  const [tab, setTab] = useState<Tab>("returns");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const g1 = useAsync(() => (tab === "returns" ? capi.get<any>(`/gst/gstr1?period=${period}`) : Promise.resolve(null)), [tab, period, company.id]);
  const g3 = useAsync(
    () => (tab === "returns" || tab === "payments" ? capi.get<any>(`/gst/gstr3b?period=${period}`) : Promise.resolve(null)),
    [tab, period, company.id],
  );
  const returns = useAsync(() => capi.get<any[]>("/gst/returns"), [company.id]);
  const itc = useAsync(() => (tab === "itc" ? capi.get<any>(`/gst/itc?from=${period}-01&to=${period}-31`) : Promise.resolve(null)), [tab, period, company.id]);
  const payments = useAsync(() => (tab === "payments" ? capi.get<any[]>("/gst/payments") : Promise.resolve([])), [tab, company.id]);
  const recon = useAsync(() => (tab === "recon" ? capi.get<any[]>(`/gst/reconciliation?period=${period}`) : Promise.resolve([])), [tab, period, company.id]);
  const invoices = useAsync(
    () =>
      tab === "einvoice"
        ? capi.get<{ rows: VoucherSummary[] }>(`/vouchers?type=Sales&status=Posted&pageSize=200`).then((r) => r.rows)
        : Promise.resolve([] as VoucherSummary[]),
    [tab, company.id],
  );
  const ewbs = useAsync(() => (tab === "einvoice" ? capi.get<any[]>("/eway-bills") : Promise.resolve([])), [tab, company.id]);
  const regs = useAsync(() => (tab === "masters" ? capi.get<any[]>("/gst/registrations") : Promise.resolve([])), [tab, company.id]);
  const hsn = useAsync(() => (tab === "masters" ? capi.get<any[]>("/gst/hsn") : Promise.resolve([])), [tab, company.id]);
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const [pay, setPay] = useState({
    cpin: "",
    cin: "",
    paymentDate: today(),
    igst: "",
    cgst: "",
    sgst: "",
    cess: "",
    interest: "",
    lateFee: "",
    bankLedgerId: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [hsnForm, setHsnForm] = useState({ code: "", kind: "HSN", description: "", rate: "" });
  const [regForm, setRegForm] = useState({ gstin: "", effectiveFrom: company.booksStartDate, isPrimary: false, eInvoiceApplicable: false });
  const [irn, setIrn] = useState<{ voucherId: string; irn: string; ackNo: string; ackDate: string } | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => unknown) => {
    setErr("");
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      await after?.();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  if (!company.gstEnabled) return <Notice title="GST is off for this company">Enable GST in Settings to prepare returns.</Notice>;
  const filed = (type: string) => (returns.data || []).find((r) => r.returnType === type && r.period === period);

  return (
    <>
      <div className="toolbar">
        <Tabs
          tabs={[
            ["returns", "GSTR-1 & 3B"],
            ["itc", "ITC register"],
            ["payments", "Liability & payments"],
            ["recon", "2B reconciliation"],
            ["einvoice", "E-invoice & e-way bill"],
            ["masters", "Registrations & rates"],
          ]}
          value={tab}
          onChange={setTab}
        />
        <input type="month" aria-label="Return period" value={period} onChange={(e) => setPeriod(e.target.value)} />
      </div>
      <ErrorBox message={err} />
      <SuccessBox message={msg} />

      {tab === "returns" && (
        <>
          {g1.loading && !g1.data ? (
            <Spinner />
          ) : g1.data ? (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>GSTR-1 · {period}</h2>
                    <p>
                      GSTIN {g1.data.gstin || "—"} · {filed("GSTR1") ? <StatusBadge status={filed("GSTR1").status} /> : "Not prepared"}
                    </p>
                  </div>
                  <ExportButtons url={(f) => capi.url(`/gst/gstr1?period=${period}&format=${f}`)} />
                </div>
                <KeyValue
                  items={[
                    ["B2B invoices", g1.data.b2b.length],
                    ["B2C large", g1.data.b2cl.length],
                    ["B2C small rows", g1.data.b2cs.length],
                    ["Exports / SEZ", g1.data.exp.length],
                    ["Credit/debit notes", g1.data.cdnr.length + g1.data.cdnur.length],
                    ["HSN lines", g1.data.hsn.length],
                    ["Taxable value", <Amount key="t" value={g1.data.totals.taxable} />],
                    ["Total tax", <Amount key="x" value={addTax(g1.data.totals)} />],
                  ]}
                />
                {g1.data.warnings.map((w: string) => (
                  <Notice key={w} title="Check" tone="warning">
                    {w}
                  </Notice>
                ))}
                {can("write") && !filed("GSTR1")?.status?.includes("Filed") && (
                  <Button onClick={() => run(() => capi.post("/gst/returns", { returnType: "GSTR1", period }), "GSTR-1 snapshot saved.", returns.reload)}>
                    Save GSTR-1 snapshot
                  </Button>
                )}
              </div>
              {g3.data && (
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>GSTR-3B · {period}</h2>
                      <p>{filed("GSTR3B") ? <StatusBadge status={filed("GSTR3B").status} /> : "Not prepared"}</p>
                    </div>
                    <ExportButtons url={(f) => capi.url(`/gst/gstr3b?period=${period}&format=${f}`)} />
                  </div>
                  <div className="table-panel acct-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Particulars</th>
                          {heads.map((h) => (
                            <th key={h} style={{ textAlign: "right" }}>
                              {h.toUpperCase()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <TaxRow label="3.1(a) Outward taxable" o={g3.data["3.1"].a_taxableOutward} />
                        <TaxRow label="3.1(b) Zero rated" o={g3.data["3.1"].b_zeroRated} />
                        <TaxRow label="3.1(c) Nil/exempt" o={g3.data["3.1"].c_nilExempt} />
                        <TaxRow label="3.1(d) Inward RCM" o={g3.data["3.1"].d_inwardReverseCharge} />
                        <TaxRow label="4 Net ITC" o={g3.data["4"].netItc} />
                        <TaxRow label="Payable in cash" o={g3.data.payment.payableInCash} />
                        <TaxRow label="Paid" o={g3.data.payment.paid} />
                        <TaxRow label="Balance due" o={g3.data.payment.balanceDue} />
                      </tbody>
                    </table>
                  </div>
                  {can("write") && (
                    <div className="page-actions" style={{ marginTop: 12 }}>
                      <Button
                        onClick={() =>
                          run(
                            () => capi.post("/gst/returns", { returnType: "GSTR3B", period }),
                            "GSTR-3B snapshot saved and ITC marked as claimed.",
                            returns.reload,
                          )
                        }
                      >
                        Save GSTR-3B snapshot
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ErrorBox message={g1.error} />
          )}
          <h2 className="section-title">Prepared returns</h2>
          <DataTable
            rowKey={(r: any) => r.id}
            rows={returns.data || []}
            empty="Snapshots of prepared returns appear here. File them on the GST portal, then record the ARN."
            columns={[
              { key: "returnType", label: "Return" },
              { key: "period", label: "Period" },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              { key: "arn", label: "ARN", render: (r: any) => r.arn || "—" },
              {
                key: "act",
                label: "",
                render: (r: any) =>
                  r.status === "Prepared" && can("approve") ? (
                    <button
                      className="text-link"
                      onClick={() => {
                        const arn = window.prompt("ARN from the GST portal")?.trim();
                        if (arn)
                          void run(() => capi.patch(`/gst/returns/${r.id}`, { status: "Filed", arn, filedOn: today() }), "Marked as filed.", returns.reload);
                      }}
                    >
                      Mark filed
                    </button>
                  ) : null,
              },
            ]}
          />
          <p className="muted">
            Returns are prepared here and filed by you on the GST portal (or through your GSP). Finpro does not file returns automatically.
          </p>
        </>
      )}

      {tab === "itc" &&
        (itc.data ? (
          <>
            <KeyValue
              items={heads.slice(1).map((h) => [`Eligible ${h.toUpperCase()}`, <Amount key={h} value={itc.data.totalEligible[h]} />] as [string, ReactNode])}
            />
            <DataTable
              rowKey={(r: any) => r.voucherId + r.rate}
              rows={itc.data.rows}
              columns={[
                { key: "date", label: "Date" },
                { key: "supplier", label: "Supplier" },
                { key: "gstin", label: "GSTIN" },
                { key: "supplierInvoiceNo", label: "Invoice" },
                { key: "taxable", label: "Taxable", align: "right", render: (r: any) => <Amount value={r.taxable} /> },
                { key: "totalTax", label: "Tax", align: "right", render: (r: any) => <Amount value={r.totalTax} /> },
                { key: "eligible", label: "ITC", render: (r: any) => (r.eligible ? (r.reverseCharge ? "RCM" : "Eligible") : "Ineligible") },
                { key: "claimedPeriod", label: "Claimed in", render: (r: any) => r.claimedPeriod || "—" },
              ]}
            />
          </>
        ) : (
          <Spinner />
        ))}

      {tab === "payments" && (
        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Record GST payment</h2>
                <p>Optionally creates the bank payment voucher against the output tax ledgers.</p>
              </div>
            </div>
            {g3.data && (
              <p className="muted">
                Cash payable for {period}: IGST ₹{g3.data.payment.balanceDue.igst} · CGST ₹{g3.data.payment.balanceDue.cgst} · SGST ₹
                {g3.data.payment.balanceDue.sgst} · Cess ₹{g3.data.payment.balanceDue.cess}
              </p>
            )}
            <form
              className="form-grid"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(
                  () => capi.post("/gst/payments", { ...Object.fromEntries(Object.entries(pay).filter(([, v]) => v !== "")), period }),
                  "Payment recorded.",
                  () => Promise.all([payments.reload(), g3.reload()]),
                );
              }}
            >
              <Field label="Payment date">
                <input type="date" value={pay.paymentDate} onChange={(e) => setPay((p) => ({ ...p, paymentDate: e.target.value }))} />
              </Field>
              <Field label="CIN">
                <input value={pay.cin} onChange={(e) => setPay((p) => ({ ...p, cin: e.target.value }))} />
              </Field>
              {(["igst", "cgst", "sgst", "cess", "interest", "lateFee"] as const).map((k) => (
                <Field key={k} label={k === "lateFee" ? "Late fee" : k.toUpperCase()}>
                  <input inputMode="decimal" value={pay[k]} onChange={(e) => setPay((p) => ({ ...p, [k]: e.target.value }))} />
                </Field>
              ))}
              <Field label="Paid from bank (creates voucher)" full>
                <LedgerSelect
                  ledgers={ledgers.data || []}
                  value={pay.bankLedgerId}
                  onChange={(v) => setPay((p) => ({ ...p, bankLedgerId: v }))}
                  filter={(l) => l.kind === "Bank"}
                  placeholder="Do not create a voucher"
                />
              </Field>
              <div className="modal-actions full">
                {can("write") && (
                  <Button
                    variant="secondary"
                    onClick={() => run(() => capi.post("/gst/setoff", { period, date: today() }), "ITC set-off journal posted.", g3.reload)}
                  >
                    Post ITC set-off journal
                  </Button>
                )}
                {can("write") && <Button type="submit">Record payment</Button>}
              </div>
            </form>
          </div>
          <div>
            <DataTable
              rowKey={(r: any) => r.id}
              rows={payments.data || []}
              empty="No GST payments recorded."
              columns={[
                { key: "period", label: "Period" },
                { key: "paymentDate", label: "Paid on" },
                { key: "cin", label: "CIN" },
                { key: "igst", label: "IGST", align: "right", render: (r: any) => <Amount value={r.igst} /> },
                { key: "cgst", label: "CGST", align: "right", render: (r: any) => <Amount value={r.cgst} /> },
                { key: "sgst", label: "SGST", align: "right", render: (r: any) => <Amount value={r.sgst} /> },
              ]}
            />
          </div>
        </div>
      )}

      {tab === "recon" && (
        <>
          <div className="panel inline-form">
            <input type="file" accept=".json,.csv" aria-label="GSTR-2B file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button
              disabled={!file || !can("write")}
              onClick={() => {
                const fd = new FormData();
                fd.append("period", period);
                if (file) fd.append("file", file);
                void run(() => api.post(`${capi.base}/gst/reconciliation`, fd), "Reconciliation complete.", recon.reload);
              }}
            >
              Reconcile with books
            </Button>
            <span className="muted">GSTR-2B JSON from the portal, or CSV with supplierGstin, invoiceNo, invoiceDate, taxable, tax.</span>
          </div>
          <DataTable
            rowKey={(r: any) => r.supplierGstin + r.invoiceNo}
            rows={recon.data || []}
            empty="Upload GSTR-2B for this period to compare supplier filings with your purchase register."
            columns={[
              { key: "supplierGstin", label: "Supplier GSTIN" },
              { key: "invoiceNo", label: "Invoice" },
              { key: "taxable", label: "Taxable", align: "right", render: (r: any) => <Amount value={r.taxable} /> },
              { key: "tax", label: "Tax", align: "right", render: (r: any) => <Amount value={r.tax} /> },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              { key: "difference", label: "Difference", align: "right", render: (r: any) => <Amount value={r.difference} /> },
            ]}
          />
        </>
      )}

      {tab === "einvoice" && (
        <>
          <DataTable
            rowKey={(r) => r.id}
            rows={invoices.data || []}
            empty="No posted sales invoices."
            columns={[
              { key: "date", label: "Date" },
              { key: "number", label: "Invoice" },
              { key: "partyName", label: "Customer" },
              { key: "total", label: "Value", align: "right", render: (r) => <Amount value={r.total} /> },
              {
                key: "act",
                label: "E-invoice / e-way bill",
                render: (r) =>
                  can("write") ? (
                    <span className="mini-actions">
                      <button
                        className="text-link"
                        onClick={() =>
                          run(() => capi.post(`/vouchers/${r.id}/e-invoice`, {}), `IRP payload ready for ${r.number}. Upload it on the IRP and record the IRN.`)
                        }
                      >
                        Prepare IRN payload
                      </button>
                      <button className="text-link" onClick={() => setIrn({ voucherId: r.id, irn: "", ackNo: "", ackDate: "" })}>
                        Record IRN
                      </button>
                      <button
                        className="text-link"
                        onClick={() => {
                          const vehicleNo = window.prompt("Vehicle number (e.g. MH12AB1234)")?.trim() || "";
                          const distanceKm = Number(window.prompt("Distance in km") || 0);
                          void run(() => capi.post(`/vouchers/${r.id}/eway-bill`, { vehicleNo, distanceKm }), "E-way bill draft created.", ewbs.reload);
                        }}
                      >
                        E-way bill
                      </button>
                    </span>
                  ) : null,
              },
            ]}
          />
          {irn && (
            <form
              className="panel form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => capi.patch(`/vouchers/${irn.voucherId}/e-invoice`, { status: "Generated", irn: irn.irn, ackNo: irn.ackNo, ackDate: irn.ackDate }),
                  "IRN recorded; the invoice is now locked.",
                  () => setIrn(null),
                );
              }}
            >
              <Field label="IRN (64 characters)" full>
                <input required value={irn.irn} onChange={(e) => setIrn({ ...irn, irn: e.target.value.trim() })} />
              </Field>
              <Field label="Ack no.">
                <input value={irn.ackNo} onChange={(e) => setIrn({ ...irn, ackNo: e.target.value })} />
              </Field>
              <Field label="Ack date">
                <input value={irn.ackDate} onChange={(e) => setIrn({ ...irn, ackDate: e.target.value })} />
              </Field>
              <div className="modal-actions full">
                <Button variant="secondary" onClick={() => setIrn(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save IRN</Button>
              </div>
            </form>
          )}
          <h2 className="section-title">E-way bills</h2>
          <DataTable
            rowKey={(r: any) => r.id}
            rows={ewbs.data || []}
            empty="No e-way bills yet."
            columns={[
              { key: "voucherNumber", label: "Invoice" },
              { key: "vehicleNo", label: "Vehicle" },
              { key: "distanceKm", label: "Km", align: "right" },
              { key: "ewayBillNo", label: "EWB no.", render: (r: any) => r.ewayBillNo || "—" },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              {
                key: "act",
                label: "",
                render: (r: any) =>
                  r.status === "Draft" && can("write") ? (
                    <button
                      className="text-link"
                      onClick={() => {
                        const no = window.prompt("12-digit e-way bill number")?.trim();
                        if (no)
                          void run(
                            () => capi.patch(`/eway-bills/${r.id}`, { status: "Generated", ewayBillNo: no, ewayBillDate: today() }),
                            "E-way bill number saved.",
                            ewbs.reload,
                          );
                      }}
                    >
                      Record EWB no.
                    </button>
                  ) : null,
              },
            ]}
          />
        </>
      )}

      {tab === "masters" && (
        <div className="grid-2">
          <div>
            <h2 className="section-title">GST registrations</h2>
            <DataTable
              rowKey={(r: any) => r.id}
              rows={regs.data || []}
              columns={[
                { key: "gstin", label: "GSTIN" },
                { key: "registrationType", label: "Type" },
                { key: "effectiveFrom", label: "From" },
                { key: "isPrimary", label: "Primary", render: (r: any) => (r.isPrimary ? "Yes" : "") },
              ]}
            />
            {can("admin") && (
              <form
                className="panel inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => capi.post("/gst/registrations", regForm), "Registration added.", regs.reload);
                }}
              >
                <input
                  required
                  placeholder="GSTIN"
                  maxLength={15}
                  value={regForm.gstin}
                  onChange={(e) => setRegForm((r) => ({ ...r, gstin: e.target.value.toUpperCase() }))}
                />
                <input type="date" value={regForm.effectiveFrom} onChange={(e) => setRegForm((r) => ({ ...r, effectiveFrom: e.target.value }))} />
                <label className="checkbox-label">
                  <input type="checkbox" checked={regForm.isPrimary} onChange={(e) => setRegForm((r) => ({ ...r, isPrimary: e.target.checked }))} /> Primary
                </label>
                <Button type="submit">Add</Button>
              </form>
            )}
          </div>
          <div>
            <h2 className="section-title">HSN / SAC and rates</h2>
            <DataTable
              rowKey={(r: any) => r.id}
              rows={hsn.data || []}
              empty="Add HSN/SAC codes with their rates; invoices pick the rate in force on the invoice date."
              columns={[
                { key: "code", label: "Code" },
                { key: "kind", label: "Kind" },
                { key: "description", label: "Description" },
                { key: "currentRate", label: "Rate %", align: "right", render: (r: any) => r.currentRate ?? "—" },
              ]}
            />
            {can("write") && (
              <form
                className="panel inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => capi.post("/gst/hsn", { ...hsnForm, rate: hsnForm.rate || undefined }), "HSN/SAC saved.", hsn.reload);
                }}
              >
                <input required placeholder="Code" value={hsnForm.code} onChange={(e) => setHsnForm((h) => ({ ...h, code: e.target.value }))} />
                <select value={hsnForm.kind} onChange={(e) => setHsnForm((h) => ({ ...h, kind: e.target.value }))}>
                  <option>HSN</option>
                  <option>SAC</option>
                </select>
                <input placeholder="Description" value={hsnForm.description} onChange={(e) => setHsnForm((h) => ({ ...h, description: e.target.value }))} />
                <input placeholder="Rate %" value={hsnForm.rate} onChange={(e) => setHsnForm((h) => ({ ...h, rate: e.target.value }))} style={{ width: 80 }} />
                <Button type="submit">Add</Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function addTax(t: Record<string, string>) {
  const p = (v: string) => {
    const [w, f = "00"] = v.replace("-", "").split(".");
    return (v.startsWith("-") ? -1 : 1) * (Number(w) * 100 + Number(f.padEnd(2, "0")));
  };
  const total = p(t.igst) + p(t.cgst) + p(t.sgst) + p(t.cess);
  const s = String(Math.abs(total)).padStart(3, "0");
  return `${total < 0 ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}
