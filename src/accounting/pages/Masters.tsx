import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Upload } from "lucide-react";
import { Badge, Button, ErrorBox, Modal, Spinner, SuccessBox } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, Field, Tabs } from "../components";
import { useCompany } from "../context";
import { fromPaise, Group, Ledger, money, STATES, toPaise } from "../lib";

type Tab = "ledgers" | "groups" | "cost";

const blankLedger = () => ({
  name: "",
  alias: "",
  groupId: "",
  openingBalance: "",
  openingSide: "Dr",
  gstin: "",
  pan: "",
  stateCode: "",
  gstRegistrationType: "Regular",
  address: "",
  email: "",
  phone: "",
  creditLimit: "",
  creditDays: "",
  defaultGstRate: "",
  defaultHsn: "",
  costCentresApplicable: false,
  bankName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  active: true,
});

export default function Masters() {
  const { capi, company, can } = useCompany();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("ledgers");
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers?withBalances=1&active=all"), [company.id]);
  const groups = useAsync(() => capi.get<Group[]>("/groups"), [company.id]);
  const centres = useAsync(() => capi.get<{ id: string; name: string; category: string | null; active: boolean }[]>("/cost-centres"), [company.id]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>(blankLedger());
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [groupForm, setGroupForm] = useState({ name: "", parentId: "" });
  const [ccName, setCcName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("name,group,opening,side,gstin\n");

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const groupOf = (id: string) => groups.data?.find((g) => g.id === id);
  const selectedGroup = groupOf(String(form.groupId));
  const isParty = /Debtors|Creditors/.test(selectedGroup?.path || "");
  const isBank = /Bank/.test(selectedGroup?.path || "");

  const openLedger = (l?: Ledger) => {
    setErr("");
    setEditing(l || null);
    if (l) {
      const ob = l.openingBalance.startsWith("-") ? l.openingBalance.slice(1) : l.openingBalance;
      setForm({
        ...blankLedger(),
        ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v === null ? "" : typeof v === "number" ? String(v) : (v as string | boolean)])),
        openingBalance: ob === "0.00" ? "" : ob,
        openingSide: l.openingBalance.startsWith("-") ? "Cr" : "Dr",
      });
    } else setForm(blankLedger());
    setOpen(true);
  };

  const saveLedger = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    const body: Record<string, unknown> = {
      name: form.name,
      alias: form.alias,
      groupId: form.groupId,
      openingBalance: form.openingBalance || "0",
      openingSide: form.openingSide,
      gstin: form.gstin,
      pan: form.pan,
      stateCode: form.stateCode,
      gstRegistrationType: form.gstRegistrationType,
      address: form.address,
      email: form.email,
      phone: form.phone,
      creditLimit: form.creditLimit === "" ? null : form.creditLimit,
      creditDays: form.creditDays === "" ? null : Number(form.creditDays),
      defaultGstRate: form.defaultGstRate === "" ? null : form.defaultGstRate,
      defaultHsn: form.defaultHsn,
      costCentresApplicable: form.costCentresApplicable,
      bankName: form.bankName,
      bankAccountNumber: form.bankAccountNumber,
      bankIfsc: form.bankIfsc,
      active: form.active,
    };
    try {
      if (editing) {
        if (editing.systemCode) {
          delete body.name;
          delete body.groupId;
        }
        await capi.patch(`/ledgers/${editing.id}`, body);
      } else await capi.post("/ledgers", body);
      setOpen(false);
      await ledgers.reload();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  const addGroup = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await capi.post("/groups", groupForm);
      setGroupForm({ name: "", parentId: "" });
      await groups.reload();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const addCentre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await capi.post("/cost-centres", { name: ccName });
      setCcName("");
      await centres.reload();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const runImport = async () => {
    setErr("");
    try {
      const r = await capi.post<{ created: number; errors: { row: number; error: string }[] }>("/ledgers/import", { csv });
      setMsg(`${r.created} ledger(s) imported${r.errors.length ? `; skipped rows: ${r.errors.map((x) => `${x.row} (${x.error})`).join(", ")}` : ""}.`);
      setImportOpen(false);
      await ledgers.reload();
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  const totals = (ledgers.data || []).reduce(
    (a, l) => {
      const v = toPaise(l.balance);
      if (v > 0) a.dr += v;
      else a.cr -= v;
      return a;
    },
    { dr: 0, cr: 0 },
  );

  return (
    <>
      <Tabs
        tabs={[
          ["ledgers", "Ledgers"],
          ["groups", "Groups"],
          ["cost", "Cost centres"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err || ledgers.error || groups.error} />
      <SuccessBox message={msg} />
      {tab === "ledgers" && (
        <>
          <div className="toolbar">
            <div className="search-box light">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ledgers, GSTIN, group…" aria-label="Search ledgers" />
            </div>
            {can("write") && (
              <div className="page-actions">
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  <Upload size={15} /> Import CSV
                </Button>
                <Button onClick={() => openLedger()}>
                  <Plus size={15} /> New ledger
                </Button>
              </div>
            )}
          </div>
          {ledgers.loading && !ledgers.data ? (
            <Spinner />
          ) : (
            <DataTable
              rowKey={(l) => l.id}
              rows={ledgers.data || []}
              filter={q}
              pageSize={50}
              onRowClick={(l) => navigate(`/accounting/reports?report=ledger&ledgerId=${l.id}`)}
              columns={[
                {
                  key: "name",
                  label: "Ledger",
                  render: (l) => (
                    <span>
                      {l.name} {!l.active && <Badge>inactive</Badge>} {l.systemCode && <Badge tone="info">system</Badge>}
                    </span>
                  ),
                },
                { key: "groupName", label: "Group" },
                { key: "gstin", label: "GSTIN" },
                { key: "openingBalance", label: "Opening (Dr+)", align: "right", render: (l) => <Amount value={l.openingBalance} /> },
                { key: "balance", label: "Balance (Dr+)", align: "right", render: (l) => <Amount value={l.balance} /> },
                {
                  key: "edit",
                  label: "",
                  render: (l) =>
                    can("write") ? (
                      <button
                        className="text-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          openLedger(l);
                        }}
                      >
                        Edit
                      </button>
                    ) : null,
                },
              ]}
            />
          )}
          <p className="muted">
            Balances include opening balances and all posted vouchers (P&L ledgers show all-time movement here; use the Trial Balance for a period). Debit
            balances {money(fromPaise(totals.dr))} · Credit balances {money(fromPaise(totals.cr))}.
          </p>
        </>
      )}
      {tab === "groups" && (
        <>
          {can("write") && (
            <form className="inline-form panel" onSubmit={addGroup}>
              <input required placeholder="New group name" value={groupForm.name} onChange={(e) => setGroupForm((g) => ({ ...g, name: e.target.value }))} />
              <select required value={groupForm.parentId} onChange={(e) => setGroupForm((g) => ({ ...g, parentId: e.target.value }))}>
                <option value="">Under group…</option>
                {(groups.data || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.path}
                  </option>
                ))}
              </select>
              <Button type="submit">Add group</Button>
            </form>
          )}
          <DataTable
            rowKey={(g) => g.id}
            rows={groups.data || []}
            pageSize={60}
            columns={[
              { key: "path", label: "Group" },
              { key: "nature", label: "Nature" },
              { key: "isSystem", label: "Type", render: (g) => (g.isSystem ? <Badge tone="info">Reserved</Badge> : <Badge>Custom</Badge>) },
            ]}
          />
        </>
      )}
      {tab === "cost" && (
        <>
          {can("write") && (
            <form className="inline-form panel" onSubmit={addCentre}>
              <input required placeholder="Cost centre name (e.g. Pune branch)" value={ccName} onChange={(e) => setCcName(e.target.value)} />
              <Button type="submit">Add cost centre</Button>
            </form>
          )}
          <DataTable
            rowKey={(c) => c.id}
            rows={centres.data || []}
            empty="Create cost centres to allocate expenses and income by branch, project or department."
            columns={[
              { key: "name", label: "Cost centre" },
              { key: "category", label: "Category", render: (c) => c.category || "Primary" },
              { key: "active", label: "Status", render: (c) => (c.active ? "Active" : "Inactive") },
            ]}
          />
        </>
      )}

      <Modal open={open} title={editing ? `Edit ${editing.name}` : "New ledger"} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={saveLedger}>
          <Field label="Name">
            <input required disabled={!!editing?.systemCode} value={String(form.name)} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Under group">
            <select required disabled={!!editing?.systemCode} value={String(form.groupId)} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">Select group</option>
              {(groups.data || []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.path}
                </option>
              ))}
            </select>
          </Field>
          {selectedGroup && !["Income", "Expenses"].includes(selectedGroup.nature) && (
            <>
              <Field label="Opening balance">
                <input inputMode="decimal" value={String(form.openingBalance)} onChange={(e) => set("openingBalance", e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Dr / Cr">
                <select value={String(form.openingSide)} onChange={(e) => set("openingSide", e.target.value)}>
                  <option>Dr</option>
                  <option>Cr</option>
                </select>
              </Field>
            </>
          )}
          {isParty && (
            <>
              <Field label="GSTIN">
                <input value={String(form.gstin)} maxLength={15} onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
              </Field>
              <Field label="Registration type">
                <select value={String(form.gstRegistrationType)} onChange={(e) => set("gstRegistrationType", e.target.value)}>
                  {["Regular", "Composition", "Unregistered", "Consumer", "SEZ", "Overseas"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="PAN">
                <input value={String(form.pan)} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase())} />
              </Field>
              <Field label="State">
                <select value={String(form.stateCode)} onChange={(e) => set("stateCode", e.target.value)}>
                  <option value="">From GSTIN</option>
                  {Object.entries(STATES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {k} – {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Credit limit (₹)">
                <input inputMode="decimal" value={String(form.creditLimit)} onChange={(e) => set("creditLimit", e.target.value)} />
              </Field>
              <Field label="Credit days">
                <input inputMode="numeric" value={String(form.creditDays)} onChange={(e) => set("creditDays", e.target.value)} />
              </Field>
              <Field label="Address (with PIN)" full>
                <input value={String(form.address)} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Email">
                <input type="email" value={String(form.email)} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <input value={String(form.phone)} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </>
          )}
          {isBank && (
            <>
              <Field label="Bank name">
                <input value={String(form.bankName)} onChange={(e) => set("bankName", e.target.value)} />
              </Field>
              <Field label="Account number">
                <input value={String(form.bankAccountNumber)} onChange={(e) => set("bankAccountNumber", e.target.value)} />
              </Field>
              <Field label="IFSC">
                <input value={String(form.bankIfsc)} maxLength={11} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} />
              </Field>
            </>
          )}
          {selectedGroup && ["Income", "Expenses"].includes(selectedGroup.nature) && (
            <>
              <Field label="Default GST rate %">
                <input inputMode="decimal" value={String(form.defaultGstRate)} onChange={(e) => set("defaultGstRate", e.target.value)} />
              </Field>
              <Field label="Default HSN/SAC">
                <input value={String(form.defaultHsn)} onChange={(e) => set("defaultHsn", e.target.value)} />
              </Field>
              <label className="checkbox-label full">
                <input type="checkbox" checked={!!form.costCentresApplicable} onChange={(e) => set("costCentresApplicable", e.target.checked)} /> Cost centres
                applicable
              </label>
            </>
          )}
          {editing && (
            <label className="checkbox-label full">
              <input type="checkbox" checked={!!form.active} onChange={(e) => set("active", e.target.checked)} /> Active
            </label>
          )}
          <div className="full">
            <ErrorBox message={err} />
          </div>
          <div className="modal-actions full">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save ledger</Button>
          </div>
        </form>
      </Modal>
      <Modal open={importOpen} title="Import ledgers from CSV" onClose={() => setImportOpen(false)}>
        <div className="form-stack">
          <p className="muted">Columns: name, group (exact group name), opening, side (Dr/Cr), gstin, pan, state, email, phone.</p>
          <textarea rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV content" />
          <ErrorBox message={err} />
          <div className="modal-actions">
            <Button onClick={runImport}>Import</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
