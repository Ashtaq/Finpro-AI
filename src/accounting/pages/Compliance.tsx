import { useState } from "react";
import { Button, ErrorBox, Notice, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, KeyValue, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { today } from "../lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "calendar" | "tds" | "tcs" | "liability";

const addMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default function Compliance() {
  const { capi, company, can } = useCompany();
  const [tab, setTab] = useState<Tab>("calendar");
  const returns = useAsync(() => capi.get<any[]>("/gst/returns"), [company.id]);
  const tds = useAsync(
    () => (tab === "tds" || tab === "tcs" ? capi.get<any[]>(`/tds/transactions?kind=${tab.toUpperCase()}`) : Promise.resolve([])),
    [tab, company.id],
  );
  const summary = useAsync(() => capi.get<any>(`/tds/summary?kind=${tab === "tcs" ? "TCS" : "TDS"}`), [tab, company.id]);
  const liability = useAsync(() => (tab === "liability" ? capi.get<any>("/gst/liability") : Promise.resolve(null)), [tab, company.id]);
  const runs = useAsync(() => (company.payrollEnabled ? capi.get<any[]>("/payroll/runs") : Promise.resolve([])), [company.id]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Statutory due dates for the previous and current month, derived from what has been recorded.
  const now = today().slice(0, 7);
  const months = [addMonth(now, -1), now];
  const filed = (type: string, p: string) => (returns.data || []).find((r) => r.returnType === type && r.period === p);
  const calendar = months.flatMap((p) => {
    const next = addMonth(p, 1);
    const items: { due: string; task: string; status: string }[] = [];
    if (company.gstEnabled) {
      items.push({ due: `${next}-11`, task: `GSTR-1 for ${p}`, status: filed("GSTR1", p)?.status || "Pending" });
      items.push({ due: `${next}-20`, task: `GSTR-3B for ${p}`, status: filed("GSTR3B", p)?.status || "Pending" });
    }
    if (company.tdsEnabled)
      items.push({ due: `${next}-07`, task: `TDS/TCS deposit for ${p}`, status: summary.data && summary.data.pendingDeposit !== "0.00" ? "Pending" : "Clear" });
    if (company.payrollEnabled) {
      const run = (runs.data || []).find((r) => r.period === p && r.status === "Posted");
      items.push({ due: `${next}-15`, task: `PF & ESI for ${p}`, status: run ? "Payroll posted — deposit due" : "No payroll posted" });
    }
    return items;
  });

  const markDeposited = async (id: string) => {
    const challan = window.prompt("Challan / BSR serial number")?.trim();
    if (!challan) return;
    try {
      await capi.patch(`/tds/transactions/${id}`, { depositedOn: today(), challanNo: challan });
      setMsg("Marked as deposited.");
      await Promise.all([tds.reload(), summary.reload()]);
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  return (
    <>
      <Tabs
        tabs={[
          ["calendar", "Compliance tracker"],
          ["tds", "TDS"],
          ["tcs", "TCS"],
          ["liability", "Tax liability"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err} />
      <SuccessBox message={msg} />
      {tab === "calendar" && (
        <>
          <DataTable
            rowKey={(r) => r.task}
            rows={calendar.sort((a, b) => a.due.localeCompare(b.due))}
            empty="Enable GST, TDS or payroll in Settings to track their statutory due dates."
            columns={[
              { key: "due", label: "Due date" },
              { key: "task", label: "Obligation" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <StatusBadge status={r.status === "Filed" || r.status === "Clear" ? "Posted" : r.status === "Prepared" ? "Prepared" : "Draft"} />
                ),
              },
              { key: "note", label: "", render: (r) => <span className="muted">{r.status}</span> },
            ]}
          />
          <Notice title="Due dates">
            Standard monthly due dates are shown; extensions notified by CBIC/CBDT and QRMP schemes may differ. Add client-specific deadlines in the workspace
            Compliance calendar.
          </Notice>
        </>
      )}
      {(tab === "tds" || tab === "tcs") && (
        <>
          {!company.tdsEnabled && <Notice title="TDS/TCS is off">Enable it in Settings to deduct and track tax at source.</Notice>}
          {summary.data && (
            <KeyValue
              items={[
                [`Total ${tab.toUpperCase()}`, <Amount key="t" value={summary.data.totalTax} />],
                ["Pending deposit", <Amount key="p" value={summary.data.pendingDeposit} />],
                ["Deductees without PAN", summary.data.missingPan],
              ]}
            />
          )}
          <DataTable
            rowKey={(r: any) => r.id}
            rows={tds.data || []}
            empty={`No ${tab.toUpperCase()} deducted yet. Select a section on purchase/sales invoices or journals.`}
            columns={[
              { key: "date", label: "Date" },
              { key: "section", label: "Section" },
              { key: "party", label: "Party" },
              { key: "pan", label: "PAN", render: (r: any) => r.pan || "PANNOTAVBL" },
              { key: "base", label: "Base", align: "right", render: (r: any) => <Amount value={r.base} /> },
              { key: "rate", label: "Rate %", align: "right" },
              { key: "tax", label: "Tax", align: "right", render: (r: any) => <Amount value={r.tax} /> },
              {
                key: "dep",
                label: "Deposit",
                render: (r: any) =>
                  r.depositedOn ? (
                    `${r.depositedOn} · ${r.challanNo}`
                  ) : can("write") ? (
                    <button className="text-link" onClick={() => markDeposited(r.id)}>
                      Mark deposited
                    </button>
                  ) : (
                    "Pending"
                  ),
              },
            ]}
          />
          <h2 className="section-title">Deductee-wise summary (basis for {tab === "tds" ? "24Q / 26Q" : "27EQ"})</h2>
          <DataTable
            rowKey={(r: any) => r.section + r.party}
            rows={summary.data?.rows || []}
            columns={[
              { key: "section", label: "Section" },
              { key: "party", label: "Deductee" },
              { key: "pan", label: "PAN" },
              { key: "transactions", label: "Entries", align: "right" },
              { key: "base", label: "Amount paid/credited", align: "right", render: (r: any) => <Amount value={r.base} /> },
              { key: "tax", label: "Tax", align: "right", render: (r: any) => <Amount value={r.tax} /> },
              { key: "pendingDeposit", label: "Pending", align: "right", render: (r: any) => <Amount value={r.pendingDeposit} /> },
            ]}
          />
        </>
      )}
      {tab === "liability" && (
        <>
          <DataTable
            rowKey={(r: any) => r.period}
            rows={liability.data?.rows || []}
            empty="No GST transactions yet."
            columns={[
              { key: "period", label: "Period" },
              { key: "outputTax", label: "Output tax", align: "right", render: (r: any) => <Amount value={r.outputTax} /> },
              { key: "rcmTax", label: "RCM tax", align: "right", render: (r: any) => <Amount value={r.rcmTax} /> },
              { key: "itc", label: "ITC", align: "right", render: (r: any) => <Amount value={r.itc} /> },
              { key: "netPayable", label: "Net payable", align: "right", render: (r: any) => <Amount value={r.netPayable} /> },
              { key: "paid", label: "Paid", align: "right", render: (r: any) => <Amount value={r.paid} /> },
            ]}
          />
          {summary.data && (
            <p className="muted">
              TDS pending deposit: <Amount value={summary.data.pendingDeposit} />
            </p>
          )}
          <Button variant="secondary" onClick={() => setTab("calendar")}>
            Back to tracker
          </Button>
        </>
      )}
    </>
  );
}
