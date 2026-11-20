import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmptyState, ErrorBox, Modal, Notice, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, ExportButtons, Field, KeyValue, LedgerSelect, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { download, Ledger, STATES, today } from "../lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "runs" | "employees" | "attendance" | "heads" | "leaves";

export default function Payroll() {
  const { capi, company, can, reloadCompany } = useCompany();
  const enabled = company.payrollEnabled;
  const [tab, setTab] = useState<Tab>("runs");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const emps = useAsync(() => (enabled ? capi.get<any[]>("/payroll/employees") : Promise.resolve([])), [enabled, company.id]);
  const comps = useAsync(() => (enabled ? capi.get<any[]>("/payroll/components") : Promise.resolve([])), [enabled, company.id]);
  const runs = useAsync(() => (enabled && tab === "runs" ? capi.get<any[]>("/payroll/runs") : Promise.resolve([])), [enabled, tab, company.id]);
  const att = useAsync(
    () => (enabled && tab === "attendance" ? capi.get<any[]>(`/payroll/attendance?period=${period}`) : Promise.resolve([])),
    [enabled, tab, period],
  );
  const statutory = useAsync(() => (enabled && tab === "heads" ? capi.get<any[]>("/payroll/statutory") : Promise.resolve([])), [enabled, tab]);
  const leaves = useAsync(() => (enabled && tab === "leaves" ? capi.get<any[]>("/payroll/leaves") : Promise.resolve([])), [enabled, tab]);
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const [run, setRun] = useState<any | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
  const [emp, setEmp] = useState({
    employeeCode: "",
    name: "",
    dateOfJoining: today(),
    pan: "",
    uan: "",
    stateCode: company.stateCode,
    taxRegime: "New",
    pfApplicable: true,
    esiApplicable: true,
    ptApplicable: true,
  });
  const [structFor, setStructFor] = useState<any | null>(null);
  const [struct, setStruct] = useState<Record<string, string>>({});
  const [structFrom, setStructFrom] = useState(today().slice(0, 8) + "01");
  const [attEdit, setAttEdit] = useState<Record<string, { workingDays: string; presentDays: string; paidLeaveDays: string; lopDays: string }>>({});
  const [leave, setLeave] = useState({ employeeId: "", leaveType: "Casual", fromDate: today(), toDate: today(), days: "1", paid: true });

  const act = async (fn: () => Promise<any>, ok: string, after?: (r: any) => unknown) => {
    setErr("");
    setMsg("");
    try {
      const r = await fn();
      setMsg(ok);
      await after?.(r);
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  if (!enabled)
    return (
      <div className="panel">
        <EmptyState
          title="Payroll is not enabled"
          description="Enable payroll to manage employees, salary structures, attendance, PF/ESI/PT/TDS and post salary journals."
          action={
            can("admin") ? (
              <Button onClick={() => act(() => capi.post("/payroll/setup", {}), "Payroll enabled.", reloadCompany)}>Enable payroll</Button>
            ) : undefined
          }
        />
      </div>
    );

  const saveStruct = (e: FormEvent) => {
    e.preventDefault();
    const lines = (comps.data || [])
      .filter((c) => struct[c.id])
      .map((c) => (c.calc === "PercentOfBasic" ? { componentId: c.id, percent: struct[c.id] } : { componentId: c.id, amount: struct[c.id] }));
    void act(
      () => capi.post(`/payroll/employees/${structFor.id}/salary-structures`, { effectiveFrom: structFrom, lines }),
      "Salary structure saved.",
      () => setStructFor(null),
    );
  };

  return (
    <>
      <div className="toolbar">
        <Tabs
          tabs={[
            ["runs", "Payroll runs"],
            ["employees", "Employees"],
            ["attendance", "Attendance"],
            ["leaves", "Leave"],
            ["heads", "Pay heads & statutory"],
          ]}
          value={tab}
          onChange={setTab}
        />
        <input type="month" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} />
      </div>
      <ErrorBox message={err} />
      <SuccessBox message={msg} />

      {tab === "runs" && (
        <>
          {can("write") && (
            <div className="page-actions" style={{ marginBottom: 12 }}>
              <Button
                onClick={() =>
                  act(
                    () => capi.post("/payroll/runs", { period }),
                    `Payroll for ${period} computed.`,
                    (r) => (setRun(r), runs.reload()),
                  )
                }
              >
                Process payroll for {period}
              </Button>
            </div>
          )}
          <DataTable
            rowKey={(r: any) => r.id}
            rows={runs.data || []}
            onRowClick={(r: any) => act(() => capi.get(`/payroll/runs/${r.id}`), "", setRun)}
            empty="No payroll runs yet."
            columns={[
              { key: "period", label: "Period" },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              { key: "gross", label: "Gross", align: "right", render: (r: any) => <Amount value={r.gross} /> },
              { key: "deductions", label: "Deductions", align: "right", render: (r: any) => <Amount value={r.deductions} /> },
              { key: "net", label: "Net pay", align: "right", render: (r: any) => <Amount value={r.net} /> },
            ]}
          />
          {run && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <div>
                  <h2>
                    Payroll {run.period} <StatusBadge status={run.status} />
                  </h2>
                  <p>
                    {run.skipped?.length
                      ? `Skipped: ${run.skipped.map((s: any) => `${s.employee} (${s.reason})`).join(", ")}`
                      : `${run.entries.length} employees`}
                  </p>
                </div>
                <ExportButtons url={(f) => capi.url(`/payroll/runs/${run.id}/register?format=${f}`)} />
              </div>
              <KeyValue
                items={[
                  ["Gross", <Amount key="g" value={run.totals.gross} />],
                  ["Deductions", <Amount key="d" value={run.totals.deductions} />],
                  ["Net pay", <Amount key="n" value={run.totals.net} />],
                  ["Employer PF + ESI", <Amount key="e" value={run.totals.employerContributions} />],
                ]}
              />
              <DataTable
                rowKey={(e: any) => e.id}
                rows={run.entries}
                columns={[
                  { key: "employeeCode", label: "Code" },
                  { key: "name", label: "Employee" },
                  { key: "paidDays", label: "Paid days", render: (e: any) => `${e.paidDays} / ${e.workingDays}` },
                  { key: "gross", label: "Gross", align: "right", render: (e: any) => <Amount value={e.gross} /> },
                  {
                    key: "ded",
                    label: "Deductions",
                    render: (e: any) =>
                      e.lines
                        .filter((l: any) => !["Earning", "Reimbursement"].includes(l.kind))
                        .map((l: any) => `${l.name} ${l.amount}`)
                        .join(" · "),
                  },
                  { key: "net", label: "Net", align: "right", render: (e: any) => <Amount value={e.net} /> },
                  {
                    key: "slip",
                    label: "",
                    render: (e: any) => (
                      <button className="text-link" onClick={() => download(capi.url(`/payroll/slips/${e.id}?format=pdf`))}>
                        Slip PDF
                      </button>
                    ),
                  },
                ]}
              />
              <div className="modal-actions">
                {run.status === "Draft" && can("write") && (
                  <Button variant="secondary" onClick={() => act(() => capi.post(`/payroll/runs/${run.id}/recompute`, {}), "Recomputed.", setRun)}>
                    Recompute
                  </Button>
                )}
                {run.status === "Draft" && can("approve") && (
                  <Button
                    onClick={() =>
                      act(
                        () => capi.post(`/payroll/runs/${run.id}/post`, {}),
                        "Payroll posted to the books.",
                        (r) => (setRun(r), runs.reload()),
                      )
                    }
                  >
                    Approve & post
                  </Button>
                )}
                {run.status !== "Cancelled" && can("approve") && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      const reason = window.prompt("Reason for cancelling this payroll run");
                      if (reason)
                        void act(
                          () => capi.post(`/payroll/runs/${run.id}/cancel`, { reason }),
                          "Payroll run cancelled.",
                          (r) => (setRun(r), runs.reload()),
                        );
                    }}
                  >
                    Cancel run
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "employees" && (
        <>
          {can("write") && (
            <div className="page-actions" style={{ marginBottom: 12 }}>
              <Button onClick={() => setEmpOpen(true)}>
                <Plus size={14} /> New employee
              </Button>
            </div>
          )}
          <DataTable
            rowKey={(e: any) => e.id}
            rows={emps.data || []}
            empty="Add employees, then give each a salary structure."
            columns={[
              { key: "employeeCode", label: "Code" },
              { key: "name", label: "Name" },
              { key: "dateOfJoining", label: "Joined" },
              { key: "taxRegime", label: "Regime" },
              {
                key: "flags",
                label: "Statutory",
                render: (e: any) => [e.pfApplicable && "PF", e.esiApplicable && "ESI", e.ptApplicable && "PT"].filter(Boolean).join(", "),
              },
              {
                key: "struct",
                label: "",
                render: (e: any) =>
                  can("write") ? (
                    <button className="text-link" onClick={() => (setStructFor(e), setStruct({}))}>
                      Salary structure
                    </button>
                  ) : null,
              },
            ]}
          />
        </>
      )}

      {tab === "attendance" && (
        <>
          <Notice title="Attendance drives proration">
            Employees without a record for the month are paid for the calendar days they were employed. Loss-of-pay days reduce prorated pay heads.
          </Notice>
          <div className="table-panel acct-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Working days</th>
                  <th>Present</th>
                  <th>Paid leave</th>
                  <th>LOP</th>
                </tr>
              </thead>
              <tbody>
                {(emps.data || []).map((e: any) => {
                  const rec = att.data?.find((a: any) => a.employeeId === e.id);
                  const cur = attEdit[e.id] || {
                    workingDays: String(rec?.workingDays ?? ""),
                    presentDays: rec?.presentDays ?? "",
                    paidLeaveDays: rec?.paidLeaveDays ?? "",
                    lopDays: rec?.lopDays ?? "",
                  };
                  const upd = (k: string, v: string) => setAttEdit((s) => ({ ...s, [e.id]: { ...cur, [k]: v } }));
                  return (
                    <tr key={e.id}>
                      <td>
                        {e.employeeCode} {e.name}
                      </td>
                      {(["workingDays", "presentDays", "paidLeaveDays", "lopDays"] as const).map((k) => (
                        <td key={k}>
                          <input aria-label={k} value={cur[k]} onChange={(ev) => upd(k, ev.target.value)} style={{ width: 80 }} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {can("write") && (
            <Button
              onClick={() =>
                act(
                  () =>
                    capi.put("/payroll/attendance", {
                      period,
                      records: Object.entries(attEdit)
                        .filter(([, v]) => v.workingDays && v.presentDays)
                        .map(([employeeId, v]) => ({
                          employeeId,
                          workingDays: Number(v.workingDays),
                          presentDays: v.presentDays,
                          paidLeaveDays: v.paidLeaveDays || "0",
                          lopDays: v.lopDays || "0",
                        })),
                    }),
                  "Attendance saved.",
                  att.reload,
                )
              }
            >
              Save attendance for {period}
            </Button>
          )}
        </>
      )}

      {tab === "leaves" && (
        <>
          <DataTable
            rowKey={(l: any) => l.id}
            rows={leaves.data || []}
            columns={[
              { key: "name", label: "Employee" },
              { key: "leaveType", label: "Type" },
              { key: "fromDate", label: "From" },
              { key: "toDate", label: "To" },
              { key: "days", label: "Days", align: "right" },
              { key: "paid", label: "Paid", render: (l: any) => (l.paid ? "Yes" : "LOP") },
              {
                key: "status",
                label: "Status",
                render: (l: any) => <StatusBadge status={l.status === "Approved" ? "Posted" : l.status === "Pending" ? "PendingApproval" : "Rejected"} />,
              },
              {
                key: "act",
                label: "",
                render: (l: any) =>
                  l.status === "Pending" && can("approve") ? (
                    <button
                      className="text-link"
                      onClick={() => act(() => capi.patch(`/payroll/leaves/${l.id}`, { status: "Approved" }), "Leave approved.", leaves.reload)}
                    >
                      Approve
                    </button>
                  ) : null,
              },
            ]}
          />
          {can("write") && (
            <form
              className="panel inline-form"
              onSubmit={(e) => (e.preventDefault(), void act(() => capi.post("/payroll/leaves", leave), "Leave recorded.", leaves.reload))}
            >
              <select required value={leave.employeeId} onChange={(e) => setLeave((l) => ({ ...l, employeeId: e.target.value }))}>
                <option value="">Employee</option>
                {(emps.data || []).map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <input value={leave.leaveType} onChange={(e) => setLeave((l) => ({ ...l, leaveType: e.target.value }))} placeholder="Type" />
              <input type="date" value={leave.fromDate} onChange={(e) => setLeave((l) => ({ ...l, fromDate: e.target.value }))} />
              <input type="date" value={leave.toDate} onChange={(e) => setLeave((l) => ({ ...l, toDate: e.target.value }))} />
              <input value={leave.days} onChange={(e) => setLeave((l) => ({ ...l, days: e.target.value }))} style={{ width: 60 }} aria-label="Days" />
              <label className="checkbox-label">
                <input type="checkbox" checked={leave.paid} onChange={(e) => setLeave((l) => ({ ...l, paid: e.target.checked }))} /> Paid
              </label>
              <Button type="submit">Add leave</Button>
            </form>
          )}
        </>
      )}

      {tab === "heads" && (
        <div className="grid-2">
          <div>
            <h2 className="section-title">Pay heads</h2>
            <DataTable
              rowKey={(c: any) => c.id}
              rows={comps.data || []}
              columns={[
                { key: "name", label: "Pay head" },
                { key: "kind", label: "Kind" },
                { key: "calc", label: "Calculation", render: (c: any) => (c.calc === "PercentOfBasic" ? "% of basic" : "Fixed") },
                {
                  key: "ledgerId",
                  label: "Ledger",
                  render: (c: any) =>
                    can("write") ? (
                      <LedgerSelect
                        ledgers={ledgers.data || []}
                        value={c.ledgerId || ""}
                        placeholder="Salaries & Wages (default)"
                        onChange={(v) => act(() => capi.patch(`/payroll/components/${c.id}`, { ledgerId: v || null }), "Ledger updated.", comps.reload)}
                      />
                    ) : (
                      (ledgers.data || []).find((l) => l.id === c.ledgerId)?.name || "Default"
                    ),
                },
              ]}
            />
          </div>
          <div>
            <h2 className="section-title">Statutory configuration (effective-dated)</h2>
            {(statutory.data || []).map((s: any) => (
              <details key={s.id} className="panel" style={{ marginBottom: 8 }}>
                <summary>
                  {s.code} — effective {s.effectiveFrom}
                </summary>
                <pre className="code-block">{JSON.stringify(s.config, null, 2)}</pre>
                {can("admin") && (
                  <button
                    className="text-link"
                    onClick={() => {
                      const from = window.prompt("New version effective from (YYYY-MM-DD)", today());
                      const json = from && window.prompt("Configuration JSON (amounts in paise, rates in basis points)", JSON.stringify(s.config));
                      if (from && json) {
                        try {
                          const config = JSON.parse(json);
                          void act(
                            () => capi.post("/payroll/statutory", { code: s.code, effectiveFrom: from, config }),
                            `${s.code} rules saved from ${from}.`,
                            statutory.reload,
                          );
                        } catch {
                          setErr("That is not valid JSON.");
                        }
                      }
                    }}
                  >
                    Add a new effective version
                  </button>
                )}
              </details>
            ))}
            <p className="muted">
              Seed rates are starting points only. Verify PF, ESI, professional tax and TDS rates against current notifications before processing payroll.
            </p>
          </div>
        </div>
      )}

      <Modal open={empOpen} title="New employee" onClose={() => setEmpOpen(false)}>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => capi.post("/payroll/employees", emp),
              "Employee added.",
              () => (setEmpOpen(false), emps.reload()),
            );
          }}
        >
          <Field label="Employee code">
            <input required value={emp.employeeCode} onChange={(e) => setEmp((x) => ({ ...x, employeeCode: e.target.value }))} />
          </Field>
          <Field label="Name">
            <input required value={emp.name} onChange={(e) => setEmp((x) => ({ ...x, name: e.target.value }))} />
          </Field>
          <Field label="Date of joining">
            <input type="date" value={emp.dateOfJoining} onChange={(e) => setEmp((x) => ({ ...x, dateOfJoining: e.target.value }))} />
          </Field>
          <Field label="PAN">
            <input value={emp.pan} maxLength={10} onChange={(e) => setEmp((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label="UAN">
            <input value={emp.uan} maxLength={12} onChange={(e) => setEmp((x) => ({ ...x, uan: e.target.value }))} />
          </Field>
          <Field label="Work state (for PT)">
            <select value={emp.stateCode} onChange={(e) => setEmp((x) => ({ ...x, stateCode: e.target.value }))}>
              <option value="">—</option>
              {Object.entries(STATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tax regime">
            <select value={emp.taxRegime} onChange={(e) => setEmp((x) => ({ ...x, taxRegime: e.target.value }))}>
              <option>New</option>
              <option>Old</option>
            </select>
          </Field>
          {(["pfApplicable", "esiApplicable", "ptApplicable"] as const).map((k) => (
            <label key={k} className="checkbox-label">
              <input type="checkbox" checked={emp[k]} onChange={(e) => setEmp((x) => ({ ...x, [k]: e.target.checked }))} />{" "}
              {k.replace("Applicable", "").toUpperCase()}
            </label>
          ))}
          <div className="modal-actions full">
            <Button type="submit">Save employee</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!structFor} title={`Salary structure — ${structFor?.name || ""}`} onClose={() => setStructFor(null)}>
        <form className="form-grid" onSubmit={saveStruct}>
          <Field label="Effective from" full>
            <input type="date" value={structFrom} onChange={(e) => setStructFrom(e.target.value)} />
          </Field>
          {(comps.data || []).map((c: any) => (
            <Field key={c.id} label={`${c.name} ${c.calc === "PercentOfBasic" ? "(% of basic)" : "(₹ / month)"}`}>
              <input inputMode="decimal" value={struct[c.id] || ""} onChange={(e) => setStruct((s) => ({ ...s, [c.id]: e.target.value }))} />
            </Field>
          ))}
          <div className="modal-actions full">
            <Button type="submit">Save structure</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
