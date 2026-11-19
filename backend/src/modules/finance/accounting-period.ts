// Dart's first official operating day. Earlier records are retained as test history.
// A date (not a UTC timestamp) makes the boundary midnight in Africa/Cairo.
export const OFFICIAL_ACCOUNTING_START = "2026-11-18";
export const OFFICIAL_ACCOUNTING_ZONE = "Africa/Cairo";

// Financial reports only include transactions created on/after the launch day.
// Inventory balances are a separate point-in-time measure, not a period expense.
export function officialCreatedAt(value: unknown): boolean {
  if (!value) return false;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw >= OFFICIAL_ACCOUNTING_START;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICIAL_ACCOUNTING_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}` >= OFFICIAL_ACCOUNTING_START;
}
