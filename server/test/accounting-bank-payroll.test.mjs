import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { annualTax, DEFAULT_STATUTORY } from "../src/accounting/payroll.mjs";
import { cr, dr, bootstrapCompany, voucher } from "./accounting-helpers.mjs";
import { setup } from "./helpers.mjs";

const { app, cleanup } = setup();
after(cleanup);

const STATEMENT = `Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance
02/05/2025,NEFT CR-ACME CUSTOMER LTD,UTR001,,"1,18,000.00","2,18,000.00"
05/05/2025,CHQ PAID 000123 OFFICE LANDLORD,000123,25000.00,,"1,93,000.00"
06/05/2025,SMS CHARGES Q1 GST,,17.70,,"1,92,982.30"
31/05/2025,INT.PD ON SAVINGS,,,"1,200.00","1,94,182.30"
`;

describe("banking and reconciliation", () => {
  it("imports statements, detects duplicates, matches, applies rules and produces a BRS", async () => {
    const a = await bootstrapCompany(app);
    const bank = await a.mkLedger("HDFC Current", "BANK", { openingBalance: "100000" });
    const cap = await a.mkLedger("Capital", "CAPITAL", { openingBalance: "100000", openingSide: "Cr" });
    const cust = await a.mkLedger("Acme Customer Ltd", "SUNDRY_DEBTORS");
    const rent = await a.mkLedger("Office Rent", "INDIRECT_EXPENSES");
    const charges = await a.mkLedger("Bank Charges", "INDIRECT_EXPENSES");
    const interest = await a.mkLedger("Interest Received", "INDIRECT_INCOMES");
    void cap;
    await a.post("/vouchers", voucher("Receipt", "2025-05-01", { entries: [dr(bank, "118000"), cr(cust, "118000")] }));
    await a.post(
      "/vouchers",
      voucher("Payment", "2025-05-03", { entries: [dr(rent, "25000"), cr(bank, "25000", { instrumentType: "Cheque", instrumentNo: "000123" })] }),
    );
    // Cheque issued but not yet presented
    await a.post(
      "/vouchers",
      voucher("Payment", "2025-05-30", { entries: [dr(rent, "5000"), cr(bank, "5000", { instrumentType: "Cheque", instrumentNo: "000124" })] }),
    );

    const up = await a.pro.agent.post(`${a.base}/bank/statements`).field("bankLedgerId", bank).attach("file", Buffer.from(STATEMENT), "may.csv");
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.imported, 4);
    const again = await a.pro.agent.post(`${a.base}/bank/statements`).field("bankLedgerId", bank).attach("file", Buffer.from(STATEMENT), "may-again.csv");
    assert.equal(again.body.imported, 0);
    assert.equal(again.body.duplicates, 4);

    const lines = await a.get(`/bank/transactions?bankLedgerId=${bank}`);
    assert.equal(lines.find((l) => l.description.startsWith("SMS")).isBankCharge, true);

    const m = await a.post("/bank/auto-match", { bankLedgerId: bank }, 200);
    assert.equal(m.matched, 2);
    await a.post("/bank/rules", { name: "Bank charges", matchText: "charges", direction: "Debit", ledgerId: charges, isBankCharge: true });
    const rr = await a.post("/bank/apply-rules", { bankLedgerId: bank }, 200);
    assert.equal(rr.created, 1);
    const unmatched = await a.get(`/bank/transactions?bankLedgerId=${bank}&status=Unmatched`);
    assert.equal(unmatched.length, 1);
    await a.post(`/bank/transactions/${unmatched[0].id}/create-voucher`, { ledgerId: interest });

    const brs = await a.get(`/bank/brs?bankLedgerId=${bank}&asOf=2025-05-31`);
    assert.equal(brs.balancePerBooks, "189182.30");
    assert.equal(brs.chequesNotPresented.length, 1);
    assert.equal(brs.chequesNotPresented[0].instrumentNo, "000124");
    assert.equal(brs.balancePerBankComputed, "194182.30");
    assert.equal(brs.balancePerStatement, "194182.30");
    assert.equal(brs.difference, "0.00");

    // Matched vouchers are locked until unmatched
    const matched = (await a.get(`/bank/transactions?bankLedgerId=${bank}&status=Matched`)).find((l) => l.description.startsWith("NEFT"));
    assert.equal((await a.pro.agent.post(`${a.base}/vouchers/${matched.match.voucherId}/cancel`).send({ reason: "x" })).status, 409);
    await a.pro.agent.delete(`${a.base}/bank/transactions/${matched.id}/match`).expect(204);
    const brs2 = await a.get(`/bank/brs?bankLedgerId=${bank}&asOf=2025-05-31`);
    assert.equal(brs2.depositsNotCredited.length, 1);
    assert.equal(brs2.creditsInBankNotInBooks.length, 1);

    const saved = await a.post("/bank/brs", { bankLedgerId: bank, asOf: "2025-05-31" });
    assert.ok(saved.id);
  });

  it("reads xlsx statements", async () => {
    const { toXlsx } = await import("../src/accounting/export.mjs");
    const { parseStatement } = await import("../src/accounting/banking.mjs");
    const x = toXlsx({ columns: ["Txn Date", "Description", "Debit", "Credit", "Balance"], rows: [["2025-05-02", "UPI-ABC", "100.00", "", "900.00"]] });
    const rows = parseStatement(x, "s.xlsx");
    assert.equal(rows[0].debit_paise, 10000);
    assert.equal(rows[0].txn_date, "2025-05-02");
  });
});

describe("payroll", () => {
  it("computes tax on the configured slabs", () => {
    const n = DEFAULT_STATUTORY.TDS.New;
    assert.equal(annualTax(1275000 * 100, n), 0); // 12.75L - 75k std = 12L -> rebate
    // 13L salary: taxable 12.25L; marginal relief caps tax at the ₹25,000 earned above 12L, + 4% cess
    assert.equal(annualTax(1300000 * 100, n), 2600000);
    // 20L salary: taxable 19.25L -> 0 + 20k + 40k + 60k + 65k(20% of 3.25L) = 1,85,000 + 4% cess = 1,92,400
    assert.equal(annualTax(2000000 * 100, n), 19240000);
  });

  it("runs payroll with PF, ESI, PT and TDS and posts a balanced journal with salary slips", async () => {
    const a = await bootstrapCompany(app, { company: { payrollEnabled: true } });
    const comps = await a.get("/payroll/components");
    const basic = comps.find((c) => c.name === "Basic").id;
    const hra = comps.find((c) => c.name === "HRA").id;
    const special = comps.find((c) => c.name === "Special Allowance").id;
    const e1 = (await a.post("/payroll/employees", { employeeCode: "E001", name: "Asha", dateOfJoining: "2024-01-01", stateCode: "27" })).id;
    const e2 = (await a.post("/payroll/employees", { employeeCode: "E002", name: "Ravi", dateOfJoining: "2024-01-01", stateCode: "27", taxRegime: "New" })).id;
    await a.post(`/payroll/employees/${e1}/salary-structures`, {
      effectiveFrom: "2025-04-01",
      lines: [
        { componentId: basic, amount: "10000" },
        { componentId: hra, percent: "40" },
        { componentId: special, amount: "2000" },
      ],
    });
    await a.post(`/payroll/employees/${e2}/salary-structures`, {
      effectiveFrom: "2025-04-01",
      lines: [
        { componentId: basic, amount: "100000" },
        { componentId: hra, percent: "50" },
      ],
    });
    await a.pro.agent
      .put(`${a.base}/payroll/attendance`)
      .send({ period: "2026-02", records: [{ employeeId: e1, workingDays: 28, presentDays: "26", lopDays: "2" }] })
      .expect(200);

    const run = await a.post("/payroll/runs", { period: "2026-02" });
    const asha = run.entries.find((e) => e.employeeCode === "E001");
    // 16,000 full month prorated 26/28 -> basic 9285.71, HRA 3714.29, special 1857.14 = 14857.14
    assert.equal(asha.gross, "14857.14");
    const line = (e, n) => e.lines.find((l) => l.name === n)?.amount;
    assert.equal(line(asha, "Provident Fund"), "1114.00"); // 12% of 9285.71 -> 1114.29 -> ₹1114
    assert.equal(line(asha, "ESI"), "112.00"); // 0.75% of 14857.14 = 111.43 -> rounded up
    assert.equal(line(asha, "Professional Tax"), "300.00"); // Maharashtra February
    const ravi = run.entries.find((e) => e.employeeCode === "E002");
    assert.equal(line(ravi, "Provident Fund"), "1800.00", "PF wage capped at ₹15,000");
    assert.equal(line(ravi, "ESI"), undefined, "above ESI threshold");
    assert.ok(Number(line(ravi, "TDS on salary")) > 0);

    const posted = await a.post(`/payroll/runs/${run.id}/post`, {}, 200);
    assert.equal(posted.status, "Posted");
    const v = await a.get(`/vouchers/${posted.voucherId}`);
    const sum = (k) => v.entries.reduce((x, e) => x + Math.round(Number(e[k]) * 100), 0);
    assert.equal(sum("debit"), sum("credit"));
    const slip = await a.get(`/payroll/slips/${asha.id}`);
    assert.equal(slip.slipNumber, "SLIP/2026-02/E001");
    const pdf = await a.pro.agent.get(`${a.base}/payroll/slips/${asha.id}?format=pdf`).expect(200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal((await a.pro.agent.post(`${a.base}/payroll/runs`).send({ period: "2026-02" })).status, 409);
    const tb = await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31");
    assert.equal(tb.balanced, true);
    await a.post(`/payroll/runs/${run.id}/cancel`, { reason: "rerun" }, 200);
    assert.equal((await a.get(`/vouchers/${posted.voucherId}`)).status, "Cancelled");
  });
});

describe("AI assistance, backup and restore", () => {
  it("flags duplicates and answers natural-language queries without changing the books", async () => {
    const a = await bootstrapCompany(app);
    const purchases = await a.mkLedger("Purchases", "PURCHASE");
    const sup = await a.mkLedger("Supplier A", "SUNDRY_CREDITORS", { gstin: "27AAACS1234A1Z2" });
    const today = new Date().toISOString().slice(0, 10);
    const inv = (ref) =>
      a.post(
        "/vouchers",
        voucher("Purchase", today, { partyLedgerId: sup, referenceNo: ref, items: [{ ledgerId: purchases, amount: "150000", gstRate: "18", hsnSac: "8471" }] }),
      );
    await inv("SA-001");
    await inv("SA/001");
    const q = await a.post("/ai/query", { question: "Identify duplicate purchase invoices" }, 200);
    assert.equal(q.intent, "duplicate_invoices");
    assert.equal(q.data[0].vouchers.length, 2);
    const big = await a.post("/ai/query", { question: "Show all transactions above ₹1 lakh for this client" }, 200);
    assert.equal(big.intent, "transactions_above");
    assert.equal(big.data.length, 2);
    const an = await a.get("/ai/anomalies");
    assert.ok(an.findings.some((f) => f.type === "DuplicateInvoice"));
    assert.match(an.disclaimer, /not audit conclusions/);
    const unknown = await a.post("/ai/query", { question: "what is the meaning of life" }, 200);
    assert.equal(unknown.intent, "unknown");
    const fields = await a.post(
      "/ai/extract-invoice",
      {
        text: "TAX INVOICE\nInvoice No: INV-77\nDate: 05/06/2025\nGSTIN 27AAACS1234A1Z2\nTaxable Value: 1,000.00\nCGST 9% 90.00\nSGST 9% 90.00\nGrand Total: 1,180.00",
      },
      200,
    );
    assert.equal(fields.fields.invoiceNo, "INV-77");
    assert.equal(fields.fields.total, "1180.00");
  });

  it("backs up a company and restores it as a separate set of books", async () => {
    const a = await bootstrapCompany(app);
    const cash = a.ledger("Cash");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    await a.post("/vouchers", voucher("Journal", "2025-06-01", { entries: [dr(cash, "1234.56"), cr(cap, "1234.56")] }));
    const backup = (await a.pro.agent.get(`${a.base}/backup`).expect(200)).body;
    const r = await a.pro.agent
      .post("/api/accounting/restore")
      .field("clientId", a.client.id)
      .field("name", "Acme Restored")
      .attach("file", Buffer.from(JSON.stringify(backup)), "backup.json");
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const tb = (await a.pro.agent.get(`/api/accounting/companies/${r.body.companyId}/reports/trial-balance?from=2025-04-01&to=2026-03-31`).expect(200)).body;
    assert.equal(tb.totals.closingDr, "1234.56");
    assert.equal(tb.balanced, true);
    const tampered = { ...backup, sha256: "0".repeat(64) };
    const bad = await a.pro.agent
      .post("/api/accounting/restore")
      .field("clientId", a.client.id)
      .field("name", "x")
      .attach("file", Buffer.from(JSON.stringify(tampered)), "b.json");
    assert.equal(bad.status, 400);
    // Original books unaffected
    assert.equal((await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31")).totals.closingDr, "1234.56");
  });
});
