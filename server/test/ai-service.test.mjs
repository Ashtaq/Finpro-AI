import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { DEV_AI_SERVICE_TOKEN, loadConfig } from "../src/config.mjs";
import { setup, signup } from "./helpers.mjs";

// A stand-in for AI_Assistant_Code that records what the Node API sends.
const received = [];
let reply = (_body) => ({
  status: 200,
  json: {
    content: "Revenue grew 10%.",
    limitations: "Only part of big.csv was read (context limit).",
    tier: "top",
    provider: "anthropic",
    model: "claude-opus-5-5",
    usage: { input_tokens: 120, output_tokens: 30 },
  },
});
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    received.push({ url: req.url, auth: req.headers.authorization, body });
    const { status, json } = reply(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  });
});
let url;
before(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${fake.address().port}`;
});
after(() => fake.close());

describe("AI service integration", () => {
  it("sends an org-scoped request to the AI service and stores its answer", async () => {
    const { app, cleanup } = setup({ env: { AI_PROVIDER: "service", AI_SERVICE_URL: url } });
    try {
      const a = await signup(app, "Finance User");
      const doc = (await a.agent.post("/api/documents").attach("file", Buffer.from("year,revenue\n2025,100\n2026,110"), "pnl.csv")).body;
      const res = await a.agent
        .post("/api/assistant/messages")
        .send({ message: "What was growth?", agentId: "finance", documentIds: [doc.id], complexity: "top" });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const call = received.at(-1);
      assert.equal(call.url, "/v1/chat");
      assert.equal(call.auth, `Bearer ${DEV_AI_SERVICE_TOKEN}`);
      assert.equal(call.body.agent_id, "finance");
      assert.equal(call.body.complexity, "top");
      assert.ok(call.body.context.org_id);
      assert.equal(call.body.context.user_role, "Finance User");
      assert.deepEqual(call.body.documents, [{ name: "pnl.csv", text: "year,revenue\n2025,100\n2026,110" }]);

      const m = res.body.message;
      assert.equal(m.content, "Revenue grew 10%.");
      assert.equal(m.model, "anthropic/claude-opus-5-5");
      assert.match(m.limitations, /context limit/);

      // The next turn carries history.
      await a.agent.post("/api/assistant/messages").send({ message: "And margin?", conversationId: res.body.conversationId }).expect(200);
      assert.deepEqual(
        received.at(-1).body.history.map((h) => h.role),
        ["user", "assistant"],
      );
      assert.equal(received.at(-1).body.complexity, "auto");
    } finally {
      cleanup();
    }
  });

  it("returns a clear 503 when the AI service is down and keeps history clean", async () => {
    const { app, db, cleanup } = setup({ env: { AI_PROVIDER: "service", AI_SERVICE_URL: "http://127.0.0.1:1" } });
    try {
      const a = await signup(app, "Professional User");
      const res = await a.agent.post("/api/assistant/messages").send({ message: "hello" });
      assert.equal(res.status, 503);
      assert.match(res.body.error, /AI service is not running/);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    } finally {
      cleanup();
    }
  });

  it("passes AI service errors through as a 502", async () => {
    reply = () => ({ status: 502, json: { error: "All AI models failed for this request." } });
    const { app, cleanup } = setup({ env: { AI_PROVIDER: "service", AI_SERVICE_URL: url } });
    try {
      const a = await signup(app, "Finance User");
      const res = await a.agent.post("/api/assistant/messages").send({ message: "hello" });
      assert.equal(res.status, 502);
    } finally {
      cleanup();
    }
  });

  it("rejects an invalid complexity value", async () => {
    const { app, cleanup } = setup({ env: { AI_PROVIDER: "service", AI_SERVICE_URL: url } });
    try {
      const a = await signup(app, "Finance User");
      assert.equal((await a.agent.post("/api/assistant/messages").send({ message: "x", complexity: "max" })).status, 400);
    } finally {
      cleanup();
    }
  });
});

describe("AI configuration", () => {
  const base = { NODE_ENV: "production", APP_ORIGIN: "https://app.example.com" };
  it("requires a strong shared token in production", () => {
    assert.throws(() => loadConfig({ ...base, AI_PROVIDER: "service" }), /AI_SERVICE_TOKEN/);
    assert.equal(loadConfig({ ...base, AI_PROVIDER: "service", AI_SERVICE_TOKEN: "x".repeat(40) }).ai.serviceToken, "x".repeat(40));
  });
  it("explains that the direct Anthropic provider moved to the AI service", () => {
    assert.throws(() => loadConfig({ AI_PROVIDER: "anthropic" }), /AI_Assistant_Code/);
  });
});
