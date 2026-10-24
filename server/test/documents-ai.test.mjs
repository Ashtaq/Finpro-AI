import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setup, signup } from "./helpers.mjs";

const calls = [];
const fakeAi = {
  enabled: true,
  provider: "fake",
  async reply(input) {
    calls.push(input);
    return { content: "Revenue grew 10%.", limitations: null, model: "fake-1", usage: { input_tokens: 10, output_tokens: 5 } };
  },
};
const { app, cleanup } = setup({ ai: fakeAi });
after(cleanup);

describe("documents", () => {
  it("uploads, lists, downloads and deletes a file within the organization", async () => {
    const a = await signup(app, "Finance User");
    const b = await signup(app, "Finance User");
    const up = await a.agent
      .post("/api/documents")
      .attach("file", Buffer.from("year,revenue\n2025,100\n2026,110\n"), "pnl.csv")
      .field("category", "Financials");
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.type, "CSV");
    const id = up.body.id;

    const dl = await a.agent.get(`/api/documents/${id}/download`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers["content-disposition"], /attachment; filename="?pnl.csv"?/);
    assert.match(dl.text, /2026,110/);

    assert.equal((await b.agent.get(`/api/documents/${id}/download`)).status, 404);
    assert.equal((await b.agent.delete(`/api/documents/${id}`)).status, 404);
    await a.agent.delete(`/api/documents/${id}`).expect(204);
    assert.equal((await a.agent.get("/api/documents")).body.length, 0);
  });

  it("rejects disallowed types, spoofed content and oversized files", async () => {
    const a = await signup(app, "Individual");
    assert.equal((await a.agent.post("/api/documents").attach("file", Buffer.from("MZ..."), "tool.exe")).status, 400);
    assert.equal((await a.agent.post("/api/documents").attach("file", Buffer.from("not a pdf"), "fake.pdf")).status, 400);
    assert.equal((await a.agent.post("/api/documents").attach("file", Buffer.alloc(1024 * 1024 + 10, 65), "big.txt")).status, 413);
    assert.equal((await a.agent.post("/api/documents").attach("file", Buffer.from("%PDF-1.7 test"), "form16.pdf")).status, 201);
  });
});

describe("assistant", () => {
  it("creates a conversation, passes org-scoped document text to the provider, and stores history", async () => {
    const a = await signup(app, "Professional User");
    const other = await signup(app, "Professional User");
    const foreign = (await other.agent.post("/api/documents").attach("file", Buffer.from("secret"), "secret.txt")).body;
    const mine = (await a.agent.post("/api/documents").attach("file", Buffer.from("revenue 100 -> 110"), "notes.txt")).body;

    const res = await a.agent.post("/api/assistant/messages").send({ message: "What was growth?", agentId: "finance", documentIds: [mine.id, foreign.id] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.message.content, "Revenue grew 10%.");
    const last = calls.at(-1);
    assert.deepEqual(
      last.documents.map((d) => d.name),
      ["notes.txt"],
      "documents from other orgs must never reach the model",
    );
    assert.match(last.documents[0].text, /100 -> 110/);

    const convo = (await a.agent.get(`/api/assistant/conversations/${res.body.conversationId}`)).body;
    assert.equal(convo.messages.length, 2);
    assert.equal((await other.agent.get(`/api/assistant/conversations/${res.body.conversationId}`)).status, 404);
  });

  it("says plainly when no AI provider is configured", async () => {
    const plain = setup();
    try {
      const a = await signup(plain.app, "Individual");
      const res = await a.agent.post("/api/assistant/messages").send({ message: "hello" }).expect(200);
      assert.match(res.body.message.content, /not configured/);
    } finally {
      plain.cleanup();
    }
  });
});
