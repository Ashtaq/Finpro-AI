import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.mjs";
import { notFound } from "../lib/errors.mjs";
import { toClient } from "../lib/mappers.mjs";
import { email, gstin, pan, parse, phone, requiredText, text } from "../lib/validate.mjs";
import { requireRole } from "../middleware/auth.mjs";

const optEmail = () => z.union([z.literal(""), email()]).default("");
const fields = {
  name: text(120).default(""),
  company: requiredText(160),
  industry: text(60).default("Other"),
  email: optEmail(),
  phone: phone().default(""),
  alternatePhone: phone().default(""),
  clientType: z.enum(["Individual", "Business", "Company", "LLP", "Trust", "Other"]).default("Business"),
  legalName: text(200).default(""),
  contactPerson: text(120).default(""),
  pan: pan().default(""),
  gstin: gstin().default(""),
  cin: text(30).default(""),
  address: text(500).default(""),
  city: text(80).default(""),
  state: text(80).default(""),
  country: text(80).default("India"),
  pinCode: text(12).default(""),
  professionActivity: text(200).default(""),
  gstRegistrationType: text(40).default(""),
  taxRegime: text(40).default(""),
  priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
  communicationPreference: text(40).default("Email"),
  notes: text(4000).default(""),
  fy: text(20).default(""),
  status: z.enum(["Active", "Prospect", "Onboarding", "Inactive", "Archived"]).default("Onboarding"),
  team: text(120).default(""),
};
const createSchema = z.object(fields);
const updateSchema = z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]))).strict();

const COLUMNS = {
  name: "name",
  company: "company",
  industry: "industry",
  email: "email",
  phone: "phone",
  alternatePhone: "alternate_phone",
  clientType: "client_type",
  legalName: "legal_name",
  contactPerson: "contact_person",
  pan: "pan",
  gstin: "gstin",
  cin: "cin",
  address: "address",
  city: "city",
  state: "state",
  country: "country",
  pinCode: "pin_code",
  professionActivity: "profession_activity",
  gstRegistrationType: "gst_registration_type",
  taxRegime: "tax_regime",
  priority: "priority",
  communicationPreference: "communication_preference",
  notes: "notes",
  fy: "fy",
  status: "status",
  team: "team",
};

const SELECT = `SELECT c.*,
  (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
  (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id) AS document_count
  FROM clients c`;

export default function clientRoutes({ db }) {
  const r = Router();
  r.use(requireRole("Professional User"));
  const get = (req, id) => {
    const row = db.prepare(`${SELECT} WHERE c.id = ? AND c.organization_id = ?`).get(id, req.user.organization_id);
    if (!row) throw notFound("Client not found.");
    return row;
  };

  r.get("/", (req, res) => {
    res.json(db.prepare(`${SELECT} WHERE c.organization_id = ? ORDER BY c.created_at DESC`).all(req.user.organization_id).map(toClient));
  });

  r.get("/:id", (req, res) => res.json(toClient(get(req, req.params.id))));

  r.post("/", (req, res) => {
    const b = parse(createSchema, req.body);
    if (!b.contactPerson) b.contactPerson = b.name;
    const id = crypto.randomUUID();
    const keys = Object.keys(COLUMNS);
    db.prepare(`INSERT INTO clients(id, organization_id, ${keys.map((k) => COLUMNS[k]).join(", ")}) VALUES (?, ?, ${keys.map(() => "?").join(", ")})`).run(
      id,
      req.user.organization_id,
      ...keys.map((k) => b[k]),
    );
    audit(db, req, "Create client", b.company);
    res.status(201).json(toClient(get(req, id)));
  });

  r.patch("/:id", (req, res) => {
    const row = get(req, req.params.id);
    const b = parse(updateSchema, req.body);
    const keys = Object.keys(b);
    if (keys.length) {
      db.prepare(`UPDATE clients SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
        ...keys.map((k) => b[k]),
        new Date().toISOString(),
        row.id,
      );
      audit(db, req, "Update client", row.company, { fields: keys });
    }
    res.json(toClient(get(req, row.id)));
  });

  r.delete("/:id", (req, res) => {
    const row = get(req, req.params.id);
    // Archive rather than hard-delete: clients are referenced by projects, documents and audit history.
    db.prepare("UPDATE clients SET status = 'Archived', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    audit(db, req, "Archive client", row.company);
    res.status(204).end();
  });

  return r;
}
