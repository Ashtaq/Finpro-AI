import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { validateItr } from "../src/services/itr.mjs";
import { setup, signup } from "./helpers.mjs";

const { app, cleanup } = setup({ env: { KYC_MODE: "mock" } });
after(cleanup);

describe("individual workspace", () => {
  it("manages assets privately and summarizes net worth", async () => {
    const a = await signup(app, "Individual");
    const b = await signup(app, "Individual");
    const asset = (await a.agent.post("/api/individual/assets").send({ name: "FD", category: "Bank", value: 100000 }).expect(201)).body;
    await a.agent.post("/api/individual/assets").send({ name: "Car loan", category: "Liability", value: 40000 }).expect(201);
    assert.equal((await b.agent.patch(`/api/individual/assets/${asset.id}`).send({ value: 1 })).status, 404);
    const summary = (await a.agent.get("/api/individual/summary")).body;
    assert.equal(summary.assets.netWorth, 60000);
    assert.equal((await a.agent.post("/api/individual/assets").send({ name: "x", value: -5 })).status, 400);
  });

  it("runs the ITR draft lifecycle and blocks submission without a provider", async () => {
    const a = await signup(app, "Individual");
    const itr = (await a.agent.post("/api/individual/itr").send({ assessmentYear: "2026-27", itrType: "ITR-1" }).expect(201)).body;
    assert.equal((await a.agent.post("/api/individual/itr").send({ assessmentYear: "2026-27" })).status, 409);
    assert.equal((await a.agent.post("/api/individual/itr").send({ assessmentYear: "2026-28" })).status, 400);

    const failing = (await a.agent.post(`/api/individual/itr/${itr.id}/validate`).expect(200)).body;
    assert.equal(failing.passed, false);
    assert.equal((await a.agent.post(`/api/individual/itr/${itr.id}/consent`).send({ confirm: true })).status, 400);

    await a.agent
      .patch(`/api/individual/itr/${itr.id}`)
      .send({ payload: { profile: { pan: "ABCPE1234F", residentialStatus: "Resident" }, income: { salary: 900000 }, taxesPaid: { tds: 50000 } } })
      .expect(200);
    const passing = (await a.agent.post(`/api/individual/itr/${itr.id}/validate`).expect(200)).body;
    assert.equal(passing.passed, true, JSON.stringify(passing.errors));
    assert.equal(passing.totals.grossTotalIncome, 900000);

    await a.agent.post(`/api/individual/itr/${itr.id}/consent`).send({ confirm: true }).expect(201);
    const submit = await a.agent.post(`/api/individual/itr/${itr.id}/submit`);
    assert.equal(submit.status, 409);
    assert.match(submit.body.error, /not enabled/);

    // Editing after validation resets status and revokes consent.
    const edited = (await a.agent.patch(`/api/individual/itr/${itr.id}`).send({ itrType: "ITR-2" }).expect(200)).body;
    assert.equal(edited.status, "DRAFT");
    assert.equal((await a.agent.get(`/api/individual/itr/${itr.id}`)).body.consent, null);
  });

  it("supports mock KYC in development and locks PAN once verified", async () => {
    const a = await signup(app, "Individual");
    assert.equal((await a.agent.post("/api/kyc/start")).status, 400);
    await a.agent.patch("/api/individual/profile").send({ pan: "ABCPE1234F", dob: "1990-01-01" }).expect(200);
    assert.equal((await a.agent.post("/api/kyc/start").expect(200)).body.status, "VERIFIED");
    assert.equal((await a.agent.patch("/api/individual/profile").send({ pan: "ZZZPZ9999Z" })).status, 409);
  });
});

describe("ITR rules", () => {
  const base = { itrType: "ITR-1", assessmentYear: "2026-27" };
  it("flags ITR-1 eligibility problems and new-regime deductions", () => {
    const r = validateItr({
      ...base,
      payload: {
        regime: "new",
        profile: { pan: "ABCPE1234F", residentialStatus: "Non-resident" },
        income: { salary: 500000, business: 10 },
        deductions: { sec80C: 200000 },
      },
    });
    assert.equal(r.passed, false);
    assert.ok(r.errors.some((e) => e.field === "itrType"));
    assert.ok(r.warnings.some((w) => w.field === "deductions"));
    assert.ok(r.warnings.some((w) => w.field === "deductions.sec80C"));
  });
  it("rejects deductions larger than income", () => {
    const r = validateItr({
      ...base,
      payload: { profile: { pan: "ABCPE1234F", residentialStatus: "Resident" }, income: { salary: 1000 }, deductions: { other: 5000 } },
    });
    assert.ok(r.errors.some((e) => e.field === "deductions"));
  });
});
