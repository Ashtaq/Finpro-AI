// Row -> API shape mappers for the accounting module. Money is returned as exact decimal strings.

import { formatScaled, fromBp, fromMilli, fromPaise } from "./money.mjs";

const bool = (v) => !!v;

export const toCompany = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name ?? undefined,
  name: r.name,
  legalName: r.legal_name,
  pan: r.pan,
  tan: r.tan,
  cin: r.cin,
  address: r.address,
  stateCode: r.state_code,
  baseCurrency: r.base_currency,
  booksStartDate: r.books_start_date,
  fyStartMonth: r.fy_start_month,
  gstEnabled: bool(r.gst_enabled),
  inventoryEnabled: bool(r.inventory_enabled),
  payrollEnabled: bool(r.payroll_enabled),
  tdsEnabled: bool(r.tds_enabled),
  requireVoucherApproval: bool(r.require_voucher_approval),
  lockDate: r.lock_date,
  invoiceTemplate: JSON.parse(r.invoice_template_json || "{}"),
  gstin: r.gstin ?? undefined,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toFy = (r) => ({ id: r.id, label: r.label, startDate: r.start_date, endDate: r.end_date, status: r.status, closedAt: r.closed_at });

export const toGroup = (r, info) => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id,
  nature: info?.nature ?? r.nature,
  affectsGrossProfit: info ? info.affectsGrossProfit : bool(r.affects_gross_profit),
  systemCode: r.system_code,
  cashFlowClass: r.cash_flow_class,
  isSystem: bool(r.is_system),
  path: info?.path.join(" › "),
});

export const toLedger = (r, info, balance) => ({
  id: r.id,
  groupId: r.group_id,
  groupName: info?.name,
  groupPath: info?.path.join(" › "),
  nature: info?.nature,
  kind: info
    ? info.codes.has("BANK") || info.codes.has("BANK_OD")
      ? "Bank"
      : info.codes.has("CASH")
        ? "Cash"
        : info.codes.has("SUNDRY_DEBTORS")
          ? "Debtor"
          : info.codes.has("SUNDRY_CREDITORS")
            ? "Creditor"
            : r.gst_duty_type
              ? "Duty"
              : "General"
    : undefined,
  name: r.name,
  alias: r.alias,
  code: r.code,
  systemCode: r.system_code,
  openingBalance: fromPaise(r.opening_balance_paise),
  balance: balance === undefined ? undefined : fromPaise(balance),
  gstin: r.gstin,
  pan: r.pan,
  stateCode: r.state_code,
  gstRegistrationType: r.gst_registration_type,
  address: r.address,
  email: r.email,
  phone: r.phone,
  creditLimit: r.credit_limit_paise === null ? null : fromPaise(r.credit_limit_paise),
  creditDays: r.credit_days,
  billWise: bool(r.bill_wise),
  currency: r.currency,
  gstDutyType: r.gst_duty_type,
  gstDutyDirection: r.gst_duty_direction,
  gstApplicable: bool(r.gst_applicable),
  defaultGstRate: r.default_gst_rate_bp === null ? null : fromBp(r.default_gst_rate_bp),
  defaultHsn: r.default_hsn,
  tdsSectionId: r.tds_section_id,
  costCentresApplicable: bool(r.cost_centres_applicable),
  bankName: r.bank_name,
  bankAccountNumber: r.bank_account_number,
  bankIfsc: r.bank_ifsc,
  bankBranch: r.bank_branch,
  active: bool(r.active),
});

export const toVoucherSummary = (v) => ({
  id: v.id,
  type: v.voucher_type,
  number: v.voucher_number,
  date: v.date,
  referenceNo: v.reference_no,
  partyLedgerId: v.party_ledger_id,
  partyName: v.party_name ?? "",
  narration: v.narration,
  status: v.status,
  total: fromPaise(v.total_paise),
  isAccounting: bool(v.is_accounting),
  source: v.source,
  revision: v.revision,
  createdBy: v.created_by_name ?? v.created_by,
  createdAt: v.created_at,
  updatedAt: v.updated_at,
});

export function toVoucherDetail(db, v) {
  const entries = db
    .prepare("SELECT ve.*, l.name ledger_name FROM voucher_entries ve JOIN ledgers l ON l.id = ve.ledger_id WHERE ve.voucher_id = ? ORDER BY ve.line_no")
    .all(v.id);
  const alloc = db.prepare("SELECT ca.*, cc.name FROM voucher_cost_allocations ca JOIN cost_centres cc ON cc.id = ca.cost_centre_id WHERE ca.entry_id = ?");
  const items = db
    .prepare(
      "SELECT vi.*, ii.name item_name, w.name godown_name FROM voucher_items vi LEFT JOIN inventory_items ii ON ii.id = vi.stock_item_id LEFT JOIN warehouses w ON w.id = vi.godown_id WHERE vi.voucher_id = ? ORDER BY vi.line_no",
    )
    .all(v.id);
  const approvals = db.prepare("SELECT * FROM voucher_approval_workflows WHERE voucher_id = ? ORDER BY created_at").all(v.id);
  const revisions = db.prepare("SELECT revision, changed_by, reason, created_at FROM voucher_revisions WHERE voucher_id = ? ORDER BY revision").all(v.id);
  const einv = db.prepare("SELECT status, irn, ack_no, ack_date FROM e_invoice_records WHERE voucher_id = ?").get(v.id);
  const tds = db.prepare("SELECT t.*, s.section FROM tds_transactions t JOIN tds_sections s ON s.id = t.section_id WHERE t.voucher_id = ?").get(v.id);
  const attachments = db
    .prepare(
      "SELECT a.id, d.id document_id, d.name, d.mime_type FROM document_attachments a JOIN documents d ON d.id = a.document_id WHERE a.entity_type = 'Voucher' AND a.entity_id = ?",
    )
    .all(v.id);
  return {
    ...toVoucherSummary(v),
    referenceDate: v.reference_date,
    placeOfSupply: v.place_of_supply,
    isInterState: bool(v.is_inter_state),
    reverseCharge: bool(v.reverse_charge),
    gstInvoiceType: v.gst_invoice_type,
    originalInvoiceNo: v.original_invoice_no,
    originalInvoiceDate: v.original_invoice_date,
    currency: v.currency,
    exchangeRate: formatScaled(v.exchange_rate_micros, 6),
    orderId: v.order_id,
    dueDate: v.due_date,
    statusReason: v.status_reason,
    approvedBy: v.approved_by,
    approvedAt: v.approved_at,
    entries: entries.map((e) => ({
      id: e.id,
      ledgerId: e.ledger_id,
      ledgerName: e.ledger_name,
      debit: fromPaise(e.debit_paise),
      credit: fromPaise(e.credit_paise),
      forexAmount: e.forex_amount_minor === null ? null : fromPaise(e.forex_amount_minor),
      narration: e.narration,
      billType: e.bill_type,
      billRef: e.bill_ref,
      billDueDate: e.bill_due_date,
      instrumentType: e.instrument_type,
      instrumentNo: e.instrument_no,
      instrumentDate: e.instrument_date,
      bankDate: e.bank_date,
      costAllocations: alloc.all(e.id).map((a) => ({ costCentreId: a.cost_centre_id, costCentre: a.name, amount: fromPaise(a.amount_paise) })),
    })),
    items: items.map((i) => ({
      id: i.id,
      stockItemId: i.stock_item_id,
      itemName: i.item_name,
      ledgerId: i.ledger_id,
      description: i.description,
      hsnSac: i.hsn_sac,
      godownId: i.godown_id,
      godownName: i.godown_name,
      batchNo: i.batch_no,
      qty: fromMilli(i.qty_milli),
      rate: fromPaise(i.rate_paise),
      discount: fromBp(i.discount_bp),
      taxable: fromPaise(i.taxable_paise),
      gstRate: fromBp(i.gst_rate_bp),
      cessRate: fromBp(i.cess_rate_bp),
      cgst: fromPaise(i.cgst_paise),
      sgst: fromPaise(i.sgst_paise),
      igst: fromPaise(i.igst_paise),
      cess: fromPaise(i.cess_paise),
    })),
    tds: tds
      ? {
          kind: tds.kind,
          section: tds.section,
          sectionId: tds.section_id,
          base: fromPaise(tds.base_paise),
          rate: fromBp(tds.rate_bp),
          amount: fromPaise(tds.tax_paise),
        }
      : null,
    approvals: approvals.map((a) => ({ action: a.action, actor: a.actor_name, comment: a.comment, at: a.created_at })),
    revisions: revisions.map((r) => ({ revision: r.revision, reason: r.reason, at: r.created_at })),
    eInvoice: einv ? { status: einv.status, irn: einv.irn, ackNo: einv.ack_no, ackDate: einv.ack_date } : null,
    attachments: attachments.map((a) => ({ id: a.id, documentId: a.document_id, name: a.name, mimeType: a.mime_type })),
  };
}

export const toItem = (r, position) => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  groupId: r.group_id,
  categoryId: r.category_id,
  unitId: r.unit_id,
  unit: r.unit_symbol,
  hsnSac: r.hsn_sac,
  gstRate: fromBp(r.gst_rate_bp),
  valuationMethod: r.valuation_method,
  trackBatches: bool(r.track_batches),
  trackExpiry: bool(r.track_expiry),
  trackSerials: bool(r.track_serials),
  reorderLevel: fromMilli(r.reorder_level_milli),
  openingQty: fromMilli(r.opening_qty_milli),
  openingRate: fromPaise(r.opening_rate_paise),
  openingGodownId: r.opening_godown_id,
  standardSaleRate: fromPaise(r.standard_sale_rate_paise),
  active: bool(r.active),
  ...(position || {}),
});

export const toEmployee = (r) => ({
  id: r.id,
  employeeCode: r.employee_code,
  name: r.name,
  departmentId: r.department_id,
  designationId: r.designation_id,
  department: r.department_name ?? undefined,
  designation: r.designation_name ?? undefined,
  dateOfJoining: r.date_of_joining,
  dateOfLeaving: r.date_of_leaving,
  pan: r.pan,
  uan: r.uan,
  esicNo: r.esic_no,
  bankAccountNumber: r.bank_account_number,
  bankIfsc: r.bank_ifsc,
  stateCode: r.state_code,
  taxRegime: r.tax_regime,
  pfApplicable: bool(r.pf_applicable),
  esiApplicable: bool(r.esi_applicable),
  ptApplicable: bool(r.pt_applicable),
  email: r.email,
  active: bool(r.active),
});
