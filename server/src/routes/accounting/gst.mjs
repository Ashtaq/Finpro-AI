// GST (registrations, HSN/SAC & rates, GSTR-1/3B, ITC, liability, payments, set-off, 2B reconciliation,
// e-invoice, e-way bill) and TDS/TCS endpoints.

import multer from "multer";
import { z } from "zod";
import { parseCsv } from "../../accounting/banking.mjs";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import { groupIdsByCode, systemLedger, UT_STATE_CODES } from "../../accounting/chart.mjs";
import { sendTable } from "../../accounting/export.mjs";
import * as G from "../../accounting/gst.mjs";
import { fromBp, fromPaise, nonNegMoney, percent, toPaise } from "../../accounting/money.mjs";
import { createVoucher, loadVoucherRow } from "../../accounting/vouchers.mjs";
import { badRequest, conflict, notFound } from "../../lib/errors.mjs";
import { gstin, id, isoDate, parse, requiredText, text } from "../../lib/validate.mjs";
import { A, ADMIN, str, W } from "./helpers.mjs";

const reqDate = () => isoDate().refine((v) => v !== "", "is required");
const period = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

const baseVoucher = {
  referenceDate: "",
  reverseCharge: false,
  itcEligible: true,
  originalInvoiceNo: "",
  originalInvoiceDate: "",
  currency: "INR",
  dueDate: "",
  roundOff: false,
  items: [],
  saveAsDraft: false,
  overrideCreditLimit: false,
};

function ensureLedger(db, company, code, name, groupCode, userId) {
  const l = db.prepare("SELECT * FROM ledgers WHERE company_id = ? AND system_code = ?").get(company.id, code);
  if (l) return l.id;
  const lid = uuid();
  db.prepare("INSERT INTO ledgers(id, organization_id, company_id, group_id, name, system_code, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?)").run(
    lid,
    company.organization_id,
    company.id,
    groupIdsByCode(db, company.id)[groupCode],
    name,
    code,
    userId,
    userId,
  );
  return lid;
}

function gstTable(kind, data) {
  if (kind === "gstr1") {
    const inv = (sec, list) =>
      list.flatMap((i) =>
        i.items.map((it) => [sec, i.invoiceNo, i.date, i.gstin || "", i.placeOfSupply, it.rate, it.taxable, it.igst, it.cgst, it.sgst, it.cess]),
      );
    return {
      title: `GSTR-1 ${data.period} (${data.gstin})`,
      columns: ["Section", "Invoice", "Date", "GSTIN", "POS", "Rate", "Taxable", "IGST", "CGST", "SGST", "Cess"],
      rows: [
        ...inv("B2B", data.b2b),
        ...inv("B2CL", data.b2cl),
        ...data.b2cs.map((x) => ["B2CS", "", "", "", x.placeOfSupply, x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.cess]),
        ...inv("EXP", data.exp),
        ...inv("CDNR", data.cdnr),
        ...inv("CDNUR", data.cdnur),
        ...data.hsn.map((h) => ["HSN", h.hsn, "", "", "", h.rate, h.taxable, h.igst, h.cgst, h.sgst, h.cess]),
        ["Total", "", "", "", "", "", data.totals.taxable, data.totals.igst, data.totals.cgst, data.totals.sgst, data.totals.cess],
      ],
    };
  }
  const row = (label, o) => [label, o.taxable ?? "", o.igst, o.cgst, o.sgst, o.cess];
  return {
    title: `GSTR-3B ${data.period} (${data.gstin})`,
    columns: ["Particulars", "Taxable", "IGST", "CGST", "SGST", "Cess"],
    rows: [
      row("3.1(a) Outward taxable supplies", data["3.1"].a_taxableOutward),
      row("3.1(b) Zero rated", data["3.1"].b_zeroRated),
      row("3.1(c) Nil / exempt", data["3.1"].c_nilExempt),
      row("3.1(d) Inward supplies (reverse charge)", data["3.1"].d_inwardReverseCharge),
      row("4(A)(3) ITC — inward RCM", data["4"].A3_inwardRcm),
      row("4(A)(5) ITC — all other", data["4"].A5_allOtherItc),
      row("4(D) Ineligible ITC", data["4"].D_ineligible),
      row("Net ITC available", data["4"].netItc),
      row("Tax payable in cash", data.payment.payableInCash),
      row("Paid", data.payment.paid),
      row("Balance due", data.payment.balanceDue),
    ],
  };
}

export default function gstRoutes(c, { db }) {
  // Registrations ----------------------------------------------------------------------------------
  const toReg = (r) => ({
    id: r.id,
    gstin: r.gstin,
    stateCode: r.state_code,
    registrationType: r.registration_type,
    effectiveFrom: r.effective_from,
    isPrimary: !!r.is_primary,
    eInvoiceApplicable: !!r.e_invoice_applicable,
    ewayBillApplicable: !!r.eway_bill_applicable,
  });
  c.get("/gst/registrations", (req, res) =>
    res.json(db.prepare("SELECT * FROM gst_registrations WHERE company_id = ? ORDER BY is_primary DESC").all(req.company.id).map(toReg)),
  );
  c.post("/gst/registrations", ADMIN, (req, res) => {
    const b = parse(
      z.object({
        gstin: gstin().refine((v) => v !== "", "is required"),
        registrationType: z.enum(["Regular", "Composition", "SEZ", "ISD"]).default("Regular"),
        effectiveFrom: reqDate(),
        isPrimary: z.boolean().default(false),
        eInvoiceApplicable: z.boolean().default(false),
        ewayBillApplicable: z.boolean().default(true),
      }),
      req.body,
    );
    const rid = uuid();
    db.transaction(() => {
      if (b.isPrimary) db.prepare("UPDATE gst_registrations SET is_primary = 0 WHERE company_id = ?").run(req.company.id);
      const first = !db.prepare("SELECT 1 FROM gst_registrations WHERE company_id = ?").get(req.company.id);
      db.prepare(
        "INSERT INTO gst_registrations(id, organization_id, company_id, gstin, state_code, registration_type, effective_from, is_primary, e_invoice_applicable, eway_bill_applicable) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        rid,
        req.company.organization_id,
        req.company.id,
        b.gstin,
        b.gstin.slice(0, 2),
        b.registrationType,
        b.effectiveFrom,
        b.isPrimary || first ? 1 : 0,
        b.eInvoiceApplicable ? 1 : 0,
        b.ewayBillApplicable ? 1 : 0,
      );
      if (!req.company.state_code) db.prepare("UPDATE accounting_companies SET state_code = ? WHERE id = ?").run(b.gstin.slice(0, 2), req.company.id);
      acctAudit(db, req, { companyId: req.company.id, action: "gst.registration.create", entityType: "GstRegistration", entityId: rid, summary: b.gstin });
    })();
    res.status(201).json(toReg(db.prepare("SELECT * FROM gst_registrations WHERE id = ?").get(rid)));
  });
  c.delete("/gst/registrations/:rid", ADMIN, (req, res) => {
    db.prepare("DELETE FROM gst_registrations WHERE id = ? AND company_id = ?").run(req.params.rid, req.company.id);
    res.status(204).end();
  });

  // HSN / SAC and rate history ---------------------------------------------------------------------------
  c.get("/gst/hsn", (req, res) =>
    res.json(
      db
        .prepare(
          `SELECT h.*, (SELECT rate_bp FROM gst_tax_rates r WHERE r.company_id = h.company_id AND r.hsn_sac = h.code AND r.effective_from <= date('now') ORDER BY effective_from DESC LIMIT 1) current_rate
           FROM hsn_sac_codes h WHERE h.company_id = ? ORDER BY h.code`,
        )
        .all(req.company.id)
        .map((h) => ({
          id: h.id,
          code: h.code,
          kind: h.kind,
          description: h.description,
          uqc: h.uqc,
          currentRate: h.current_rate === null ? null : fromBp(h.current_rate),
        })),
    ),
  );
  c.post("/gst/hsn", W, (req, res) => {
    const b = parse(
      z.object({
        code: z.string().regex(/^\d{4,8}$/, "must be 4-8 digits"),
        kind: z.enum(["HSN", "SAC"]).default("HSN"),
        description: text(300).default(""),
        uqc: text(10).default("NOS"),
        rate: percent().optional(),
        cessRate: percent().default(0),
        effectiveFrom: isoDate().default(""),
      }),
      req.body,
    );
    const hid = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO hsn_sac_codes(id, organization_id, company_id, code, kind, description, uqc) VALUES (?,?,?,?,?,?,?)").run(
        hid,
        req.company.organization_id,
        req.company.id,
        b.code,
        b.kind,
        b.description,
        b.uqc,
      );
      if (b.rate !== undefined)
        db.prepare("INSERT INTO gst_tax_rates(id, organization_id, company_id, hsn_sac, rate_bp, cess_rate_bp, effective_from) VALUES (?,?,?,?,?,?,?)").run(
          uuid(),
          req.company.organization_id,
          req.company.id,
          b.code,
          b.rate,
          b.cessRate,
          b.effectiveFrom || req.company.books_start_date,
        );
    })();
    res.status(201).json({ id: hid, code: b.code });
  });
  c.get("/gst/rates", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM gst_tax_rates WHERE company_id = ? ORDER BY hsn_sac, effective_from")
        .all(req.company.id)
        .map((r) => ({ id: r.id, hsnSac: r.hsn_sac, rate: fromBp(r.rate_bp), cessRate: fromBp(r.cess_rate_bp), effectiveFrom: r.effective_from })),
    ),
  );
  c.post("/gst/rates", W, (req, res) => {
    const b = parse(z.object({ hsnSac: z.string().regex(/^\d{4,8}$/), rate: percent(), cessRate: percent().default(0), effectiveFrom: reqDate() }), req.body);
    const rid = uuid();
    db.prepare("INSERT INTO gst_tax_rates(id, organization_id, company_id, hsn_sac, rate_bp, cess_rate_bp, effective_from) VALUES (?,?,?,?,?,?,?)").run(
      rid,
      req.company.organization_id,
      req.company.id,
      b.hsnSac,
      b.rate,
      b.cessRate,
      b.effectiveFrom,
    );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "gst.rate.create",
      entityType: "GstRate",
      entityId: rid,
      summary: `${b.hsnSac} ${fromBp(b.rate)}% from ${b.effectiveFrom}`,
    });
    res.status(201).json({ id: rid });
  });

  // Returns ----------------------------------------------------------------------------------------
  const returnRoute = (kind, fn) => (req, res) => {
    const data = fn(db, req.company, str(req.query.period));
    const format = str(req.query.format);
    if (!format || format === "json") return res.json(data);
    sendTable(res, gstTable(kind, data), format, `${req.company.name}-${kind}-${data.period}`, req.company.legal_name || req.company.name);
  };
  c.get("/gst/gstr1", returnRoute("gstr1", G.gstr1));
  c.get("/gst/gstr3b", returnRoute("gstr3b", G.gstr3b));

  c.get("/gst/returns", (req, res) =>
    res.json(
      db
        .prepare("SELECT id, return_type, period, status, arn, filed_on, created_at, updated_at FROM gst_returns WHERE company_id = ? ORDER BY period DESC")
        .all(req.company.id)
        .map((r) => ({ id: r.id, returnType: r.return_type, period: r.period, status: r.status, arn: r.arn, filedOn: r.filed_on, preparedAt: r.updated_at })),
    ),
  );
  c.post("/gst/returns", W, (req, res) => {
    const b = parse(z.object({ returnType: z.enum(["GSTR1", "GSTR3B"]), period: period() }), req.body);
    const existing = db
      .prepare("SELECT * FROM gst_returns WHERE company_id = ? AND return_type = ? AND period = ?")
      .get(req.company.id, b.returnType, b.period);
    if (existing?.status === "Filed") throw conflict("This return is marked as filed; its snapshot cannot be replaced.");
    const data = (b.returnType === "GSTR1" ? G.gstr1 : G.gstr3b)(db, req.company, b.period);
    db.prepare(
      `INSERT INTO gst_returns(id, organization_id, company_id, return_type, period, data_json, prepared_by) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(company_id, return_type, period) DO UPDATE SET data_json = excluded.data_json, prepared_by = excluded.prepared_by, updated_at = excluded.updated_at`,
    ).run(uuid(), req.company.organization_id, req.company.id, b.returnType, b.period, JSON.stringify(data), req.user.id);
    if (b.returnType === "GSTR3B") {
      const { from, to } = G.periodRange(b.period);
      db.prepare(
        "UPDATE gst_transactions SET itc_claimed_period = ? WHERE company_id = ? AND direction = 'Inward' AND itc_eligible = 1 AND itc_claimed_period IS NULL AND date BETWEEN ? AND ?",
      ).run(b.period, req.company.id, from, to);
    }
    acctAudit(db, req, { companyId: req.company.id, action: "gst.return.prepare", entityType: "GstReturn", summary: `${b.returnType} ${b.period}` });
    res.status(201).json({ returnType: b.returnType, period: b.period, data });
  });
  c.patch("/gst/returns/:rid", A, (req, res) => {
    const b = parse(z.object({ status: z.literal("Filed"), arn: requiredText(30), filedOn: reqDate() }), req.body);
    const r = db
      .prepare("UPDATE gst_returns SET status = ?, arn = ?, filed_on = ?, updated_at = ? WHERE id = ? AND company_id = ?")
      .run(b.status, b.arn, b.filedOn, nowIso(), req.params.rid, req.company.id);
    if (!r.changes) throw notFound("Return not found.");
    acctAudit(db, req, { companyId: req.company.id, action: "gst.return.filed", entityType: "GstReturn", entityId: req.params.rid, summary: `ARN ${b.arn}` });
    res.json({ ok: true });
  });

  c.get("/gst/itc", (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    res.json(G.itcRegister(db, req.company, str(req.query.from) || `${today.slice(0, 7)}-01`, str(req.query.to) || today));
  });
  c.get("/gst/liability", (req, res) => res.json(G.liabilitySummary(db, req.company, str(req.query.from) || "0000-01-01", str(req.query.to) || "9999-12-31")));

  // Payments and ITC set-off --------------------------------------------------------------------------
  const toPayment = (p) => ({
    id: p.id,
    period: p.period,
    cpin: p.cpin,
    cin: p.cin,
    paymentDate: p.payment_date,
    igst: fromPaise(p.igst_paise),
    cgst: fromPaise(p.cgst_paise),
    sgst: fromPaise(p.sgst_paise),
    cess: fromPaise(p.cess_paise),
    interest: fromPaise(p.interest_paise),
    lateFee: fromPaise(p.late_fee_paise),
    voucherId: p.voucher_id,
  });
  c.get("/gst/payments", (req, res) =>
    res.json(db.prepare("SELECT * FROM gst_payments WHERE company_id = ? ORDER BY payment_date DESC").all(req.company.id).map(toPayment)),
  );
  c.post("/gst/payments", W, (req, res) => {
    const b = parse(
      z.object({
        period: period(),
        paymentDate: reqDate(),
        cpin: text(30).default(""),
        cin: text(30).default(""),
        igst: nonNegMoney().default(0),
        cgst: nonNegMoney().default(0),
        sgst: nonNegMoney().default(0),
        cess: nonNegMoney().default(0),
        interest: nonNegMoney().default(0),
        lateFee: nonNegMoney().default(0),
        bankLedgerId: id().optional(),
        towards: z.enum(["Output", "RCM"]).default("Output"),
      }),
      req.body,
    );
    const total = b.igst + b.cgst + b.sgst + b.cess + b.interest + b.lateFee;
    if (!total) throw badRequest("Enter the amounts paid.");
    const result = db.transaction(() => {
      let voucherId = null;
      if (b.bankLedgerId) {
        const dir = b.towards === "RCM" ? "RCM" : "OUTPUT";
        const sgstCode = UT_STATE_CODES.has(req.company.state_code) ? "UTGST" : "SGST";
        const entries = [
          ["IGST", b.igst],
          ["CGST", b.cgst],
          [sgstCode, b.sgst],
          ["CESS", b.cess],
        ]
          .filter(([, a]) => a)
          .map(([duty, a]) => ({ ledgerId: systemLedger(db, req.company.id, `GST_${dir}_${duty}`).id, debit: a, narration: "", costAllocations: [] }));
        if (b.interest)
          entries.push({
            ledgerId: ensureLedger(db, req.company, "GST_INTEREST", "Interest on GST", "INDIRECT_EXPENSES", req.user.id),
            debit: b.interest,
            narration: "",
            costAllocations: [],
          });
        if (b.lateFee)
          entries.push({
            ledgerId: ensureLedger(db, req.company, "GST_LATE_FEE", "GST Late Fee", "INDIRECT_EXPENSES", req.user.id),
            debit: b.lateFee,
            narration: "",
            costAllocations: [],
          });
        entries.push({
          ledgerId: b.bankLedgerId,
          credit: total,
          narration: "",
          costAllocations: [],
          instrumentType: "NEFT",
          instrumentNo: b.cin || b.cpin || undefined,
        });
        voucherId = createVoucher(
          db,
          req,
          req.company,
          { ...baseVoucher, type: "Payment", date: b.paymentDate, referenceNo: b.cin || b.cpin, narration: `GST paid for ${b.period}`, entries },
          { source: "gst" },
        ).id;
      }
      const pid = uuid();
      db.prepare(
        "INSERT INTO gst_payments(id, organization_id, company_id, period, cpin, cin, payment_date, igst_paise, cgst_paise, sgst_paise, cess_paise, interest_paise, late_fee_paise, voucher_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        pid,
        req.company.organization_id,
        req.company.id,
        b.period,
        b.cpin,
        b.cin,
        b.paymentDate,
        b.igst,
        b.cgst,
        b.sgst,
        b.cess,
        b.interest,
        b.lateFee,
        voucherId,
        req.user.id,
      );
      acctAudit(db, req, {
        companyId: req.company.id,
        action: "gst.payment",
        entityType: "GstPayment",
        entityId: pid,
        summary: `${b.period}: ₹${fromPaise(total)}`,
      });
      return pid;
    })();
    res.status(201).json(toPayment(db.prepare("SELECT * FROM gst_payments WHERE id = ?").get(result)));
  });

  // Journal that utilises ITC against output tax for a period (Dr Output, Cr Input), per s.49 order.
  c.post("/gst/setoff", W, (req, res) => {
    const b = parse(z.object({ period: period(), date: reqDate() }), req.body);
    const r3 = G.gstr3b(db, req.company, b.period);
    const liab = Object.fromEntries(Object.entries(r3.payment.liability).map(([k, v]) => [k, toPaise(v)]));
    const itc = Object.fromEntries(Object.entries(r3["4"].netItc).map(([k, v]) => [k, toPaise(v)]));
    const transfers = [];
    const L = { ...liab };
    const C = { ...itc };
    const use = (from, to) => {
      const u = Math.min(C[from], L[to]);
      if (u > 0) (transfers.push({ from, to, amount: u }), (C[from] -= u), (L[to] -= u));
    };
    (use("igst", "igst"),
      use("igst", "cgst"),
      use("igst", "sgst"),
      use("cgst", "cgst"),
      use("cgst", "igst"),
      use("sgst", "sgst"),
      use("sgst", "igst"),
      use("cess", "cess"));
    if (!transfers.length) throw badRequest("Nothing to set off for this period.");
    const head = (h) => (h === "sgst" && UT_STATE_CODES.has(req.company.state_code) ? "UTGST" : h.toUpperCase());
    const post = new Map();
    const add = (lid, amt) => post.set(lid, (post.get(lid) || 0) + amt);
    for (const t of transfers) {
      add(systemLedger(db, req.company.id, `GST_OUTPUT_${head(t.to)}`).id, t.amount);
      add(systemLedger(db, req.company.id, `GST_INPUT_${head(t.from)}`).id, -t.amount);
    }
    const entries = [...post.entries()]
      .filter(([, a]) => a)
      .map(([lid, a]) => ({ ledgerId: lid, debit: a > 0 ? a : undefined, credit: a < 0 ? -a : undefined, narration: "", costAllocations: [] }));
    const { id: vid } = createVoucher(
      db,
      req,
      req.company,
      {
        ...baseVoucher,
        type: "Journal",
        date: b.date,
        referenceNo: `GST set-off ${b.period}`,
        narration: `ITC utilised against output tax for ${b.period}`,
        entries,
      },
      { source: "gst" },
    );
    res.status(201).json({ voucherId: vid, transfers: transfers.map((t) => ({ ...t, amount: fromPaise(t.amount) })) });
  });

  // GSTR-2B reconciliation ---------------------------------------------------------------------------
  // Accepts JSON {period, data} or multipart {period, file} where file is GSTR-2B JSON or a CSV with
  // columns supplierGstin, invoiceNo, invoiceDate, taxable, tax.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 } });
  c.post("/gst/reconciliation", W, upload.single("file"), (req, res) => {
    let data = req.body?.data;
    if (req.file) {
      const text = req.file.buffer.toString("utf8");
      if (/\.json$/i.test(req.file.originalname)) {
        try {
          data = JSON.parse(text);
        } catch {
          throw badRequest("file: invalid JSON.");
        }
      } else {
        const [head, ...rest] = parseCsv(text);
        const keys = head.map((h) => h.trim());
        data = rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
      }
    }
    const b = parse(z.object({ period: period(), data: z.union([z.array(z.record(z.string(), z.unknown())).max(50000), z.record(z.string(), z.unknown())]) }), {
      period: req.body?.period,
      data,
    });
    const rows = G.parse2b(b.data);
    const result = db.transaction(() => G.reconcile2b(db, req.company, b.period, rows, toPaise, uuid))();
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "gst.reconcile",
      entityType: "GstReconciliation",
      summary: `${b.period}: ${JSON.stringify(result.summary)}`,
    });
    res.json(result);
  });
  c.get("/gst/reconciliation", (req, res) => {
    const p = str(req.query.period);
    const rows = db
      .prepare(`SELECT * FROM gst_reconciliations WHERE company_id = ? ${p ? "AND period = ?" : ""} ORDER BY period DESC, match_status`)
      .all(req.company.id, ...(p ? [p] : []));
    res.json(
      rows.map((r) => ({
        period: r.period,
        supplierGstin: r.supplier_gstin,
        invoiceNo: r.invoice_no,
        invoiceDate: r.invoice_date,
        taxable: fromPaise(r.taxable_paise),
        tax: fromPaise(r.tax_paise),
        status: r.match_status,
        voucherId: r.voucher_id,
        difference: fromPaise(r.difference_paise),
      })),
    );
  });

  // E-invoice ------------------------------------------------------------------------------------------
  const toEinv = (r) =>
    r && {
      status: r.status,
      irn: r.irn,
      ackNo: r.ack_no,
      ackDate: r.ack_date,
      signedQr: r.signed_qr,
      provider: r.provider,
      payload: JSON.parse(r.payload_json),
      updatedAt: r.updated_at,
    };
  c.get("/vouchers/:voucherId/e-invoice", (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    res.json(toEinv(db.prepare("SELECT * FROM e_invoice_records WHERE voucher_id = ?").get(v.id)) || null);
  });
  c.post("/vouchers/:voucherId/e-invoice", W, (req, res) => {
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    const existing = db.prepare("SELECT * FROM e_invoice_records WHERE voucher_id = ?").get(v.id);
    if (existing?.status === "Generated") throw conflict("An IRN already exists for this invoice.");
    const { payload, errors } = G.eInvoicePayload(db, req.company, v);
    if (errors.length)
      return res.status(400).json({ error: "The invoice is not ready for e-invoicing.", details: errors.map((m) => ({ field: "eInvoice", message: m })) });
    const adapter = G.gstPortalAdapter("manual");
    db.prepare(
      `INSERT INTO e_invoice_records(id, organization_id, company_id, voucher_id, payload_json, status, provider) VALUES (?,?,?,?,?,'PayloadReady',?)
       ON CONFLICT(voucher_id) DO UPDATE SET payload_json = excluded.payload_json, status = 'PayloadReady', error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(uuid(), req.company.organization_id, req.company.id, v.id, JSON.stringify(payload), adapter.name);
    acctAudit(db, req, { companyId: req.company.id, action: "einvoice.prepare", entityType: "Voucher", entityId: v.id, summary: v.voucher_number });
    res.status(201).json(toEinv(db.prepare("SELECT * FROM e_invoice_records WHERE voucher_id = ?").get(v.id)));
  });
  c.patch("/vouchers/:voucherId/e-invoice", W, (req, res) => {
    const b = parse(
      z.object({
        status: z.enum(["Generated", "Cancelled", "Failed"]),
        irn: z
          .string()
          .regex(/^[a-f0-9]{64}$/i, "must be the 64-character IRN")
          .optional(),
        ackNo: text(30).optional(),
        ackDate: text(30).optional(),
        signedQr: text(5000).optional(),
        error: text(1000).optional(),
      }),
      req.body,
    );
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    const rec = db.prepare("SELECT * FROM e_invoice_records WHERE voucher_id = ?").get(v.id);
    if (!rec) throw notFound("Prepare the e-invoice payload first.");
    if (b.status === "Generated" && !b.irn) throw badRequest("irn: required when marking the e-invoice generated.");
    db.prepare(
      "UPDATE e_invoice_records SET status = ?, irn = COALESCE(?, irn), ack_no = COALESCE(?, ack_no), ack_date = COALESCE(?, ack_date), signed_qr = COALESCE(?, signed_qr), error = ?, updated_at = ? WHERE id = ?",
    ).run(b.status, b.irn ?? null, b.ackNo ?? null, b.ackDate ?? null, b.signedQr ?? null, b.error ?? null, nowIso(), rec.id);
    acctAudit(db, req, {
      companyId: req.company.id,
      action: `einvoice.${b.status.toLowerCase()}`,
      entityType: "Voucher",
      entityId: v.id,
      summary: b.irn || b.error || "",
    });
    res.json(toEinv(db.prepare("SELECT * FROM e_invoice_records WHERE id = ?").get(rec.id)));
  });

  // E-way bills --------------------------------------------------------------------------------------
  const toEwb = (r) => ({
    id: r.id,
    voucherId: r.voucher_id,
    voucherNumber: r.voucher_number,
    ewayBillNo: r.eway_bill_no,
    ewayBillDate: r.eway_bill_date,
    validUntil: r.valid_until,
    transporterId: r.transporter_id,
    transporterName: r.transporter_name,
    transportMode: r.transport_mode,
    vehicleNo: r.vehicle_no,
    distanceKm: r.distance_km,
    status: r.status,
    payload: JSON.parse(r.payload_json),
  });
  c.get("/eway-bills", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT e.*, v.voucher_number FROM eway_bill_records e JOIN vouchers v ON v.id = e.voucher_id WHERE e.company_id = ? ORDER BY e.created_at DESC",
        )
        .all(req.company.id)
        .map(toEwb),
    ),
  );
  c.post("/vouchers/:voucherId/eway-bill", W, (req, res) => {
    const b = parse(
      z.object({
        transportMode: z.enum(["Road", "Rail", "Air", "Ship"]).default("Road"),
        vehicleNo: text(15).default(""),
        transporterId: text(15).default(""),
        transporterName: text(100).default(""),
        distanceKm: z.number().int().min(0).max(4000).default(0),
      }),
      req.body,
    );
    const v = loadVoucherRow(db, req.company, req.params.voucherId);
    if (v.status !== "Posted") throw badRequest("Post the voucher first.");
    const { payload, errors } = G.ewayPayload(db, req.company, v, b);
    const blocking = errors.filter((e) => !/not mandatory/.test(e));
    if (blocking.length)
      return res.status(400).json({ error: "E-way bill details are incomplete.", details: blocking.map((m) => ({ field: "ewayBill", message: m })) });
    const eid = uuid();
    db.prepare(
      "INSERT INTO eway_bill_records(id, organization_id, company_id, voucher_id, transporter_id, transporter_name, transport_mode, vehicle_no, distance_km, payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      eid,
      req.company.organization_id,
      req.company.id,
      v.id,
      b.transporterId,
      b.transporterName,
      b.transportMode,
      b.vehicleNo.toUpperCase(),
      b.distanceKm,
      JSON.stringify(payload),
    );
    res.status(201).json({
      ...toEwb(db.prepare("SELECT e.*, v.voucher_number FROM eway_bill_records e JOIN vouchers v ON v.id = e.voucher_id WHERE e.id = ?").get(eid)),
      warnings: errors.filter((e) => /not mandatory/.test(e)),
    });
  });
  c.patch("/eway-bills/:eid", W, (req, res) => {
    const b = parse(
      z.object({
        status: z.enum(["Generated", "Cancelled"]),
        ewayBillNo: z
          .string()
          .regex(/^\d{12}$/, "must be 12 digits")
          .optional(),
        ewayBillDate: isoDate().optional(),
        validUntil: isoDate().optional(),
      }),
      req.body,
    );
    if (b.status === "Generated" && !b.ewayBillNo) throw badRequest("ewayBillNo: required.");
    const r = db
      .prepare(
        "UPDATE eway_bill_records SET status = ?, eway_bill_no = COALESCE(?, eway_bill_no), eway_bill_date = COALESCE(?, eway_bill_date), valid_until = COALESCE(?, valid_until), updated_at = ? WHERE id = ? AND company_id = ?",
      )
      .run(b.status, b.ewayBillNo ?? null, b.ewayBillDate ?? null, b.validUntil ?? null, nowIso(), req.params.eid, req.company.id);
    if (!r.changes) throw notFound("E-way bill not found.");
    res.json({ ok: true });
  });

  // TDS / TCS --------------------------------------------------------------------------------------------
  const toSection = (s) => ({
    id: s.id,
    kind: s.kind,
    section: s.section,
    description: s.description,
    rate: fromBp(s.rate_bp),
    rateNoPan: fromBp(s.rate_no_pan_bp),
    thresholdSingle: fromPaise(s.threshold_single_paise),
    thresholdAnnual: fromPaise(s.threshold_annual_paise),
    effectiveFrom: s.effective_from,
    ledgerId: s.ledger_id,
  });
  c.get("/tds/sections", (req, res) =>
    res.json(db.prepare("SELECT * FROM tds_sections WHERE company_id = ? ORDER BY kind, section, effective_from").all(req.company.id).map(toSection)),
  );
  c.post("/tds/sections", ADMIN, (req, res) => {
    const b = parse(
      z.object({
        kind: z.enum(["TDS", "TCS"]),
        section: requiredText(20),
        description: text(200).default(""),
        rate: percent(),
        rateNoPan: percent().default(2000),
        thresholdSingle: nonNegMoney().default(0),
        thresholdAnnual: nonNegMoney().default(0),
        effectiveFrom: reqDate(),
        ledgerId: id(),
      }),
      req.body,
    );
    if (!db.prepare("SELECT 1 FROM ledgers WHERE id = ? AND company_id = ?").get(b.ledgerId, req.company.id)) throw badRequest("ledgerId: not found.");
    const sid = uuid();
    db.prepare(
      "INSERT INTO tds_sections(id, organization_id, company_id, kind, section, description, rate_bp, rate_no_pan_bp, threshold_single_paise, threshold_annual_paise, effective_from, ledger_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      sid,
      req.company.organization_id,
      req.company.id,
      b.kind,
      b.section,
      b.description,
      b.rate,
      b.rateNoPan,
      b.thresholdSingle,
      b.thresholdAnnual,
      b.effectiveFrom,
      b.ledgerId,
    );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "tds.section.create",
      entityType: "TdsSection",
      entityId: sid,
      summary: `${b.kind} ${b.section} ${fromBp(b.rate)}%`,
    });
    res.status(201).json(toSection(db.prepare("SELECT * FROM tds_sections WHERE id = ?").get(sid)));
  });

  c.get("/tds/transactions", (req, res) => {
    const kind = str(req.query.kind) || "TDS";
    const rows = db
      .prepare(
        `SELECT t.*, s.section, l.name party, l.pan, v.voucher_number, v.voucher_type FROM tds_transactions t JOIN tds_sections s ON s.id = t.section_id JOIN ledgers l ON l.id = t.party_ledger_id
         JOIN vouchers v ON v.id = t.voucher_id WHERE t.company_id = ? AND t.kind = ? AND v.status = 'Posted' AND t.date BETWEEN ? AND ? ORDER BY t.date`,
      )
      .all(req.company.id, kind, str(req.query.from) || "0000-01-01", str(req.query.to) || "9999-12-31");
    res.json(
      rows.map((t) => ({
        id: t.id,
        date: t.date,
        section: t.section,
        party: t.party,
        pan: t.pan,
        voucherId: t.voucher_id,
        voucher: `${t.voucher_type} ${t.voucher_number}`,
        base: fromPaise(t.base_paise),
        rate: fromBp(t.rate_bp),
        tax: fromPaise(t.tax_paise),
        depositedOn: t.deposited_on,
        challanNo: t.challan_no,
      })),
    );
  });
  c.patch("/tds/transactions/:tid", W, (req, res) => {
    const b = parse(z.object({ depositedOn: reqDate(), challanNo: requiredText(30) }), req.body);
    const r = db
      .prepare("UPDATE tds_transactions SET deposited_on = ?, challan_no = ? WHERE id = ? AND company_id = ?")
      .run(b.depositedOn, b.challanNo, req.params.tid, req.company.id);
    if (!r.changes) throw notFound("TDS entry not found.");
    res.json({ ok: true });
  });
  // Quarterly deductee-wise summary (basis for 24Q/26Q/27EQ preparation).
  c.get("/tds/summary", (req, res) => {
    const kind = str(req.query.kind) || "TDS";
    const rows = db
      .prepare(
        `SELECT s.section, l.name party, l.pan, COUNT(*) n, SUM(t.base_paise) base, SUM(t.tax_paise) tax, SUM(CASE WHEN t.deposited_on IS NULL THEN t.tax_paise ELSE 0 END) pending
         FROM tds_transactions t JOIN tds_sections s ON s.id = t.section_id JOIN ledgers l ON l.id = t.party_ledger_id JOIN vouchers v ON v.id = t.voucher_id
         WHERE t.company_id = ? AND t.kind = ? AND v.status = 'Posted' AND t.date BETWEEN ? AND ? GROUP BY s.section, l.id ORDER BY s.section, l.name`,
      )
      .all(req.company.id, kind, str(req.query.from) || "0000-01-01", str(req.query.to) || "9999-12-31");
    res.json({
      kind,
      rows: rows.map((r) => ({
        section: r.section,
        party: r.party,
        pan: r.pan || "PANNOTAVBL",
        transactions: r.n,
        base: fromPaise(r.base),
        tax: fromPaise(r.tax),
        pendingDeposit: fromPaise(r.pending),
      })),
      totalTax: fromPaise(rows.reduce((a, r) => a + r.tax, 0)),
      pendingDeposit: fromPaise(rows.reduce((a, r) => a + r.pending, 0)),
      missingPan: rows.filter((r) => !r.pan).length,
    });
  });
}
