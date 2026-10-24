import multer from "multer";
import { HttpError } from "../lib/errors.mjs";

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: "Not found." });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Invalid upload.";
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body." });
  if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "This record already exists." });
  // http-errors style client errors from middleware (e.g. serve-static 404s)
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: status === 404 ? "Not found." : "Bad request." });

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Something went wrong. Please try again.", requestId: req.id });
}
