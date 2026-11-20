import { FormEvent, useState } from "react";
import { Button, ErrorBox, Notice, SuccessBox } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { Client } from "../../types";
import { Amount, DataTable, Field, LedgerSelect, StatusBadge, Tabs } from "../components";
import { useAccounting, useCompany } from "../context";
import { download, Ledger, today, typeLabel } from "../lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "company" | "years" | "numbering" | "team" | "budgets" | "stock" | "data";

export default function Settings() {
  const { capi, company, can, reloadCompany } = useCompany();
  const { reloadCompanies, selectCompany } = useAccounting();
  const [tab, setTab] = useState<Tab>("company");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const tpl = company.invoiceTemplate as Record<string, string | boolean>;
  const [f, setF] = useState({
    name: company.name,
    legalName: company.legalName,
    pan: company.pan,
    tan: company.tan,
    address: company.address,
    gstEnabled: company.gstEnabled,
    inventoryEnabled: company.inventoryEnabled,
    tdsEnabled: company.tdsEnabled,
    requireVoucherApproval: company.requireVoucherApproval,
    lockDate: company.lockDate || "",
    title: String(tpl.title || ""),
    format: String(tpl.format || "standard"),
    terms: String(tpl.terms || ""),
    footer: String(tpl.footer || ""),
    showHsn: tpl.showHsn !== false,
    showBankDetails: tpl.showBankDetails !== false,
  });
  const years = useAsync(() => capi.get<any[]>("/financial-years"), [company.id]);
  const series = useAsync(() => (tab === "numbering" ? capi.get<any[]>("/voucher-series") : Promise.resolve([])), [tab, company.id]);
  const team = useAsync(() => (tab === "team" && can("admin") ? api.get<any[]>("/accounting/roles") : Promise.resolve([])), [tab]);
  const clients = useAsync(() => (tab === "team" || tab === "data" ? api.get<Client[]>("/clients") : Promise.resolve([] as Client[])), [tab]);
  const budgets = useAsync(() => (tab === "budgets" ? capi.get<any[]>("/budgets") : Promise.resolve([])), [tab, company.id]);
  const closing = useAsync(() => (tab === "stock" ? capi.get<any[]>("/closing-stock") : Promise.resolve([])), [tab, company.id]);
  const jobs = useAsync(() => (tab === "data" ? capi.get<any[]>("/data-jobs") : Promise.resolve([])), [tab, company.id]);
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const [budget, setBudget] = useState({ name: "", financialYearId: "", lines: [{ ledgerId: "", amount: "" }] });
  const [cs, setCs] = useState({ asOfDate: today(), value: "" });
  const [restore, setRestore] = useState<{ file: File | null; clientId: string; name: string }>({
    file: null,
    clientId: company.clientId,
    name: `${company.name} (restored)`,
  });

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
  const saveCompany = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        capi.patch("", {
          name: f.name,
          legalName: f.legalName,
          pan: f.pan,
          tan: f.tan,
          address: f.address,
          gstEnabled: f.gstEnabled,
          inventoryEnabled: f.inventoryEnabled,
          tdsEnabled: f.tdsEnabled,
          requireVoucherApproval: f.requireVoucherApproval,
          lockDate: f.lockDate || null,
          invoiceTemplate: { title: f.title, format: f.format, terms: f.terms, footer: f.footer, showHsn: f.showHsn, showBankDetails: f.showBankDetails },
        }),
      "Settings saved.",
      () => Promise.all([reloadCompany(), reloadCompanies()]),
    );
  };

  return (
    <>
      <Tabs
        tabs={[
          ["company", "Company & invoice"],
          ["years", "Financial years"],
          ["numbering", "Voucher numbering"],
          ["team", "Team access"],
          ["budgets", "Budgets"],
          ["stock", "Closing stock"],
          ["data", "Backup & data"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err} />
      <SuccessBox message={msg} />
      {tab === "company" && (
        <form className="panel form-grid" onSubmit={saveCompany}>
          {(
            [
              ["name", "Company name"],
              ["legalName", "Legal name"],
              ["pan", "PAN"],
              ["tan", "TAN"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!can("admin")} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
            </Field>
          ))}
          <Field label="Address (with PIN)" full>
            <input disabled={!can("admin")} value={f.address} onChange={(e) => setF((x) => ({ ...x, address: e.target.value }))} />
          </Field>
          <Field label="Lock books up to" hint="No voucher can be created or changed on or before this date.">
            <input type="date" disabled={!can("admin")} value={f.lockDate} onChange={(e) => setF((x) => ({ ...x, lockDate: e.target.value }))} />
          </Field>
          <div />
          {(
            [
              ["gstEnabled", "GST"],
              ["inventoryEnabled", "Integrate inventory with accounts"],
              ["tdsEnabled", "TDS / TCS"],
              ["requireVoucherApproval", "Maker-checker approval for accountants' vouchers"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="checkbox-label">
              <input type="checkbox" disabled={!can("admin")} checked={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))} /> {label}
            </label>
          ))}
          <h3 className="full sub-head">Invoice template</h3>
          <Field label="Invoice title">
            <input value={f.title} placeholder="Tax Invoice" onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} />
          </Field>
          <Field label="Format">
            <select value={f.format} onChange={(e) => setF((x) => ({ ...x, format: e.target.value }))}>
              <option value="standard">Standard</option>
              <option value="compact">Compact</option>
              <option value="detailed">Detailed (tax per line, batches)</option>
            </select>
          </Field>
          <Field label="Terms & conditions" full>
            <textarea rows={3} value={f.terms} onChange={(e) => setF((x) => ({ ...x, terms: e.target.value }))} />
          </Field>
          <Field label="Footer" full>
            <input value={f.footer} onChange={(e) => setF((x) => ({ ...x, footer: e.target.value }))} />
          </Field>
          <label className="checkbox-label">
            <input type="checkbox" checked={f.showHsn} onChange={(e) => setF((x) => ({ ...x, showHsn: e.target.checked }))} /> Show HSN/SAC
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={f.showBankDetails} onChange={(e) => setF((x) => ({ ...x, showBankDetails: e.target.checked }))} /> Show bank details
          </label>
          {can("admin") && (
            <div className="modal-actions full">
              <Button type="submit">Save settings</Button>
            </div>
          )}
        </form>
      )}
      {tab === "years" && (
        <>
          <DataTable
            rowKey={(y: any) => y.id}
            rows={years.data || []}
            columns={[
              { key: "label", label: "Financial year" },
              { key: "startDate", label: "From" },
              { key: "endDate", label: "To" },
              { key: "status", label: "Status", render: (y: any) => <StatusBadge status={y.status === "Open" ? "Posted" : "Cancelled"} /> },
              {
                key: "act",
                label: "",
                render: (y: any) =>
                  can("admin") ? (
                    <button
                      className="text-link"
                      onClick={() =>
                        run(
                          () => capi.post(`/financial-years/${y.id}/${y.status === "Open" ? "close" : "reopen"}`, {}),
                          `${y.label} ${y.status === "Open" ? "closed" : "reopened"}.`,
                          () => Promise.all([years.reload(), reloadCompany()]),
                        )
                      }
                    >
                      {y.status === "Open" ? "Close year" : "Reopen"}
                    </button>
                  ) : null,
              },
            ]}
          />
          {can("write") && (
            <Button onClick={() => run(() => capi.post("/financial-years", {}), "Next financial year created.", years.reload)}>
              Create next financial year
            </Button>
          )}
          <Notice title="Year-end">
            Closing a year locks its vouchers. Balance-sheet balances carry forward automatically; the year's profit moves into the Profit & Loss A/c. Opening
            balances and P&L A/c in later years are derived from posted data, so there is no separate closing entry to pass.
          </Notice>
        </>
      )}
      {tab === "numbering" && (
        <DataTable
          rowKey={(s: any) => s.id}
          rows={series.data || []}
          pageSize={60}
          columns={[
            { key: "financialYear", label: "Year" },
            { key: "voucherType", label: "Voucher type", render: (s: any) => typeLabel(s.voucherType) },
            { key: "numberingMethod", label: "Method" },
            { key: "preview", label: "Next number" },
            {
              key: "act",
              label: "",
              render: (s: any) =>
                can("admin") ? (
                  <button
                    className="text-link"
                    onClick={() => {
                      const prefix = window.prompt("Prefix", s.prefix);
                      if (prefix === null) return;
                      const next = window.prompt("Next number", String(s.nextNumber));
                      if (!next) return;
                      void run(() => capi.patch(`/voucher-series/${s.id}`, { prefix, nextNumber: Number(next) }), "Numbering updated.", series.reload);
                    }}
                  >
                    Edit
                  </button>
                ) : null,
            },
          ]}
        />
      )}
      {tab === "team" &&
        (can("admin") ? (
          <DataTable
            rowKey={(u: any) => u.userId}
            rows={team.data || []}
            columns={[
              { key: "name", label: "Member" },
              { key: "email", label: "Email" },
              {
                key: "role",
                label: "Accounting role",
                render: (u: any) => (
                  <select
                    aria-label="Role"
                    value={u.role}
                    onChange={(e) =>
                      run(() => api.put(`/accounting/roles/${u.userId}`, { role: e.target.value, clientIds: u.clientIds }), "Role updated.", team.reload)
                    }
                  >
                    {["Admin", "Accountant", "Reviewer", "Viewer"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                ),
              },
              {
                key: "clients",
                label: "Client access",
                render: (u: any) =>
                  u.role === "Admin" ? (
                    "All clients"
                  ) : (
                    <select
                      multiple
                      aria-label="Clients"
                      value={u.clientIds}
                      onChange={(e) => {
                        const ids = [...e.target.selectedOptions].map((o) => o.value);
                        void run(() => api.put(`/accounting/roles/${u.userId}`, { role: u.role, clientIds: ids }), "Client access updated.", team.reload);
                      }}
                    >
                      {(clients.data || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company}
                        </option>
                      ))}
                    </select>
                  ),
              },
            ]}
          />
        ) : (
          <Notice title="Admins only">Ask an accounting Admin in your firm to change roles.</Notice>
        ))}
      {tab === "team" && (
        <Notice title="Roles">
          Admin: everything incl. settings, year close and roles · Accountant: masters and vouchers (subject to approval when enabled) · Reviewer: read and
          approve · Viewer: read-only. Leave client access empty to allow all clients.
        </Notice>
      )}
      {tab === "budgets" && (
        <div className="grid-2">
          <DataTable
            rowKey={(b: any) => b.id}
            rows={budgets.data || []}
            empty="No budgets yet."
            columns={[
              { key: "name", label: "Budget" },
              { key: "financialYear", label: "Year" },
            ]}
          />
          {can("write") && (
            <form
              className="panel form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => capi.post("/budgets", { ...budget, lines: budget.lines.filter((l) => l.ledgerId && l.amount) }),
                  "Budget saved. See Financial Reports › Budget vs Actual.",
                  budgets.reload,
                );
              }}
            >
              <Field label="Budget name">
                <input required value={budget.name} onChange={(e) => setBudget((b) => ({ ...b, name: e.target.value }))} />
              </Field>
              <Field label="Financial year">
                <select required value={budget.financialYearId} onChange={(e) => setBudget((b) => ({ ...b, financialYearId: e.target.value }))}>
                  <option value="">Select</option>
                  {(years.data || []).map((y: any) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                    </option>
                  ))}
                </select>
              </Field>
              {budget.lines.map((l, i) => (
                <div key={i} className="inline-form">
                  <LedgerSelect
                    ledgers={ledgers.data || []}
                    value={l.ledgerId}
                    onChange={(v) => setBudget((b) => ({ ...b, lines: b.lines.map((x, j) => (j === i ? { ...x, ledgerId: v } : x)) }))}
                    filter={(x) => x.nature === "Expenses" || x.nature === "Income"}
                  />
                  <input
                    placeholder="Amount (income negative)"
                    value={l.amount}
                    onChange={(e) => setBudget((b) => ({ ...b, lines: b.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) }))}
                  />
                </div>
              ))}
              <button type="button" className="text-link" onClick={() => setBudget((b) => ({ ...b, lines: [...b.lines, { ledgerId: "", amount: "" }] }))}>
                + Add line
              </button>
              <Button type="submit">Save budget</Button>
            </form>
          )}
        </div>
      )}
      {tab === "stock" && (
        <>
          {company.inventoryEnabled ? (
            <Notice title="Computed from inventory">Closing stock is valued from stock items (FIFO / weighted average). See Inventory › Stock summary.</Notice>
          ) : (
            <>
              <DataTable
                rowKey={(r: any) => r.id}
                rows={closing.data || []}
                empty="Enter closing stock values for period ends; the P&L and balance sheet use the latest value on or before the report date."
                columns={[
                  { key: "asOfDate", label: "As at" },
                  { key: "value", label: "Value", align: "right", render: (r: any) => <Amount value={r.value} /> },
                ]}
              />
              {can("write") && (
                <form
                  className="panel inline-form"
                  onSubmit={(e) => (e.preventDefault(), void run(() => capi.post("/closing-stock", cs), "Closing stock saved.", closing.reload))}
                >
                  <input type="date" value={cs.asOfDate} onChange={(e) => setCs((c) => ({ ...c, asOfDate: e.target.value }))} />
                  <input required placeholder="Value (₹)" value={cs.value} onChange={(e) => setCs((c) => ({ ...c, value: e.target.value }))} />
                  <Button type="submit">Save</Button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {tab === "data" && (
        <div className="grid-2">
          <div className="panel form-stack">
            <h3 className="sub-head">Backup</h3>
            <p className="muted">Download a checksummed JSON backup of this company's books (masters, vouchers, GST, inventory, banking and payroll).</p>
            {can("admin") && <Button onClick={() => download(capi.url("/backup"))}>Download backup</Button>}
            <h3 className="sub-head">Restore into a new company</h3>
            <input type="file" accept=".json" aria-label="Backup file" onChange={(e) => setRestore((r) => ({ ...r, file: e.target.files?.[0] || null }))} />
            <Field label="Client">
              <select value={restore.clientId} onChange={(e) => setRestore((r) => ({ ...r, clientId: e.target.value }))}>
                {(clients.data || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New company name">
              <input value={restore.name} onChange={(e) => setRestore((r) => ({ ...r, name: e.target.value }))} />
            </Field>
            {can("admin") && (
              <Button
                disabled={!restore.file}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("clientId", restore.clientId);
                  fd.append("name", restore.name);
                  if (restore.file) fd.append("file", restore.file);
                  void run(async () => {
                    const r = await api.post<{ companyId: string }>("/accounting/restore", fd);
                    await reloadCompanies();
                    selectCompany(r.companyId);
                  }, "Backup restored as a new company.");
                }}
              >
                Restore
              </Button>
            )}
          </div>
          <div>
            <h3 className="sub-head">Import & export history</h3>
            <DataTable
              rowKey={(j: any) => j.id}
              rows={jobs.data || []}
              columns={[
                { key: "at", label: "When", render: (j: any) => formatDateTime(j.at) },
                { key: "direction", label: "Type" },
                { key: "kind", label: "Data" },
                { key: "by", label: "By" },
                {
                  key: "summary",
                  label: "Summary",
                  render: (j: any) =>
                    Object.entries(j.summary)
                      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                      .join(", "),
                },
              ]}
            />
          </div>
        </div>
      )}
    </>
  );
}
