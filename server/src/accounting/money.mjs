// Exact money arithmetic. Amounts are integer paise (1 INR = 100 paise); quantities are integer
// thousandths; rates/percentages are integer basis points (1% = 100 bp). No floating point is used
// for any accounting value: parsing works on the decimal string, and multiplications that could exceed
// 2^53 go through BigInt with explicit half-away-from-zero rounding.

import { z } from "zod";

export const MAX_PAISE = 1e15; // ₹10 lakh crore — far above any single voucher, well inside 2^53

/** Parse a decimal string/number with up to `scale` fraction digits into a scaled integer. Returns null when invalid. */
export function parseScaled(input, scale) {
  if (input === null || input === undefined || input === "") return null;
  let s;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Numbers arrive from JSON; their shortest round-trip representation is what the user typed.
    s = String(input);
    if (/e/i.test(s)) return null;
  } else if (typeof input === "string") s = input.trim().replace(/,/g, "");
  else return null;
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  if (frac.length > scale) return null;
  const digits = whole + frac.padEnd(scale, "0");
  const value = Number(BigInt(digits));
  if (!Number.isSafeInteger(value)) return null;
  return sign === "-" ? -value : value;
}

export const toPaise = (input) => parseScaled(input, 2);
export const toMilli = (input) => parseScaled(input, 3);
export const toBp = (input) => parseScaled(input, 2); // "18" -> 1800, "0.25" -> 25

/** Format scaled integer as a plain decimal string ("-1234.50"). */
export function formatScaled(value, scale) {
  const n = Number(value) || 0;
  const neg = n < 0;
  const s = String(Math.abs(n)).padStart(scale + 1, "0");
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return neg ? `-${out}` : out;
}
export const fromPaise = (p) => formatScaled(p, 2);
export const fromMilli = (q) => formatScaled(q, 3);
export const fromBp = (bp) => {
  const s = formatScaled(bp, 2);
  return s.replace(/\.?0+$/, "") || "0";
};

/** round(a * b / c) with half-away-from-zero rounding, exact via BigInt. */
export function mulDiv(a, b, c) {
  if (c === 0) throw new Error("division by zero");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const neg = num < 0n !== den < 0n && num !== 0n;
  const an = num < 0n ? -num : num;
  const ad = den < 0n ? -den : den;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  const v = Number(q);
  return neg ? -v : v;
}

/** Percentage of an amount: paise * bp / 10000, rounded to the paisa. */
export const percentOf = (paise, bp) => mulDiv(paise, bp, 10000);
/** Value of a quantity at a rate: qtyMilli * ratePaise / 1000. */
export const valueOf = (qtyMilli, ratePaise) => mulDiv(qtyMilli, ratePaise, 1000);
/** Rate per unit for a value and quantity. */
export const rateOf = (valuePaise, qtyMilli) => (qtyMilli ? mulDiv(valuePaise, 1000, qtyMilli) : 0);
/** Convert foreign minor units to INR paise: minor * rateMicros / 1e6. */
export const fxToBase = (minor, rateMicros) => mulDiv(minor, rateMicros, 1_000_000);

/** Round to the nearest rupee (GST/TDS deposits, invoice round-off). Returns paise. */
export const roundToRupee = (paise) => mulDiv(paise, 1, 100) * 100;

export const sum = (values) => values.reduce((a, b) => a + (b || 0), 0);

// zod helpers -------------------------------------------------------------------------------------

const scaled = (scale, label, { min = -MAX_PAISE, max = MAX_PAISE } = {}) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = parseScaled(v, scale);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: `must be a ${label} with at most ${scale} decimal places` });
      return z.NEVER;
    }
    if (n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `is out of range` });
      return z.NEVER;
    }
    return n;
  });

/** Money in rupees ("1234.56" or 1234.56) -> integer paise. */
export const money = (opts) => scaled(2, "amount", opts);
export const nonNegMoney = () => scaled(2, "amount", { min: 0 });
export const positiveMoney = () => scaled(2, "amount", { min: 1 });
/** Quantity -> integer thousandths. */
export const quantity = (opts = { min: 0 }) => scaled(3, "quantity", opts);
/** Percentage ("18", "0.75") -> integer basis points. */
export const percent = () => scaled(2, "percentage", { min: 0, max: 10000 });
