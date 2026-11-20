// Voucher engine: validation, GST/TDS computation, double-entry posting, inventory movements,
// numbering, approval and immutable revision history. Every write runs in one DB transaction.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.mjs";
import { id, isoDate, text } from "../lib/validate.mjs";
import { acctAudit, nowIso, uuid } from "./access.mjs";
import { addDays, ensureFinancialYear, systemLedger, UT_STATE_CODES, VOUCHER_TYPES } from "./chart.mjs";
import { fromPaise, fxToBase, money, mulDiv, nonNegMoney, parseScaled, percent, percentOf, positiveMoney, quantity, roundToRupee, valueOf } from "./money.mjs";
import { availableQty, unitCost } from "./stock.mjs";
import { isCashOrBank, isParty, isStock, loadTree } from "./tree.mjs";

export const INVOICE_TYPES = ["Sales", "Purchase", "DebitNote", "CreditNote"];
export const INVENTORY_NOTE_TYPES = ["DeliveryNote", "ReceiptNote"];
const OUTWARD = new Set(["Sales", "CreditNote"]); // supplies made by the company (and their returns)

const date = () => isoDate().refine((v) => v !== "", "is required");
const optDate = () => isoDate().optional();

const entrySchema = z.object({
  ledgerId: id(),
  debit: nonNegMoney().optional(),
  credit: nonNegMoney().optional(),
  forexAmount: money().optional(),
  narration: text(500).default(""),
  billType: z.enum(["New", "Against", "Advance", "OnAccount"]).optional(),
  billRef: text(60).optional(),
  billDueDate: optDate(),
  instrumentType: text(30).optional(),
  instrumentNo: text(40).optional(),
  instrumentDate: optDate(),
  costAllocations: z
    .array(z.object({ costCentreId: id(), amount: positiveMoney() }))
    .max(50)
    .default([]),
});

const itemSchema = z.object({
  stockItemId: id().optional(),
  ledgerId: id().optional(),
  description: text(300).default(""),
  hsnSac: text(12).default(""),
  godownId: id().optional(),
  batchNo: text(60).optional(),
  mfgDate: optDate(),
  expiryDate: optDate(),
  serialNumbers: text(4000).default(""),
  qty: quantity({ min: 0 }).optional(),
  rate: nonNegMoney().optional(),
  amount: nonNegMoney().optional(),
  discount: percent().optional(),
  gstRate: percent().optional(),
  cessRate: percent().optional(),
  skipStock: z.boolean().default(false), // goods already moved by a delivery / receipt note
});

const stockLine = z.object({
  stockItemId: id(),
  qty: quantity({ min: 1 }),
  rate: nonNegMoney().optional(),
  direction: z.enum(["In", "Out"]).optional(),
  godownId: id().optional(),
  batchNo: text(60).optional(),
  expiryDate: optDate(),
});

export const voucherSchema = z.object({
  type: z.enum(VOUCHER_TYPES),
  date: date(),
  voucherNumber: text(40).optional(),
  referenceNo: text(60).default(""),
  referenceDate: isoDate().default(""),
  narration: text(2000).default(""),
  partyLedgerId: id().optional(),
  placeOfSupply: z
    .string()
    .regex(/^\d{2}$/, "must be a 2-digit state code")
    .optional(),
  reverseCharge: z.boolean().default(false),
  itcEligible: z.boolean().default(true),
  originalInvoiceNo: text(40).default(""),
  originalInvoiceDate: isoDate().default(""),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  exchangeRate: z.union([z.string(), z.number()]).optional(),
  dueDate: isoDate().default(""),
  orderId: id().optional(),
  roundOff: z.boolean().default(true),
  tds: z.object({ sectionId: id(), base: nonNegMoney().optional(), partyLedgerId: id().optional() }).optional(),
  entries: z.array(entrySchema).max(500).default([]),
  items: z.array(itemSchema).max(500).default([]),
  stock: z
    .object({
      mode: z.enum(["Transfer", "Manufacture", "Adjustment"]),
      fromGodownId: id().optional(),
      toGodownId: id().optional(),
      bomId: id().optional(),
      outputQty: quantity({ min: 1 }).optional(),
      additionalCost: nonNegMoney().optional(),
      lines: z.array(stockLine).max(500).default([]),
    })
    .optional(),
  saveAsDraft: z.boolean().default(false),
  overrideCreditLimit: z.boolean().default(false),
});

// ----------------------------------------------------------------------------------------------------

function primaryGstState(db, company) {
  const reg = db.prepare("SELECT state_code FROM gst_registrations WHERE company_id = ? ORDER BY is_primary DESC, effective_from LIMIT 1").get(company.id);
  return reg?.state_code || company.state_code || "";
}

/** GST rate in force for an HSN/SAC on a date (latest effective_from <= date). */
export function lookupGstRate(db, companyId, hsn, onDate) {
  if (!hsn) return null;
  return db
    .prepare(
      "SELECT rate_bp, cess_rate_bp FROM gst_tax_rates WHERE company_id = ? AND hsn_sac = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1",
    )
    .get(companyId, hsn, onDate);
}

export function tdsSectionFor(db, companyId, sectionId) {
  const s = db.prepare("SELECT * FROM tds_sections WHERE id = ? AND company_id = ?").get(sectionId, companyId);
  if (!s) throw badRequest("tds.sectionId: TDS/TCS section not found.");
  if (!s.ledger_id) throw badRequest(`Section ${s.section} has no payable ledger configured.`);
  return s;
}

function stateOf(ledger) {
  return ledger.state_code || (ledger.gstin ? ledger.gstin.slice(0, 2) : "");
}

/** Compute the full posting for a voucher. Pure with respect to writes. */
export function buildVoucher(db, req, company, input, { existing } = {}) {
  const tree = loadTree(db, company.id);
  const L = (lid, field = "ledgerId") => {
    const l = tree.ledgerInfo.get(lid);
    if (!l) throw badRequest(`${field}: ledger not found in this company.`);
    if (!l.active) throw badRequest(`${field}: ledger "${l.name}" is inactive.`);
    return l;
  };
  if (input.type === "Payroll" && !req.internalPayroll) throw badRequest("Payroll vouchers are created by payroll runs.");
  const fy = ensureFinancialYear(db, company, input.date);
  if (company.lock_date && input.date <= company.lock_date) throw badRequest(`Books are locked up to ${company.lock_date}.`);
  const rateMicros = input.currency === "INR" ? 1_000_000 : parseScaled(input.exchangeRate ?? "", 6);
  if (!rateMicros || rateMicros <= 0) throw badRequest("exchangeRate: required (up to 6 decimals) for foreign-currency vouchers.");

  const out = {
    fy,
    header: {
      voucher_type: input.type,
      date: input.date,
      reference_no: input.referenceNo,
      reference_date: input.referenceDate,
      narration: input.narration,
      party_ledger_id: input.partyLedgerId ?? null,
      place_of_supply: "",
      is_inter_state: 0,
      reverse_charge: input.reverseCharge ? 1 : 0,
      gst_invoice_type: "",
      original_invoice_no: input.originalInvoiceNo,
      original_invoice_date: input.originalInvoiceDate,
      currency: input.currency,
      exchange_rate_micros: rateMicros,
      order_id: input.orderId ?? null,
      due_date: input.dueDate,
      is_accounting: 1,
      total_paise: 0,
    },
    entries: [],
    items: [],
    gst: [],
    movements: [],
    tds: null,
    transfer: null,
    warnings: [],
  };
  if (input.partyLedgerId) L(input.partyLedgerId, "partyLedgerId");

  if (INVOICE_TYPES.includes(input.type)) buildInvoice(db, company, input, out, tree, L);
  else if (INVENTORY_NOTE_TYPES.includes(input.type)) buildNote(db, company, input, out);
  else if (input.type === "StockJournal") buildStockJournal(db, company, input, out);
  else buildEntries(db, company, input, out, L);

  if (out.header.is_accounting) validateEntries(db, req, company, input, out, tree, L);
  if (out.movements.length) validateStock(db, company, out, existing);
  return out;
}

function buildEntries(db, company, input, out, L) {
  if (input.items.length) throw badRequest(`${input.type} vouchers take ledger entries, not items.`);
  out.entries = input.entries.map((e, i) => {
    const has = (e.debit || 0) > 0;
    const hasCr = (e.credit || 0) > 0;
    if (has === hasCr) throw badRequest(`entries.${i}: enter either a debit or a credit amount.`);
    L(e.ledgerId, `entries.${i}.ledgerId`);
    return {
      ledger_id: e.ledgerId,
      debit_paise: e.debit || 0,
      credit_paise: e.credit || 0,
      forex_amount_minor: e.forexAmount ?? null,
      narration: e.narration,
      bill_type: e.billType ?? null,
      bill_ref: e.billRef ?? null,
      bill_due_date: e.billDueDate ?? null,
      instrument_type: e.instrumentType ?? null,
      instrument_no: e.instrumentNo ?? null,
      instrument_date: e.instrumentDate ?? null,
      allocations: e.costAllocations,
    };
  });
  if (input.tds) {
    const s = tdsSectionFor(db, company.id, input.tds.sectionId);
    const partyId = input.tds.partyLedgerId || input.partyLedgerId;
    if (!partyId) throw badRequest("tds.partyLedgerId: the deductee party is required.");
    const party = L(partyId, "tds.partyLedgerId");
    if (input.tds.base === undefined) throw badRequest("tds.base: the amount TDS is computed on is required.");
    const rate = party.pan ? s.rate_bp : Math.max(s.rate_bp, s.rate_no_pan_bp);
    const tax = roundToRupee(percentOf(input.tds.base, rate));
    const credited = out.entries.filter((e) => e.ledger_id === s.ledger_id).reduce((a, e) => a + e.credit_paise - e.debit_paise, 0);
    if (credited !== tax)
      throw badRequest(
        `TDS under ${s.section} at ${rate / 100}% on ₹${fromPaise(input.tds.base)} is ₹${fromPaise(tax)}; credit that amount to the TDS ledger.`,
      );
    out.tds = { kind: s.kind, section_id: s.id, party_ledger_id: party.id, base_paise: input.tds.base, rate_bp: rate, tax_paise: tax };
  }
}

function buildInvoice(db, company, input, out, tree, L) {
  if (!input.items.length) throw badRequest("items: add at least one line.");
  if (!input.partyLedgerId) throw badRequest("partyLedgerId: select the party (or Cash) ledger.");
  if (input.entries.length) throw badRequest("Invoice vouchers are entered as items; ledger entries are generated.");
  const party = L(input.partyLedgerId, "partyLedgerId");
  const outward = OUTWARD.has(input.type);
  if (input.reverseCharge && input.type !== "Purchase") throw badRequest("reverseCharge: only supported on purchase invoices.");

  const companyState = primaryGstState(db, company);
  const partyState = stateOf(party);
  const supplierState = outward ? companyState : partyState || companyState;
  const pos = input.placeOfSupply || (outward ? partyState || companyState : companyState);
  const foreign = ["Overseas", "SEZ"].includes(party.gst_registration_type);
  const interState = foreign || (supplierState && pos ? supplierState !== pos : false);
  const unregisteredSupplier = !outward && ["Unregistered", "Consumer", "Composition"].includes(party.gst_registration_type);
  const noGst = !company.gst_enabled || (unregisteredSupplier && !input.reverseCharge);
  const rcm = input.reverseCharge && company.gst_enabled;
  const ut = !interState && UT_STATE_CODES.has(pos);
  out.header.place_of_supply = pos;
  out.header.is_inter_state = interState ? 1 : 0;
  if (outward && company.gst_enabled) {
    if (foreign) out.header.gst_invoice_type = party.gst_registration_type === "SEZ" ? "SEZ" : "EXP";
    else if (party.gstin) out.header.gst_invoice_type = "B2B";
    else out.header.gst_invoice_type = interState ? "B2CL" : "B2CS"; // B2CL value threshold applied below
  } else if (company.gst_enabled) out.header.gst_invoice_type = party.gstin ? "B2B" : "B2C";

  const defaultLedger = (() => {
    const code = outward ? "SALES" : "PURCHASE";
    return tree.ledgers.find((l) => tree.info.get(l.group_id)?.codes.has(code) && l.active)?.id;
  })();

  const gstRows = new Map();
  let taxable = 0;
  const tax = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  const lineLedgerAmounts = new Map(); // ledgerId -> taxable (+ non-creditable tax)
  input.items.forEach((it, i) => {
    let stock = null;
    if (it.stockItemId) {
      stock = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND company_id = ?").get(it.stockItemId, company.id);
      if (!stock) throw badRequest(`items.${i}.stockItemId: stock item not found.`);
    }
    const ledgerId = it.ledgerId || defaultLedger;
    if (!ledgerId) throw badRequest(`items.${i}.ledgerId: choose the ${outward ? "sales" : "purchase"} ledger for this line.`);
    const ledger = L(ledgerId, `items.${i}.ledgerId`);
    if (isParty(ledger.g) || isCashOrBank(ledger.g) || ledger.gst_duty_type || isStock(ledger.g))
      throw badRequest(`items.${i}.ledgerId: "${ledger.name}" cannot be used as an invoice line ledger.`);
    let gross;
    if (it.qty !== undefined && it.rate !== undefined) gross = valueOf(it.qty, it.rate);
    else if (it.amount !== undefined) gross = it.amount;
    else throw badRequest(`items.${i}: enter quantity and rate, or an amount.`);
    if (stock && !it.qty) throw badRequest(`items.${i}.qty: quantity is required for stock items.`);
    const grossBase = input.currency === "INR" ? gross : fxToBase(gross, out.header.exchange_rate_micros);
    const disc = it.discount ? percentOf(grossBase, it.discount) : 0;
    const lineTaxable = grossBase - disc;
    if (lineTaxable <= 0) throw badRequest(`items.${i}: line value must be more than zero.`);
    const hsn = it.hsnSac || stock?.hsn_sac || ledger.default_hsn || "";
    const looked = lookupGstRate(db, company.id, hsn, input.date);
    let rate = it.gstRate ?? (stock ? stock.gst_rate_bp : null) ?? ledger.default_gst_rate_bp ?? looked?.rate_bp ?? 0;
    let cessRate = it.cessRate ?? looked?.cess_rate_bp ?? 0;
    if (noGst) ((rate = 0), (cessRate = 0));
    const line = { cgst: 0, sgst: 0, igst: 0, cess: percentOf(lineTaxable, cessRate) };
    if (interState) line.igst = percentOf(lineTaxable, rate);
    else {
      line.cgst = mulDiv(lineTaxable, rate, 20000);
      line.sgst = mulDiv(lineTaxable, rate, 20000);
    }
    taxable += lineTaxable;
    for (const k of Object.keys(tax)) tax[k] += line[k];
    const lineTax = line.cgst + line.sgst + line.igst + line.cess;
    const creditable = outward || input.itcEligible;
    lineLedgerAmounts.set(ledgerId, (lineLedgerAmounts.get(ledgerId) || 0) + lineTaxable + (!outward && !creditable ? lineTax : 0));
    const key = `${hsn}|${rate}`;
    const g = gstRows.get(key) || { hsn_sac: hsn, rate_bp: rate, taxable_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, cess_paise: 0 };
    g.taxable_paise += lineTaxable;
    g.cgst_paise += line.cgst;
    g.sgst_paise += line.sgst;
    g.igst_paise += line.igst;
    g.cess_paise += line.cess;
    gstRows.set(key, g);
    out.items.push({
      stock_item_id: it.stockItemId ?? null,
      ledger_id: ledgerId,
      description: it.description || stock?.name || ledger.name,
      hsn_sac: hsn,
      godown_id: it.godownId ?? null,
      batch_no: it.batchNo ?? null,
      qty_milli: it.qty ?? 0,
      rate_paise: it.rate ?? 0,
      discount_bp: it.discount ?? 0,
      taxable_paise: lineTaxable,
      gst_rate_bp: rate,
      cess_rate_bp: cessRate,
      cgst_paise: line.cgst,
      sgst_paise: line.sgst,
      igst_paise: line.igst,
      cess_paise: line.cess,
    });
    if (stock && !it.skipStock) {
      const dir = input.type === "Sales" || input.type === "DebitNote" ? "Out" : "In";
      const mtype = { Sales: "Sale", Purchase: "Purchase", DebitNote: "PurchaseReturn", CreditNote: "SalesReturn" }[input.type];
      out.movements.push({
        stock,
        warehouse_id: it.godownId,
        batchNo: it.batchNo,
        mfgDate: it.mfgDate,
        expiryDate: it.expiryDate,
        direction: dir,
        movement_type: mtype,
        qty_milli: it.qty,
        value_paise: input.type === "Purchase" ? lineTaxable + (!input.itcEligible ? lineTax : 0) : 0,
        serial_numbers: it.serialNumbers,
        line: i,
      });
    }
  });
  const totalTax = tax.cgst + tax.sgst + tax.igst + tax.cess;
  if (outward && out.header.gst_invoice_type === "B2CL" && !(interState && taxable + totalTax > 10000000)) out.header.gst_invoice_type = "B2CS";

  // Signed postings: + debit, - credit, expressed for a Sales / Purchase invoice and negated for returns.
  const post = new Map();
  const add = (ledgerId, amt) => amt && post.set(ledgerId, (post.get(ledgerId) || 0) + amt);
  const dutyLedger = (dir, duty) => systemLedger(db, company.id, `GST_${dir}_${duty}`).id;
  const sgstCode = ut ? "UTGST" : "SGST";
  const duties = [
    ["CGST", tax.cgst],
    [sgstCode, tax.sgst],
    ["IGST", tax.igst],
    ["CESS", tax.cess],
  ];
  let partyAmount;
  if (outward) {
    partyAmount = taxable + totalTax;
    for (const [lid, amt] of lineLedgerAmounts) add(lid, -amt);
    for (const [duty, amt] of duties) add(amt ? dutyLedger("OUTPUT", duty) : null, -amt);
  } else {
    partyAmount = rcm ? taxable : taxable + totalTax;
    for (const [lid, amt] of lineLedgerAmounts) add(lid, amt);
    for (const [duty, amt] of duties) {
      if (!amt) continue;
      if (input.itcEligible) add(dutyLedger("INPUT", duty), amt);
      if (rcm) add(dutyLedger("RCM", duty), -amt);
    }
  }
  if (input.roundOff) {
    const rounded = roundToRupee(partyAmount);
    const diff = rounded - partyAmount;
    if (diff) {
      add(systemLedger(db, company.id, "ROUND_OFF").id, outward ? -diff : diff);
      partyAmount = rounded;
    }
  }
  if (input.tds) {
    const s = tdsSectionFor(db, company.id, input.tds.sectionId);
    const rate = party.pan ? s.rate_bp : Math.max(s.rate_bp, s.rate_no_pan_bp);
    if (s.kind === "TCS" && input.type !== "Sales") throw badRequest("TCS applies to sales invoices.");
    if (s.kind === "TDS" && input.type !== "Purchase") throw badRequest("TDS on an invoice applies to purchase invoices.");
    const base = input.tds.base ?? (s.kind === "TDS" ? taxable : partyAmount);
    const amount = roundToRupee(percentOf(base, rate));
    if (amount) {
      add(s.ledger_id, -amount);
      partyAmount += s.kind === "TCS" ? amount : -amount;
    }
    out.tds = { kind: s.kind, section_id: s.id, party_ledger_id: party.id, base_paise: base, rate_bp: rate, tax_paise: amount };
  }
  add(party.id, outward ? partyAmount : -partyAmount);

  const sign = input.type === "CreditNote" || input.type === "DebitNote" ? -1 : 1;
  const billType =
    INVOICE_TYPES.includes(input.type) && (input.type === "Sales" || input.type === "Purchase") ? "New" : input.originalInvoiceNo ? "Against" : "OnAccount";
  out.entries = [...post.entries()]
    .filter(([, amt]) => amt !== 0)
    .sort(([a], [b]) => (a === party.id ? -1 : b === party.id ? 1 : 0))
    .map(([lid, amt]) => {
      const v = amt * sign;
      const isPartyLine = lid === party.id && party.bill_wise;
      return {
        ledger_id: lid,
        debit_paise: v > 0 ? v : 0,
        credit_paise: v < 0 ? -v : 0,
        forex_amount_minor: null,
        narration: "",
        bill_type: isPartyLine ? billType : null,
        bill_ref: isPartyLine && billType === "Against" ? input.originalInvoiceNo : null,
        bill_due_date: isPartyLine && billType === "New" ? input.dueDate || (party.credit_days ? addDays(input.date, party.credit_days) : null) : null,
        instrument_type: null,
        instrument_no: null,
        instrument_date: null,
        allocations: [],
      };
    });
  if (!out.header.due_date && party.credit_days) out.header.due_date = addDays(input.date, party.credit_days);
  if (company.gst_enabled)
    out.gst = [...gstRows.values()].map((g) => ({
      ...g,
      direction: outward ? "Outward" : "Inward",
      doc_type: input.type === "Sales" || input.type === "Purchase" ? "Invoice" : input.type,
      party_ledger_id: party.id,
      party_gstin: party.gstin,
      place_of_supply: pos,
      reverse_charge: rcm ? 1 : 0,
      itc_eligible: !outward && input.itcEligible && !noGst ? 1 : 0,
    }));
}

function buildNote(db, company, input, out) {
  if (!input.items.length) throw badRequest("items: add at least one stock line.");
  out.header.is_accounting = 0;
  let total = 0;
  input.items.forEach((it, i) => {
    if (!it.stockItemId || !it.qty) throw badRequest(`items.${i}: stock item and quantity are required.`);
    const stock = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND company_id = ?").get(it.stockItemId, company.id);
    if (!stock) throw badRequest(`items.${i}.stockItemId: stock item not found.`);
    const value = valueOf(it.qty, it.rate ?? 0);
    total += value;
    out.items.push({
      stock_item_id: stock.id,
      ledger_id: null,
      description: it.description || stock.name,
      hsn_sac: stock.hsn_sac,
      godown_id: it.godownId ?? null,
      batch_no: it.batchNo ?? null,
      qty_milli: it.qty,
      rate_paise: it.rate ?? 0,
      discount_bp: 0,
      taxable_paise: value,
      gst_rate_bp: 0,
      cess_rate_bp: 0,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      cess_paise: 0,
    });
    const inward = input.type === "ReceiptNote";
    out.movements.push({
      stock,
      warehouse_id: it.godownId,
      batchNo: it.batchNo,
      mfgDate: it.mfgDate,
      expiryDate: it.expiryDate,
      direction: inward ? "In" : "Out",
      movement_type: inward ? "Purchase" : "Sale",
      qty_milli: it.qty,
      value_paise: inward ? value : 0,
      serial_numbers: it.serialNumbers,
      line: i,
    });
  });
  out.header.total_paise = total;
}

function buildStockJournal(db, company, input, out) {
  const s = input.stock;
  if (!s) throw badRequest("stock: transfer / manufacture / adjustment details are required.");
  out.header.is_accounting = 0;
  const item = (iid, field) => {
    const it = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND company_id = ?").get(iid, company.id);
    if (!it) throw badRequest(`${field}: stock item not found.`);
    return it;
  };
  const push = (m) => out.movements.push(m);
  if (s.mode === "Transfer") {
    if (!s.fromGodownId || !s.toGodownId || s.fromGodownId === s.toGodownId) throw badRequest("stock: choose two different godowns for a transfer.");
    if (!s.lines.length) throw badRequest("stock.lines: add the items to transfer.");
    s.lines.forEach((l, i) => {
      const it = item(l.stockItemId, `stock.lines.${i}.stockItemId`);
      push({
        stock: it,
        warehouse_id: s.fromGodownId,
        batchNo: l.batchNo,
        direction: "Out",
        movement_type: "TransferOut",
        qty_milli: l.qty,
        value_paise: 0,
        line: i,
      });
      push({
        stock: it,
        warehouse_id: s.toGodownId,
        batchNo: l.batchNo,
        direction: "In",
        movement_type: "TransferIn",
        qty_milli: l.qty,
        value_paise: 0,
        line: i,
      });
    });
    out.transfer = { from: s.fromGodownId, to: s.toGodownId };
  } else if (s.mode === "Manufacture") {
    let lines = s.lines;
    let finished;
    let outputQty = s.outputQty;
    if (s.bomId) {
      const bom = db.prepare("SELECT * FROM bills_of_materials WHERE id = ? AND company_id = ? AND active = 1").get(s.bomId, company.id);
      if (!bom) throw badRequest("stock.bomId: bill of materials not found.");
      if (!outputQty) throw badRequest("stock.outputQty: quantity to produce is required.");
      finished = item(bom.item_id, "bom.itemId");
      lines = JSON.parse(bom.components_json).map((c) => ({
        stockItemId: c.itemId,
        qty: mulDiv(c.qtyMilli, outputQty, bom.output_qty_milli),
        direction: "Out",
      }));
    } else {
      const outLine = lines.find((l) => l.direction === "In");
      if (!outLine) throw badRequest("stock.lines: mark the finished item line with direction In.");
      finished = item(outLine.stockItemId, "stock.lines");
      outputQty = outLine.qty;
      lines = lines.filter((l) => l !== outLine);
    }
    let cost = s.additionalCost || 0;
    lines.forEach((l, i) => {
      const it = item(l.stockItemId, `stock.lines.${i}.stockItemId`);
      const c = valueOf(l.qty, unitCost(db, company, it.id, input.date));
      cost += c;
      push({
        stock: it,
        warehouse_id: s.fromGodownId,
        batchNo: l.batchNo,
        direction: "Out",
        movement_type: "Consumption",
        qty_milli: l.qty,
        value_paise: 0,
        line: i,
      });
    });
    push({ stock: finished, warehouse_id: s.toGodownId, direction: "In", movement_type: "Production", qty_milli: outputQty, value_paise: cost, line: -1 });
    out.header.total_paise = cost;
  } else {
    if (!s.lines.length) throw badRequest("stock.lines: add adjustment lines.");
    s.lines.forEach((l, i) => {
      const it = item(l.stockItemId, `stock.lines.${i}.stockItemId`);
      const dir = l.direction || "Out";
      if (dir === "In" && l.rate === undefined) throw badRequest(`stock.lines.${i}.rate: rate is required for inward adjustments.`);
      push({
        stock: it,
        warehouse_id: l.godownId,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
        direction: dir,
        movement_type: "Adjustment",
        qty_milli: l.qty,
        value_paise: dir === "In" ? valueOf(l.qty, l.rate) : 0,
        line: i,
      });
    });
  }
  out.header.total_paise ||= out.movements.filter((m) => m.direction === "In").reduce((a, m) => a + m.value_paise, 0);
}

function validateEntries(db, req, company, input, out, tree, L) {
  const entries = out.entries;
  if (entries.length < 2) throw badRequest("A voucher needs at least two ledger entries.");
  let dr = 0;
  let cr = 0;
  const ledgerOf = new Map();
  entries.forEach((e, i) => {
    const l = L(e.ledger_id, `entries.${i}.ledgerId`);
    ledgerOf.set(i, l);
    if (isStock(l.g)) throw badRequest(`entries.${i}: "${l.name}" is a stock ledger; its value comes from inventory / closing stock.`);
    dr += e.debit_paise;
    cr += e.credit_paise;
    const amount = e.debit_paise || e.credit_paise;
    if (e.allocations?.length) {
      const total = e.allocations.reduce((a, c) => a + c.amount, 0);
      if (total !== amount)
        throw badRequest(`entries.${i}: cost centre allocations (₹${fromPaise(total)}) must equal the entry amount (₹${fromPaise(amount)}).`);
      for (const c of e.allocations)
        if (!db.prepare("SELECT 1 FROM cost_centres WHERE id = ? AND company_id = ?").get(c.costCentreId, company.id))
          throw badRequest(`entries.${i}: cost centre not found.`);
    }
    if (l.bill_wise && !e.bill_type) e.bill_type = input.type === "Journal" ? "New" : "OnAccount";
    if (!l.bill_wise) ((e.bill_type = null), (e.bill_ref = null));
    if (e.bill_type === "Against") {
      if (!e.bill_ref) throw badRequest(`entries.${i}.billRef: enter the bill being settled.`);
      const exists = db
        .prepare(
          `SELECT 1 FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
           WHERE ve.ledger_id = ? AND ve.bill_ref = ? AND ve.bill_type IN ('New','Advance') AND v.status = 'Posted' LIMIT 1`,
        )
        .get(l.id, e.bill_ref);
      if (!exists) throw badRequest(`entries.${i}.billRef: no open bill "${e.bill_ref}" for ${l.name}.`);
    }
  });
  if (dr !== cr) throw badRequest(`Debits (₹${fromPaise(dr)}) and credits (₹${fromPaise(cr)}) must be equal.`);
  if (dr <= 0) throw badRequest("Voucher total must be more than zero.");
  out.header.total_paise = dr;

  const cashBank = entries.map((e, i) => isCashOrBank(ledgerOf.get(i).g));
  const t = input.type;
  if (t === "Payment" && !entries.some((e, i) => cashBank[i] && e.credit_paise > 0)) throw badRequest("A payment must credit a cash or bank ledger.");
  if (t === "Receipt" && !entries.some((e, i) => cashBank[i] && e.debit_paise > 0)) throw badRequest("A receipt must debit a cash or bank ledger.");
  if (t === "Contra" && cashBank.some((c) => !c)) throw badRequest("Contra vouchers may only use cash and bank ledgers.");

  // Credit limit on sales.
  if (t === "Sales" && input.partyLedgerId) {
    const party = L(input.partyLedgerId);
    if (party.credit_limit_paise !== null && party.credit_limit_paise !== undefined) {
      const bal = ledgerBalance(db, party.id, input.date, req.excludeVoucherId) + party.opening_balance_paise;
      const after = bal + (entries.find((e) => e.ledger_id === party.id)?.debit_paise || 0);
      if (after > party.credit_limit_paise) {
        if (!(input.overrideCreditLimit && req.acct.can("approve")))
          throw badRequest(
            `Credit limit exceeded for ${party.name}: limit ₹${fromPaise(party.credit_limit_paise)}, balance after this invoice ₹${fromPaise(after)}.`,
          );
        out.warnings.push("Credit limit overridden.");
      }
    }
  }
}

/** Posted balance (Dr positive, excluding opening) of a ledger up to a date. */
export function ledgerBalance(db, ledgerId, to, excludeVoucherId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(ve.debit_paise - ve.credit_paise),0) b FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.ledger_id = ? AND v.status = 'Posted' AND v.date <= ? AND v.id <> ?`,
    )
    .get(ledgerId, to || "9999-12-31", excludeVoucherId || "").b;
}

function validateStock(db, company, out, existing) {
  const defaultWh = db.prepare("SELECT id FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, name LIMIT 1").get(company.id)?.id;
  const need = new Map();
  for (const m of out.movements) {
    m.warehouse_id ||= defaultWh;
    if (!db.prepare("SELECT 1 FROM warehouses WHERE id = ? AND company_id = ?").get(m.warehouse_id, company.id)) throw badRequest("Godown not found.");
    const it = m.stock;
    if (it.track_batches && !m.batchNo) throw badRequest(`Batch number is required for ${it.name}.`);
    if (it.track_expiry && m.direction === "In" && !m.expiryDate && m.batchNo) {
      const b = db.prepare("SELECT expiry_date FROM stock_batches WHERE item_id = ? AND batch_no = ?").get(it.id, m.batchNo);
      if (!b?.expiry_date) throw badRequest(`Expiry date is required for ${it.name} batch ${m.batchNo}.`);
    }
    if (it.track_serials) {
      const serials = (m.serial_numbers || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (m.qty_milli % 1000 !== 0 || serials.length !== m.qty_milli / 1000)
        throw badRequest(`${it.name}: enter one serial number per unit (${m.qty_milli / 1000} expected).`);
      m.serial_numbers = serials.join(",");
    }
    if (m.direction === "Out") {
      const batch = m.batchNo ? db.prepare("SELECT id FROM stock_batches WHERE item_id = ? AND batch_no = ?").get(it.id, m.batchNo) : null;
      if (m.batchNo && !batch) throw badRequest(`Batch ${m.batchNo} of ${it.name} does not exist.`);
      const key = `${it.id}|${m.warehouse_id}|${batch?.id || ""}`;
      need.set(key, { it, wh: m.warehouse_id, batchId: batch?.id || null, qty: (need.get(key)?.qty || 0) + m.qty_milli });
    }
  }
  for (const n of need.values()) {
    const args = { itemId: n.it.id, warehouseId: n.wh, batchId: n.batchId, excludeVoucherId: existing?.id };
    const asOf = availableQty(db, company, { ...args, to: out.header.date });
    const overall = availableQty(db, company, args);
    const inSameVoucher = out.movements
      .filter((m) => m.direction === "In" && m.stock.id === n.it.id && m.warehouse_id === n.wh)
      .reduce((a, m) => a + m.qty_milli, 0);
    if (Math.min(asOf, overall) + inSameVoucher < n.qty)
      throw badRequest(`Insufficient stock of ${n.it.name}: available ${Math.min(asOf, overall) / 1000}, required ${n.qty / 1000}.`);
  }
}

// Persistence ------------------------------------------------------------------------------------------

function nextNumber(db, fy, type, manual) {
  const s = db.prepare("SELECT * FROM voucher_series WHERE financial_year_id = ? AND voucher_type = ?").get(fy.id, type);
  if (!s || s.numbering_method === "Manual") {
    if (!manual) throw badRequest("voucherNumber: this voucher type uses manual numbering.");
    return manual;
  }
  for (let n = s.next_number; ; n += 1) {
    const num = `${s.prefix}${String(n).padStart(s.pad_length, "0")}${s.suffix}`;
    const taken = db.prepare("SELECT 1 FROM vouchers WHERE financial_year_id = ? AND voucher_type = ? AND voucher_number = ?").get(fy.id, type, num);
    if (!taken) {
      db.prepare("UPDATE voucher_series SET next_number = ? WHERE id = ?").run(n + 1, s.id);
      return num;
    }
  }
}

export function voucherSnapshot(db, voucherId) {
  const v = db.prepare("SELECT * FROM vouchers WHERE id = ?").get(voucherId);
  if (!v) return null;
  const entries = db.prepare("SELECT * FROM voucher_entries WHERE voucher_id = ? ORDER BY line_no").all(voucherId);
  for (const e of entries) e.allocations = db.prepare("SELECT cost_centre_id, amount_paise FROM voucher_cost_allocations WHERE entry_id = ?").all(e.id);
  const items = db.prepare("SELECT * FROM voucher_items WHERE voucher_id = ? ORDER BY line_no").all(voucherId);
  return { voucher: v, entries, items };
}

function clearChildren(db, voucherId) {
  for (const t of ["gst_transactions", "stock_movements", "tds_transactions", "voucher_items", "stock_transfers"])
    db.prepare(`DELETE FROM ${t} WHERE voucher_id = ?`).run(voucherId);
  db.prepare("DELETE FROM voucher_cost_allocations WHERE entry_id IN (SELECT id FROM voucher_entries WHERE voucher_id = ?)").run(voucherId);
  db.prepare("DELETE FROM voucher_entries WHERE voucher_id = ?").run(voucherId);
}

function writeChildren(db, company, voucherId, built, voucherNumber) {
  const insEntry = db.prepare(
    `INSERT INTO voucher_entries(id, voucher_id, company_id, ledger_id, line_no, debit_paise, credit_paise, forex_amount_minor, narration, bill_type, bill_ref,
       bill_due_date, instrument_type, instrument_no, instrument_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insAlloc = db.prepare("INSERT INTO voucher_cost_allocations(id, entry_id, cost_centre_id, amount_paise) VALUES (?,?,?,?)");
  built.entries.forEach((e, i) => {
    const eid = uuid();
    const ref = e.bill_type === "New" && !e.bill_ref ? voucherNumber || null : e.bill_ref;
    insEntry.run(
      eid,
      voucherId,
      company.id,
      e.ledger_id,
      i + 1,
      e.debit_paise,
      e.credit_paise,
      e.forex_amount_minor,
      e.narration,
      e.bill_type,
      ref,
      e.bill_due_date,
      e.instrument_type,
      e.instrument_no,
      e.instrument_date,
    );
    for (const a of e.allocations || []) insAlloc.run(uuid(), eid, a.costCentreId ?? a.cost_centre_id, a.amount ?? a.amount_paise);
  });
  const insItem = db.prepare(
    `INSERT INTO voucher_items(id, voucher_id, line_no, stock_item_id, ledger_id, description, hsn_sac, godown_id, batch_no, qty_milli, rate_paise, discount_bp,
       taxable_paise, gst_rate_bp, cess_rate_bp, cgst_paise, sgst_paise, igst_paise, cess_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  built.items.forEach((it, i) =>
    insItem.run(
      uuid(),
      voucherId,
      i + 1,
      it.stock_item_id,
      it.ledger_id,
      it.description,
      it.hsn_sac,
      it.godown_id,
      it.batch_no,
      it.qty_milli,
      it.rate_paise,
      it.discount_bp,
      it.taxable_paise,
      it.gst_rate_bp,
      it.cess_rate_bp,
      it.cgst_paise,
      it.sgst_paise,
      it.igst_paise,
      it.cess_paise,
    ),
  );
  const insGst = db.prepare(
    `INSERT INTO gst_transactions(id, organization_id, company_id, voucher_id, direction, doc_type, date, party_ledger_id, party_gstin, place_of_supply, hsn_sac,
       rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, reverse_charge, itc_eligible) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const g of built.gst)
    insGst.run(
      uuid(),
      company.organization_id,
      company.id,
      voucherId,
      g.direction,
      g.doc_type,
      built.header.date,
      g.party_ledger_id,
      g.party_gstin,
      g.place_of_supply,
      g.hsn_sac,
      g.rate_bp,
      g.taxable_paise,
      g.cgst_paise,
      g.sgst_paise,
      g.igst_paise,
      g.cess_paise,
      g.reverse_charge,
      g.itc_eligible,
    );
  const insMove = db.prepare(
    `INSERT INTO stock_movements(id, organization_id, company_id, item_id, warehouse_id, batch_id, voucher_id, date, direction, movement_type, qty_milli, rate_paise, value_paise, serial_numbers)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const m of built.movements) {
    let batchId = null;
    if (m.batchNo) {
      let b = db.prepare("SELECT * FROM stock_batches WHERE item_id = ? AND batch_no = ?").get(m.stock.id, m.batchNo);
      if (!b && m.direction === "In") {
        const bid = uuid();
        db.prepare("INSERT INTO stock_batches(id, organization_id, company_id, item_id, batch_no, mfg_date, expiry_date) VALUES (?,?,?,?,?,?,?)").run(
          bid,
          company.organization_id,
          company.id,
          m.stock.id,
          m.batchNo,
          m.mfgDate ?? null,
          m.expiryDate ?? null,
        );
        b = { id: bid };
      }
      batchId = b?.id ?? null;
    }
    let value = m.value_paise;
    if (m.direction === "In" && m.movement_type === "SalesReturn") value = valueOf(m.qty_milli, unitCost(db, company, m.stock.id, built.header.date));
    const rate = m.qty_milli ? mulDiv(value, 1000, m.qty_milli) : 0;
    insMove.run(
      uuid(),
      company.organization_id,
      company.id,
      m.stock.id,
      m.warehouse_id,
      batchId,
      voucherId,
      built.header.date,
      m.direction,
      m.movement_type,
      m.qty_milli,
      rate,
      value,
      m.serial_numbers || "",
    );
  }
  if (built.transfer)
    db.prepare("INSERT INTO stock_transfers(id, organization_id, company_id, voucher_id, from_warehouse_id, to_warehouse_id, date) VALUES (?,?,?,?,?,?,?)").run(
      uuid(),
      company.organization_id,
      company.id,
      voucherId,
      built.transfer.from,
      built.transfer.to,
      built.header.date,
    );
  if (built.tds)
    db.prepare(
      "INSERT INTO tds_transactions(id, organization_id, company_id, kind, voucher_id, section_id, party_ledger_id, date, base_paise, rate_bp, tax_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      uuid(),
      company.organization_id,
      company.id,
      built.tds.kind,
      voucherId,
      built.tds.section_id,
      built.tds.party_ledger_id,
      built.header.date,
      built.tds.base_paise,
      built.tds.rate_bp,
      built.tds.tax_paise,
    );
}

function decideStatus(req, company, input) {
  if (input.saveAsDraft) return "Draft";
  if (company.require_voucher_approval && !req.acct.can("approve")) return "PendingApproval";
  return "Posted";
}

/** Create a voucher. Returns its id. */
export function createVoucher(db, req, company, input, { source = "manual", sourceRef = null } = {}) {
  return db.transaction(() => {
    const built = buildVoucher(db, req, company, input);
    const status = decideStatus(req, company, input);
    const vid = uuid();
    const number = status === "Posted" ? nextNumber(db, built.fy, input.type, input.voucherNumber) : null;
    const h = built.header;
    db.prepare(
      `INSERT INTO vouchers(id, organization_id, company_id, financial_year_id, voucher_type, voucher_number, date, reference_no, reference_date, party_ledger_id,
         narration, status, total_paise, is_accounting, place_of_supply, is_inter_state, reverse_charge, gst_invoice_type, original_invoice_no, original_invoice_date,
         currency, exchange_rate_micros, order_id, source, source_ref, due_date, approved_by, approved_at, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      vid,
      company.organization_id,
      company.id,
      built.fy.id,
      h.voucher_type,
      number,
      h.date,
      h.reference_no,
      h.reference_date,
      h.party_ledger_id,
      h.narration,
      status,
      h.total_paise,
      h.is_accounting,
      h.place_of_supply,
      h.is_inter_state,
      h.reverse_charge,
      h.gst_invoice_type,
      h.original_invoice_no,
      h.original_invoice_date,
      h.currency,
      h.exchange_rate_micros,
      h.order_id,
      source,
      sourceRef,
      h.due_date,
      status === "Posted" ? req.user.id : null,
      status === "Posted" ? nowIso() : null,
      req.user.id,
      req.user.id,
    );
    writeChildren(db, company, vid, built, number);
    if (status === "PendingApproval") approvalEvent(db, req, company, vid, "Submitted");
    if (input.orderId) updateOrderFulfilment(db, company, input.orderId);
    acctAudit(db, req, {
      companyId: company.id,
      action: "voucher.create",
      entityType: "Voucher",
      entityId: vid,
      summary: `${h.voucher_type} ${number || "(unnumbered)"} ₹${fromPaise(h.total_paise)} — ${status}`,
      after: voucherSnapshot(db, vid),
    });
    return { id: vid, warnings: built.warnings };
  })();
}

function assertEditable(db, company, v) {
  if (v.status === "Cancelled") throw conflict("Cancelled vouchers cannot be changed.");
  if (company.lock_date && v.date <= company.lock_date) throw badRequest(`Books are locked up to ${company.lock_date}.`);
  const fy = db.prepare("SELECT * FROM financial_years WHERE id = ?").get(v.financial_year_id);
  if (fy?.status === "Closed") throw badRequest(`${fy.label} is closed.`);
  const matched = db
    .prepare("SELECT 1 FROM bank_reconciliation_matches m JOIN voucher_entries ve ON ve.id = m.entry_id WHERE ve.voucher_id = ? LIMIT 1")
    .get(v.id);
  if (matched) throw conflict("This voucher is matched to a bank statement line. Unmatch it first.");
  const einv = db.prepare("SELECT status FROM e_invoice_records WHERE voucher_id = ?").get(v.id);
  if (einv?.status === "Generated") throw conflict("An IRN has been generated for this invoice. Cancel the e-invoice and raise a credit note instead.");
}

export function loadVoucherRow(db, company, voucherId) {
  const v = db.prepare("SELECT * FROM vouchers WHERE id = ? AND company_id = ?").get(voucherId, company.id);
  if (!v) throw notFound("Voucher not found.");
  return v;
}

/** Modify a voucher. The previous version is preserved as an immutable revision. */
export function updateVoucher(db, req, company, voucherId, input, reason = "") {
  return db.transaction(() => {
    const v = loadVoucherRow(db, company, voucherId);
    assertEditable(db, company, v);
    if (input.type !== v.voucher_type) throw badRequest("The voucher type cannot be changed; cancel and re-enter instead.");
    if (v.source === "payroll" && !req.internalPayroll) throw badRequest("Payroll vouchers are changed through the payroll run.");
    const before = voucherSnapshot(db, v.id);
    db.prepare("INSERT INTO voucher_revisions(id, voucher_id, company_id, revision, snapshot_json, changed_by, reason) VALUES (?,?,?,?,?,?,?)").run(
      uuid(),
      v.id,
      company.id,
      v.revision,
      JSON.stringify(before),
      req.user.id,
      reason,
    );
    req.excludeVoucherId = v.id;
    clearChildren(db, v.id);
    const built = buildVoucher(db, req, company, input, { existing: v });
    let status = decideStatus(req, company, input);
    if (built.fy.id !== v.financial_year_id && v.voucher_number) throw badRequest("A numbered voucher cannot be moved to another financial year.");
    let number = v.voucher_number;
    if (status === "Posted" && !number) number = nextNumber(db, built.fy, input.type, input.voucherNumber);
    if (status === "Draft" && v.status === "Posted") status = "Posted"; // posted vouchers cannot be un-posted, only cancelled
    const h = built.header;
    db.prepare(
      `UPDATE vouchers SET financial_year_id=?, voucher_number=?, date=?, reference_no=?, reference_date=?, party_ledger_id=?, narration=?, status=?, total_paise=?,
         is_accounting=?, place_of_supply=?, is_inter_state=?, reverse_charge=?, gst_invoice_type=?, original_invoice_no=?, original_invoice_date=?, currency=?,
         exchange_rate_micros=?, order_id=?, due_date=?, revision = revision + 1, approved_by=?, approved_at=?, status_reason='', updated_by=?, updated_at=? WHERE id=?`,
    ).run(
      built.fy.id,
      number,
      h.date,
      h.reference_no,
      h.reference_date,
      h.party_ledger_id,
      h.narration,
      status,
      h.total_paise,
      h.is_accounting,
      h.place_of_supply,
      h.is_inter_state,
      h.reverse_charge,
      h.gst_invoice_type,
      h.original_invoice_no,
      h.original_invoice_date,
      h.currency,
      h.exchange_rate_micros,
      h.order_id,
      h.due_date,
      status === "Posted" ? req.user.id : null,
      status === "Posted" ? nowIso() : null,
      req.user.id,
      nowIso(),
      v.id,
    );
    writeChildren(db, company, v.id, built, number);
    if (status === "PendingApproval") approvalEvent(db, req, company, v.id, "Submitted", reason);
    if (input.orderId) updateOrderFulfilment(db, company, input.orderId);
    if (v.order_id && v.order_id !== input.orderId) updateOrderFulfilment(db, company, v.order_id);
    acctAudit(db, req, {
      companyId: company.id,
      action: "voucher.modify",
      entityType: "Voucher",
      entityId: v.id,
      summary: `${v.voucher_type} ${number || ""} revised (rev ${v.revision + 1})${reason ? `: ${reason}` : ""}`,
      before,
      after: voucherSnapshot(db, v.id),
    });
    return { id: v.id, warnings: built.warnings };
  })();
}

export function cancelVoucher(db, req, company, voucherId, reason) {
  return db.transaction(() => {
    const v = loadVoucherRow(db, company, voucherId);
    assertEditable(db, company, v);
    if (v.source === "payroll" && !req.internalPayroll) throw badRequest("Cancel the payroll run instead.");
    db.prepare("UPDATE vouchers SET status='Cancelled', cancelled_by=?, cancelled_at=?, status_reason=?, updated_by=?, updated_at=? WHERE id=?").run(
      req.user.id,
      nowIso(),
      reason,
      req.user.id,
      nowIso(),
      v.id,
    );
    if (v.order_id) updateOrderFulfilment(db, company, v.order_id);
    acctAudit(db, req, {
      companyId: company.id,
      action: "voucher.cancel",
      entityType: "Voucher",
      entityId: v.id,
      summary: `${v.voucher_type} ${v.voucher_number || ""} cancelled: ${reason}`,
      before: { status: v.status },
      after: { status: "Cancelled" },
    });
  })();
}

function approvalEvent(db, req, company, voucherId, action, comment = "") {
  db.prepare(
    "INSERT INTO voucher_approval_workflows(id, organization_id, company_id, voucher_id, action, actor_id, actor_name, comment) VALUES (?,?,?,?,?,?,?,?)",
  ).run(uuid(), company.organization_id, company.id, voucherId, action, req.user.id, req.user.name, comment);
}

export function decideApproval(db, req, company, voucherId, approve, comment = "") {
  return db.transaction(() => {
    const v = loadVoucherRow(db, company, voucherId);
    if (v.status !== "PendingApproval") throw conflict("Only vouchers pending approval can be approved or rejected.");
    // Maker-checker: a reviewer cannot approve their own entry (Admins may, e.g. in a one-person firm).
    if (v.updated_by === req.user.id && req.acct.role !== "Admin") throw forbidden("You cannot approve your own voucher.");
    if (approve) {
      const fy = db.prepare("SELECT * FROM financial_years WHERE id = ?").get(v.financial_year_id);
      if (fy.status === "Closed") throw badRequest(`${fy.label} is closed.`);
      const number = v.voucher_number || nextNumber(db, fy, v.voucher_type, null);
      db.prepare("UPDATE vouchers SET status='Posted', voucher_number=?, approved_by=?, approved_at=?, updated_at=? WHERE id=?").run(
        number,
        req.user.id,
        nowIso(),
        nowIso(),
        v.id,
      );
      db.prepare("UPDATE voucher_entries SET bill_ref = ? WHERE voucher_id = ? AND bill_type = 'New' AND bill_ref IS NULL").run(number, v.id);
    } else db.prepare("UPDATE vouchers SET status='Rejected', status_reason=?, updated_at=? WHERE id=?").run(comment, nowIso(), v.id);
    approvalEvent(db, req, company, v.id, approve ? "Approved" : "Rejected", comment);
    acctAudit(db, req, {
      companyId: company.id,
      action: approve ? "voucher.approve" : "voucher.reject",
      entityType: "Voucher",
      entityId: v.id,
      summary: `${v.voucher_type} ${approve ? "approved" : "rejected"}${comment ? `: ${comment}` : ""}`,
    });
  })();
}

/** Recompute fulfilled quantities of an order from posted vouchers linked to it. */
export function updateOrderFulfilment(db, company, orderId) {
  const o = db.prepare("SELECT * FROM business_orders WHERE id = ? AND company_id = ?").get(orderId, company.id);
  if (!o) throw badRequest("orderId: order not found.");
  if (o.status === "Cancelled") throw badRequest("orderId: the order is cancelled.");
  const lines = JSON.parse(o.lines_json);
  const done = db
    .prepare(
      `SELECT vi.stock_item_id, SUM(vi.qty_milli) q FROM voucher_items vi JOIN vouchers v ON v.id = vi.voucher_id
       WHERE v.order_id = ? AND v.status = 'Posted' AND v.voucher_type IN ('Sales','Purchase','DeliveryNote','ReceiptNote') GROUP BY vi.stock_item_id`,
    )
    .all(orderId);
  const byItem = new Map(done.map((d) => [d.stock_item_id, d.q]));
  for (const l of lines) l.fulfilledMilli = Math.min(l.qtyMilli, byItem.get(l.itemId) || 0);
  const all = lines.every((l) => l.fulfilledMilli >= l.qtyMilli);
  const any = lines.some((l) => l.fulfilledMilli > 0);
  db.prepare("UPDATE business_orders SET lines_json = ?, status = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(lines),
    all ? "Fulfilled" : any ? "PartiallyFulfilled" : "Open",
    nowIso(),
    orderId,
  );
}
