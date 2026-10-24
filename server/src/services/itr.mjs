import { z } from "zod";
import { PAN_RE } from "../lib/validate.mjs";

// Deterministic, reviewable ITR draft checks. This module intentionally does NOT compute
// tax liability — that must come from a versioned, professionally reviewed rules engine.

const amount = z.coerce.number().min(0, "cannot be negative").max(1e12).default(0);

export const ITR_TYPES = ["ITR-1", "ITR-2", "ITR-3", "ITR-4"];
export const AY_RE = /^(\d{4})-(\d{2})$/;

export const payloadSchema = z
  .object({
    regime: z.enum(["new", "old"]).default("new"),
    profile: z
      .object({
        pan: z.string().trim().toUpperCase().max(10).default(""),
        residentialStatus: z.enum(["", "Resident", "Non-resident", "RNOR"]).default(""),
        taxpayerType: z.enum(["Individual", "Individual with business/profession"]).default("Individual"),
      })
      .default({}),
    income: z
      .object({
        salary: amount,
        houseProperty: z.coerce.number().min(-1e12).max(1e12).default(0), // may be a loss
        interest: amount,
        dividends: amount,
        capitalGainsShortTerm: amount,
        capitalGainsLongTerm: amount,
        business: amount,
        other: amount,
      })
      .default({}),
    deductions: z.object({ sec80C: amount, sec80D: amount, sec80CCD1B: amount, sec80TTA: amount, other: amount }).default({}),
    taxesPaid: z.object({ tds: amount, tcs: amount, advanceTax: amount, selfAssessmentTax: amount }).default({}),
  })
  .strict();

export function validAssessmentYear(ay) {
  const m = AY_RE.exec(ay);
  return Boolean(m) && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

const sum = (o) => Object.values(o).reduce((s, v) => s + Number(v || 0), 0);

export function validateItr({ itrType, assessmentYear, payload }) {
  const p = payloadSchema.parse(payload ?? {});
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ field, message });
  const warn = (field, message) => warnings.push({ field, message });

  if (!validAssessmentYear(assessmentYear)) err("assessmentYear", "Assessment year must look like 2026-27.");
  if (!p.profile.pan) err("profile.pan", "PAN is required.");
  else if (!PAN_RE.test(p.profile.pan)) err("profile.pan", "PAN format is invalid (expected ABCDE1234F).");
  else if (p.profile.pan[3] !== "P")
    warn("profile.pan", "The 4th character of an individual's PAN is normally 'P'. Confirm this PAN belongs to an individual.");
  if (!p.profile.residentialStatus) err("profile.residentialStatus", "Residential status is required.");

  const gross = sum(p.income);
  const deductions = sum(p.deductions);
  const taxesPaid = sum(p.taxesPaid);
  if (gross <= 0) err("income", "Enter at least one income figure.");
  if (deductions > Math.max(gross, 0)) err("deductions", "Deductions claimed exceed gross total income.");

  if (itrType === "ITR-1") {
    if (p.profile.residentialStatus && p.profile.residentialStatus !== "Resident") err("itrType", "ITR-1 is only for resident individuals. Choose ITR-2.");
    if (p.profile.taxpayerType !== "Individual" || p.income.business > 0)
      err("itrType", "Business or professional income cannot be reported in ITR-1. Choose ITR-3 or ITR-4.");
    if (p.income.capitalGainsShortTerm > 0 || p.income.capitalGainsLongTerm > 0)
      warn("itrType", "Capital gains may make you ineligible for ITR-1. Check eligibility for this assessment year; ITR-2 is usually required.");
  }
  if (p.income.business > 0 && (itrType === "ITR-1" || itrType === "ITR-2")) err("income.business", `${itrType} cannot include business income.`);

  if (p.regime === "new" && p.deductions.sec80C + p.deductions.sec80D + p.deductions.sec80CCD1B + p.deductions.sec80TTA > 0)
    warn("deductions", "Most Chapter VI-A deductions (80C, 80D, 80CCD(1B), 80TTA) are not available under the new tax regime. Confirm before claiming.");
  if (p.deductions.sec80C > 150000) warn("deductions.sec80C", "Section 80C claim exceeds the ₹1,50,000 limit.");
  if (p.income.salary > 0 && p.taxesPaid.tds === 0) warn("taxesPaid.tds", "Salary income with no TDS — check Form 16 / Form 26AS.");

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    totals: { grossTotalIncome: gross, deductionsClaimed: deductions, taxesPaid },
    checkedAt: new Date().toISOString(),
    note: "Local pre-checks only. Tax liability is not computed here, and final schema validation happens with the approved filing integration.",
  };
}
