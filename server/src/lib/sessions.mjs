import crypto from "node:crypto";

export const SESSION_COOKIE = "finpro_sid";
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

export function createSession(db, config, req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlMs);
  db.prepare("INSERT INTO sessions(id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)").run(
    sha256(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
    req.ip || null,
    String(req.get("user-agent") || "").slice(0, 300),
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions(config, config.sessionTtlMs));
}

export function cookieOptions(config, maxAge) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge };
}

/** Resolve the user for a raw session token, sliding the expiry window. Returns null when invalid. */
export function resolveSession(db, config, token) {
  if (!token || typeof token !== "string" || token.length > 128) return null;
  const id = sha256(token);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*, o.name AS organization_name, o.kind AS organization_kind
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.organization_id
       WHERE s.id = ?`,
    )
    .get(id);
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now || !row.active) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  // Touch at most once a minute to avoid a write on every request.
  if (now - Date.parse(row.last_seen_at) > 60_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
      new Date(now).toISOString(),
      new Date(now + config.sessionTtlMs).toISOString(),
      id,
    );
  }
  return row;
}

export function destroySession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function destroyUserSessions(db, userId, exceptToken) {
  if (exceptToken) db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(userId, sha256(exceptToken));
  else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions(db) {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString()).changes;
}
