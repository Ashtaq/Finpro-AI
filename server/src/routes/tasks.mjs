import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { notFound } from "../lib/errors.mjs";
import { toTask } from "../lib/mappers.mjs";
import { isoDate, parse, requiredText } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";

const STATUSES = ["To Do", "In Progress", "Review", "Completed"];
const createSchema = z.object({
  title: requiredText(200),
  projectId: z.string().trim().max(64).nullable().optional(),
  assigneeId: z.string().trim().max(64).nullable().optional(),
  priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
  due: isoDate().default(""),
  status: z.enum(STATUSES).default("To Do"),
});
const updateSchema = createSchema.partial().strict();

const SELECT = `SELECT t.*, p.name AS project_name, c.company AS client_name, u.name AS assignee_name
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = t.assignee_id`;

export default function taskRoutes({ db }) {
  const r = Router();
  r.use(requireRole("Professional User", "Finance User"));
  const org = (req) => req.user.organization_id;
  const get = (req, id) => {
    const row = db.prepare(`${SELECT} WHERE t.id = ? AND t.organization_id = ?`).get(id, org(req));
    if (!row) throw notFound("Task not found.");
    return row;
  };
  const scoped = (req, table, id, label) => {
    if (!id) return null;
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND organization_id = ?`).get(id, org(req)))
      throw notFound(`${label} not found in your organization.`);
    return id;
  };

  r.get("/", (req, res) => {
    res.json(db.prepare(`${SELECT} WHERE t.organization_id = ? ORDER BY CASE WHEN t.due = '' THEN 1 ELSE 0 END, t.due`).all(org(req)).map(toTask));
  });

  r.post("/", (req, res) => {
    const b = parse(createSchema, req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO tasks(id, organization_id, project_id, assignee_id, title, priority, due, status) VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      org(req),
      scoped(req, "projects", b.projectId, "Project"),
      scoped(req, "users", b.assigneeId ?? req.user.id, "Assignee"),
      b.title,
      b.priority,
      b.due,
      b.status,
    );
    audit(db, req, "Create task", b.title, { projectId: b.projectId || undefined });
    res.status(201).json(toTask(get(req, id)));
  });

  r.patch("/:id", (req, res) => {
    const t = get(req, req.params.id);
    const b = parse(updateSchema, req.body);
    const cols = { title: "title", priority: "priority", due: "due", status: "status" };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(cols)) if (b[k] !== undefined) (sets.push(`${col} = ?`), vals.push(b[k]));
    if (b.projectId !== undefined) (sets.push("project_id = ?"), vals.push(scoped(req, "projects", b.projectId, "Project")));
    if (b.assigneeId !== undefined) (sets.push("assignee_id = ?"), vals.push(scoped(req, "users", b.assigneeId, "Assignee")));
    if (sets.length) {
      db.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, new Date().toISOString(), t.id);
      audit(db, req, b.status && Object.keys(b).length === 1 ? "Task status update" : "Update task", t.title, {
        ...(b.status ? { status: b.status } : {}),
        ...(t.project_id ? { projectId: t.project_id } : {}),
      });
    }
    res.json(toTask(get(req, t.id)));
  });

  r.delete("/:id", (req, res) => {
    const t = get(req, req.params.id);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(t.id);
    audit(db, req, "Delete task", t.title);
    res.status(204).end();
  });

  return r;
}
