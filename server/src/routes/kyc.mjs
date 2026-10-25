import crypto from "node:crypto";
import { Router } from "express";
import { audit } from "../lib/audit.mjs";
import { badRequest, HttpError } from "../lib/errors.mjs";
import { PAN_RE } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";
import { createPkceVerifier, pkceChallenge } from "../services/digilocker.mjs";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

/** Identity verification for Individual users. Disabled unless KYC_MODE is set; `sandbox` uses the local simulator. */
export default function kycRoutes({ db, config, digilocker }) {
  const r = Router();
  const mode = config.kyc.mode;
  const setStatus = (userId, status, extra = {}) =>
    db
      .prepare(
        "UPDATE individual_profiles SET kyc_status = ?, kyc_provider = ?, kyc_verified_at = ?, aadhaar_last4 = COALESCE(?, aadhaar_last4), updated_at = ? WHERE user_id = ?",
      )
      .run(status, mode, status === "VERIFIED" ? new Date().toISOString() : null, extra.aadhaarLast4 ?? null, new Date().toISOString(), userId);

  r.get("/status", requireRole("Individual"), (req, res) => {
    const p = db.prepare("SELECT kyc_status, kyc_verified_at, aadhaar_last4, pan, dob FROM individual_profiles WHERE user_id = ?").get(req.user.id);
    const last = db.prepare("SELECT status, error, created_at FROM kyc_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(req.user.id);
    res.json({
      mode,
      enabled: config.kyc.enabled,
      required: config.kyc.required,
      status: p?.kyc_status || "NOT_STARTED",
      verifiedAt: p?.kyc_verified_at || null,
      aadhaarLast4: p?.kyc_status === "VERIFIED" ? p.aadhaar_last4 : null,
      panMasked: p?.pan ? `${p.pan.slice(0, 2)}XXXX${p.pan.slice(6)}` : null,
      hasDob: Boolean(p?.dob),
      lastFailure: p?.kyc_status === "FAILED" && last?.status === "FAILED" ? { reason: last.error, at: last.created_at } : null,
    });
  });

  r.post("/start", requireRole("Individual"), (req, res) => {
    if (mode === "disabled") throw new HttpError(409, "Identity verification is not enabled.");
    const profile = db.prepare("SELECT * FROM individual_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile?.pan || !PAN_RE.test(profile.pan) || !profile.dob) throw badRequest("Add your PAN and date of birth before verifying.");
    if (db.prepare("SELECT 1 FROM individual_profiles WHERE pan = ? AND kyc_status = 'VERIFIED' AND user_id <> ?").get(profile.pan, req.user.id))
      throw new HttpError(409, "This PAN is already verified on another Finpro account.");
    if (profile.kyc_status === "VERIFIED") return res.json({ status: "VERIFIED" });

    if (mode === "mock") {
      // Development only (blocked in production by config validation).
      setStatus(req.user.id, "VERIFIED", { aadhaarLast4: "0000" });
      audit(db, req, "KYC verified", "mock");
      return res.json({ status: "VERIFIED" });
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = createPkceVerifier();
    db.prepare("DELETE FROM kyc_sessions WHERE user_id = ? AND status = 'PENDING'").run(req.user.id);
    db.prepare("INSERT INTO kyc_sessions(id, user_id, state_hash, code_verifier, provider, expires_at) VALUES (?,?,?,?,?,?)").run(
      crypto.randomUUID(),
      req.user.id,
      sha256(state),
      verifier,
      mode,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    );
    setStatus(req.user.id, "PENDING");
    audit(db, req, "KYC started", mode);
    res.json({ status: "PENDING", authorizationUrl: digilocker.authorizationUrl({ state, codeChallenge: pkceChallenge(verifier) }) });
  });

  // OAuth redirect target. The browser arrives here from DigiLocker; we always redirect back to the SPA.
  r.get("/digilocker/callback", async (req, res) => {
    const back = (result) => res.redirect(303, `${config.appUrl}/verify-identity?kyc=${result}`);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const session = state ? db.prepare("SELECT * FROM kyc_sessions WHERE state_hash = ? AND status = 'PENDING'").get(sha256(state)) : null;
    if (!session || Date.parse(session.expires_at) < Date.now()) return back("expired");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
    const fail = (reason) => {
      db.prepare("UPDATE kyc_sessions SET status = 'FAILED', error = ? WHERE id = ?").run(reason, session.id);
      setStatus(session.user_id, "FAILED");
      audit(db, req, "KYC failed", mode, { reason }, user);
      return back("failed");
    };
    if (req.query.error === "access_denied") return fail("consent_denied");
    if (!code || req.query.error) return fail("provider_error");
    try {
      const token = await digilocker.exchangeCode(code, session.code_verifier);
      const profile = db.prepare("SELECT p.*, u.name FROM individual_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?").get(session.user_id);
      const result = await digilocker.verify(token, { name: profile.name, dob: profile.dob, pan: profile.pan });
      if (!result.verified) return fail(result.reason || "verification_failed");
      // One verified account per PAN.
      const taken = db
        .prepare("SELECT 1 FROM individual_profiles WHERE pan = ? AND kyc_status = 'VERIFIED' AND user_id <> ?")
        .get(profile.pan, session.user_id);
      if (taken) return fail("pan_in_use");
      db.prepare("UPDATE kyc_sessions SET status = 'VERIFIED', code_verifier = '' WHERE id = ?").run(session.id);
      setStatus(session.user_id, "VERIFIED", { aadhaarLast4: result.aadhaarLast4 });
      audit(db, req, "KYC verified", mode, {}, user);
      return back("verified");
    } catch (err) {
      req.log?.warn({ err }, "DigiLocker verification failed");
      return fail("provider_error");
    }
  });

  return r;
}
