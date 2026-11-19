// GST returns preparation (GSTR-1, GSTR-3B), ITC register, liability, GSTR-2B reconciliation and
// e-invoice / e-way bill payloads. Return data is *prepared* here; filing happens on the GST portal
// (or through a GSP adapter added later — see gstPortalAdapter below). Nothing is auto-filed.

import { badRequest } from "../lib/errors.mjs";
import { addDays } from "./chart.mjs";
import { fromBp, fromMilli, fromPaise, roundToRupee, toPaise } from "./money.mjs";

const POSTED_JOIN = "JOIN vouchers v ON v.id = g.voucher_id AND v.status = 'Posted'";

export function periodRange(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || "")) throw badRequest("period must be YYYY-MM.");
  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
  return { from, to };
}

const sign = (docType) => (docType === "CreditNote" || docType === "DebitNote" ? -1 : 1);
const amt = (p) => fromPaise(p);
const tax = (r) => r.cgst_paise + r.sgst_paise + r.igst_paise + r.cess_paise;

function rows(db, companyId, direction, from, to) {
  return db
    .prepare(
      `SELECT g.*, v.voucher_number, v.total_paise, v.gst_invoice_type, v.original_invoice_no, v.original_invoice_date, v.reference_no, v.reference_date, l.name party_name
       FROM gst_transactions g ${POSTED_JOIN} LEFT JOIN ledgers l ON l.id = g.party_ledger_id
       WHERE g.company_id = ? AND g.direction = ? AND g.date BETWEEN ? AND ? ORDER BY g.date, v.voucher_number`,
    )
    .all(companyId, direction, from, to);
}

function byInvoice(list) {
  const m = new Map();
  for (const r of list) {
    const inv = m.get(r.voucher_id) || {
      voucherId: r.voucher_id,
      invoiceNo: r.voucher_number,
      date: r.date,
      party: r.party_name,
      gstin: r.party_gstin,
      placeOfSupply: r.place_of_supply,
      reverseCharge: !!r.reverse_charge,
      invoiceValue: amt(r.total_paise),
      originalInvoiceNo: r.original_invoice_no,
      originalInvoiceDate: r.original_invoice_date,
      docType: r.doc_type,
      items: [],
    };
    inv.items.push({
      rate: fromBp(r.rate_bp),
      taxable: amt(r.taxable_paise),
      igst: amt(r.igst_paise),
      cgst: amt(r.cgst_paise),
      sgst: amt(r.sgst_paise),
      cess: amt(r.cess_paise),
    });
    m.set(r.voucher_id, inv);
  }
  return [...m.values()];
}

export function gstr1(db, company, period) {
  const { from, to } = periodRange(period);
  const out = rows(db, company.id, "Outward", from, to);
  const invoices = out.filter((r) => r.doc_type === "Invoice");
  const notes = out.filter((r) => r.doc_type !== "Invoice");
  const b2b = byInvoice(invoices.filter((r) => r.gst_invoice_type === "B2B"));
  const b2cl = byInvoice(invoices.filter((r) => r.gst_invoice_type === "B2CL"));
  const exp = byInvoice(invoices.filter((r) => r.gst_invoice_type === "EXP" || r.gst_invoice_type === "SEZ"));
  const b2csMap = new Map();
  for (const r of invoices.filter((x) => x.gst_invoice_type === "B2CS")) {
    const k = `${r.place_of_supply}|${r.rate_bp}`;
    const x = b2csMap.get(k) || { placeOfSupply: r.place_of_supply, rate: fromBp(r.rate_bp), taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    x.taxable += r.taxable_paise;
    x.igst += r.igst_paise;
    x.cgst += r.cgst_paise;
    x.sgst += r.sgst_paise;
    x.cess += r.cess_paise;
    b2csMap.set(k, x);
  }
  const b2cs = [...b2csMap.values()].map((x) => ({
    ...x,
    taxable: amt(x.taxable),
    igst: amt(x.igst),
    cgst: amt(x.cgst),
    sgst: amt(x.sgst),
    cess: amt(x.cess),
  }));
  const cdnr = byInvoice(notes.filter((r) => r.party_gstin));
  const cdnur = byInvoice(notes.filter((r) => !r.party_gstin));

  // HSN summary (quantities from item lines; values net of credit notes)
  const hsn = new Map();
  for (const r of out) {
    const s = sign(r.doc_type);
    const k = `${r.hsn_sac}|${r.rate_bp}`;
    const x = hsn.get(k) || { hsn: r.hsn_sac, rate: fromBp(r.rate_bp), qtyMilli: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    x.taxable += s * r.taxable_paise;
    x.igst += s * r.igst_paise;
    x.cgst += s * r.cgst_paise;
    x.sgst += s * r.sgst_paise;
    x.cess += s * r.cess_paise;
    hsn.set(k, x);
  }
  const qty = db
    .prepare(
      `SELECT vi.hsn_sac, vi.gst_rate_bp, v.voucher_type, SUM(vi.qty_milli) q FROM voucher_items vi JOIN vouchers v ON v.id = vi.voucher_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.voucher_type IN ('Sales','CreditNote') AND v.date BETWEEN ? AND ? GROUP BY vi.hsn_sac, vi.gst_rate_bp, v.voucher_type`,
    )
    .all(company.id, from, to);
  for (const q of qty) {
    const x = hsn.get(`${q.hsn_sac}|${q.gst_rate_bp}`);
    if (x) x.qtyMilli += (q.voucher_type === "CreditNote" ? -1 : 1) * q.q;
  }
  const hsnSummary = [...hsn.values()].map((x) => ({
    hsn: x.hsn || "(blank)",
    rate: x.rate,
    quantity: fromMilli(x.qtyMilli),
    taxable: amt(x.taxable),
    igst: amt(x.igst),
    cgst: amt(x.cgst),
    sgst: amt(x.sgst),
    cess: amt(x.cess),
  }));

  const docs = db
    .prepare(
      `SELECT voucher_type, MIN(voucher_number) first, MAX(voucher_number) last, COUNT(*) total, SUM(status='Cancelled') cancelled FROM vouchers
       WHERE company_id = ? AND voucher_type IN ('Sales','CreditNote') AND voucher_number IS NOT NULL AND date BETWEEN ? AND ? GROUP BY voucher_type`,
    )
    .all(company.id, from, to);
  const totals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const r of out) {
    const s = sign(r.doc_type);
    totals.taxable += s * r.taxable_paise;
    totals.igst += s * r.igst_paise;
    totals.cgst += s * r.cgst_paise;
    totals.sgst += s * r.sgst_paise;
    totals.cess += s * r.cess_paise;
  }
  const missing = out.filter((r) => !r.hsn_sac).length;
  return {
    period,
    gstin: primaryGstin(db, company),
    b2b,
    b2cl,
    b2cs,
    exp,
    cdnr,
    cdnur,
    hsn: hsnSummary,
    documents: docs.map((d) => ({ type: d.voucher_type, from: d.first, to: d.last, total: d.total, cancelled: d.cancelled })),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, amt(v)])),
    warnings: missing ? [`${missing} outward line(s) have no HSN/SAC code.`] : [],
  };
}

export function primaryGstin(db, company) {
  return db.prepare("SELECT gstin FROM gst_registrations WHERE company_id = ? ORDER BY is_primary DESC LIMIT 1").get(company.id)?.gstin || "";
}

const zero = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const addTo = (acc, r, s = 1) => {
  acc.taxable += s * r.taxable_paise;
  acc.igst += s * r.igst_paise;
  acc.cgst += s * r.cgst_paise;
  acc.sgst += s * r.sgst_paise;
  acc.cess += s * r.cess_paise;
};
const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, amt(v)]));

/** Utilise ITC against liability in the order prescribed by s.49 / rule 88A. Returns cash payable per head. */
export function setOff(liability, itc) {
  const L = { ...liability };
  const C = { ...itc };
  const use = (from, to) => {
    const u = Math.min(C[from], L[to]);
    C[from] -= u;
    L[to] -= u;
    return u;
  };
  const used = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  // IGST credit: IGST, then CGST, then SGST
  used.igst += use("igst", "igst") + use("igst", "cgst") + use("igst", "sgst");
  // CGST credit: CGST then IGST; SGST credit: SGST then IGST (never CGST <-> SGST)
  used.cgst += use("cgst", "cgst") + use("cgst", "igst");
  used.sgst += use("sgst", "sgst") + use("sgst", "igst");
  used.cess += use("cess", "cess");
  return { cashPayable: L, itcUsed: used, itcBalance: C };
}

export function gstr3b(db, company, period) {
  const { from, to } = periodRange(period);
  const out = rows(db, company.id, "Outward", from, to);
  const inn = rows(db, company.id, "Inward", from, to);
  const taxableOut = zero();
  const zeroRated = zero();
  const nilExempt = zero();
  for (const r of out) {
    const s = sign(r.doc_type);
    if (r.gst_invoice_type === "EXP" || r.gst_invoice_type === "SEZ") addTo(zeroRated, r, s);
    else if (r.rate_bp === 0) addTo(nilExempt, r, s);
    else addTo(taxableOut, r, s);
  }
  const rcmInward = zero();
  const itcRcm = zero();
  const itcOther = zero();
  const ineligible = zero();
  for (const r of inn) {
    const s = sign(r.doc_type);
    if (r.reverse_charge) addTo(rcmInward, r, s);
    if (!r.itc_eligible) addTo(ineligible, r, s);
    else if (r.reverse_charge) addTo(itcRcm, r, s);
    else addTo(itcOther, r, s);
  }
  const itc = { igst: itcRcm.igst + itcOther.igst, cgst: itcRcm.cgst + itcOther.cgst, sgst: itcRcm.sgst + itcOther.sgst, cess: itcRcm.cess + itcOther.cess };
  const outwardLiability = { igst: taxableOut.igst + zeroRated.igst, cgst: taxableOut.cgst, sgst: taxableOut.sgst, cess: taxableOut.cess + zeroRated.cess };
  const so = setOff(outwardLiability, itc);
  // RCM tax is always discharged in cash.
  const cash = {
    igst: so.cashPayable.igst + rcmInward.igst,
    cgst: so.cashPayable.cgst + rcmInward.cgst,
    sgst: so.cashPayable.sgst + rcmInward.sgst,
    cess: so.cashPayable.cess + rcmInward.cess,
  };
  const paid = db
    .prepare(
      "SELECT COALESCE(SUM(igst_paise),0) igst, COALESCE(SUM(cgst_paise),0) cgst, COALESCE(SUM(sgst_paise),0) sgst, COALESCE(SUM(cess_paise),0) cess FROM gst_payments WHERE company_id = ? AND period = ?",
    )
    .get(company.id, period);
  const cashRounded = Object.fromEntries(Object.entries(cash).map(([k, v]) => [k, roundToRupee(Math.max(0, v))]));
  return {
    period,
    gstin: primaryGstin(db, company),
    3.1: {
      a_taxableOutward: fmt(taxableOut),
      b_zeroRated: fmt(zeroRated),
      c_nilExempt: fmt(nilExempt),
      d_inwardReverseCharge: fmt(rcmInward),
    },
    4: {
      A3_inwardRcm: fmt({ igst: itcRcm.igst, cgst: itcRcm.cgst, sgst: itcRcm.sgst, cess: itcRcm.cess }),
      A5_allOtherItc: fmt({ igst: itcOther.igst, cgst: itcOther.cgst, sgst: itcOther.sgst, cess: itcOther.cess }),
      D_ineligible: fmt({ igst: ineligible.igst, cgst: ineligible.cgst, sgst: ineligible.sgst, cess: ineligible.cess }),
      netItc: fmt(itc),
    },
    payment: {
      liability: fmt(outwardLiability),
      itcUtilised: fmt(so.itcUsed),
      itcCarriedForward: fmt(so.itcBalance),
      payableInCash: fmt(cashRounded),
      paid: fmt(paid),
      balanceDue: fmt(Object.fromEntries(Object.keys(cashRounded).map((k) => [k, Math.max(0, cashRounded[k] - paid[k])]))),
    },
  };
}

export function itcRegister(db, company, from, to) {
  const list = rows(db, company.id, "Inward", from, to);
  const t = zero();
  for (const r of list) if (r.itc_eligible) addTo(t, r, sign(r.doc_type));
  return {
    from,
    to,
    rows: list.map((r) => ({
      voucherId: r.voucher_id,
      date: r.date,
      voucherNo: r.voucher_number,
      supplierInvoiceNo: r.reference_no,
      supplier: r.party_name,
      gstin: r.party_gstin,
      docType: r.doc_type,
      rate: fromBp(r.rate_bp),
      taxable: amt(r.taxable_paise),
      igst: amt(r.igst_paise),
      cgst: amt(r.cgst_paise),
      sgst: amt(r.sgst_paise),
      cess: amt(r.cess_paise),
      totalTax: amt(tax(r)),
      reverseCharge: !!r.reverse_charge,
      eligible: !!r.itc_eligible,
      claimedPeriod: r.itc_claimed_period,
    })),
    totalEligible: fmt(t),
  };
}

export function liabilitySummary(db, company, from, to) {
  const list = db
    .prepare(
      `SELECT substr(g.date,1,7) period, g.direction, g.doc_type, g.reverse_charge, g.itc_eligible, SUM(g.igst_paise+g.cgst_paise+g.sgst_paise+g.cess_paise) t
       FROM gst_transactions g ${POSTED_JOIN} WHERE g.company_id = ? AND g.date BETWEEN ? AND ? GROUP BY period, g.direction, g.doc_type, g.reverse_charge, g.itc_eligible`,
    )
    .all(company.id, from, to);
  const m = new Map();
  for (const r of list) {
    const x = m.get(r.period) || { period: r.period, outputTax: 0, rcmTax: 0, itc: 0 };
    const s = sign(r.doc_type);
    if (r.direction === "Outward") x.outputTax += s * r.t;
    else {
      if (r.reverse_charge) x.rcmTax += s * r.t;
      if (r.itc_eligible) x.itc += s * r.t;
    }
    m.set(r.period, x);
  }
  const paid = new Map(
    db
      .prepare("SELECT period, SUM(igst_paise+cgst_paise+sgst_paise+cess_paise) p FROM gst_payments WHERE company_id = ? GROUP BY period")
      .all(company.id)
      .map((r) => [r.period, r.p]),
  );
  return {
    from,
    to,
    rows: [...m.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((x) => ({
        period: x.period,
        outputTax: amt(x.outputTax),
        rcmTax: amt(x.rcmTax),
        itc: amt(x.itc),
        netPayable: amt(Math.max(0, x.outputTax + x.rcmTax - x.itc)),
        paid: amt(paid.get(x.period) || 0),
      })),
  };
}

// GSTR-2B reconciliation -----------------------------------------------------------------------------

const normInv = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+/, "");

/** Accepts the portal's GSTR-2B JSON (data.docdata.b2b[].inv[]) or a flat list of rows. */
export function parse2b(input) {
  if (Array.isArray(input)) return input;
  const b2b = input?.data?.docdata?.b2b || input?.docdata?.b2b || input?.b2b;
  if (!Array.isArray(b2b)) throw badRequest("Upload GSTR-2B JSON (data.docdata.b2b) or a list of rows.");
  const out = [];
  for (const s of b2b)
    for (const inv of s.inv || []) {
      const items = inv.items || inv.itms || [];
      const p = (v) => toPaise(v ?? 0) ?? 0; // portal numbers have at most 2 decimals; summed exactly in paise
      const taxable = items.reduce((a, i) => a + p(i.txval ?? i.itm_det?.txval), 0);
      const taxAmt = items.reduce((a, i) => a + p(i.igst ?? i.iamt) + p(i.cgst ?? i.camt) + p(i.sgst ?? i.samt) + p(i.cess ?? i.csamt), 0);
      out.push({ supplierGstin: s.ctin, invoiceNo: inv.inum, invoiceDate: inv.dt || inv.idt || "", taxable: fromPaise(taxable), tax: fromPaise(taxAmt) });
    }
  return out;
}

export function reconcile2b(db, company, period, portalRows, toPaise, uuid) {
  const { from, to } = periodRange(period);
  const books = db
    .prepare(
      `SELECT v.id, v.reference_no, v.date, l.gstin, l.name, SUM(g.taxable_paise) taxable, SUM(g.igst_paise+g.cgst_paise+g.sgst_paise+g.cess_paise) tax
       FROM vouchers v JOIN gst_transactions g ON g.voucher_id = v.id JOIN ledgers l ON l.id = v.party_ledger_id
       WHERE v.company_id = ? AND v.status = 'Posted' AND v.voucher_type = 'Purchase' AND v.date BETWEEN ? AND ? AND l.gstin <> '' GROUP BY v.id`,
    )
    .all(company.id, from, addDays(to, 0));
  const index = new Map(books.map((b) => [`${b.gstin}|${normInv(b.reference_no)}`, b]));
  const used = new Set();
  db.prepare("DELETE FROM gst_reconciliations WHERE company_id = ? AND period = ?").run(company.id, period);
  const ins = db.prepare(
    `INSERT INTO gst_reconciliations(id, organization_id, company_id, period, source, supplier_gstin, invoice_no, invoice_date, taxable_paise, tax_paise, match_status, voucher_id, difference_paise)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const result = [];
  portalRows.forEach((r, i) => {
    const gstin = String(r.supplierGstin || "")
      .trim()
      .toUpperCase();
    const taxable = toPaise(r.taxable);
    const t = toPaise(r.tax);
    if (!gstin || !r.invoiceNo || taxable === null || t === null) throw badRequest(`rows.${i}: supplierGstin, invoiceNo, taxable and tax are required.`);
    const b = index.get(`${gstin}|${normInv(r.invoiceNo)}`);
    let status = "MissingInBooks";
    let diff = 0;
    if (b) {
      used.add(b.id);
      diff = taxable + t - (b.taxable + b.tax);
      status = Math.abs(diff) <= 100 ? "Matched" : "Mismatch"; // ₹1 tolerance for rounding
    }
    ins.run(
      uuid(),
      company.organization_id,
      company.id,
      period,
      "GSTR2B",
      gstin,
      String(r.invoiceNo),
      r.invoiceDate || "",
      taxable,
      t,
      status,
      b?.id ?? null,
      diff,
    );
    result.push({ supplierGstin: gstin, invoiceNo: r.invoiceNo, taxable: amt(taxable), tax: amt(t), status, voucherId: b?.id ?? null, difference: amt(diff) });
  });
  const booksOnly = books
    .filter((b) => !used.has(b.id))
    .map((b) => ({
      supplierGstin: b.gstin,
      supplier: b.name,
      invoiceNo: b.reference_no,
      date: b.date,
      taxable: amt(b.taxable),
      tax: amt(b.tax),
      status: "MissingIn2B",
      voucherId: b.id,
    }));
  const count = (s) => result.filter((r) => r.status === s).length;
  return {
    period,
    summary: { matched: count("Matched"), mismatched: count("Mismatch"), missingInBooks: count("MissingInBooks"), missingIn2B: booksOnly.length },
    rows: [...result, ...booksOnly],
  };
}

// E-invoice (IRP schema 1.1) and e-way bill --------------------------------------------------------------

const ddmmyyyy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const num = (p) => Number(fromPaise(p)); // portal JSON expects numbers; values are exact to 2 dp
const pinOf = (addr) => Number(/(\d{6})(?!.*\d{6})/.exec(addr || "")?.[1] || 0);

export function eInvoicePayload(db, company, voucher) {
  if (!["Sales", "CreditNote"].includes(voucher.voucher_type)) throw badRequest("E-invoices are generated for sales invoices and credit notes.");
  if (voucher.status !== "Posted") throw badRequest("Post the voucher before generating its e-invoice.");
  const party = db.prepare("SELECT * FROM ledgers WHERE id = ?").get(voucher.party_ledger_id);
  const items = db
    .prepare(
      "SELECT vi.*, u.uqc FROM voucher_items vi LEFT JOIN inventory_items ii ON ii.id = vi.stock_item_id LEFT JOIN units_of_measure u ON u.id = ii.unit_id WHERE vi.voucher_id = ? ORDER BY vi.line_no",
    )
    .all(voucher.id);
  const sellerGstin = primaryGstin(db, company);
  const errors = [];
  if (!sellerGstin) errors.push("Company GSTIN is missing.");
  if (!party?.gstin && !["Overseas"].includes(party?.gst_registration_type)) errors.push("Buyer GSTIN is required for B2B e-invoices.");
  if (!pinOf(company.address)) errors.push("Company address must include a 6-digit PIN code.");
  if (party && !pinOf(party.address) && party.gst_registration_type !== "Overseas") errors.push("Buyer address must include a 6-digit PIN code.");
  items.forEach((it, i) => {
    if (!it.hsn_sac) errors.push(`Line ${i + 1}: HSN/SAC code is required.`);
  });
  const roundOff = db
    .prepare(
      "SELECT COALESCE(SUM(ve.credit_paise - ve.debit_paise),0) r FROM voucher_entries ve JOIN ledgers l ON l.id = ve.ledger_id WHERE ve.voucher_id = ? AND l.system_code = 'ROUND_OFF'",
    )
    .get(voucher.id).r;
  const t = items.reduce(
    (a, it) => ({
      ass: a.ass + it.taxable_paise,
      cgst: a.cgst + it.cgst_paise,
      sgst: a.sgst + it.sgst_paise,
      igst: a.igst + it.igst_paise,
      cess: a.cess + it.cess_paise,
    }),
    { ass: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 },
  );
  const supTyp =
    party?.gst_registration_type === "SEZ"
      ? t.igst
        ? "SEZWP"
        : "SEZWOP"
      : party?.gst_registration_type === "Overseas"
        ? t.igst
          ? "EXPWP"
          : "EXPWOP"
        : "B2B";
  const payload = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supTyp, RegRev: voucher.reverse_charge ? "Y" : "N", IgstOnIntra: "N" },
    DocDtls: { Typ: voucher.voucher_type === "CreditNote" ? "CRN" : "INV", No: voucher.voucher_number, Dt: ddmmyyyy(voucher.date) },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: company.legal_name || company.name,
      Addr1: (company.address || "").slice(0, 100),
      Loc: "",
      Pin: pinOf(company.address),
      Stcd: sellerGstin.slice(0, 2),
    },
    BuyerDtls: {
      Gstin: party?.gstin || "URP",
      LglNm: party?.name || "",
      Pos: voucher.place_of_supply || "96",
      Addr1: (party?.address || "").slice(0, 100),
      Loc: "",
      Pin: pinOf(party?.address) || 999999,
      Stcd: party?.gstin ? party.gstin.slice(0, 2) : "96",
    },
    ItemList: items.map((it, i) => {
      const gross = it.qty_milli ? Math.round((it.qty_milli * it.rate_paise) / 1000) : it.taxable_paise;
      return {
        SlNo: String(i + 1),
        PrdDesc: it.description,
        IsServc: /^99/.test(it.hsn_sac) ? "Y" : "N",
        HsnCd: it.hsn_sac,
        Qty: it.qty_milli / 1000,
        Unit: it.uqc || "NOS",
        UnitPrice: num(it.rate_paise || it.taxable_paise),
        TotAmt: num(gross),
        Discount: num(gross - it.taxable_paise),
        AssAmt: num(it.taxable_paise),
        GstRt: it.gst_rate_bp / 100,
        IgstAmt: num(it.igst_paise),
        CgstAmt: num(it.cgst_paise),
        SgstAmt: num(it.sgst_paise),
        CesRt: it.cess_rate_bp / 100,
        CesAmt: num(it.cess_paise),
        TotItemVal: num(it.taxable_paise + it.cgst_paise + it.sgst_paise + it.igst_paise + it.cess_paise),
      };
    }),
    ValDtls: {
      AssVal: num(t.ass),
      CgstVal: num(t.cgst),
      SgstVal: num(t.sgst),
      IgstVal: num(t.igst),
      CesVal: num(t.cess),
      RndOffAmt: num(roundOff),
      TotInvVal: num(voucher.total_paise),
    },
  };
  return { payload, errors };
}

export const EWAY_THRESHOLD_PAISE = 5000000; // ₹50,000 — notified consignment value threshold

export function ewayPayload(db, company, voucher, transport) {
  const party = db.prepare("SELECT * FROM ledgers WHERE id = ?").get(voucher.party_ledger_id);
  const items = db.prepare("SELECT * FROM voucher_items WHERE voucher_id = ? ORDER BY line_no").all(voucher.id);
  const errors = [];
  if (voucher.total_paise < EWAY_THRESHOLD_PAISE) errors.push("Consignment value is below ₹50,000; an e-way bill is generally not mandatory.");
  if (transport.transportMode === "Road" && !transport.vehicleNo && !transport.transporterId)
    errors.push("Vehicle number or transporter ID is required for road transport.");
  if (transport.vehicleNo && !/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(transport.vehicleNo.replace(/\s/g, "").toUpperCase()))
    errors.push("Vehicle number format looks invalid.");
  const outward = ["Sales", "DeliveryNote", "DebitNote"].includes(voucher.voucher_type);
  const gstin = primaryGstin(db, company);
  return {
    errors,
    payload: {
      supplyType: outward ? "O" : "I",
      subSupplyType: "1",
      docType: voucher.voucher_type === "DeliveryNote" ? "CHL" : "INV",
      docNo: voucher.voucher_number,
      docDate: ddmmyyyy(voucher.date),
      fromGstin: outward ? gstin : party?.gstin || "URP",
      toGstin: outward ? party?.gstin || "URP" : gstin,
      fromPincode: pinOf(outward ? company.address : party?.address),
      toPincode: pinOf(outward ? party?.address : company.address),
      transactionType: 1,
      totalValue: num(items.reduce((a, i) => a + i.taxable_paise, 0)),
      cgstValue: num(items.reduce((a, i) => a + i.cgst_paise, 0)),
      sgstValue: num(items.reduce((a, i) => a + i.sgst_paise, 0)),
      igstValue: num(items.reduce((a, i) => a + i.igst_paise, 0)),
      cessValue: num(items.reduce((a, i) => a + i.cess_paise, 0)),
      totInvValue: num(voucher.total_paise),
      transMode: { Road: "1", Rail: "2", Air: "3", Ship: "4" }[transport.transportMode] || "1",
      transDistance: String(transport.distanceKm || 0),
      transporterId: transport.transporterId || "",
      transporterName: transport.transporterName || "",
      vehicleNo: (transport.vehicleNo || "").replace(/\s/g, "").toUpperCase(),
      itemList: items.map((i) => ({ productName: i.description, hsnCode: i.hsn_sac, quantity: i.qty_milli / 1000, taxableAmount: num(i.taxable_paise) })),
    },
  };
}

/**
 * GST portal / GSP adapter boundary. Today only "manual" exists: payloads are prepared here, uploaded by
 * the professional on the portal (or a GSP), and the IRN / e-way bill number is recorded back. A GSP
 * integration implements { generateIrn(payload), cancelIrn(irn), generateEwb(payload), fileReturn(...) }
 * and is selected by configuration — callers do not change.
 */
export function gstPortalAdapter(provider = "manual") {
  if (provider !== "manual") throw new Error(`GST provider ${provider} is not configured`);
  return { name: "manual", automatic: false };
}
