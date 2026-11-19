import assert from "node:assert/strict";
import { signup } from "./helpers.mjs";

/** Create a professional user, a client and a company; return helpers bound to that company. */
export async function bootstrapCompany(app, overrides = {}, user) {
  const pro = user || (await signup(app, "Professional User"));
  const client = (
    await pro.agent
      .post("/api/clients")
      .send({ company: overrides.clientName || "Acme Traders Pvt Ltd" })
      .expect(201)
  ).body;
  const res = await pro.agent.post("/api/accounting/companies").send({
    clientId: client.id,
    name: overrides.name || "Acme Traders",
    gstin: "27ABCDE1234F1Z5",
    address: "12 MG Road, Pune 411001",
    booksStartDate: "2025-04-01",
    ...overrides.company,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const company = res.body;
  const base = `/api/accounting/companies/${company.id}`;
  const get = async (path, status = 200) => {
    const r = await pro.agent.get(`${base}${path}`);
    assert.equal(r.status, status, `${path}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const post = async (path, body, status = 201) => {
    const r = await pro.agent.post(`${base}${path}`).send(body);
    assert.equal(r.status, status, `${path}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const ledgers = await get("/ledgers");
  const groups = await get("/groups");
  const group = (code) => groups.find((g) => g.systemCode === code).id;
  const ledger = (name) => ledgers.find((l) => l.name === name)?.id;
  const mkLedger = async (name, groupCode, extra = {}) => (await post("/ledgers", { name, groupId: group(groupCode), ...extra })).id;
  return { pro, client, company, base, get, post, group, ledger, mkLedger, groups };
}

export const voucher = (type, date, extra = {}) => ({ type, date, ...extra });
export const dr = (ledgerId, amount, extra = {}) => ({ ledgerId, debit: amount, ...extra });
export const cr = (ledgerId, amount, extra = {}) => ({ ledgerId, credit: amount, ...extra });
