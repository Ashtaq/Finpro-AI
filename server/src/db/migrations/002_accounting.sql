-- Finpro AI — Professional accounting & financial management module.
--
-- Conventions (see docs/ACCOUNTING.md):
--   * Every table carries organization_id (the professional firm, i.e. the tenant) and, below the
--     company level, company_id (one set of books). The API scopes every query by both.
--   * A "company" is a set of books kept for a client (clients.id). One client may own several companies.
--   * Money is stored as INTEGER paise (exact). Never REAL. Quantities are INTEGER thousandths
--     (qty_milli), percentages are INTEGER basis points (1800 = 18%), FX rates are INTEGER x 1e6.
--   * Posted financial history is never deleted: vouchers are cancelled, modifications are recorded as
--     immutable revisions, and the accounting audit log is append-only (enforced by triggers).

-- Access control ------------------------------------------------------------------------------------

CREATE TABLE accounting_user_roles (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Accountant', 'Reviewer', 'Viewer')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_id, user_id)
);

-- When a user has any rows here they may only open books of the listed clients (Admins are unrestricted).
CREATE TABLE accounting_client_access (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX idx_acct_client_access_org ON accounting_client_access(organization_id);

-- Companies (books) and financial years --------------------------------------------------------------

CREATE TABLE accounting_companies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  tan TEXT NOT NULL DEFAULT '',
  cin TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',            -- 2-digit GST state code of the principal place of business
  base_currency TEXT NOT NULL DEFAULT 'INR',
  books_start_date TEXT NOT NULL,                 -- YYYY-MM-DD; opening balances are as at this date
  fy_start_month INTEGER NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  gst_enabled INTEGER NOT NULL DEFAULT 1,
  inventory_enabled INTEGER NOT NULL DEFAULT 0,   -- integrate accounts with inventory (closing stock from stock ledger)
  payroll_enabled INTEGER NOT NULL DEFAULT 0,
  tds_enabled INTEGER NOT NULL DEFAULT 0,
  require_voucher_approval INTEGER NOT NULL DEFAULT 0,
  lock_date TEXT,                                 -- no voucher may be created/changed on or before this date
  invoice_template_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_acct_companies_org ON accounting_companies(organization_id, client_id);

CREATE TABLE financial_years (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  label TEXT NOT NULL,                            -- e.g. "FY 2026-27"
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_date >= start_date),
  UNIQUE (company_id, start_date)
);
CREATE INDEX idx_fy_company ON financial_years(company_id, start_date);

-- Chart of accounts -------------------------------------------------------------------------------

CREATE TABLE account_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES account_groups(id),
  nature TEXT NOT NULL CHECK (nature IN ('Assets', 'Liabilities', 'Income', 'Expenses')),
  affects_gross_profit INTEGER NOT NULL DEFAULT 0,
  system_code TEXT,                               -- stable code for reserved groups (SUNDRY_DEBTORS, BANK, ...)
  cash_flow_class TEXT NOT NULL DEFAULT 'Operating' CHECK (cash_flow_class IN ('Operating', 'Investing', 'Financing', 'Cash')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_groups_name ON account_groups(company_id, lower(name));
CREATE UNIQUE INDEX idx_groups_code ON account_groups(company_id, system_code) WHERE system_code IS NOT NULL;
CREATE INDEX idx_groups_parent ON account_groups(parent_id);

CREATE TABLE ledgers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  group_id TEXT NOT NULL REFERENCES account_groups(id),
  name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  opening_balance_paise INTEGER NOT NULL DEFAULT 0, -- Dr positive, Cr negative, as at books_start_date
  system_code TEXT,                               -- PL_ACCOUNT, CASH, ROUND_OFF, GST_OUTPUT_CGST, ...
  -- party details
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  gst_registration_type TEXT NOT NULL DEFAULT 'Regular' CHECK (gst_registration_type IN ('Regular', 'Composition', 'Unregistered', 'Consumer', 'SEZ', 'Overseas')),
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  credit_limit_paise INTEGER,                     -- NULL = no limit
  credit_days INTEGER,
  bill_wise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  -- tax classification
  gst_duty_type TEXT CHECK (gst_duty_type IN ('CGST', 'SGST', 'UTGST', 'IGST', 'CESS')),
  gst_duty_direction TEXT CHECK (gst_duty_direction IN ('Input', 'Output', 'RCM')),
  gst_applicable INTEGER NOT NULL DEFAULT 0,      -- income/expense ledger used in GST invoices
  default_gst_rate_bp INTEGER,
  default_hsn TEXT NOT NULL DEFAULT '',
  tds_section_id TEXT,                            -- party ledger default TDS section
  cost_centres_applicable INTEGER NOT NULL DEFAULT 0,
  -- bank details (for ledgers under Bank Accounts / Bank OD)
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  bank_ifsc TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (credit_limit_paise IS NULL OR credit_limit_paise >= 0)
);
CREATE UNIQUE INDEX idx_ledgers_name ON ledgers(company_id, lower(name));
CREATE UNIQUE INDEX idx_ledgers_code ON ledgers(company_id, system_code) WHERE system_code IS NOT NULL;
CREATE INDEX idx_ledgers_group ON ledgers(group_id);
CREATE INDEX idx_ledgers_gstin ON ledgers(company_id, gstin);

CREATE TABLE cost_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_cost_categories_name ON cost_categories(company_id, lower(name));

CREATE TABLE cost_centres (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  category_id TEXT REFERENCES cost_categories(id),
  parent_id TEXT REFERENCES cost_centres(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_cost_centres_name ON cost_centres(company_id, lower(name));

-- Vouchers --------------------------------------------------------------------------------------------

CREATE TABLE voucher_series (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id),
  voucher_type TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  pad_length INTEGER NOT NULL DEFAULT 4 CHECK (pad_length BETWEEN 1 AND 10),
  numbering_method TEXT NOT NULL DEFAULT 'Automatic' CHECK (numbering_method IN ('Automatic', 'Manual')),
  UNIQUE (financial_year_id, voucher_type)
);

CREATE TABLE vouchers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id),
  voucher_type TEXT NOT NULL CHECK (voucher_type IN ('Journal', 'Payment', 'Receipt', 'Contra', 'Sales', 'Purchase', 'DebitNote', 'CreditNote', 'StockJournal', 'DeliveryNote', 'ReceiptNote', 'Payroll')),
  voucher_number TEXT,                            -- assigned when posted (or at entry for Manual series)
  date TEXT NOT NULL,
  reference_no TEXT NOT NULL DEFAULT '',          -- supplier invoice no. / cheque no. etc.
  reference_date TEXT NOT NULL DEFAULT '',
  party_ledger_id TEXT REFERENCES ledgers(id),
  narration TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Draft', 'PendingApproval', 'Posted', 'Rejected', 'Cancelled')),
  total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  is_accounting INTEGER NOT NULL DEFAULT 1,       -- 0 for pure inventory vouchers (delivery/receipt notes)
  -- GST
  place_of_supply TEXT NOT NULL DEFAULT '',
  is_inter_state INTEGER NOT NULL DEFAULT 0,
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  gst_invoice_type TEXT NOT NULL DEFAULT '' ,     -- B2B / B2CL / B2CS / EXPWP / EXPWOP / SEZ / ''
  original_invoice_no TEXT NOT NULL DEFAULT '',   -- for debit/credit notes
  original_invoice_date TEXT NOT NULL DEFAULT '',
  -- multi-currency
  currency TEXT NOT NULL DEFAULT 'INR',
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000 CHECK (exchange_rate_micros > 0),
  -- links
  order_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',          -- manual | recurring | payroll | bank | import | stock
  source_ref TEXT,
  due_date TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT,
  approved_at TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  status_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_vouchers_company_date ON vouchers(company_id, date, status);
CREATE INDEX idx_vouchers_type ON vouchers(company_id, voucher_type, date);
CREATE INDEX idx_vouchers_party ON vouchers(party_ledger_id);
CREATE UNIQUE INDEX idx_vouchers_number ON vouchers(financial_year_id, voucher_type, voucher_number) WHERE voucher_number IS NOT NULL;

CREATE TABLE voucher_entries (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  line_no INTEGER NOT NULL,
  debit_paise INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  forex_amount_minor INTEGER,                     -- amount in voucher currency (minor units) when not INR
  narration TEXT NOT NULL DEFAULT '',
  -- bill-wise details (receivables / payables)
  bill_type TEXT CHECK (bill_type IN ('New', 'Against', 'Advance', 'OnAccount')),
  bill_ref TEXT,
  bill_due_date TEXT,
  -- banking
  instrument_type TEXT,                           -- Cheque / NEFT / RTGS / UPI / Cash ...
  instrument_no TEXT,
  instrument_date TEXT,
  bank_date TEXT,                                 -- date the bank cleared it (bank reconciliation)
  CHECK ((debit_paise > 0 AND credit_paise = 0) OR (credit_paise > 0 AND debit_paise = 0))
);
CREATE INDEX idx_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX idx_entries_ledger ON voucher_entries(ledger_id);
CREATE INDEX idx_entries_bill ON voucher_entries(company_id, ledger_id, bill_ref);

CREATE TABLE voucher_cost_allocations (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES voucher_entries(id) ON DELETE CASCADE,
  cost_centre_id TEXT NOT NULL REFERENCES cost_centres(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0)
);
CREATE INDEX idx_cost_alloc_entry ON voucher_cost_allocations(entry_id);
CREATE INDEX idx_cost_alloc_centre ON voucher_cost_allocations(cost_centre_id);

-- Inventory / invoice item lines on a voucher.
CREATE TABLE voucher_items (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  stock_item_id TEXT,
  ledger_id TEXT REFERENCES ledgers(id),          -- sales / purchase / income / expense ledger the line posts to
  description TEXT NOT NULL DEFAULT '',
  hsn_sac TEXT NOT NULL DEFAULT '',
  godown_id TEXT,
  batch_no TEXT,
  qty_milli INTEGER NOT NULL DEFAULT 0,
  rate_paise INTEGER NOT NULL DEFAULT 0,
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate_bp INTEGER NOT NULL DEFAULT 0,
  cess_rate_bp INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,          -- SGST or UTGST
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_voucher_items_voucher ON voucher_items(voucher_id);

-- Immutable snapshot of every prior version of a voucher.
CREATE TABLE voucher_revisions (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  company_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  changed_by TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (voucher_id, revision)
);

CREATE TABLE voucher_approval_workflows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  action TEXT NOT NULL CHECK (action IN ('Submitted', 'Approved', 'Rejected')),
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_approvals_voucher ON voucher_approval_workflows(voucher_id);

CREATE TABLE recurring_vouchers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('Weekly', 'Monthly', 'Quarterly', 'Yearly')),
  next_run_date TEXT NOT NULL,
  end_date TEXT,
  template_json TEXT NOT NULL,                    -- same shape as the voucher create payload (without date)
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_recurring_due ON recurring_vouchers(company_id, active, next_run_date);

-- Manual closing stock (used when inventory is not integrated with accounts).
CREATE TABLE closing_stock_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  as_of_date TEXT NOT NULL,
  value_paise INTEGER NOT NULL CHECK (value_paise >= 0),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, as_of_date)
);

-- GST --------------------------------------------------------------------------------------------------

CREATE TABLE gst_registrations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  gstin TEXT NOT NULL,
  state_code TEXT NOT NULL,
  registration_type TEXT NOT NULL DEFAULT 'Regular' CHECK (registration_type IN ('Regular', 'Composition', 'SEZ', 'ISD')),
  effective_from TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  e_invoice_applicable INTEGER NOT NULL DEFAULT 0,
  eway_bill_applicable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, gstin)
);

CREATE TABLE hsn_sac_codes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'HSN' CHECK (kind IN ('HSN', 'SAC')),
  description TEXT NOT NULL DEFAULT '',
  uqc TEXT NOT NULL DEFAULT 'NOS',
  UNIQUE (company_id, code)
);

-- Rate history per HSN/SAC: the rate in force on an invoice date is the latest effective_from <= date.
CREATE TABLE gst_tax_rates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  hsn_sac TEXT NOT NULL,
  rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  cess_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (cess_rate_bp BETWEEN 0 AND 10000),
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, hsn_sac, effective_from)
);

-- One row per voucher x rate: the GST register that GSTR-1/3B and ITC are built from.
CREATE TABLE gst_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('Outward', 'Inward')),
  doc_type TEXT NOT NULL,                         -- Invoice / DebitNote / CreditNote
  date TEXT NOT NULL,
  party_ledger_id TEXT,
  party_gstin TEXT NOT NULL DEFAULT '',
  place_of_supply TEXT NOT NULL DEFAULT '',
  hsn_sac TEXT NOT NULL DEFAULT '',
  rate_bp INTEGER NOT NULL,
  taxable_paise INTEGER NOT NULL,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  itc_eligible INTEGER NOT NULL DEFAULT 1,
  itc_claimed_period TEXT                         -- YYYY-MM when ITC was claimed in GSTR-3B
);
CREATE INDEX idx_gst_txn_company ON gst_transactions(company_id, direction, date);
CREATE INDEX idx_gst_txn_voucher ON gst_transactions(voucher_id);

CREATE TABLE gst_returns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  return_type TEXT NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR3B')),
  period TEXT NOT NULL,                           -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'Prepared' CHECK (status IN ('Prepared', 'Filed')),
  data_json TEXT NOT NULL,
  arn TEXT,
  filed_on TEXT,
  prepared_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, return_type, period)
);

CREATE TABLE gst_payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  period TEXT NOT NULL,
  cpin TEXT NOT NULL DEFAULT '',
  cin TEXT NOT NULL DEFAULT '',
  payment_date TEXT NOT NULL,
  igst_paise INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  cess_paise INTEGER NOT NULL DEFAULT 0 CHECK (cess_paise >= 0),
  interest_paise INTEGER NOT NULL DEFAULT 0 CHECK (interest_paise >= 0),
  late_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (late_fee_paise >= 0),
  voucher_id TEXT REFERENCES vouchers(id),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_gst_payments_company ON gst_payments(company_id, period);

-- Supplier-side data imported from GSTR-2A/2B and its match against the purchase register.
CREATE TABLE gst_reconciliations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  period TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'GSTR2B',
  supplier_gstin TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL DEFAULT '',
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'Unmatched' CHECK (match_status IN ('Matched', 'Mismatch', 'MissingInBooks', 'Unmatched')),
  voucher_id TEXT REFERENCES vouchers(id),
  difference_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_gst_recon_company ON gst_reconciliations(company_id, period);

CREATE TABLE e_invoice_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  voucher_id TEXT NOT NULL UNIQUE REFERENCES vouchers(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PayloadReady' CHECK (status IN ('PayloadReady', 'Generated', 'Cancelled', 'Failed')),
  irn TEXT,
  ack_no TEXT,
  ack_date TEXT,
  signed_qr TEXT,
  error TEXT,
  provider TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE eway_bill_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  eway_bill_no TEXT,
  eway_bill_date TEXT,
  valid_until TEXT,
  transporter_id TEXT NOT NULL DEFAULT '',
  transporter_name TEXT NOT NULL DEFAULT '',
  transport_mode TEXT NOT NULL DEFAULT 'Road' CHECK (transport_mode IN ('Road', 'Rail', 'Air', 'Ship')),
  vehicle_no TEXT NOT NULL DEFAULT '',
  distance_km INTEGER NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Generated', 'Cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_eway_voucher ON eway_bill_records(voucher_id);

-- TDS / TCS --------------------------------------------------------------------------------------------

CREATE TABLE tds_sections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  kind TEXT NOT NULL DEFAULT 'TDS' CHECK (kind IN ('TDS', 'TCS')),
  section TEXT NOT NULL,                          -- 194C, 194J, 206C(1H) ...
  description TEXT NOT NULL DEFAULT '',
  rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  rate_no_pan_bp INTEGER NOT NULL DEFAULT 2000 CHECK (rate_no_pan_bp BETWEEN 0 AND 10000),
  threshold_single_paise INTEGER NOT NULL DEFAULT 0,
  threshold_annual_paise INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  ledger_id TEXT REFERENCES ledgers(id),          -- TDS/TCS payable ledger
  UNIQUE (company_id, kind, section, effective_from)
);

CREATE TABLE tds_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  kind TEXT NOT NULL DEFAULT 'TDS' CHECK (kind IN ('TDS', 'TCS')),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES tds_sections(id),
  party_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  date TEXT NOT NULL,
  base_paise INTEGER NOT NULL CHECK (base_paise >= 0),
  rate_bp INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
  deposited_on TEXT,
  challan_no TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tds_txn_company ON tds_transactions(company_id, kind, date);

-- Inventory --------------------------------------------------------------------------------------------

CREATE TABLE units_of_measure (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  uqc TEXT NOT NULL DEFAULT 'NOS',                -- GST unit quantity code
  decimals INTEGER NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 3),
  UNIQUE (company_id, symbol)
);

CREATE TABLE inventory_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES inventory_categories(id),
  kind TEXT NOT NULL DEFAULT 'Group' CHECK (kind IN ('Group', 'Category')),
  UNIQUE (company_id, kind, name)
);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, name)
);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES inventory_categories(id),
  category_id TEXT REFERENCES inventory_categories(id),
  unit_id TEXT NOT NULL REFERENCES units_of_measure(id),
  hsn_sac TEXT NOT NULL DEFAULT '',
  gst_rate_bp INTEGER NOT NULL DEFAULT 0,
  valuation_method TEXT NOT NULL DEFAULT 'WeightedAverage' CHECK (valuation_method IN ('FIFO', 'WeightedAverage')),
  track_batches INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  track_serials INTEGER NOT NULL DEFAULT 0,
  reorder_level_milli INTEGER NOT NULL DEFAULT 0,
  opening_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (opening_qty_milli >= 0),
  opening_rate_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_rate_paise >= 0),
  opening_godown_id TEXT REFERENCES warehouses(id),
  standard_sale_rate_paise INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_items_name ON inventory_items(company_id, lower(name));

CREATE TABLE stock_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  expiry_date TEXT,
  UNIQUE (item_id, batch_no)
);
CREATE INDEX idx_batches_expiry ON stock_batches(company_id, expiry_date);

-- Every quantity change. Inward rows carry their cost; outward rows are valued by the valuation engine.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  batch_id TEXT REFERENCES stock_batches(id),
  voucher_id TEXT REFERENCES vouchers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('In', 'Out')),
  movement_type TEXT NOT NULL,                    -- Purchase / Sale / TransferIn / TransferOut / Consumption / Production / Adjustment / PurchaseReturn / SalesReturn
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  rate_paise INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  value_paise INTEGER NOT NULL DEFAULT 0,
  serial_numbers TEXT NOT NULL DEFAULT '',        -- comma separated, for serial-tracked items
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_stock_mov_item ON stock_movements(company_id, item_id, date);
CREATE INDEX idx_stock_mov_voucher ON stock_movements(voucher_id);

CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  date TEXT NOT NULL,
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE bills_of_materials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  name TEXT NOT NULL,
  output_qty_milli INTEGER NOT NULL CHECK (output_qty_milli > 0),
  components_json TEXT NOT NULL,                  -- [{itemId, qtyMilli}]
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Orders (non-accounting) -------------------------------------------------------------------------------

CREATE TABLE business_orders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('SalesOrder', 'PurchaseOrder')),
  order_number TEXT NOT NULL,
  date TEXT NOT NULL,
  party_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'PartiallyFulfilled', 'Fulfilled', 'Cancelled')),
  lines_json TEXT NOT NULL,                       -- [{itemId, description, qtyMilli, ratePaise, fulfilledMilli}]
  total_paise INTEGER NOT NULL DEFAULT 0,
  narration TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, order_type, order_number)
);

-- Budgets ----------------------------------------------------------------------------------------------

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, name)
);

CREATE TABLE budget_entries (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  ledger_id TEXT REFERENCES ledgers(id),
  group_id TEXT REFERENCES account_groups(id),
  cost_centre_id TEXT REFERENCES cost_centres(id),
  amount_paise INTEGER NOT NULL,                  -- Dr positive (expenses), Cr negative (income)
  CHECK (ledger_id IS NOT NULL OR group_id IS NOT NULL)
);
CREATE INDEX idx_budget_entries_budget ON budget_entries(budget_id);

-- Banking ----------------------------------------------------------------------------------------------

CREATE TABLE bank_statements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  bank_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  file_name TEXT NOT NULL DEFAULT '',
  period_from TEXT,
  period_to TEXT,
  opening_balance_paise INTEGER,
  closing_balance_paise INTEGER,
  line_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE bank_statement_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  bank_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  txn_date TEXT NOT NULL,
  value_date TEXT,
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  debit_paise INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),   -- withdrawal
  credit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0), -- deposit
  balance_paise INTEGER,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Unmatched' CHECK (status IN ('Unmatched', 'Matched', 'Ignored')),
  is_bank_charge INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_bank_txn_ledger ON bank_statement_transactions(bank_ledger_id, txn_date);
CREATE UNIQUE INDEX idx_bank_txn_fingerprint ON bank_statement_transactions(bank_ledger_id, fingerprint);

CREATE TABLE bank_reconciliation_matches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  statement_txn_id TEXT NOT NULL UNIQUE REFERENCES bank_statement_transactions(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL UNIQUE REFERENCES voucher_entries(id),
  method TEXT NOT NULL CHECK (method IN ('Auto', 'Manual', 'Rule', 'AI')),
  confidence INTEGER NOT NULL DEFAULT 100,
  matched_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE bank_reconciliations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  bank_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  as_of_date TEXT NOT NULL,
  balance_per_books_paise INTEGER NOT NULL,
  balance_per_bank_paise INTEGER NOT NULL,
  unreconciled_paise INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE bank_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  match_text TEXT NOT NULL,                       -- case-insensitive substring of the statement description
  direction TEXT NOT NULL DEFAULT 'Any' CHECK (direction IN ('Any', 'Debit', 'Credit')),
  ledger_id TEXT NOT NULL REFERENCES ledgers(id), -- counter ledger for the voucher the rule creates
  is_bank_charge INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE cheque_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  bank_ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  direction TEXT NOT NULL CHECK (direction IN ('Issued', 'Received')),
  cheque_no TEXT NOT NULL,
  cheque_date TEXT NOT NULL,
  party_name TEXT NOT NULL DEFAULT '',
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'Issued' CHECK (status IN ('Blank', 'Issued', 'Deposited', 'Cleared', 'Bounced', 'Cancelled', 'Stale')),
  voucher_id TEXT REFERENCES vouchers(id),
  cleared_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_cheques_bank ON cheque_records(bank_ledger_id, status);

-- Payroll ----------------------------------------------------------------------------------------------

CREATE TABLE payroll_departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('Department', 'Designation')),
  name TEXT NOT NULL,
  UNIQUE (company_id, kind, name)
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  employee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  department_id TEXT REFERENCES payroll_departments(id),
  designation_id TEXT REFERENCES payroll_departments(id),
  date_of_joining TEXT NOT NULL,
  date_of_leaving TEXT,
  pan TEXT NOT NULL DEFAULT '',
  uan TEXT NOT NULL DEFAULT '',
  esic_no TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  bank_ifsc TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',            -- for professional tax slabs
  tax_regime TEXT NOT NULL DEFAULT 'New' CHECK (tax_regime IN ('New', 'Old')),
  pf_applicable INTEGER NOT NULL DEFAULT 1,
  esi_applicable INTEGER NOT NULL DEFAULT 1,
  pt_applicable INTEGER NOT NULL DEFAULT 1,
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, employee_code)
);

-- Pay heads: earnings and deductions. calc: Fixed (monthly amount on the structure) or PercentOfBasic.
CREATE TABLE payroll_components (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Earning', 'Deduction', 'Reimbursement')),
  calc TEXT NOT NULL DEFAULT 'Fixed' CHECK (calc IN ('Fixed', 'PercentOfBasic')),
  is_basic INTEGER NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  pf_wage INTEGER NOT NULL DEFAULT 0,             -- part of PF wages
  esi_wage INTEGER NOT NULL DEFAULT 1,            -- part of ESI wages
  prorate INTEGER NOT NULL DEFAULT 1,             -- reduce for loss-of-pay days
  ledger_id TEXT REFERENCES ledgers(id),
  UNIQUE (company_id, name)
);

CREATE TABLE employee_salary_structures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  effective_from TEXT NOT NULL,
  lines_json TEXT NOT NULL,                       -- [{componentId, amountPaise | percentBp}]
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (employee_id, effective_from)
);

-- Statutory rules (PF, ESI, PT slabs, TDS slabs) — configurable with effective dates, never hardcoded.
CREATE TABLE payroll_statutory_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  code TEXT NOT NULL CHECK (code IN ('PF', 'ESI', 'PT', 'TDS')),
  effective_from TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (company_id, code, effective_from)
);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  period TEXT NOT NULL,                           -- YYYY-MM
  working_days INTEGER NOT NULL CHECK (working_days BETWEEN 0 AND 31),
  present_days_milli INTEGER NOT NULL CHECK (present_days_milli >= 0),
  paid_leave_days_milli INTEGER NOT NULL DEFAULT 0 CHECK (paid_leave_days_milli >= 0),
  lop_days_milli INTEGER NOT NULL DEFAULT 0 CHECK (lop_days_milli >= 0),
  overtime_hours_milli INTEGER NOT NULL DEFAULT 0,
  UNIQUE (employee_id, period)
);

CREATE TABLE leave_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  days_milli INTEGER NOT NULL CHECK (days_milli > 0),
  paid INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Approved' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (to_date >= from_date)
);
CREATE INDEX idx_leaves_employee ON leave_records(employee_id, from_date);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  period TEXT NOT NULL,                           -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Cancelled')),
  gross_paise INTEGER NOT NULL DEFAULT 0,
  deductions_paise INTEGER NOT NULL DEFAULT 0,
  net_paise INTEGER NOT NULL DEFAULT 0,
  employer_contrib_paise INTEGER NOT NULL DEFAULT 0,
  voucher_id TEXT REFERENCES vouchers(id),
  created_by TEXT,
  posted_by TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_payroll_run_period ON payroll_runs(company_id, period) WHERE status <> 'Cancelled';

CREATE TABLE payroll_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  paid_days_milli INTEGER NOT NULL,
  working_days INTEGER NOT NULL,
  gross_paise INTEGER NOT NULL,
  deductions_paise INTEGER NOT NULL,
  net_paise INTEGER NOT NULL,
  employer_pf_paise INTEGER NOT NULL DEFAULT 0,
  employer_esi_paise INTEGER NOT NULL DEFAULT 0,
  lines_json TEXT NOT NULL,                       -- [{name, kind, amountPaise}]
  UNIQUE (run_id, employee_id)
);

CREATE TABLE salary_slips (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  payroll_entry_id TEXT NOT NULL UNIQUE REFERENCES payroll_entries(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  period TEXT NOT NULL,
  slip_number TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Documents, data jobs, audit --------------------------------------------------------------------------

CREATE TABLE document_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES accounting_companies(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('Voucher', 'Ledger', 'Employee', 'BankStatement', 'Order')),
  entity_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, entity_type, entity_id)
);
CREATE INDEX idx_attachments_entity ON document_attachments(entity_type, entity_id);

CREATE TABLE data_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT REFERENCES accounting_companies(id),
  direction TEXT NOT NULL CHECK (direction IN ('Import', 'Export')),
  kind TEXT NOT NULL,                             -- Backup / Restore / Ledgers / BankStatement / Report
  status TEXT NOT NULL CHECK (status IN ('Completed', 'Failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_data_jobs_company ON data_jobs(company_id, created_at);

CREATE TABLE accounting_audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT,
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_acct_audit_company ON accounting_audit_logs(company_id, created_at);
CREATE INDEX idx_acct_audit_entity ON accounting_audit_logs(entity_type, entity_id);

-- Immutability guarantees ------------------------------------------------------------------------------

CREATE TRIGGER trg_acct_audit_no_update BEFORE UPDATE ON accounting_audit_logs
BEGIN SELECT RAISE(ABORT, 'accounting audit log is append-only'); END;
CREATE TRIGGER trg_acct_audit_no_delete BEFORE DELETE ON accounting_audit_logs
BEGIN SELECT RAISE(ABORT, 'accounting audit log is append-only'); END;
CREATE TRIGGER trg_voucher_rev_no_update BEFORE UPDATE ON voucher_revisions
BEGIN SELECT RAISE(ABORT, 'voucher revisions are immutable'); END;
CREATE TRIGGER trg_voucher_rev_no_delete BEFORE DELETE ON voucher_revisions
BEGIN SELECT RAISE(ABORT, 'voucher revisions are immutable'); END;
-- Posted or cancelled vouchers are never deleted (cancel instead).
CREATE TRIGGER trg_voucher_no_delete_posted BEFORE DELETE ON vouchers
WHEN OLD.status IN ('Posted', 'Cancelled')
BEGIN SELECT RAISE(ABORT, 'posted vouchers cannot be deleted; cancel them instead'); END;
-- Cancelled vouchers stay cancelled.
CREATE TRIGGER trg_voucher_cancel_final BEFORE UPDATE OF status ON vouchers
WHEN OLD.status = 'Cancelled' AND NEW.status <> 'Cancelled'
BEGIN SELECT RAISE(ABORT, 'cancelled vouchers cannot be reinstated'); END;
