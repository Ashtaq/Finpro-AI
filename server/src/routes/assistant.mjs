import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { HttpError, notFound } from "../lib/errors.mjs";
import { toMessage } from "../lib/mappers.mjs";
import { parse, requiredText } from "../lib/validate.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import { AGENTS, findAgent } from "../services/ai.mjs";
import { extensionOf, TEXT_EXTENSIONS } from "../services/storage.mjs";

const messageSchema = z.object({
  message: requiredText(8000),
  conversationId: z.string().trim().max(64).optional(),
  agentId: z.string().trim().max(32).default("finance"),
  projectId: z.string().trim().max(64).nullable().optional(),
  documentIds: z.array(z.string().max(64)).max(8).default([]),
});

const MAX_DOC_BYTES = 30_000;
const MAX_TOTAL_BYTES = 80_000;

export default function assistantRoutes({ db, config, ai, storage }) {
  const r = Router();
  r.use(requireAuth);
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.isTest ? 1000 : 20,
    keyGenerator: (req) => req.user.id,
    message: { error: "Too many AI requests. Please wait a moment." },
  });

  r.get("/agents", (_req, res) => {
    res.json(AGENTS.map(({ focus: _focus, ...a }) => a));
  });

  r.get("/status", (_req, res) => res.json({ enabled: ai.enabled, provider: ai.provider }));

  r.get("/conversations", (req, res) => {
    const rows = db
      .prepare("SELECT id, title, agent_id, project_id, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50")
      .all(req.user.id);
    res.json(rows.map((c) => ({ id: c.id, title: c.title, agentId: c.agent_id, projectId: c.project_id, updatedAt: c.updated_at })));
  });

  r.get("/conversations/:id", (req, res) => {
    const c = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!c) throw notFound("Conversation not found.");
    const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at").all(c.id).map(toMessage);
    res.json({ id: c.id, title: c.title, agentId: c.agent_id, projectId: c.project_id, messages });
  });

  r.delete("/conversations/:id", (req, res) => {
    const c = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!c) throw notFound("Conversation not found.");
    db.prepare("DELETE FROM conversations WHERE id = ?").run(c.id);
    res.status(204).end();
  });

  r.post("/messages", limiter, async (req, res) => {
    const b = parse(messageSchema, req.body);
    const org = req.user.organization_id;
    const agent = findAgent(b.agentId);
    if (!agent) throw notFound("Agent not found.");

    let convo;
    if (b.conversationId) {
      convo = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(b.conversationId, req.user.id);
      if (!convo) throw notFound("Conversation not found.");
    } else {
      if (b.projectId && !db.prepare("SELECT 1 FROM projects WHERE id = ? AND organization_id = ?").get(b.projectId, org)) throw notFound("Project not found.");
      convo = {
        id: crypto.randomUUID(),
        organization_id: org,
        user_id: req.user.id,
        project_id: b.projectId || null,
        agent_id: agent.id,
        title: b.message.slice(0, 80),
      };
      db.prepare("INSERT INTO conversations(id, organization_id, user_id, project_id, agent_id, title) VALUES (?,?,?,?,?,?)").run(
        convo.id,
        org,
        req.user.id,
        convo.project_id,
        convo.agent_id,
        convo.title,
      );
    }

    const project = convo.project_id
      ? db.prepare("SELECT p.name, c.company FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?").get(convo.project_id)
      : null;

    // Documents: explicitly selected ones, else the latest few from the project. Always org-scoped.
    const docRows = b.documentIds.length
      ? db.prepare(`SELECT * FROM documents WHERE organization_id = ? AND id IN (${b.documentIds.map(() => "?").join(",")})`).all(org, ...b.documentIds)
      : convo.project_id
        ? db.prepare("SELECT * FROM documents WHERE organization_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 4").all(org, convo.project_id)
        : [];
    let budget = MAX_TOTAL_BYTES;
    const documents = [];
    for (const d of docRows) {
      let textContent = null;
      if (TEXT_EXTENSIONS.has(extensionOf(d.name)) && budget > 0) {
        textContent = await storage.readText(d.storage_key, Math.min(MAX_DOC_BYTES, budget)).catch(() => null);
        if (textContent != null) budget -= Buffer.byteLength(textContent);
      }
      documents.push({ id: d.id, name: d.name, text: textContent });
    }

    const history = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12").all(convo.id).reverse();

    const userMessageId = crypto.randomUUID();
    db.prepare("INSERT INTO messages(id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)").run(
      userMessageId,
      convo.id,
      "user",
      b.message,
      new Date().toISOString(),
    );

    let result;
    try {
      result = await ai.reply({
        agent,
        history,
        message: b.message,
        documents,
        ctx: { userRole: req.user.role, projectName: project?.name, clientName: project?.company },
      });
    } catch (err) {
      req.log?.warn({ err }, "AI provider call failed");
      db.prepare("DELETE FROM messages WHERE id = ?").run(userMessageId); // keep history strictly alternating
      throw new HttpError(502, "The AI provider could not complete this request. Please try again.");
    }

    const assistantId = crypto.randomUUID();
    const sources = documents.map((d) => ({ documentId: d.id, name: d.name, read: d.text != null }));
    db.prepare(
      "INSERT INTO messages(id, conversation_id, role, content, sources_json, limitations, model, input_tokens, output_tokens, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      assistantId,
      convo.id,
      "assistant",
      result.content,
      JSON.stringify(sources),
      result.limitations,
      result.model,
      result.usage?.input_tokens ?? null,
      result.usage?.output_tokens ?? null,
      new Date().toISOString(),
    );
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), convo.id);
    if (ai.enabled) db.prepare("UPDATE organizations SET ai_requests = ai_requests + 1 WHERE id = ?").run(org);
    audit(db, req, "AI request", agent.name, { conversationId: convo.id, ...(convo.project_id ? { projectId: convo.project_id } : {}) });

    res.json({ conversationId: convo.id, message: toMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(assistantId)) });
  });

  return r;
}
