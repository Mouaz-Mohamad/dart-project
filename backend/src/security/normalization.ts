export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEgyptianPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (/^01(0|1|2|5)\d{8}$/.test(digits)) return `20${digits.slice(1)}`;
  if (/^201(0|1|2|5)\d{8}$/.test(digits)) return digits;
  throw new Error("INVALID_EGYPTIAN_PHONE");
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}
