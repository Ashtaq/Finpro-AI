import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import request from "supertest";
import { loadConfig } from "../src/config.mjs";
import { setup, signup } from "./helpers.mjs";

const { app, db, cleanup } = setup();
after(cleanup);

describe("auth", () => {
  it("signs up, reads /me via cookie, and logs out", async () => {
    const { agent, user } = await signup(app, "Finance User");
    assert.equal(user.role, "Finance User");
    assert.equal((await agent.get("/api/auth/me")).body.user.id, user.id);
    assert.equal((await agent.post("/api/auth/logout")).status, 204);
    assert.equal((await agent.get("/api/auth/me")).status, 401);
  });

  it("sets an httpOnly SameSite session cookie and never returns the password hash", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Cookie", email: "cookie@example.com", password: "correct-horse-battery", role: "Individual", acceptTerms: true });
    assert.equal(res.status, 201);
    const cookie = res.headers["set-cookie"][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(JSON.stringify(res.body).includes("scrypt"), false);
    const row = db.prepare("SELECT password_hash FROM users WHERE email = 'cookie@example.com'").get();
    assert.match(row.password_hash, /^scrypt\$/);
  });

  it("rejects weak passwords, unaccepted terms and duplicate emails", async () => {
    const base = { name: "X", email: "dup@example.com", password: "correct-horse-battery", role: "Individual", acceptTerms: true };
    assert.equal(
      (
        await request(app)
          .post("/api/auth/signup")
          .send({ ...base, password: "short" })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/auth/signup")
          .send({ ...base, acceptTerms: false })
      ).status,
      400,
    );
    assert.equal((await request(app).post("/api/auth/signup").send(base)).status, 201);
    assert.equal(
      (
        await request(app)
          .post("/api/auth/signup")
          .send({ ...base, email: "DUP@example.com" })
      ).status,
      409,
    );
  });

  it("logs in with correct credentials only", async () => {
    const { email, password } = await signup(app);
    assert.equal((await request(app).post("/api/auth/login").send({ email, password: "wrong-password-123" })).status, 401);
    assert.equal((await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password })).status, 401);
    const ok = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password });
    assert.equal(ok.status, 200);
  });

  it("ignores the legacy x-user-id header (no header-based impersonation)", async () => {
    const { user } = await signup(app);
    const res = await request(app).get("/api/auth/me").set("x-user-id", user.id);
    assert.equal(res.status, 401);
  });

  it("blocks cross-origin state-changing requests", async () => {
    const { agent } = await signup(app);
    const res = await agent.patch("/api/account").set("Origin", "https://evil.example").send({ name: "A", email: "a@example.com" });
    assert.equal(res.status, 403);
  });

  it("changing password revokes other sessions", async () => {
    const { agent, email, password } = await signup(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email, password }).expect(200);
    await agent.post("/api/account/change-password").send({ currentPassword: password, newPassword: "another-strong-pass" }).expect(204);
    assert.equal((await agent.get("/api/auth/me")).status, 200);
    assert.equal((await other.get("/api/auth/me")).status, 401);
  });
});

describe("config", () => {
  it("refuses unsafe production settings", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.com", SEED_DEMO: "true" }), /SEED_DEMO/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.com", KYC_MODE: "mock" }), /KYC_MODE/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "http://app.example.com" }), /https/);
    const ok = loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.com" });
    assert.equal(ok.cookieSecure, true);
  });
});
