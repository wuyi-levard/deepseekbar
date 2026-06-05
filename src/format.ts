import Decimal from "decimal.js-light";

export function toDecimal(s: string | number | null | undefined): Decimal {
  if (s === null || s === undefined || s === "") return new Decimal(0);
  try {
    return new Decimal(s);
  } catch {
    return new Decimal(0);
  }
}

export function formatBalance(s: string | number | null | undefined): string {
  const d = toDecimal(s);
  return d.toFixed(2);
}

export function formatDelta(prev: string | null, curr: string): string {
  if (!prev) return "";
  const p = toDecimal(prev);
  const c = toDecimal(curr);
  const diff = c.minus(p);
  if (diff.isZero()) return "±0.00";
  const sign = diff.isPositive() ? "⌃" : "⌄";
  return `${sign}${diff.abs().toFixed(2)}`;
}
