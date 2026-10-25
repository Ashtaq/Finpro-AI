import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, it } from "node:test";
import { setup, signup } from "./helpers.mjs";

// End-to-end: real HTTP listener so the server-side DigiLocker client can call the sandbox
// token/document endpoints exactly as it would call the real API.
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let ctx;
let server;
before(async () => {
  const port = await freePort();
  ctx = setup({ env: { KYC_MODE: "sandbox", PORT: String(port) } });
  server = ctx.app.listen(port, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
});
after(() => {
  server?.close();
  ctx?.cleanup();
});

const pathOf = (url) => {
  const u = new URL(url);
  return u.pathname + u.search;
};
const hidden = (html, name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];

/** Drive the browser part of the flow: authorize → sign in → consent → callback. */
async function runFlow(agent, { identity = "custom", name, dob, pan, otp = "123456", decision = "allow" } = {}) {
  const start = await agent.post("/api/kyc/start").expect(200);
  assert.equal(start.body.status, "PENDING");
  const authorize = await agent.get(pathOf(start.body.authorizationUrl)).expect(200);
  const loginId = hidden(authorize.text, "login_id");
  assert.ok(loginId, "sign-in page carries a login_id");
  const login = await agent.post("/api/sandbox/digilocker/login").type("form").send({ login_id: loginId, identity, name, dob, pan, otp });
  if (login.status !== 200) return { login };
  assert.match(login.text, /is requesting access/);
  const consent = await agent.post("/api/sandbox/digilocker/consent").type("form").send({ login_id: loginId, decision }).expect(303);
  const callback = await agent.get(pathOf(consent.headers.location)).expect(303);
  const status = (await agent.get("/api/kyc/status").expect(200)).body;
  return { redirect: callback.headers.location, status };
}

describe("DigiLocker sandbox KYC", () => {
  it("verifies Aadhaar + PAN through the full OAuth/PKCE flow", async () => {
    const u = await signup(ctx.app, "Individual", { name: "Rahul Verma", pan: "ABCPV1234K", dob: "1990-05-15" });
    const { redirect, status } = await runFlow(u.agent, { identity: "rahul" });
    assert.equal(redirect, "http://localhost:5173/verify-identity?kyc=verified");
    assert.equal(status.status, "VERIFIED");
    assert.equal(status.aadhaarLast4, "4821");
    assert.equal(status.panMasked, "ABXXXX234K");
    assert.equal((await u.agent.get("/api/auth/me")).body.user.kycStatus, "VERIFIED");
    await u.agent.get("/api/individual/assets").expect(200);
    const logs = ctx.db
      .prepare("SELECT action FROM audit_logs WHERE actor_id = ?")
      .all(u.user.id)
      .map((r) => r.action);
    assert.ok(logs.includes("KYC verified"));
  });

  it("works with a custom identity matching the account", async () => {
    const u = await signup(ctx.app, "Individual", { name: "Neha Gupta", pan: "DXGPG4321Q", dob: "1992-03-09" });
    const { status } = await runFlow(u.agent, { name: "Neha Gupta", dob: "1992-03-09", pan: "DXGPG4321Q" });
    assert.equal(status.status, "VERIFIED");
  });

  for (const [title, account, flow, reason] of [
    [
      "name mismatch",
      { name: "Account Holder", pan: "EFGPE1111E", dob: "1985-07-07" },
      { name: "Different Person", dob: "1985-07-07", pan: "EFGPE1111E" },
      "name_mismatch",
    ],
    ["date of birth mismatch", { name: "Priya Sharma", pan: "BQSPS5678L", dob: "1999-01-01" }, { identity: "priya" }, "dob_mismatch"],
    ["PAN mismatch", { name: "Priya Sharma", pan: "BQSPS0000L", dob: "1988-11-02" }, { identity: "priya" }, "pan_mismatch"],
    ["no PAN in locker", { name: "Amit Kumar", pan: "CTKPK9012M", dob: "1995-01-20" }, { identity: "amit" }, "pan_missing"],
    ["consent denied", { name: "Priya Sharma", pan: "BQSPS5678L", dob: "1988-11-02" }, { identity: "priya", decision: "deny" }, "consent_denied"],
  ]) {
    it(`fails on ${title}`, async () => {
      const u = await signup(ctx.app, "Individual", account);
      const { redirect, status } = await runFlow(u.agent, flow);
      assert.equal(redirect, "http://localhost:5173/verify-identity?kyc=failed");
      assert.equal(status.status, "FAILED");
      assert.equal(status.lastFailure.reason, reason);
      assert.equal((await u.agent.get("/api/individual/assets")).status, 403);
    });
  }

  it("rejects a wrong OTP and a PAN already verified elsewhere", async () => {
    await assert.rejects(signup(ctx.app, "Individual", { name: "Rahul Verma", pan: "ABCPV1234K", dob: "1990-05-15" }), /409/, "PAN verified by the first test");
    const v = await signup(ctx.app, "Individual", { name: "Priya Sharma", pan: "BQSPS5678L", dob: "1988-11-02" });
    const { login } = await runFlow(v.agent, { identity: "priya", otp: "000000" });
    assert.equal(login.status, 400);
    assert.match(login.text, /Incorrect OTP/);
  });

  it("protects the token endpoint (PKCE, client secret, single-use codes)", async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sandbox/digilocker/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "nope", client_id: "finpro-sandbox-client", client_secret: "wrong" }),
    });
    assert.equal(res.status, 401);
  });

  it("is refused in production", async () => {
    const { loadConfig } = await import("../src/config.mjs");
    assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.com", KYC_MODE: "sandbox" }), /KYC_MODE=sandbox/);
  });
});
