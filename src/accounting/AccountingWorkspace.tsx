import { FormEvent, lazy, Suspense, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Building2, Plus } from "lucide-react";
import { Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Client } from "../types";
import { Field } from "./components";
import { AccountingProvider, useAccounting } from "./context";
import { fyStart, STATES } from "./lib";
import "./accounting.css";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Masters = lazy(() => import("./pages/Masters"));
const Vouchers = lazy(() => import("./pages/Vouchers"));
const SalesPurchase = lazy(() => import("./pages/SalesPurchase"));
const Gst = lazy(() => import("./pages/Gst"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Reports = lazy(() => import("./pages/Reports"));
const Banking = lazy(() => import("./pages/Banking"));
const Payroll = lazy(() => import("./pages/Payroll"));
const Compliance = lazy(() => import("./pages/Compliance"));
const Audit = lazy(() => import("./pages/Audit"));
const SettingsPage = lazy(() => import("./pages/Settings"));

const SECTIONS: [string, string][] = [
  ["", "Dashboard"],
  ["masters", "Accounts & Ledgers"],
  ["vouchers", "Vouchers"],
  ["sales-purchase", "Sales & Purchase"],
  ["gst", "GST"],
  ["inventory", "Inventory"],
  ["reports", "Financial Reports"],
  ["banking", "Banking"],
  ["payroll", "Payroll"],
  ["compliance", "Tax & Compliance"],
  ["audit", "Audit & AI"],
  ["settings", "Settings"],
];

function NewCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reloadCompanies, selectCompany } = useAccounting();
  const clients = useAsync(() => (open ? api.get<Client[]>("/clients") : Promise.resolve([] as Client[])), [open]);
  const [f, setF] = useState({
    clientId: "",
    name: "",
    legalName: "",
    gstin: "",
    pan: "",
    stateCode: "",
    address: "",
    booksStartDate: fyStart(),
    gstEnabled: true,
    inventoryEnabled: false,
    payrollEnabled: false,
    tdsEnabled: true,
    requireVoucherApproval: false,
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const c = await api.post<{ id: string }>("/accounting/companies", { ...f, gstin: f.gstin.toUpperCase(), pan: f.pan.toUpperCase() });
      await reloadCompanies();
      selectCompany(c.id);
      onClose();
    } catch (ex) {
      setErr(errorMessage(ex));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} title="Create company books" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Client" full>
          <select required value={f.clientId} onChange={(e) => set("clientId", e.target.value)}>
            <option value="">Select client</option>
            {(clients.data || [])
              .filter((c) => c.status !== "Archived")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Company name">
          <input required value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Legal name">
          <input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} />
        </Field>
        <Field label="GSTIN">
          <input value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} />
        </Field>
        <Field label="PAN">
          <input value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} />
        </Field>
        <Field label="State">
          <select value={f.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
            <option value="">From GSTIN</option>
            {Object.entries(STATES).map(([k, v]) => (
              <option key={k} value={k}>
                {k} – {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Books beginning from">
          <input type="date" required value={f.booksStartDate} onChange={(e) => set("booksStartDate", e.target.value)} />
        </Field>
        <Field label="Address (include PIN for e-invoicing)" full>
          <input value={f.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        {(
          [
            ["gstEnabled", "GST"],
            ["inventoryEnabled", "Integrate inventory with accounts"],
            ["tdsEnabled", "TDS / TCS"],
            ["payrollEnabled", "Payroll"],
            ["requireVoucherApproval", "Maker-checker approval for vouchers"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="checkbox-label">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
          </label>
        ))}
        <div className="full">
          <ErrorBox message={err || clients.error} />
        </div>
        <div className="modal-actions full">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create books"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Workspace() {
  const { companies, company, selectCompany, loading, error, can, me } = useAccounting();
  const [open, setOpen] = useState(false);
  if (loading) return <Spinner />;
  return (
    <div className="acct">
      <PageHeader
        eyebrow="Professional accounting"
        title={company ? company.name : "Accounting"}
        description={
          company
            ? `${company.clientName} · ${company.gstin ? `GSTIN ${company.gstin} · ` : ""}Books from ${company.booksStartDate} · Your role: ${me?.role}`
            : "Double-entry books, GST, inventory, banking and payroll for your clients."
        }
        action={
          <div className="page-actions">
            {companies.length > 0 && (
              <select className="company-select" aria-label="Select company" value={company?.id || ""} onChange={(e) => selectCompany(e.target.value)}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.clientName} — {c.name}
                  </option>
                ))}
              </select>
            )}
            {can("write") && (
              <Button onClick={() => setOpen(true)}>
                <Plus size={16} /> New company
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox message={error} />
      <NewCompanyModal open={open} onClose={() => setOpen(false)} />
      {!company ? (
        <div className="panel">
          <EmptyState
            title="No company books yet"
            description="Create books for one of your clients to start recording vouchers. Each client can have several companies, and every company's data is kept separate."
            action={
              can("write") ? (
                <Button onClick={() => setOpen(true)}>
                  <Building2 size={16} /> Create company books
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <nav className="workspace-tabs acct-nav" aria-label="Accounting sections">
            {SECTIONS.map(([path, label]) => (
              <NavLink
                key={path}
                end={path === ""}
                to={path ? `/accounting/${path}` : "/accounting"}
                className={({ isActive }) => (isActive ? "workspace-tab active" : "workspace-tab")}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <Suspense fallback={<Spinner />}>
            <Routes key={company.id}>
              <Route index element={<Dashboard />} />
              <Route path="masters" element={<Masters />} />
              <Route path="vouchers" element={<Vouchers />} />
              <Route path="sales-purchase" element={<SalesPurchase />} />
              <Route path="gst" element={<Gst />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="reports" element={<Reports />} />
              <Route path="banking" element={<Banking />} />
              <Route path="payroll" element={<Payroll />} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="audit" element={<Audit />} />
              <Route path="settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function AccountingWorkspace() {
  return (
    <AccountingProvider>
      <Workspace />
    </AccountingProvider>
  );
}
