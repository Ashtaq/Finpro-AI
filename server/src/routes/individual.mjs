import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.mjs";
import { toAsset, toItr } from "../lib/mappers.mjs";
import { isoDate, pan, parse, requiredText, text } from "../lib/validate.mjs";
import { requireKyc, requireRole } from "../middleware/auth.mjs";
import { ITR_TYPES, payloadSchema, validAssessmentYear, validateItr } from "../services/itr.mjs";

const profileSchema = z
  .object({
    pan: pan().optional(),
    dob: isoDate().optional(),
    residentialStatus: z.enum(["", "Resident", "Non-resident", "RNOR"]).optional(),
    address: text(500).optional(),
  })
  .strict();
const ASSET_CATEGORIES = ["Bank", "Investments", "Property", "Vehicle", "Gold", "Retirement", "Liability", "Other"];
const assetSchema = z.object({
  name: requiredText(120),
  category: z.enum(ASSET_CATEGORIES).default("Other"),
  value: z.coerce.number().min(0).max(1e12),
  institution: text(120).default(""),
  asOf: isoDate().optional(),
});
const createItrSchema = z.object({
  assessmentYear: z.string().trim().refine(validAssessmentYear, "must look like 2026-27"),
  itrType: z.enum(ITR_TYPES).default("ITR-1"),
});
const updateItrSchema = z.object({ itrType: z.enum(ITR_TYPES).optional(), payload: payloadSchema.optional() }).strict();

const toProfile = (p) => ({
  pan: p?.pan || "",
  dob: p?.dob || "",
  residentialStatus: p?.residential_status || "",
  address: p?.address || "",
  kycStatus: p?.kyc_status || "NOT_STARTED",
  kycProvider: p?.kyc_provider || undefined,
  kycVerifiedAt: p?.kyc_verified_at || undefined,
  aadhaarLast4: p?.aadhaar_last4 || undefined,
});

/** Personal tax workspace — Individual users only, always scoped to req.user.id. */
export default function individualRoutes({ db, config }) {
  const r = Router();
  r.use(requireRole("Individual"));
  const kyc = requireKyc(config);
  r.use(["/assets", "/itr"], kyc);
  const uid = (req) => req.user.id;
  const event = (itrId, type, status, metadata = {}) =>
    db
      .prepare("INSERT INTO itr_filing_events(id, itr_return_id, event_type, status, metadata_json) VALUES (?,?,?,?,?)")
      .run(crypto.randomUUID(), itrId, type, status, JSON.stringify(metadata));
  const getReturn = (req) => {
    const row = db.prepare("SELECT * FROM itr_returns WHERE id = ? AND user_id = ?").get(req.params.id, uid(req));
    if (!row) throw notFound("Return not found.");
    return row;
  };

  // Profile -----------------------------------------------------------------
  r.get("/profile", (req, res) => res.json(toProfile(db.prepare("SELECT * FROM individual_profiles WHERE user_id = ?").get(uid(req)))));
  r.patch("/profile", (req, res) => {
    const b = parse(profileSchema, req.body);
    const current = db.prepare("SELECT * FROM individual_profiles WHERE user_id = ?").get(uid(req));
    if (current?.kyc_status === "VERIFIED" && b.pan !== undefined && b.pan !== current.pan) throw conflict("PAN is locked after identity verification.");
    if (current?.kyc_status === "VERIFIED" && b.dob !== undefined && b.dob !== current.dob)
      throw conflict("Date of birth is locked after identity verification.");
    db.prepare(
      `INSERT INTO individual_profiles(user_id, pan, dob, residential_status, address, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET pan = COALESCE(excluded.pan, pan), dob = COALESCE(excluded.dob, dob),
         residential_status = COALESCE(excluded.residential_status, residential_status), address = COALESCE(excluded.address, address), updated_at = excluded.updated_at`,
    ).run(uid(req), b.pan ?? null, b.dob ?? null, b.residentialStatus ?? null, b.address ?? null, new Date().toISOString());
    audit(db, req, "Update profile", "Individual profile", { fields: Object.keys(b) });
    res.json(toProfile(db.prepare("SELECT * FROM individual_profiles WHERE user_id = ?").get(uid(req))));
  });

  // Summary for the dashboard -------------------------------------------------
  r.get("/summary", (req, res) => {
    const assets = db.prepare("SELECT category, SUM(value) AS total, COUNT(*) AS n FROM assets WHERE user_id = ? GROUP BY category").all(uid(req));
    const latest = db.prepare("SELECT * FROM itr_returns WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").get(uid(req));
    const documents = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = ?").get(req.user.organization_id).c;
    const liabilities = assets.filter((a) => a.category === "Liability").reduce((s, a) => s + a.total, 0);
    const gross = assets.filter((a) => a.category !== "Liability").reduce((s, a) => s + a.total, 0);
    res.json({
      assets: { total: gross, liabilities, netWorth: gross - liabilities, count: assets.reduce((s, a) => s + a.n, 0), byCategory: assets },
      documents,
      profile: toProfile(db.prepare("SELECT * FROM individual_profiles WHERE user_id = ?").get(uid(req))),
      latestReturn: latest ? toItr(latest) : null,
    });
  });

  // Assets --------------------------------------------------------------------
  r.get("/assets", (req, res) => res.json(db.prepare("SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC").all(uid(req)).map(toAsset)));
  r.post("/assets", (req, res) => {
    const b = parse(assetSchema, req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO assets(id, user_id, name, category, value, institution, as_of) VALUES (?,?,?,?,?,?,?)").run(
      id,
      uid(req),
      b.name,
      b.category,
      b.value,
      b.institution,
      b.asOf || new Date().toISOString().slice(0, 10),
    );
    audit(db, req, "Create asset", b.name);
    res.status(201).json(toAsset(db.prepare("SELECT * FROM assets WHERE id = ?").get(id)));
  });
  r.patch("/assets/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM assets WHERE id = ? AND user_id = ?").get(req.params.id, uid(req));
    if (!row) throw notFound("Asset not found.");
    const b = parse(assetSchema.partial().strict(), req.body);
    db.prepare(
      "UPDATE assets SET name = COALESCE(?, name), category = COALESCE(?, category), value = COALESCE(?, value), institution = COALESCE(?, institution), as_of = COALESCE(?, as_of) WHERE id = ?",
    ).run(b.name ?? null, b.category ?? null, b.value ?? null, b.institution ?? null, b.asOf || null, row.id);
    audit(db, req, "Update asset", row.name);
    res.json(toAsset(db.prepare("SELECT * FROM assets WHERE id = ?").get(row.id)));
  });
  r.delete("/assets/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM assets WHERE id = ? AND user_id = ?").get(req.params.id, uid(req));
    if (!row) throw notFound("Asset not found.");
    db.prepare("DELETE FROM assets WHERE id = ?").run(row.id);
    audit(db, req, "Delete asset", row.name);
    res.status(204).end();
  });

  // ITR drafts ---------------------------------------------------------------
  r.get("/itr", (req, res) => res.json(db.prepare("SELECT * FROM itr_returns WHERE user_id = ? ORDER BY updated_at DESC").all(uid(req)).map(toItr)));
  r.get("/itr/:id", (req, res) => {
    const row = getReturn(req);
    const events = db
      .prepare("SELECT event_type, status, metadata_json, created_at FROM itr_filing_events WHERE itr_return_id = ? ORDER BY created_at DESC")
      .all(row.id)
      .map((e) => ({ type: e.event_type, status: e.status, metadata: JSON.parse(e.metadata_json), createdAt: e.created_at }));
    const consent = db
      .prepare("SELECT status, granted_at FROM consents WHERE itr_return_id = ? AND status = 'Granted' ORDER BY created_at DESC LIMIT 1")
      .get(row.id);
    res.json({ ...toItr(row), events, consent: consent ? { status: consent.status, grantedAt: consent.granted_at } : null });
  });

  r.post("/itr", (req, res) => {
    const b = parse(createItrSchema, req.body);
    if (
      db.prepare("SELECT 1 FROM itr_returns WHERE user_id = ? AND assessment_year = ? AND status IN ('DRAFT','READY_TO_FILE')").get(uid(req), b.assessmentYear)
    )
      throw conflict(`You already have an open draft for AY ${b.assessmentYear}.`);
    const profile = db.prepare("SELECT pan, residential_status FROM individual_profiles WHERE user_id = ?").get(uid(req));
    const payload = payloadSchema.parse({ profile: { pan: profile?.pan || "", residentialStatus: profile?.residential_status || "" } });
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO itr_returns(id, user_id, assessment_year, itr_type, payload_json) VALUES (?,?,?,?,?)").run(
      id,
      uid(req),
      b.assessmentYear,
      b.itrType,
      JSON.stringify(payload),
    );
    event(id, "CREATED", "DRAFT");
    audit(db, req, "Create ITR draft", `AY ${b.assessmentYear}`, { itrId: id });
    res.status(201).json(toItr(db.prepare("SELECT * FROM itr_returns WHERE id = ?").get(id)));
  });

  r.patch("/itr/:id", (req, res) => {
    const row = getReturn(req);
    if (!["DRAFT", "READY_TO_FILE"].includes(row.status)) throw conflict("A submitted return cannot be edited.");
    const b = parse(updateItrSchema, req.body);
    // Any edit invalidates a previous validation and consent.
    db.prepare(
      "UPDATE itr_returns SET itr_type = COALESCE(?, itr_type), payload_json = COALESCE(?, payload_json), status = 'DRAFT', validation_json = '{}', updated_at = ? WHERE id = ?",
    ).run(b.itrType ?? null, b.payload ? JSON.stringify(b.payload) : null, new Date().toISOString(), row.id);
    if (row.status === "READY_TO_FILE") {
      db.prepare("UPDATE consents SET status = 'Revoked', revoked_at = ? WHERE itr_return_id = ? AND status = 'Granted'").run(new Date().toISOString(), row.id);
      event(row.id, "EDITED_AFTER_VALIDATION", "DRAFT");
    }
    res.json(toItr(db.prepare("SELECT * FROM itr_returns WHERE id = ?").get(row.id)));
  });

  r.post("/itr/:id/validate", (req, res) => {
    const row = getReturn(req);
    if (!["DRAFT", "READY_TO_FILE"].includes(row.status)) throw conflict("This return is already submitted.");
    const result = validateItr({ itrType: row.itr_type, assessmentYear: row.assessment_year, payload: JSON.parse(row.payload_json) });
    db.prepare("UPDATE itr_returns SET validation_json = ?, status = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(result),
      result.passed ? "READY_TO_FILE" : "DRAFT",
      new Date().toISOString(),
      row.id,
    );
    event(row.id, "LOCAL_VALIDATION", result.passed ? "PASSED" : "FAILED", { errors: result.errors.length, warnings: result.warnings.length });
    audit(db, req, "Validate ITR draft", `AY ${row.assessment_year}`, { itrId: row.id, passed: result.passed });
    res.json(result);
  });

  r.post("/itr/:id/consent", (req, res) => {
    const row = getReturn(req);
    if (row.status !== "READY_TO_FILE") throw badRequest("Validate the return before recording consent.");
    const parsed = parse(z.object({ confirm: z.literal(true, { message: "must be confirmed" }) }), req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO consents(id, user_id, itr_return_id, purpose, status, granted_at) VALUES (?,?,?,?,?,?)").run(
      id,
      uid(req),
      row.id,
      "ITR prefill and filing via approved intermediary",
      "Granted",
      new Date().toISOString(),
    );
    event(row.id, "CONSENT", "GRANTED", { consentId: id, confirmed: parsed.confirm });
    audit(db, req, "Grant ITR consent", `AY ${row.assessment_year}`, { itrId: row.id });
    res.status(201).json({ consentId: id, status: "Granted" });
  });

  r.post("/itr/:id/submit", (req, _res) => {
    const row = getReturn(req);
    if (row.status !== "READY_TO_FILE") throw badRequest("The return must pass validation before submission.");
    if (!db.prepare("SELECT 1 FROM consents WHERE itr_return_id = ? AND status = 'Granted'").get(row.id))
      throw badRequest("Record taxpayer consent before submission.");
    if (config.itr.provider === "none") {
      event(row.id, "SUBMISSION_BLOCKED", "PROVIDER_NOT_CONFIGURED");
      throw new HttpError(409, "Electronic filing is not enabled. An approved ERI integration must be configured before returns can be submitted.");
    }
    throw new HttpError(501, "Filing provider not implemented.");
  });

  r.delete("/itr/:id", (req, res) => {
    const row = getReturn(req);
    if (!["DRAFT", "READY_TO_FILE"].includes(row.status)) throw conflict("Submitted returns cannot be deleted.");
    db.prepare("DELETE FROM itr_returns WHERE id = ?").run(row.id);
    audit(db, req, "Delete ITR draft", `AY ${row.assessment_year}`, { itrId: row.id });
    res.status(204).end();
  });

  return r;
}
