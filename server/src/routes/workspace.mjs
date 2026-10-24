import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { notFound } from "../lib/errors.mjs";
import { complianceStatus, toAudit, toClient, toCompliance, toKnowledge, toProject, toTask } from "../lib/mappers.mjs";
import { isoDate, parse, requiredText, text } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";
import { PROJECT_SELECT } from "./projects.mjs";

const complianceSchema = z.object({
  title: requiredText(200),
  clientId: z.string().trim().max(64).nullable().optional(),
  category: z.enum(["Tax", "Audit", "Filing", "Deliverable", "Internal"]).default("Internal"),
  dueDate: isoDate().refine((v) => v !== "", "is required"),
});
const complianceUpdate = z.object({ completed: z.boolean() }).strict();
const knowledgeSchema = z.object({
  title: requiredText(200),
  kind: z.enum(["SOP", "Template", "Policy", "Report", "Methodology"]),
  owner: text(120).default(""),
  body: text(20000).default(""),
});
// Organization settings: a flat map of feature flags / short strings.
const settingsSchema = z
  .record(z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), z.union([z.boolean(), z.string().max(500), z.number()]))
  .refine((o) => Object.keys(o).length <= 50, "too many settings");

/** Professional/Finance workspace endpoints: dashboard, analytics, compliance, knowledge, audit, settings. */
export default function workspaceRoutes({ db }) {
  const r = Router();
  const pro = requireRole("Professional User");
  const workspace = requireRole("Professional User", "Finance User");
  const org = (req) => req.user.organization_id;
  const count = (sql, ...args) => db.prepare(sql).get(...args)?.c ?? 0;

  r.get("/dashboard", workspace, (req, res) => {
    const o = org(req);
    const compliance = db
      .prepare(
        "SELECT ci.*, c.company AS client_name FROM compliance_items ci LEFT JOIN clients c ON c.id = ci.client_id WHERE ci.organization_id = ? AND ci.completed = 0 ORDER BY ci.due_date LIMIT 50",
      )
      .all(o);
    res.json({
      role: req.user.role,
      metrics: {
        clients: count("SELECT COUNT(*) c FROM clients WHERE organization_id = ? AND status <> 'Archived'", o),
        activeProjects: count("SELECT COUNT(*) c FROM projects WHERE organization_id = ? AND status = 'Active'", o),
        documents: count("SELECT COUNT(*) c FROM documents WHERE organization_id = ?", o),
        aiAnalyses: count(
          "SELECT COUNT(*) c FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.organization_id = ? AND m.role = 'assistant'",
          o,
        ),
        pendingTasks: count("SELECT COUNT(*) c FROM tasks WHERE organization_id = ? AND status <> 'Completed'", o),
        highPriorityTasks: count("SELECT COUNT(*) c FROM tasks WHERE organization_id = ? AND status <> 'Completed' AND priority = 'High'", o),
        upcomingDeadlines: compliance.filter((c) => complianceStatus(c) !== "Overdue").length,
        overdueDeadlines: compliance.filter((c) => complianceStatus(c) === "Overdue").length,
      },
      recentProjects: db.prepare(`${PROJECT_SELECT} WHERE p.organization_id = ? ORDER BY p.updated_at DESC LIMIT 5`).all(o).map(toProject),
      recentClients:
        req.user.role === "Professional User"
          ? db.prepare("SELECT * FROM clients WHERE organization_id = ? ORDER BY created_at DESC LIMIT 5").all(o).map(toClient)
          : [],
      upcomingTasks: db
        .prepare(
          "SELECT t.*, p.name AS project_name, u.name AS assignee_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id WHERE t.organization_id = ? AND t.status <> 'Completed' ORDER BY CASE WHEN t.due = '' THEN 1 ELSE 0 END, t.due LIMIT 5",
        )
        .all(o)
        .map(toTask),
      activity: monthly(db, "SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS c FROM audit_logs WHERE organization_id = ? AND created_at >= ? GROUP BY m", o),
    });
  });

  r.get("/analytics", workspace, (req, res) => {
    const o = org(req);
    res.json({
      activeUsers: count("SELECT COUNT(*) c FROM users WHERE organization_id = ? AND active = 1", o),
      aiRequests: count(
        "SELECT COUNT(*) c FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.organization_id = ? AND m.role = 'user'",
        o,
      ),
      documents: count("SELECT COUNT(*) c FROM documents WHERE organization_id = ?", o),
      conversations: count("SELECT COUNT(*) c FROM conversations WHERE organization_id = ?", o),
      tasks: count("SELECT COUNT(*) c FROM tasks WHERE organization_id = ?", o),
      activityEvents: count("SELECT COUNT(*) c FROM audit_logs WHERE organization_id = ?", o),
      aiByMonth: monthly(
        db,
        "SELECT substr(m.created_at, 1, 7) AS m, COUNT(*) AS c FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.organization_id = ? AND m.role = 'user' AND m.created_at >= ? GROUP BY 1",
        o,
      ),
      documentsByMonth: monthly(
        db,
        "SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS c FROM documents WHERE organization_id = ? AND created_at >= ? GROUP BY m",
        o,
      ),
    });
  });

  // Compliance calendar ----------------------------------------------------
  r.get("/compliance", pro, (req, res) => {
    res.json(
      db
        .prepare(
          "SELECT ci.*, c.company AS client_name FROM compliance_items ci LEFT JOIN clients c ON c.id = ci.client_id WHERE ci.organization_id = ? ORDER BY ci.completed, ci.due_date",
        )
        .all(org(req))
        .map(toCompliance),
    );
  });
  r.post("/compliance", pro, (req, res) => {
    const b = parse(complianceSchema, req.body);
    if (b.clientId && !db.prepare("SELECT 1 FROM clients WHERE id = ? AND organization_id = ?").get(b.clientId, org(req))) throw notFound("Client not found.");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO compliance_items(id, organization_id, client_id, title, category, due_date) VALUES (?,?,?,?,?,?)").run(
      id,
      org(req),
      b.clientId || null,
      b.title,
      b.category,
      b.dueDate,
    );
    audit(db, req, "Create deadline", b.title);
    const row = db.prepare("SELECT ci.*, c.company AS client_name FROM compliance_items ci LEFT JOIN clients c ON c.id = ci.client_id WHERE ci.id = ?").get(id);
    res.status(201).json(toCompliance(row));
  });
  r.patch("/compliance/:id", pro, (req, res) => {
    const b = parse(complianceUpdate, req.body);
    const row = db.prepare("SELECT * FROM compliance_items WHERE id = ? AND organization_id = ?").get(req.params.id, org(req));
    if (!row) throw notFound("Deadline not found.");
    db.prepare("UPDATE compliance_items SET completed = ? WHERE id = ?").run(b.completed ? 1 : 0, row.id);
    audit(db, req, b.completed ? "Complete deadline" : "Reopen deadline", row.title);
    res.json(toCompliance({ ...row, completed: b.completed ? 1 : 0 }));
  });
  r.delete("/compliance/:id", pro, (req, res) => {
    const row = db.prepare("SELECT * FROM compliance_items WHERE id = ? AND organization_id = ?").get(req.params.id, org(req));
    if (!row) throw notFound("Deadline not found.");
    db.prepare("DELETE FROM compliance_items WHERE id = ?").run(row.id);
    audit(db, req, "Delete deadline", row.title);
    res.status(204).end();
  });

  // Knowledge base -----------------------------------------------------------
  r.get("/knowledge-base", pro, (req, res) => {
    res.json(db.prepare("SELECT * FROM knowledge_items WHERE organization_id = ? ORDER BY updated_at DESC").all(org(req)).map(toKnowledge));
  });
  r.post("/knowledge-base", pro, (req, res) => {
    const b = parse(knowledgeSchema, req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO knowledge_items(id, organization_id, title, kind, owner, body) VALUES (?,?,?,?,?,?)").run(
      id,
      org(req),
      b.title,
      b.kind,
      b.owner || req.user.name,
      b.body,
    );
    audit(db, req, "Create knowledge item", b.title);
    res.status(201).json(toKnowledge(db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id)));
  });
  r.delete("/knowledge-base/:id", pro, (req, res) => {
    const row = db.prepare("SELECT * FROM knowledge_items WHERE id = ? AND organization_id = ?").get(req.params.id, org(req));
    if (!row) throw notFound("Knowledge item not found.");
    db.prepare("DELETE FROM knowledge_items WHERE id = ?").run(row.id);
    audit(db, req, "Delete knowledge item", row.title);
    res.status(204).end();
  });

  // Audit log ----------------------------------------------------------------
  r.get("/audit-logs", pro, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const before = typeof req.query.before === "string" ? req.query.before : "9999";
    const action = typeof req.query.action === "string" && req.query.action ? req.query.action : null;
    const rows = db
      .prepare(`SELECT * FROM audit_logs WHERE organization_id = ? AND created_at < ? ${action ? "AND action = ?" : ""} ORDER BY created_at DESC LIMIT ?`)
      .all(...[org(req), before, ...(action ? [action] : []), limit]);
    res.json(rows.map(toAudit));
  });

  // Organization settings ------------------------------------------------------
  r.get("/settings", workspace, (req, res) => {
    const row = db.prepare("SELECT data_json FROM settings WHERE organization_id = ?").get(org(req));
    res.json(row ? JSON.parse(row.data_json) : {});
  });
  r.put("/settings", pro, (req, res) => {
    const data = parse(settingsSchema, req.body);
    db.prepare(
      "INSERT INTO settings(organization_id, data_json, updated_at) VALUES (?,?,?) ON CONFLICT(organization_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
    ).run(org(req), JSON.stringify(data), new Date().toISOString());
    audit(db, req, "Update settings", "Organization settings", { keys: Object.keys(data) });
    res.json(data);
  });

  return r;
}

/** Return the last 6 calendar months as [{month: "2026-05", value}] with zero-filled gaps. */
function monthly(db, sql, orgId) {
  const months = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 5; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(x.toISOString().slice(0, 7));
  }
  const rows = db.prepare(sql).all(orgId, `${months[0]}-01`);
  const byMonth = new Map(rows.map((r) => [r.m, r.c]));
  return months.map((m) => ({ month: m, value: byMonth.get(m) ?? 0 }));
}
