// DART CODE GUIDE | backend/src/security/normalization.ts
// الغرض: وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEgyptianPhone(value: string): string {
  const digits = value.replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) - (char >= "۰" ? 1776 : 1632))).replace(/\D/g, "").replace(/^0020/, "20");
  if (/^01(0|1|2|5)\d{8}$/.test(digits)) return `20${digits.slice(1)}`;
  if (/^201(0|1|2|5)\d{8}$/.test(digits)) return digits;
  throw new Error("INVALID_EGYPTIAN_PHONE");
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}
