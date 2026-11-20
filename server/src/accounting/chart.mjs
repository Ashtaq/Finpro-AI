// Company set-up: default chart of accounts (the 28 reserved groups familiar to Tally users),
// system ledgers, financial years and voucher numbering series.

import { badRequest, conflict } from "../lib/errors.mjs";
import { nowIso, uuid } from "./access.mjs";

// [code, name, parentCode, nature, affectsGrossProfit, cashFlowClass]
export const DEFAULT_GROUPS = [
  ["CAPITAL", "Capital Account", null, "Liabilities", 0, "Financing"],
  ["LOANS_LIABILITY", "Loans (Liability)", null, "Liabilities", 0, "Financing"],
  ["CURRENT_LIABILITIES", "Current Liabilities", null, "Liabilities", 0, "Operating"],
  ["BRANCH_DIVISIONS", "Branch / Divisions", null, "Liabilities", 0, "Operating"],
  ["SUSPENSE", "Suspense A/c", null, "Liabilities", 0, "Operating"],
  ["FIXED_ASSETS", "Fixed Assets", null, "Assets", 0, "Investing"],
  ["INVESTMENTS", "Investments", null, "Assets", 0, "Investing"],
  ["CURRENT_ASSETS", "Current Assets", null, "Assets", 0, "Operating"],
  ["MISC_EXPENSES_ASSET", "Misc. Expenses (ASSET)", null, "Assets", 0, "Operating"],
  ["SALES", "Sales Accounts", null, "Income", 1, "Operating"],
  ["DIRECT_INCOMES", "Direct Incomes", null, "Income", 1, "Operating"],
  ["INDIRECT_INCOMES", "Indirect Incomes", null, "Income", 0, "Operating"],
  ["PURCHASE", "Purchase Accounts", null, "Expenses", 1, "Operating"],
  ["DIRECT_EXPENSES", "Direct Expenses", null, "Expenses", 1, "Operating"],
  ["INDIRECT_EXPENSES", "Indirect Expenses", null, "Expenses", 0, "Operating"],
  ["RESERVES", "Reserves & Surplus", "CAPITAL", "Liabilities", 0, "Financing"],
  ["SECURED_LOANS", "Secured Loans", "LOANS_LIABILITY", "Liabilities", 0, "Financing"],
  ["UNSECURED_LOANS", "Unsecured Loans", "LOANS_LIABILITY", "Liabilities", 0, "Financing"],
  ["BANK_OD", "Bank OD A/c", "LOANS_LIABILITY", "Liabilities", 0, "Cash"],
  ["DUTIES_TAXES", "Duties & Taxes", "CURRENT_LIABILITIES", "Liabilities", 0, "Operating"],
  ["PROVISIONS", "Provisions", "CURRENT_LIABILITIES", "Liabilities", 0, "Operating"],
  ["SUNDRY_CREDITORS", "Sundry Creditors", "CURRENT_LIABILITIES", "Liabilities", 0, "Operating"],
  ["BANK", "Bank Accounts", "CURRENT_ASSETS", "Assets", 0, "Cash"],
  ["CASH", "Cash-in-Hand", "CURRENT_ASSETS", "Assets", 0, "Cash"],
  ["DEPOSITS", "Deposits (Asset)", "CURRENT_ASSETS", "Assets", 0, "Operating"],
  ["LOANS_ADVANCES", "Loans & Advances (Asset)", "CURRENT_ASSETS", "Assets", 0, "Operating"],
  ["STOCK", "Stock-in-Hand", "CURRENT_ASSETS", "Assets", 0, "Operating"],
  ["SUNDRY_DEBTORS", "Sundry Debtors", "CURRENT_ASSETS", "Assets", 0, "Operating"],
];

// [systemCode, name, groupCode, extra]
const BASE_LEDGERS = [
  ["CASH", "Cash", "CASH", {}],
  ["PL_ACCOUNT", "Profit & Loss A/c", "RESERVES", {}],
  ["ROUND_OFF", "Round Off", "INDIRECT_EXPENSES", {}],
];
const GST_LEDGERS = [];
for (const dir of ["Output", "Input"])
  for (const duty of ["CGST", "SGST", "UTGST", "IGST", "CESS"])
    GST_LEDGERS.push([
      `GST_${dir.toUpperCase()}_${duty}`,
      `${dir} ${duty === "CESS" ? "GST Cess" : duty}`,
      "DUTIES_TAXES",
      { gst_duty_type: duty, gst_duty_direction: dir },
    ]);
for (const duty of ["CGST", "SGST", "UTGST", "IGST", "CESS"])
  GST_LEDGERS.push([
    `GST_RCM_${duty}`,
    `RCM Payable ${duty === "CESS" ? "GST Cess" : duty}`,
    "DUTIES_TAXES",
    { gst_duty_type: duty, gst_duty_direction: "RCM" },
  ]);
const TDS_LEDGERS = [
  ["TDS_PAYABLE", "TDS Payable", "DUTIES_TAXES", {}],
  ["TCS_PAYABLE", "TCS Payable", "DUTIES_TAXES", {}],
  ["TDS_RECEIVABLE", "TDS Receivable", "LOANS_ADVANCES", {}],
];
export const PAYROLL_LEDGERS = [
  ["SALARY_EXPENSE", "Salaries & Wages", "INDIRECT_EXPENSES", {}],
  ["EMPLOYER_PF_EXPENSE", "Employer PF Contribution", "INDIRECT_EXPENSES", {}],
  ["EMPLOYER_ESI_EXPENSE", "Employer ESI Contribution", "INDIRECT_EXPENSES", {}],
  ["SALARY_PAYABLE", "Salary Payable", "PROVISIONS", {}],
  ["PF_PAYABLE", "PF Payable", "DUTIES_TAXES", {}],
  ["ESI_PAYABLE", "ESI Payable", "DUTIES_TAXES", {}],
  ["PT_PAYABLE", "Professional Tax Payable", "DUTIES_TAXES", {}],
  ["TDS_SALARY_PAYABLE", "TDS on Salary Payable", "DUTIES_TAXES", {}],
];

// Default TDS / TCS sections (rates in bp). Rates are data: Admins edit them or add new effective dates.
export const DEFAULT_TDS_SECTIONS = [
  ["TDS", "194C", "Payment to contractors (individual/HUF)", 100, 3000000, 10000000],
  ["TDS", "194C-O", "Payment to contractors (others)", 200, 3000000, 10000000],
  ["TDS", "194J", "Professional / technical fees", 1000, 3000000, 0],
  ["TDS", "194H", "Commission or brokerage", 200, 1500000, 0],
  ["TDS", "194I-B", "Rent — land, building, furniture", 1000, 0, 24000000],
  ["TDS", "194Q", "Purchase of goods", 10, 0, 500000000],
  ["TCS", "206C(1H)", "Sale of goods", 10, 0, 500000000],
];

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
  "Payroll",
];
const SERIES_PREFIX = {
  Journal: "JV",
  Payment: "PMT",
  Receipt: "RCT",
  Contra: "CON",
  Sales: "INV",
  Purchase: "PUR",
  DebitNote: "DN",
  CreditNote: "CN",
  StockJournal: "SJ",
  DeliveryNote: "DLN",
  ReceiptNote: "GRN",
  Payroll: "PAY",
};

// GST state codes that are Union Territories without legislature (UTGST instead of SGST).
export const UT_STATE_CODES = new Set(["04", "25", "26", "31", "35", "38"]);
export const GST_STATES = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  10: "Bihar",
  11: "Sikkim",
  12: "Arunachal Pradesh",
  13: "Nagaland",
  14: "Manipur",
  15: "Mizoram",
  16: "Tripura",
  17: "Meghalaya",
  18: "Assam",
  19: "West Bengal",
  20: "Jharkhand",
  21: "Odisha",
  22: "Chhattisgarh",
  23: "Madhya Pradesh",
  24: "Gujarat",
  26: "Dadra and Nagar Haveli and Daman and Diu",
  27: "Maharashtra",
  29: "Karnataka",
  30: "Goa",
  31: "Lakshadweep",
  32: "Kerala",
  33: "Tamil Nadu",
  34: "Puducherry",
  35: "Andaman and Nicobar Islands",
  36: "Telangana",
  37: "Andhra Pradesh",
  38: "Ladakh",
  97: "Other Territory",
  96: "Foreign Country",
};

/** Financial year containing `date` for a company whose FY starts in `startMonth` (1-12). */
export function fyBounds(date, startMonth = 4) {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 1) - 86400000);
  const end = endDate.toISOString().slice(0, 10);
  const label = startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String(startYear + 1).slice(2)}`;
  return { start, end, label, startYear };
}

export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function createSeries(db, company, fy) {
  const short = `${String(fy.startYear).slice(2)}${String(fy.startYear + 1).slice(2)}`;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO voucher_series(id, organization_id, company_id, financial_year_id, voucher_type, prefix, pad_length) VALUES (?,?,?,?,?,?,4)",
  );
  for (const type of VOUCHER_TYPES) insert.run(uuid(), company.organization_id, company.id, fy.id, type, `${SERIES_PREFIX[type]}/${short}/`);
}

/**
 * Return the financial year for `date`, creating it (and its numbering series) when it is the next
 * consecutive year. Throws for dates before the books begin or for closed years.
 */
export function ensureFinancialYear(db, company, date, { allowClosed = false } = {}) {
  if (date < company.books_start_date) throw badRequest(`Date ${date} is before the books beginning date (${company.books_start_date}).`);
  const b = fyBounds(date, company.fy_start_month);
  let fy = db.prepare("SELECT * FROM financial_years WHERE company_id = ? AND start_date <= ? AND end_date >= ?").get(company.id, date, date);
  if (!fy) {
    const last = db.prepare("SELECT * FROM financial_years WHERE company_id = ? ORDER BY start_date DESC LIMIT 1").get(company.id);
    if (last && addDays(last.end_date, 1) !== b.start) throw badRequest(`Financial year ${b.label} cannot be opened yet — create the years in between first.`);
    const id = uuid();
    db.prepare("INSERT INTO financial_years(id, organization_id, company_id, label, start_date, end_date) VALUES (?,?,?,?,?,?)").run(
      id,
      company.organization_id,
      company.id,
      b.label,
      b.start,
      b.end,
    );
    fy = db.prepare("SELECT * FROM financial_years WHERE id = ?").get(id);
    createSeries(db, company, { ...b, id });
  }
  if (fy.status === "Closed" && !allowClosed) throw badRequest(`${fy.label} is closed. Reopen it to make changes.`);
  return fy;
}

function insertLedger(db, company, groups, [code, name, groupCode, extra], userId) {
  const exists = db.prepare("SELECT id FROM ledgers WHERE company_id = ? AND (system_code = ? OR lower(name) = lower(?))").get(company.id, code, name);
  if (exists) return exists.id;
  const id = uuid();
  db.prepare(
    `INSERT INTO ledgers(id, organization_id, company_id, group_id, name, system_code, gst_duty_type, gst_duty_direction, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, company.organization_id, company.id, groups[groupCode], name, code, extra.gst_duty_type ?? null, extra.gst_duty_direction ?? null, userId, userId);
  return id;
}

export function groupIdsByCode(db, companyId) {
  return Object.fromEntries(
    db
      .prepare("SELECT system_code, id FROM account_groups WHERE company_id = ? AND system_code IS NOT NULL")
      .all(companyId)
      .map((r) => [r.system_code, r.id]),
  );
}

export function ensureSystemLedgers(db, company, set, userId) {
  const groups = groupIdsByCode(db, company.id);
  const list = { gst: GST_LEDGERS, tds: TDS_LEDGERS, payroll: PAYROLL_LEDGERS, base: BASE_LEDGERS }[set];
  for (const l of list) insertLedger(db, company, groups, l, userId);
}

export function systemLedger(db, companyId, code) {
  const row = db.prepare("SELECT * FROM ledgers WHERE company_id = ? AND system_code = ?").get(companyId, code);
  if (!row) throw badRequest(`System ledger ${code} is missing for this company.`);
  return row;
}

/** Create a company with its default masters. Runs inside the caller's transaction. */
export function createCompanyBooks(db, { organizationId, clientId, userId, input }) {
  const id = uuid();
  const company = {
    id,
    organization_id: organizationId,
    client_id: clientId,
    books_start_date: input.booksStartDate,
    fy_start_month: input.fyStartMonth ?? 4,
  };
  if (
    db
      .prepare("SELECT 1 FROM accounting_companies WHERE organization_id = ? AND client_id = ? AND lower(name) = lower(?)")
      .get(organizationId, clientId, input.name)
  )
    throw conflict("This client already has a company with that name.");
  db.prepare(
    `INSERT INTO accounting_companies(id, organization_id, client_id, name, legal_name, pan, tan, cin, address, state_code, base_currency, books_start_date,
       fy_start_month, gst_enabled, inventory_enabled, payroll_enabled, tds_enabled, require_voucher_approval, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    organizationId,
    clientId,
    input.name,
    input.legalName ?? "",
    input.pan ?? "",
    input.tan ?? "",
    input.cin ?? "",
    input.address ?? "",
    input.stateCode ?? "",
    input.baseCurrency ?? "INR",
    input.booksStartDate,
    company.fy_start_month,
    input.gstEnabled === false ? 0 : 1,
    input.inventoryEnabled ? 1 : 0,
    input.payrollEnabled ? 1 : 0,
    input.tdsEnabled ? 1 : 0,
    input.requireVoucherApproval ? 1 : 0,
    userId,
    userId,
  );

  // Groups
  const codes = {};
  const insertGroup = db.prepare(
    `INSERT INTO account_groups(id, organization_id, company_id, name, parent_id, nature, affects_gross_profit, system_code, cash_flow_class, sort_order, is_system, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  );
  DEFAULT_GROUPS.forEach(([code, name, parent, nature, gp, cf], i) => {
    codes[code] = uuid();
    insertGroup.run(codes[code], organizationId, id, name, parent ? codes[parent] : null, nature, gp, code, cf, i, userId, userId);
  });

  for (const l of BASE_LEDGERS) insertLedger(db, company, codes, l, userId);
  if (input.gstEnabled !== false) for (const l of GST_LEDGERS) insertLedger(db, company, codes, l, userId);
  if (input.tdsEnabled) {
    for (const l of TDS_LEDGERS) insertLedger(db, company, codes, l, userId);
    seedTdsSections(db, { ...company }, input.booksStartDate);
  }
  if (input.payrollEnabled) for (const l of PAYROLL_LEDGERS) insertLedger(db, company, codes, l, userId);

  // Inventory masters every company gets (harmless when inventory is off).
  db.prepare("INSERT INTO warehouses(id, organization_id, company_id, name, is_default) VALUES (?,?,?,?,1)").run(uuid(), organizationId, id, "Main Location");
  db.prepare("INSERT INTO units_of_measure(id, organization_id, company_id, symbol, name, uqc) VALUES (?,?,?,?,?,?)").run(
    uuid(),
    organizationId,
    id,
    "Nos",
    "Numbers",
    "NOS",
  );

  if (input.gstin) {
    db.prepare("INSERT INTO gst_registrations(id, organization_id, company_id, gstin, state_code, effective_from, is_primary) VALUES (?,?,?,?,?,?,1)").run(
      uuid(),
      organizationId,
      id,
      input.gstin,
      input.gstin.slice(0, 2),
      input.booksStartDate,
    );
    if (!input.stateCode) db.prepare("UPDATE accounting_companies SET state_code = ? WHERE id = ?").run(input.gstin.slice(0, 2), id);
  }

  ensureFinancialYear(db, { ...company }, input.booksStartDate);
  return id;
}

export function seedTdsSections(db, company, effectiveFrom) {
  const tdsLedger = db.prepare("SELECT id FROM ledgers WHERE company_id = ? AND system_code = 'TDS_PAYABLE'").get(company.id)?.id ?? null;
  const tcsLedger = db.prepare("SELECT id FROM ledgers WHERE company_id = ? AND system_code = 'TCS_PAYABLE'").get(company.id)?.id ?? null;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO tds_sections(id, organization_id, company_id, kind, section, description, rate_bp, threshold_single_paise, threshold_annual_paise, effective_from, ledger_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const [kind, section, description, rate, single, annual] of DEFAULT_TDS_SECTIONS)
    ins.run(
      uuid(),
      company.organization_id,
      company.id,
      kind,
      section,
      description,
      rate,
      single,
      annual,
      effectiveFrom,
      kind === "TDS" ? tdsLedger : tcsLedger,
    );
}

export const touch = () => nowIso();
