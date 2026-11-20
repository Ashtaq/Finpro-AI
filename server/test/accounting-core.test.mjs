import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fromPaise, mulDiv, parseScaled, percentOf, toPaise } from "../src/accounting/money.mjs";
import { cr, dr, bootstrapCompany, voucher } from "./accounting-helpers.mjs";
import { setup, signup } from "./helpers.mjs";

const { app, db, cleanup } = setup();
after(cleanup);

describe("money arithmetic", () => {
  it("parses decimals exactly and rejects bad input", () => {
    assert.equal(toPaise("1234.56"), 123456);
    assert.equal(toPaise(0.1), 10);
    assert.equal(toPaise("1,00,000"), 10000000);
    assert.equal(toPaise("-5.5"), -550);
    assert.equal(toPaise("1.234"), null);
    assert.equal(toPaise("abc"), null);
    assert.equal(parseScaled("2.5", 3), 2500);
    assert.equal(fromPaise(-123456), "-1234.56");
    assert.equal(fromPaise(5), "0.05");
  });
  it("rounds half away from zero without floating point drift", () => {
    assert.equal(mulDiv(5, 1, 2), 3);
    assert.equal(mulDiv(-5, 1, 2), -3);
    assert.equal(percentOf(1050, 1800), 189); // 18% of 10.50 = 1.89
    assert.equal(percentOf(333, 1800), 60); // 59.94 -> 60
    // 0.1 + 0.2 style sums stay exact in paise
    assert.equal(toPaise("0.1") + toPaise("0.2"), toPaise("0.3"));
    // large values beyond 2^53 / 10000 still exact
    assert.equal(percentOf(9e14, 1800), 1.62e14);
  });
});

describe("accounting access control", () => {
  it("is limited to professional users and isolates firms and clients", async () => {
    const fin = await signup(app, "Finance User");
    const ind = await signup(app, "Individual");
    assert.equal((await fin.agent.get("/api/accounting/companies")).status, 403);
    assert.equal((await ind.agent.get("/api/accounting/companies")).status, 403);

    const a = await bootstrapCompany(app);
    const outsider = await signup(app, "Professional User");
    assert.equal((await outsider.agent.get(a.base)).status, 404);
    assert.equal((await outsider.agent.get(`${a.base}/ledgers`)).status, 404);
    assert.deepEqual((await outsider.agent.get("/api/accounting/companies")).body, []);
    assert.equal(
      (await outsider.agent.post("/api/accounting/companies").send({ clientId: a.client.id, name: "x", booksStartDate: "2025-04-01" })).status,
      404,
      "cannot open books for another firm's client",
    );
  });

  it("enforces accounting roles and client restrictions inside a firm", async () => {
    const a = await bootstrapCompany(app);
    const staff = (
      await a.pro.agent
        .post("/api/users")
        .send({ name: "Staff", email: `staff-${Date.now()}@ex.com`, password: "staff-password-1", role: "Professional User" })
        .expect(201)
    ).body;
    const other = await bootstrapCompany(app, { clientName: "Other Client", name: "Other Books" }, a.pro);
    await a.pro.agent
      .put(`/api/accounting/roles/${staff.id}`)
      .send({ role: "Viewer", clientIds: [a.client.id] })
      .expect(200);
    const s = await (await import("supertest")).default.agent(app);
    await s.post("/api/auth/login").send({ email: staff.email, password: "staff-password-1" }).expect(200);
    const me = (await s.get("/api/accounting/me").expect(200)).body;
    assert.equal(me.role, "Viewer");
    assert.equal((await s.get(a.base)).status, 200);
    assert.equal((await s.get(other.base)).status, 404, "restricted to assigned clients");
    const cash = a.ledger("Cash");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    assert.equal((await s.post(`${a.base}/vouchers`).send(voucher("Journal", "2025-05-01", { entries: [dr(cash, "10"), cr(cap, "10")] }))).status, 403);
    assert.equal((await s.get("/api/accounting/roles")).status, 403);
    assert.equal((await a.pro.agent.put(`/api/accounting/roles/${a.pro.user.id}`).send({ role: "Viewer" })).status, 400, "cannot demote yourself");
  });
});

describe("chart of accounts and double entry", () => {
  it("creates the 28 reserved groups and system ledgers", async () => {
    const a = await bootstrapCompany(app);
    assert.equal(a.groups.filter((g) => g.isSystem).length, 28);
    for (const n of ["Cash", "Profit & Loss A/c", "Output CGST", "Input IGST", "Round Off"]) assert.ok(a.ledger(n), n);
    const fys = await a.get("/financial-years");
    assert.equal(fys[0].label, "FY 2025-26");
    assert.equal(
      (await a.post("/ledgers", { name: "Rent", groupId: a.group("INDIRECT_EXPENSES"), openingBalance: "100" }, 400)).error,
      "Income and expense ledgers cannot have opening balances.",
    );
  });

  it("validates balancing, voucher rules and dates", async () => {
    const a = await bootstrapCompany(app);
    const cash = a.ledger("Cash");
    const rent = await a.mkLedger("Rent", "INDIRECT_EXPENSES");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    let r = await a.post("/vouchers", voucher("Journal", "2025-05-01", { entries: [dr(rent, "100"), cr(cash, "99.99")] }), 400);
    assert.match(r.error, /must be equal/);
    r = await a.post("/vouchers", voucher("Payment", "2025-05-01", { entries: [dr(rent, "100"), cr(cap, "100")] }), 400);
    assert.match(r.error, /credit a cash or bank/);
    r = await a.post("/vouchers", voucher("Contra", "2025-05-01", { entries: [dr(rent, "100"), cr(cash, "100")] }), 400);
    assert.match(r.error, /only use cash and bank/);
    r = await a.post("/vouchers", voucher("Journal", "2025-03-31", { entries: [dr(cash, "1"), cr(cap, "1")] }), 400);
    assert.match(r.error, /before the books beginning/);
    r = await a.post("/vouchers", voucher("Journal", "2025-05-01", { entries: [dr(cash, "1.001"), cr(cap, "1.001")] }), 400);
    assert.match(r.error, /decimal places/);
    const ok = await a.post(
      "/vouchers",
      voucher("Receipt", "2025-05-01", { entries: [dr(cash, "500000"), cr(cap, "500000")], narration: "Capital introduced" }),
    );
    assert.equal(ok.status, "Posted");
    assert.equal(ok.number, "RCT/2526/0001");
    const ok2 = await a.post("/vouchers", voucher("Payment", "2025-05-02", { entries: [dr(rent, "25000"), cr(cash, "25000")] }));
    assert.equal(ok2.number, "PMT/2526/0001");
    const tb = await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31");
    assert.equal(tb.balanced, true);
    assert.equal(tb.totals.closingDr, "500000.00");
  });

  it("keeps revisions, cancels instead of deleting, and the audit trail is append-only", async () => {
    const a = await bootstrapCompany(app);
    const cash = a.ledger("Cash");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    const v = await a.post("/vouchers", voucher("Journal", "2025-06-01", { entries: [dr(cash, "100"), cr(cap, "100")] }));
    const upd = await a.pro.agent
      .put(`${a.base}/vouchers/${v.id}`)
      .send({ ...voucher("Journal", "2025-06-02", { entries: [dr(cash, "150"), cr(cap, "150")] }), reason: "typo" });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.total, "150.00");
    assert.equal(upd.body.number, v.number, "number is kept");
    const revs = await a.get(`/vouchers/${v.id}/revisions`);
    assert.equal(revs.length, 1);
    assert.equal(revs[0].snapshot.voucher.total_paise, 10000);
    assert.equal((await a.pro.agent.delete(`${a.base}/vouchers/${v.id}`)).status, 409);
    await a.post(`/vouchers/${v.id}/cancel`, { reason: "duplicate" }, 200);
    const tb = await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31");
    assert.equal(tb.rows.length, 0, "cancelled vouchers are excluded");
    assert.throws(() => db.prepare("DELETE FROM accounting_audit_logs").run(), /append-only/);
    assert.throws(() => db.prepare("UPDATE voucher_revisions SET reason = 'x'").run(), /immutable/);
    assert.throws(() => db.prepare("DELETE FROM vouchers WHERE id = ?").run(v.id), /cannot be deleted/);
    const log = await a.get(`/audit-logs?entityId=${v.id}`);
    assert.deepEqual(
      log.rows.map((r) => r.action),
      ["voucher.cancel", "voucher.modify", "voucher.create"],
    );
  });

  it("routes accountant vouchers through maker-checker approval", async () => {
    const a = await bootstrapCompany(app, { company: { requireVoucherApproval: true } });
    const staffEmail = `acct-${Date.now()}@ex.com`;
    const staff = (
      await a.pro.agent.post("/api/users").send({ name: "Acct", email: staffEmail, password: "staff-password-1", role: "Professional User" }).expect(201)
    ).body;
    await a.pro.agent.put(`/api/accounting/roles/${staff.id}`).send({ role: "Accountant" }).expect(200);
    const s = (await import("supertest")).default.agent(app);
    await s.post("/api/auth/login").send({ email: staffEmail, password: "staff-password-1" }).expect(200);
    const cash = a.ledger("Cash");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    const v = (
      await s
        .post(`${a.base}/vouchers`)
        .send(voucher("Journal", "2025-06-01", { entries: [dr(cash, "100"), cr(cap, "100")] }))
        .expect(201)
    ).body;
    assert.equal(v.status, "PendingApproval");
    assert.equal(v.number, null);
    assert.equal((await s.post(`${a.base}/vouchers/${v.id}/approve`).send({})).status, 403);
    assert.equal((await a.get("/reports/trial-balance?from=2025-04-01&to=2026-03-31")).rows.length, 0);
    const approved = await a.post(`/vouchers/${v.id}/approve`, { comment: "ok" }, 200);
    assert.equal(approved.status, "Posted");
    assert.equal(approved.number, "JV/2526/0001");
    assert.deepEqual(
      approved.approvals.map((x) => x.action),
      ["Submitted", "Approved"],
    );
  });

  it("closes financial years and honours the lock date", async () => {
    const a = await bootstrapCompany(app);
    const cash = a.ledger("Cash");
    const cap = await a.mkLedger("Capital", "CAPITAL");
    await a.post("/vouchers", voucher("Journal", "2025-06-01", { entries: [dr(cash, "100"), cr(cap, "100")] }));
    await a.post("/vouchers", voucher("Journal", "2026-04-02", { entries: [dr(cash, "50"), cr(cap, "50")] }));
    const fys = await a.get("/financial-years");
    assert.equal(fys.length, 2, "next FY is opened automatically");
    await a.post(`/financial-years/${fys[0].id}/close`, {}, 200);
    const r = await a.post("/vouchers", voucher("Journal", "2025-07-01", { entries: [dr(cash, "1"), cr(cap, "1")] }), 400);
    assert.match(r.error, /closed/);
    await a.pro.agent.patch(a.base).send({ lockDate: "2026-04-30" }).expect(200);
    assert.match((await a.post("/vouchers", voucher("Journal", "2026-04-15", { entries: [dr(cash, "1"), cr(cap, "1")] }), 400)).error, /locked/);
    // Balance sheet in the new year carries the prior position
    const bs = await a.get("/reports/balance-sheet?to=2026-06-30");
    assert.equal(bs.balanced, true);
    assert.equal(bs.totals.assets, "150.00");
  });
});
