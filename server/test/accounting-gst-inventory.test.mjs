import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readXlsx } from "../src/accounting/export.mjs";
import { cr, dr, bootstrapCompany, voucher } from "./accounting-helpers.mjs";
import { setup } from "./helpers.mjs";

const { app, cleanup } = setup();
after(cleanup);

async function tradingSetup(extra = {}) {
  const a = await bootstrapCompany(app, { company: { tdsEnabled: true, ...extra } });
  const sales = await a.mkLedger("Sales", "SALES");
  const purchases = await a.mkLedger("Purchases", "PURCHASE");
  const local = await a.mkLedger("Local Customer", "SUNDRY_DEBTORS", { gstin: "27AAACL1234A1Z2", creditDays: 30 });
  const outstation = await a.mkLedger("Delhi Customer", "SUNDRY_DEBTORS", { gstin: "07AAACD1234A1Z2" });
  const supplier = await a.mkLedger("Mumbai Supplier", "SUNDRY_CREDITORS", { gstin: "27AAACS1234A1Z2", pan: "AAACS1234A" });
  const unreg = await a.mkLedger("Local Transporter", "SUNDRY_CREDITORS", { gstRegistrationType: "Unregistered" });
  const bank = await a.mkLedger("HDFC Bank", "BANK", { openingBalance: "100000", bankAccountNumber: "50100012345678", bankIfsc: "HDFC0000123" });
  const capital = await a.mkLedger("Capital", "CAPITAL", { openingBalance: "100000", openingSide: "Cr" });
  return { ...a, sales, purchases, local, outstation, supplier, unreg, bank, capital };
}

const entry = (v, ledgerName) => v.entries.find((e) => e.ledgerName === ledgerName);

describe("GST invoicing", () => {
  it("splits intra-state tax into CGST/SGST, inter-state into IGST, and rounds the invoice", async () => {
    const a = await tradingSetup();
    const inv = await a.post(
      "/vouchers",
      voucher("Sales", "2025-05-10", {
        partyLedgerId: a.local,
        items: [{ ledgerId: a.sales, description: "Consulting", hsnSac: "998311", amount: "10000.50", gstRate: "18" }],
      }),
    );
    assert.equal(inv.isInterState, false);
    assert.equal(inv.gstInvoiceType, "B2B");
    assert.equal(entry(inv, "Output CGST").credit, "900.05"); // 9% of 10000.50 = 900.045 -> 900.05
    assert.equal(entry(inv, "Output SGST").credit, "900.05");
    assert.equal(entry(inv, "Local Customer").debit, "11801.00"); // 11800.60 rounded
    assert.equal(entry(inv, "Round Off").credit, "0.40");
    assert.equal(inv.total, "11801.00");

    const inter = await a.post(
      "/vouchers",
      voucher("Sales", "2025-05-11", { partyLedgerId: a.outstation, items: [{ ledgerId: a.sales, hsnSac: "998311", amount: "50000", gstRate: "18" }] }),
    );
    assert.equal(inter.isInterState, true);
    assert.equal(inter.placeOfSupply, "07");
    assert.equal(entry(inter, "Output IGST").credit, "9000.00");
    assert.equal(entry(inter, "Output CGST"), undefined);
  });

  it("books ITC, reverse charge and TDS on purchases and builds GSTR-1 / GSTR-3B", async () => {
    const a = await tradingSetup();
    await a.post(
      "/vouchers",
      voucher("Sales", "2025-06-05", { partyLedgerId: a.local, items: [{ ledgerId: a.sales, hsnSac: "998311", amount: "100000", gstRate: "18" }] }),
    );
    const sections = await a.get("/tds/sections");
    const s194c = sections.find((s) => s.section === "194C-O");
    const pur = await a.post(
      "/vouchers",
      voucher("Purchase", "2025-06-08", {
        partyLedgerId: a.supplier,
        referenceNo: "MS/889",
        items: [{ ledgerId: a.purchases, hsnSac: "998311", amount: "40000", gstRate: "18" }],
        tds: { sectionId: s194c.id },
      }),
    );
    assert.equal(entry(pur, "Input CGST").debit, "3600.00");
    assert.equal(entry(pur, "TDS Payable").credit, "800.00"); // 2% of taxable 40,000
    assert.equal(entry(pur, "Mumbai Supplier").credit, "46400.00"); // 47,200 - 800
    assert.equal(pur.tds.section, "194C-O");

    const rcm = await a.post(
      "/vouchers",
      voucher("Purchase", "2025-06-09", {
        partyLedgerId: a.unreg,
        reverseCharge: true,
        items: [{ ledgerId: a.purchases, hsnSac: "996511", amount: "10000", gstRate: "5" }],
      }),
    );
    assert.equal(entry(rcm, "Local Transporter").credit, "10000.00");
    assert.equal(entry(rcm, "RCM Payable CGST").credit, "250.00");
    assert.equal(entry(rcm, "Input CGST").debit, "250.00");

    const noGst = await a.post(
      "/vouchers",
      voucher("Purchase", "2025-06-10", { partyLedgerId: a.unreg, items: [{ ledgerId: a.purchases, amount: "999", gstRate: "18" }] }),
    );
    assert.equal(noGst.items[0].gstRate, "0", "unregistered supplier charges no GST without RCM");

    const cn = await a.post(
      "/vouchers",
      voucher("CreditNote", "2025-06-20", { partyLedgerId: a.local, items: [{ ledgerId: a.sales, hsnSac: "998311", amount: "10000", gstRate: "18" }] }),
    );
    assert.equal(entry(cn, "Output CGST").debit, "900.00");

    const g1 = await a.get("/gst/gstr1?period=2025-06");
    assert.equal(g1.b2b.length, 1);
    assert.equal(g1.cdnr.length, 1);
    assert.equal(g1.totals.taxable, "90000.00");
    assert.equal(g1.hsn[0].hsn, "998311");

    const g3 = await a.get("/gst/gstr3b?period=2025-06");
    assert.equal(g3["3.1"].a_taxableOutward.cgst, "8100.00");
    assert.equal(g3["3.1"].d_inwardReverseCharge.cgst, "250.00");
    assert.equal(g3["4"].netItc.cgst, "3850.00");
    // CGST liability 8,100 - ITC 3,850 = 4,250 cash + RCM 250 always in cash
    assert.equal(g3.payment.payableInCash.cgst, "4500.00");

    const so = await a.post("/gst/setoff", { period: "2025-06", date: "2025-06-30" });
    assert.ok(so.transfers.some((t) => t.from === "cgst" && t.to === "cgst" && t.amount === "3850.00"));
    const pay = await a.post("/gst/payments", {
      period: "2025-06",
      paymentDate: "2025-07-18",
      cin: "CIN123",
      cgst: "4250",
      sgst: "4250",
      bankLedgerId: a.bank,
    });
    assert.ok(pay.voucherId);
    const g3b = await a.get("/gst/gstr3b?period=2025-06");
    assert.equal(g3b.payment.paid.cgst, "4250.00");

    const g1csv = await a.pro.agent.get(`${a.base}/gst/gstr1?period=2025-06&format=csv`).expect(200);
    assert.match(g1csv.text, /B2B/);

    // 2B reconciliation
    const rec = await a.post(
      "/gst/reconciliation",
      {
        period: "2025-06",
        data: [
          { supplierGstin: "27AAACS1234A1Z2", invoiceNo: "MS-889", taxable: "40000", tax: "7200" },
          { supplierGstin: "29AAACX1234A1Z2", invoiceNo: "Z1", taxable: "10", tax: "1" },
        ],
      },
      200,
    );
    assert.deepEqual(rec.summary, { matched: 1, mismatched: 0, missingInBooks: 1, missingIn2B: 0 });

    const tds = await a.get("/tds/summary");
    assert.equal(tds.totalTax, "800.00");
    assert.equal(tds.pendingDeposit, "800.00");

    const tb = await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31");
    assert.equal(tb.balanced, true);
  });

  it("prepares e-invoice and e-way bill payloads", async () => {
    const a = await tradingSetup();
    await a.pro.agent.patch(`${a.base}/ledgers/${a.local}`).send({ address: "Plot 4, Nashik 422001" }).expect(200);
    const inv = await a.post(
      "/vouchers",
      voucher("Sales", "2025-07-01", {
        partyLedgerId: a.local,
        items: [{ ledgerId: a.sales, description: "Steel", hsnSac: "7208", amount: "60000", gstRate: "18" }],
      }),
    );
    const e = await a.post(`/vouchers/${inv.id}/e-invoice`, {});
    assert.equal(e.payload.DocDtls.No, inv.number);
    assert.equal(e.payload.ValDtls.TotInvVal, 70800);
    assert.equal(e.payload.SellerDtls.Pin, 411001);
    const irn = "a".repeat(64);
    await a.pro.agent
      .patch(`${a.base}/vouchers/${inv.id}/e-invoice`)
      .send({ status: "Generated", irn, ackNo: "112010", ackDate: "2025-07-01 10:00" })
      .expect(200);
    assert.equal((await a.pro.agent.post(`${a.base}/vouchers/${inv.id}/cancel`).send({ reason: "x" })).status, 409, "IRN locks the invoice");
    const ewb = await a.post(`/vouchers/${inv.id}/eway-bill`, { vehicleNo: "MH12AB1234", distanceKm: 210 });
    assert.equal(ewb.payload.transDistance, "210");
    const html = await a.pro.agent.get(`${a.base}/vouchers/${inv.id}/print`).expect(200);
    assert.match(html.text, /Tax Invoice/);
    assert.match(html.text, /Seventy Thousand Eight Hundred/);
    const pdf = await a.pro.agent.get(`${a.base}/vouchers/${inv.id}/print?format=pdf`).buffer(true).expect(200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
  });
});

describe("inventory", () => {
  it("values stock by FIFO and weighted average, rejects negative stock, and feeds closing stock", async () => {
    const a = await tradingSetup({ inventoryEnabled: true });
    const units = await a.get("/units");
    const fifo = (
      await a.post("/items", { name: "Widget FIFO", unitId: units[0].id, hsnSac: "8471", gstRate: "18", valuationMethod: "FIFO", reorderLevel: "5" })
    ).id;
    const avg = (await a.post("/items", { name: "Widget AVG", unitId: units[0].id, hsnSac: "8471", gstRate: "18", openingQty: "10", openingRate: "100" })).id;
    const buy = (item, qty, rate, date) =>
      a.post(
        "/vouchers",
        voucher("Purchase", date, { partyLedgerId: a.supplier, items: [{ stockItemId: item, ledgerId: a.purchases, qty, rate }], roundOff: false }),
      );
    await buy(fifo, "10", "100", "2025-05-01");
    await buy(fifo, "10", "130", "2025-05-02");
    await buy(avg, "10", "130", "2025-05-02");
    const sell = (item, qty) =>
      a.post("/vouchers", voucher("Sales", "2025-05-03", { partyLedgerId: a.local, items: [{ stockItemId: item, ledgerId: a.sales, qty, rate: "200" }] }));
    await sell(fifo, "15");
    await sell(avg, "15");
    const sum = await a.get("/stock/summary?to=2025-05-31");
    const f = sum.rows.find((r) => r.item === "Widget FIFO");
    const w = sum.rows.find((r) => r.item === "Widget AVG");
    assert.equal(f.quantity, "5.000");
    assert.equal(f.value, "650.00"); // 5 left from the ₹130 layer
    assert.equal(f.costOfOutward, "1650.00"); // 10x100 + 5x130
    assert.equal(w.value, "575.00"); // avg 115 x 5
    assert.equal(f.lowStock, true);
    const r = await a.post(
      "/vouchers",
      voucher("Sales", "2025-05-04", { partyLedgerId: a.local, items: [{ stockItemId: fifo, ledgerId: a.sales, qty: "6", rate: "200" }] }),
      400,
    );
    assert.match(r.error, /Insufficient stock/);

    const pl = await a.get("/reports/profit-loss?from=2025-04-01&to=2025-05-31");
    assert.equal(pl.totals.openingStock, "1000.00");
    assert.equal(pl.totals.closingStock, "1225.00");
    // Sales 6,000 ; purchases 3,600 ; opening 1,000 ; closing 1,225 -> GP 2,625
    assert.equal(pl.grossProfit, "2625.00");
    const bs = await a.get("/reports/balance-sheet?to=2025-05-31");
    assert.equal(bs.openingDifference, "1000.00", "item opening stock without a matching capital entry is reported");
    assert.equal(bs.balanced, false);
  });

  it("transfers between godowns and manufactures from a bill of materials", async () => {
    const a = await tradingSetup({ inventoryEnabled: true });
    const units = await a.get("/units");
    const main = (await a.get("/warehouses"))[0].id;
    const shop = (await a.post("/warehouses", { name: "Shop" })).id;
    const raw = (await a.post("/items", { name: "Steel rod", unitId: units[0].id, openingQty: "100", openingRate: "50" })).id;
    const fg = (await a.post("/items", { name: "Rack", unitId: units[0].id })).id;
    const bom = (await a.post("/boms", { name: "Rack BOM", itemId: fg, outputQty: "1", components: [{ itemId: raw, qty: "4" }] })).id;
    const mfg = await a.post(
      "/vouchers",
      voucher("StockJournal", "2025-05-01", { stock: { mode: "Manufacture", bomId: bom, outputQty: "10", additionalCost: "100" } }),
    );
    assert.equal(mfg.total, "2100.00"); // 40 rods x 50 + 100
    await a.post(
      "/vouchers",
      voucher("StockJournal", "2025-05-02", { stock: { mode: "Transfer", fromGodownId: main, toGodownId: shop, lines: [{ stockItemId: fg, qty: "3" }] } }),
    );
    const sum = await a.get("/stock/summary?to=2025-05-31");
    const rack = sum.rows.find((r) => r.item === "Rack");
    assert.equal(rack.quantity, "10.000");
    assert.equal(rack.value, "2100.00");
    assert.deepEqual(rack.godowns.map((g) => [g.warehouse, g.quantity]).sort(), [
      ["Main Location", "7.000"],
      ["Shop", "3.000"],
    ]);
    assert.equal(sum.rows.find((r) => r.item === "Steel rod").quantity, "60.000");
  });

  it("tracks batches with expiry", async () => {
    const a = await tradingSetup({ inventoryEnabled: true });
    const units = await a.get("/units");
    const med = (await a.post("/items", { name: "Syrup", unitId: units[0].id, trackBatches: true, trackExpiry: true })).id;
    const r = await a.post(
      "/vouchers",
      voucher("Purchase", "2025-05-01", { partyLedgerId: a.supplier, items: [{ stockItemId: med, ledgerId: a.purchases, qty: "10", rate: "20" }] }),
      400,
    );
    assert.match(r.error, /Batch number/);
    await a.post(
      "/vouchers",
      voucher("Purchase", "2025-05-01", {
        partyLedgerId: a.supplier,
        items: [{ stockItemId: med, ledgerId: a.purchases, qty: "10", rate: "20", batchNo: "B1", expiryDate: "2025-06-30" }],
      }),
    );
    const b = await a.get("/stock/batches?to=2025-06-01&expiringWithinDays=60");
    assert.equal(b.rows[0].status, "Expiring soon");
  });
});

describe("financial statements", () => {
  it("balances, reconciles cash flow and exports", async () => {
    const a = await tradingSetup();
    const rent = await a.mkLedger("Office Rent", "INDIRECT_EXPENSES");
    const machine = await a.mkLedger("Machinery", "FIXED_ASSETS");
    const loan = await a.mkLedger("Term Loan", "SECURED_LOANS");
    await a.post(
      "/vouchers",
      voucher("Sales", "2025-05-01", { partyLedgerId: a.local, items: [{ ledgerId: a.sales, amount: "200000", gstRate: "18", hsnSac: "998311" }] }),
    );
    await a.post(
      "/vouchers",
      voucher("Receipt", "2025-05-15", { entries: [dr(a.bank, "150000"), cr(a.local, "150000", { billType: "Against", billRef: "INV/2526/0001" })] }),
    );
    await a.post("/vouchers", voucher("Payment", "2025-05-20", { entries: [dr(rent, "30000"), cr(a.bank, "30000")] }));
    await a.post("/vouchers", voucher("Receipt", "2025-05-21", { entries: [dr(a.bank, "500000"), cr(loan, "500000")] }));
    await a.post("/vouchers", voucher("Payment", "2025-05-22", { entries: [dr(machine, "400000"), cr(a.bank, "400000")] }));

    const pl = await a.get("/reports/profit-loss?from=2025-04-01&to=2026-03-31");
    assert.equal(pl.netProfit, "170000.00");
    const bs = await a.get("/reports/balance-sheet?to=2026-03-31");
    assert.equal(bs.balanced, true);
    assert.equal(bs.totals.assets, bs.totals.liabilities);
    assert.equal(bs.currentPeriodProfit, "170000.00");

    const cf = await a.get("/reports/cash-flow?from=2025-04-01&to=2026-03-31");
    assert.equal(cf.reconciles, true);
    assert.equal(cf.openingCash, "100000.00");
    assert.equal(cf.closingCash, "320000.00");
    const sec = Object.fromEntries(cf.sections.map((s) => [s.name, s.total]));
    assert.deepEqual(sec, { "Operating activities": "120000.00", "Investing activities": "-400000.00", "Financing activities": "500000.00" });

    const rec = await a.get("/reports/receivables?to=2026-03-31");
    assert.equal(rec.total, "86000.00"); // 236,000 - 150,000
    assert.equal(rec.parties[0].bills[0].ref, "INV/2526/0001");

    const led = await a.get(`/reports/ledger?ledgerId=${a.bank}&from=2025-04-01&to=2026-03-31`);
    assert.equal(led.opening, "100000.00");
    assert.equal(led.closing, "320000.00");

    const ratios = await a.get("/reports/ratios?from=2025-04-01&to=2026-03-31");
    assert.ok(ratios.ratios.find((r) => r.key === "currentRatio").value);

    const xlsx = await a.pro.agent
      .get(`${a.base}/reports/trial-balance?from=2025-04-01&to=2026-03-31&format=xlsx`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(xlsx.status, 200);
    const sheet = readXlsx(xlsx.body);
    assert.equal(sheet[0][0], "Ledger");
    assert.ok(sheet.some((r) => r[0] === "Total"));
    const pdf = await a.pro.agent.get(`${a.base}/reports/balance-sheet?to=2026-03-31&format=pdf`).expect(200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    const csv = await a.pro.agent.get(`${a.base}/reports/day-book?from=2025-05-01&to=2025-05-31&format=csv`).expect(200);
    assert.match(csv.text, /Receipt/);

    const cmp = await a.get("/reports/fy-comparison?to=2026-03-31");
    assert.equal(cmp.profitAndLoss.netProfit.current, "170000.00");
  });

  it("supports cost centres, budgets and recurring vouchers", async () => {
    const a = await tradingSetup();
    const rent = await a.mkLedger("Rent", "INDIRECT_EXPENSES", { costCentresApplicable: true });
    const cc1 = (await a.post("/cost-centres", { name: "Pune branch" })).id;
    const cc2 = (await a.post("/cost-centres", { name: "Mumbai branch" })).id;
    let r = await a.post(
      "/vouchers",
      voucher("Payment", "2025-05-01", { entries: [dr(rent, "1000", { costAllocations: [{ costCentreId: cc1, amount: "600" }] }), cr(a.bank, "1000")] }),
      400,
    );
    assert.match(r.error, /allocations/);
    await a.post(
      "/vouchers",
      voucher("Payment", "2025-05-01", {
        entries: [
          dr(rent, "1000", {
            costAllocations: [
              { costCentreId: cc1, amount: "600" },
              { costCentreId: cc2, amount: "400" },
            ],
          }),
          cr(a.bank, "1000"),
        ],
      }),
    );
    const ccr = await a.get("/reports/cost-centres?from=2025-04-01&to=2026-03-31");
    assert.equal(ccr.centres.find((c) => c.name === "Pune branch").total, "600.00");

    const fy = (await a.get("/financial-years"))[0].id;
    const b = await a.post("/budgets", { name: "FY26", financialYearId: fy, lines: [{ ledgerId: rent, amount: "12000" }] });
    assert.equal(b.rows[0].actual, "1000.00");
    assert.equal(b.rows[0].variance, "-11000.00");

    const rec = await a.post("/recurring", {
      name: "Monthly rent",
      frequency: "Monthly",
      nextRunDate: "2025-06-01",
      template: { type: "Payment", entries: [dr(rent, "1000"), cr(a.bank, "1000")] },
    });
    r = await a.post("/recurring/run", { asOf: "2025-08-15" }, 200);
    assert.equal(r.created.length, 3);
    const after = (await a.get("/recurring")).find((x) => x.id === rec.id);
    assert.equal(after.nextRunDate, "2025-09-01");
  });
});
