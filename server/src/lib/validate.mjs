import { z } from "zod";
import { badRequest } from "./errors.mjs";

/** Parse `input` with a zod schema or throw a 400 with field-level details. */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    const first = details[0];
    throw badRequest(first?.field ? `${first.field}: ${first.message}` : first?.message || "Invalid request.", details);
  }
  return result.data;
}

export const text = (max = 200) => z.string().trim().max(max);
export const requiredText = (max = 200) => z.string().trim().min(1, "is required").max(max);
export const email = () => z.string().trim().toLowerCase().max(254).pipe(z.email("must be a valid email"));
export const password = () => z.string().min(10, "must be at least 10 characters").max(128, "must be at most 128 characters");
export const phone = () =>
  z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^\+?[0-9 ()-]{7,20}$/.test(v), "must be a valid phone number");
export const isoDate = () =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "must be a date (YYYY-MM-DD)");
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const pan = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || PAN_RE.test(v), "must be a valid PAN (e.g. ABCDE1234F)");
export const gstin = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(v), "must be a valid GSTIN");
export const id = () => z.string().trim().min(1).max(64);

export const ROLES = ["Individual", "Finance User", "Professional User"];
export const WORKSPACE_ROLES = ["Finance User", "Professional User"];
export const PROFESSIONAL_ROLES = [
  "CA",
  "CS",
  "CFA",
  "Financial Analyst",
  "Accountant",
  "Auditor",
  "Finance Manager",
  "Investment Analyst",
  "Consultant",
  "Other",
];
