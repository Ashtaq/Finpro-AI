import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { badRequest, notFound } from "../lib/errors.mjs";
import { toDocument, toProject, toTask } from "../lib/mappers.mjs";
import { isoDate, parse, requiredText, text } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";

const PROJECT_TYPES = ["Financial Analysis", "Tax Analysis", "Audit", "Accounting", "Valuation", "Due Diligence", "Advisory", "Other"];
const fields = {
  name: requiredText(160),
  clientId: z.string().trim().max(64).nullable().optional(),
  type: z.enum(PROJECT_TYPES).default("Financial Analysis"),
  fy: text(20).default(""),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code")
    .default("INR"),
  status: z.enum(["Draft", "Active", "Under Review", "Completed", "Archived"]).default("Draft"),
  priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
  startDate: isoDate().default(""),
  endDate: isoDate().default(""),
  team: z.array(text(120)).max(50).default([]),
  tags: z.array(text(40)).max(20).default([]),
};
const createSchema = z.object(fields);
const updateSchema = z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]))).strict();

export const PROJECT_SELECT = "SELECT p.*, c.company AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id";

export default function projectRoutes({ db }) {
  const r = Router();
  r.use(requireRole("Professional User", "Finance User"));

  const get = (req, id) => {
    const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.organization_id = ?`).get(id, req.user.organization_id);
    if (!row) throw notFound("Project not found.");
    return row;
  };
  const checkClient = (req, clientId) => {
    if (!clientId) return null;
    if (req.user.role !== "Professional User") throw badRequest("Only Professional Users can link projects to clients.");
    const c = db.prepare("SELECT id FROM clients WHERE id = ? AND organization_id = ?").get(clientId, req.user.organization_id);
    if (!c) throw notFound("Client not found in your organization.");
    return c.id;
  };

  r.get("/", (req, res) => {
    res.json(db.prepare(`${PROJECT_SELECT} WHERE p.organization_id = ? ORDER BY p.created_at DESC`).all(req.user.organization_id).map(toProject));
  });

  r.get("/:id", (req, res) => {
    const p = get(req, req.params.id);
    const documents = db
      .prepare(
        "SELECT d.*, u.name AS uploader_name FROM documents d JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? AND d.organization_id = ? ORDER BY d.created_at DESC",
      )
      .all(p.id, req.user.organization_id)
      .map(toDocument);
    const tasks = db
      .prepare(
        "SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? AND t.organization_id = ? ORDER BY t.due",
      )
      .all(p.id, req.user.organization_id)
      .map((t) => toTask({ ...t, project_name: p.name, client_name: p.client_name }));
    const activity = db
      .prepare(
        "SELECT actor_name, action, resource, created_at FROM audit_logs WHERE organization_id = ? AND metadata_json LIKE ? ORDER BY created_at DESC LIMIT 25",
      )
      .all(req.user.organization_id, `%"projectId":"${p.id}"%`)
      .map((a) => ({ actor: a.actor_name, action: a.action, resource: a.resource, timestamp: a.created_at }));
    const conversations = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE project_id = ?").get(p.id).c;
    res.json({ project: toProject(p), documents, tasks, activity, conversations });
  });

  r.post("/", (req, res) => {
    const b = parse(createSchema, req.body);
    const clientId = checkClient(req, b.clientId);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO projects(id, organization_id, client_id, name, type, fy, currency, status, priority, start_date, end_date, team_json, tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      req.user.organization_id,
      clientId,
      b.name,
      b.type,
      b.fy,
      b.currency,
      b.status,
      b.priority,
      b.startDate,
      b.endDate,
      JSON.stringify(b.team),
      JSON.stringify(b.tags),
    );
    audit(db, req, "Create project", b.name, { projectId: id, clientId });
    res.status(201).json(toProject(get(req, id)));
  });

  r.patch("/:id", (req, res) => {
    const p = get(req, req.params.id);
    const b = parse(updateSchema, req.body);
    const map = {
      name: "name",
      type: "type",
      fy: "fy",
      currency: "currency",
      status: "status",
      priority: "priority",
      startDate: "start_date",
      endDate: "end_date",
    };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) (sets.push(`${col} = ?`), vals.push(b[k]));
    if (b.clientId !== undefined) (sets.push("client_id = ?"), vals.push(checkClient(req, b.clientId)));
    if (b.team) (sets.push("team_json = ?"), vals.push(JSON.stringify(b.team)));
    if (b.tags) (sets.push("tags_json = ?"), vals.push(JSON.stringify(b.tags)));
    if (sets.length) {
      db.prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, new Date().toISOString(), p.id);
      audit(db, req, "Update project", p.name, { projectId: p.id, fields: Object.keys(b) });
    }
    res.json(toProject(get(req, p.id)));
  });

  return r;
}
