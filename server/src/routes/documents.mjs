import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { badRequest, forbidden, notFound } from "../lib/errors.mjs";
import { toDocument } from "../lib/mappers.mjs";
import { parse, text } from "../lib/validate.mjs";
import { requireAuth, requireKyc } from "../middleware/auth.mjs";
import { ALLOWED_EXTENSIONS, extensionOf, safeDisplayName, signatureMatches } from "../services/storage.mjs";

const metaSchema = z.object({
  projectId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => v || null),
  category: text(60).default("General"),
});

const SELECT = `SELECT d.*, u.name AS uploader_name, p.name AS project_name, c.company AS client_name
  FROM documents d JOIN users u ON u.id = d.uploaded_by LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN clients c ON c.id = d.client_id`;

export default function documentRoutes({ db, config, storage }) {
  const r = Router();
  r.use(requireAuth, requireKyc(config));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } });
  const get = (req) => {
    const row = db.prepare(`${SELECT} WHERE d.id = ? AND d.organization_id = ?`).get(req.params.id, req.user.organization_id);
    if (!row) throw notFound("Document not found.");
    return row;
  };

  r.get("/", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    const rows = projectId
      ? db.prepare(`${SELECT} WHERE d.organization_id = ? AND d.project_id = ? ORDER BY d.created_at DESC`).all(req.user.organization_id, projectId)
      : db.prepare(`${SELECT} WHERE d.organization_id = ? ORDER BY d.created_at DESC LIMIT 500`).all(req.user.organization_id);
    res.json(rows.map(toDocument));
  });

  r.post("/", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest("Attach a file in the 'file' field.");
    const meta = parse(metaSchema, req.body);
    const name = safeDisplayName(file.originalname);
    const ext = extensionOf(name);
    if (!ALLOWED_EXTENSIONS.has(ext)) throw badRequest(`Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS.keys()].join(", ")}.`);
    if (!signatureMatches(ext, file.buffer)) throw badRequest("File contents do not match its extension.");

    let project = null;
    if (meta.projectId) {
      if (req.user.role === "Individual") throw badRequest("Individual workspaces do not use projects.");
      project = db.prepare("SELECT id, client_id FROM projects WHERE id = ? AND organization_id = ?").get(meta.projectId, req.user.organization_id);
      if (!project) throw notFound("Project not found.");
    }

    const key = await storage.put(req.user.organization_id, file.buffer);
    const id = crypto.randomUUID();
    try {
      db.prepare(
        "INSERT INTO documents(id, organization_id, project_id, client_id, uploaded_by, name, type, category, size_bytes, mime_type, sha256, storage_key, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        req.user.organization_id,
        project?.id ?? null,
        project?.client_id ?? null,
        req.user.id,
        name,
        ext.toUpperCase(),
        meta.category,
        file.size,
        ALLOWED_EXTENSIONS.get(ext),
        crypto.createHash("sha256").update(file.buffer).digest("hex"),
        key,
        "Uploaded",
      );
    } catch (err) {
      await storage.remove(key);
      throw err;
    }
    audit(db, req, "File upload", name, { documentId: id, ...(project ? { projectId: project.id } : {}), size: file.size });
    res.status(201).json(toDocument(db.prepare(`${SELECT} WHERE d.id = ?`).get(id)));
  });

  r.get("/:id/download", (req, res) => {
    const row = get(req);
    audit(db, req, "File download", row.name, { documentId: row.id });
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.attachment(row.name);
    res.sendFile(storage.path(row.storage_key), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "File is no longer available." });
    });
  });

  r.delete("/:id", async (req, res) => {
    const row = get(req);
    if (row.uploaded_by !== req.user.id && req.user.role !== "Professional User")
      throw forbidden("Only the uploader or a Professional User can delete this file.");
    db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
    await storage.remove(row.storage_key);
    audit(db, req, "File delete", row.name, { documentId: row.id, ...(row.project_id ? { projectId: row.project_id } : {}) });
    res.status(204).end();
  });

  return r;
}
