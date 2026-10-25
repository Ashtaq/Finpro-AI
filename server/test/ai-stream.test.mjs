import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { setup } from "./helpers.mjs";

// Stand-in for the AI service's /v1/chat/stream. Behaviour per test via `script`.
let script = async (_res) => {};
const seen = { bodies: [], closedEarly: 0 };
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    seen.bodies.push({ url: req.url, body: JSON.parse(raw || "{}") });
    res.on("close", () => {
      if (!res.writableEnded) seen.closedEarly += 1;
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    await script(res);
  });
});
const ev = (res, event, data) => !res.destroyed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app, db, cleanup, server, base, cookie;
before(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  ({ app, db, cleanup } = setup({ env: { AI_PROVIDER: "service", AI_SERVICE_URL: `http://127.0.0.1:${fake.address().port}` } }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ name: "Streamer", email: `s${Date.now()}@example.com`, password: "correct-horse-battery", role: "Finance User", acceptTerms: true }),
  });
  assert.equal(res.status, 201);
  cookie = res.headers.get("set-cookie").split(";")[0];
});
after(() => {
  server.close();
  fake.close();
  cleanup();
});

const post = (body, signal) =>
  fetch(`${base}/api/assistant/messages/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173", cookie },
    body: JSON.stringify(body),
    signal,
  });

async function readEvents(res, { stopAfterDeltas } = {}) {
  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (event) events.push([event, JSON.parse(data)]);
      if (stopAfterDeltas && events.filter(([e]) => e === "delta").length >= stopAfterDeltas) return events;
    }
  }
  return events;
}

const countMessages = (conversationId) =>
  db.prepare("SELECT role, content, limitations FROM messages WHERE conversation_id = ? ORDER BY created_at").all(conversationId);

describe("streamed AI answers", () => {
  it("forwards text as it arrives and stores the final answer", async () => {
    script = async (res) => {
      ev(res, "meta", { tier: "fast", provider: "ollama", model: "qwen3:8b" });
      for (const t of ["GST ", "is ", "a tax."]) {
        ev(res, "delta", { text: t });
        await sleep(20);
      }
      ev(res, "done", { content: "GST is a tax.", tier: "fast", provider: "ollama", model: "qwen3:8b", usage: { input_tokens: 5, output_tokens: 3 } });
      res.end();
    };
    const res = await post({ message: "What is GST?", agentId: "tax" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    const events = await readEvents(res);
    assert.deepEqual(
      events.map(([e]) => e),
      ["start", "meta", "delta", "delta", "delta", "done"],
    );
    const done = events.at(-1)[1];
    assert.equal(done.message.content, "GST is a tax.");
    assert.equal(done.message.model, "ollama/qwen3:8b");
    assert.equal(seen.bodies.at(-1).url, "/v1/chat/stream");
    assert.deepEqual(
      countMessages(done.conversationId).map((m) => m.role),
      ["user", "assistant"],
    );
  });

  it("Stop closes the AI service connection and keeps the partial answer", async () => {
    const closedBefore = seen.closedEarly;
    script = async (res) => {
      ev(res, "meta", { tier: "fast", provider: "ollama", model: "qwen3:8b" });
      for (let i = 0; i < 200 && !res.destroyed; i++) {
        ev(res, "delta", { text: `w${i} ` });
        await sleep(20);
      }
      res.end();
    };
    const controller = new AbortController();
    const res = await post({ message: "Explain everything", agentId: "finance" }, controller.signal);
    const events = await readEvents(res, { stopAfterDeltas: 3 });
    const conversationId = events[0][1].conversationId;
    controller.abort();

    // the Node API must close its upstream request so the model stops
    for (let i = 0; i < 50 && seen.closedEarly === closedBefore; i++) await sleep(20);
    assert.equal(seen.closedEarly, closedBefore + 1, "AI service connection was not closed after Stop");

    let rows = [];
    for (let i = 0; i < 50 && rows.length < 2; i++) {
      rows = countMessages(conversationId);
      await sleep(20);
    }
    assert.equal(rows.length, 2);
    assert.match(rows[1].content, /^w0 w1 w2/);
    assert.equal(rows[1].limitations, "Stopped before the answer was complete.");
  });

  it("reports an error and removes the question when nothing was generated", async () => {
    script = async (res) => {
      ev(res, "meta", { tier: "fast", provider: "ollama", model: "qwen3:8b" });
      ev(res, "error", { error: "All AI models failed (ollama: model not found — run `ollama pull qwen3:8b`)." });
      res.end();
    };
    const events = await readEvents(await post({ message: "hello" }));
    const [kind, data] = events.at(-1);
    assert.equal(kind, "error");
    assert.match(data.error, /ollama pull/, "development shows the AI service's reason");
    assert.equal(countMessages(events[0][1].conversationId).length, 0);
  });

  it("returns normal JSON errors before streaming starts", async () => {
    const res = await post({ message: "" });
    assert.equal(res.status, 400);
    assert.match(res.headers.get("content-type"), /json/);
  });
});
