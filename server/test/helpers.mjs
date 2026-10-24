import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import request from "supertest";
import { createApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { openDatabase } from "../src/db/index.mjs";

export function setup({ env = {}, ai } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finpro-test-"));
  const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, APP_ORIGIN: "http://localhost:5173", MAX_UPLOAD_MB: "1", ...env });
  const db = openDatabase(":memory:");
  const app = createApp({ db, config, logger: pino({ level: "silent" }), ...(ai ? { ai } : {}) });
  const cleanup = () => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, config, cleanup };
}

let n = 0;
/** Sign up a fresh user and return a supertest agent carrying its session cookie. */
export async function signup(app, role = "Professional User", extra = {}) {
  const agent = request.agent(app);
  n += 1;
  const body = { name: `User ${n}`, email: `user${n}-${Date.now()}@example.com`, password: "correct-horse-battery", role, acceptTerms: true, ...extra };
  const res = await agent.post("/api/auth/signup").send(body);
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user, password: body.password, email: body.email };
}
