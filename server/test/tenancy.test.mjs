import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setup, signup } from "./helpers.mjs";

const { app, cleanup } = setup();
after(cleanup);

describe("RBAC and tenant isolation", () => {
  it("keeps clients, projects and tasks inside the owning organization", async () => {
    const a = await signup(app, "Professional User");
    const b = await signup(app, "Professional User");

    const client = (await a.agent.post("/api/clients").send({ company: "Acme Pvt Ltd", pan: "abcde1234f" }).expect(201)).body;
    assert.equal(client.pan, "ABCDE1234F");
    const project = (await a.agent.post("/api/projects").send({ name: "Audit FY26", clientId: client.id }).expect(201)).body;
    const task = (await a.agent.post("/api/tasks").send({ title: "Vouching", projectId: project.id }).expect(201)).body;

    assert.deepEqual((await b.agent.get("/api/clients")).body, []);
    assert.equal((await b.agent.get(`/api/clients/${client.id}`)).status, 404);
    assert.equal((await b.agent.get(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await b.agent.patch(`/api/tasks/${task.id}`).send({ status: "Completed" })).status, 404);
    assert.equal((await b.agent.post("/api/projects").send({ name: "x", clientId: client.id })).status, 404);
    assert.equal((await b.agent.get("/api/dashboard")).body.metrics.clients, 0);
  });

  it("enforces role permissions", async () => {
    const fin = await signup(app, "Finance User");
    const ind = await signup(app, "Individual");
    assert.equal((await fin.agent.get("/api/clients")).status, 403);
    assert.equal((await fin.agent.get("/api/users")).status, 403);
    assert.equal((await fin.agent.get("/api/audit-logs")).status, 403);
    assert.equal((await fin.agent.post("/api/projects").send({ name: "My shop books" })).status, 201);
    assert.equal((await ind.agent.get("/api/projects")).status, 403);
    assert.equal((await ind.agent.get("/api/dashboard")).status, 403);
    assert.equal((await fin.agent.get("/api/individual/assets")).status, 403);
  });

  it("lets a Professional User manage only their own organization's users", async () => {
    const owner = await signup(app, "Professional User");
    const outsider = await signup(app, "Professional User");
    const created = (
      await owner.agent
        .post("/api/users")
        .send({ name: "Staff", email: "staff@example.com", password: "staff-password-1", role: "Finance User", organizationId: outsider.user.organizationId })
        .expect(201)
    ).body;
    assert.equal(created.organizationId, owner.user.organizationId, "organizationId from the body must be ignored");
    assert.equal((await outsider.agent.patch(`/api/users/${created.id}`).send({ name: "Hacked" })).status, 404);
    assert.equal((await outsider.agent.delete(`/api/users/${created.id}`)).status, 404);
    await owner.agent.delete(`/api/users/${created.id}`).expect(204);
  });

  it("validates settings payloads and restricts writes to Professional Users", async () => {
    const pro = await signup(app, "Professional User");
    await pro.agent.put("/api/settings").send({ evidenceFirst: true, "bad key!": 1 }).expect(400);
    await pro.agent.put("/api/settings").send({ evidenceFirst: true }).expect(200);
    assert.deepEqual((await pro.agent.get("/api/settings")).body, { evidenceFirst: true });
  });

  it("records audit events per organization", async () => {
    const pro = await signup(app, "Professional User");
    await pro.agent.post("/api/clients").send({ company: "Audit Co" }).expect(201);
    const logs = (await pro.agent.get("/api/audit-logs")).body;
    assert.ok(logs.some((l) => l.action === "Create client"));
    assert.ok(logs.every((l) => !JSON.stringify(l).includes("password")));
  });
});
