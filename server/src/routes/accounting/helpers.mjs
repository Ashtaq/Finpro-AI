// Small helpers shared by the accounting sub-routers.
import { requireCap } from "../../accounting/access.mjs";

export const page = (q, max = 200) => {
  const size = Math.min(max, Math.max(1, Number(q.pageSize) || 50));
  const p = Math.max(1, Number(q.page) || 1);
  return { limit: size, offset: (p - 1) * size, page: p, pageSize: size };
};
export const str = (v) => (typeof v === "string" && v !== "" ? v : undefined);
export const W = requireCap("write");
export const A = requireCap("approve");
export const ADMIN = requireCap("admin");

/**
 * Update schema for PATCH: every field optional and *without* its create-time default (zod applies
 * defaults even to optional fields, which would silently reset omitted columns).
 */
export const patchSchema = (z, fields) =>
  z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.unwrap() : v).optional()]))).strict();
