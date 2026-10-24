import crypto from "node:crypto";

/** Append an audit event for the actor's organization. Never store secrets in metadata. */
export function audit(db, req, action, resource, metadata = {}, actor = req.user) {
  if (!actor) return;
  db.prepare("INSERT INTO audit_logs(id, organization_id, actor_id, actor_name, action, resource, ip, metadata_json) VALUES (?,?,?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    actor.organization_id,
    actor.id,
    actor.name,
    action,
    String(resource).slice(0, 300),
    req.ip || null,
    JSON.stringify(metadata),
  );
}
