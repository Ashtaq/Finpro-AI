// Accounting module client helpers: typed API wrappers and exact money formatting.
import { api } from "../lib/api";

export interface Company {
  id: string;
  clientId: string;
  clientName?: string;
  name: string;
  legalName: string;
  pan: string;
  tan: string;
  address: string;
  stateCode: string;
  booksStartDate: string;
  fyStartMonth: number;
  gstEnabled: boolean;
  inventoryEnabled: boolean;
  payrollEnabled: boolean;
  tdsEnabled: boolean;
  requireVoucherApproval: boolean;
  lockDate: string | null;
  gstin?: string;
  status: string;
  invoiceTemplate: Record<string, unknown>;
  financialYears?: { id: string; label: string; startDate: string; endDate: string; status: string }[];
}

export interface Ledger {
  id: string;
  groupId: string;
  groupName?: string;
  groupPath?: string;
  nature?: string;
  kind?: "Bank" | "Cash" | "Debtor" | "Creditor" | "Duty" | "General";
  name: string;
  alias: string;
  systemCode: string | null;
  openingBalance: string;
  balance?: string;
  gstin: string;
  pan: string;
  stateCode: string;
  gstRegistrationType: string;
  address: string;
  email: string;
  phone: string;
  creditLimit: string | null;
  creditDays: number | null;
  billWise: boolean;
  costCentresApplicable: boolean;
  defaultGstRate: string | null;
  defaultHsn: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  active: boolean;
}

export interface Group {
  id: string;
  name: string;
  parentId: string | null;
  nature: string;
  systemCode: string | null;
  isSystem: boolean;
  path?: string;
}

export interface VoucherSummary {
  id: string;
  type: string;
  number: string | null;
  date: string;
  referenceNo: string;
  partyName: string;
  narration: string;
  status: string;
  total: string;
  source: string;
  revision: number;
}

export interface VoucherEntry {
  id?: string;
  ledgerId: string;
  ledgerName?: string;
  debit: string;
  credit: string;
  narration?: string;
  billType?: string | null;
  billRef?: string | null;
  instrumentNo?: string | null;
  bankDate?: string | null;
  costAllocations?: { costCentreId: string; costCentre?: string; amount: string }[];
}

export interface VoucherDetail extends VoucherSummary {
  referenceDate: string;
  partyLedgerId: string | null;
  placeOfSupply: string;
  isInterState: boolean;
  reverseCharge: boolean;
  gstInvoiceType: string;
  originalInvoiceNo: string;
  dueDate: string;
  statusReason: string;
  entries: VoucherEntry[];
  items: {
    id: string;
    stockItemId: string | null;
    itemName: string | null;
    ledgerId: string | null;
    description: string;
    hsnSac: string;
    qty: string;
    rate: string;
    discount: string;
    taxable: string;
    gstRate: string;
    cgst: string;
    sgst: string;
    igst: string;
    cess: string;
    batchNo: string | null;
    godownId: string | null;
  }[];
  tds: { kind: string; section: string; sectionId: string; base: string; rate: string; amount: string } | null;
  approvals: { action: string; actor: string; comment: string; at: string }[];
  revisions: { revision: number; reason: string; at: string }[];
  eInvoice: { status: string; irn: string | null; ackNo: string | null; ackDate: string | null } | null;
  attachments: { id: string; documentId: string; name: string }[];
  warnings?: string[];
}

export interface Me {
  role: "Admin" | "Accountant" | "Reviewer" | "Viewer";
  capabilities: string[];
  restrictedToClientIds: string[] | null;
}

export const VOUCHER_TYPES = [
  "Journal",
  "Payment",
  "Receipt",
  "Contra",
  "Sales",
  "Purchase",
  "DebitNote",
  "CreditNote",
  "StockJournal",
  "DeliveryNote",
  "ReceiptNote",
] as const;
export const INVOICE_TYPES = ["Sales", "Purchase", "DebitNote", "CreditNote"];
export const TYPE_LABEL: Record<string, string> = {
  DebitNote: "Debit Note",
  CreditNote: "Credit Note",
  StockJournal: "Stock Journal",
  DeliveryNote: "Delivery Note",
  ReceiptNote: "Receipt Note",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] || t;

/** API bound to one company. */
export const companyApi = (companyId: string) => {
  const base = `/accounting/companies/${companyId}`;
  return {
    base,
    get: <T>(p: string) => api.get<T>(`${base}${p}`),
    post: <T>(p: string, body?: Record<string, unknown> | FormData) => api.post<T>(`${base}${p}`, body),
    put: <T>(p: string, body: Record<string, unknown>) => api.put<T>(`${base}${p}`, body),
    patch: <T>(p: string, body: Record<string, unknown>) => api.patch<T>(`${base}${p}`, body),
    del: (p: string) => api.del(`${base}${p}`),
    url: (p: string) => api.url(`${base}${p}`),
  };
};
export type CompanyApi = ReturnType<typeof companyApi>;

/** Format an exact decimal string with Indian digit grouping, without converting through floats. */
export function money(value: string | null | undefined, opts: { symbol?: boolean; blankZero?: boolean } = {}) {
  if (value === null || value === undefined || value === "") return opts.blankZero ? "" : "—";
  const neg = value.startsWith("-");
  const [w, f = "00"] = value.replace("-", "").split(".");
  if (opts.blankZero && /^0*$/.test(w) && /^0*$/.test(f)) return "";
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const s = `${rest ? `${rest},` : ""}${last3}.${f.padEnd(2, "0").slice(0, 2)}`;
  return `${neg ? "-" : ""}${opts.symbol === false ? "" : "₹"}${s}`;
}

/** Add decimal strings exactly (paise integers). */
export function addAmounts(values: (string | undefined | null)[]) {
  let total = 0;
  for (const v of values) total += toPaise(v);
  return fromPaise(total);
}
export function toPaise(v: string | undefined | null) {
  if (!v) return 0;
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(v.trim().replace(/,/g, ""));
  if (!m) return NaN;
  const p = Number(m[2] || "0") * 100 + Number((m[3] || "").padEnd(2, "0"));
  return m[1] ? -p : p;
}
export function fromPaise(p: number) {
  const neg = p < 0;
  const s = String(Math.abs(p)).padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export function fyStart(date = today(), month = 4) {
  const [y, m] = date.split("-").map(Number);
  const sy = m >= month ? y : y - 1;
  return `${sy}-${String(month).padStart(2, "0")}-01`;
}

export const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "96": "Foreign Country",
  "97": "Other Territory",
};

export const statusTone = (s: string) =>
  s === "Posted" || s === "Matched" || s === "Filed" || s === "Generated" || s === "Cleared"
    ? "success"
    : s === "PendingApproval" || s === "Draft" || s === "Unmatched" || s === "Prepared"
      ? "warning"
      : s === "Cancelled" || s === "Rejected" || s === "Bounced"
        ? "danger"
        : "default";

/** Trigger a file download for an authenticated GET (cookie session). */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
