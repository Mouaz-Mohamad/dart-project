export function isDartCardEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.dartCardEnabled === true;
}
// Legacy card dates have day precision; rounding up preserves the whole paused duration.
export function extendedDartCardExpiry(value: unknown, days: number): string | null {
  const raw = String(value || "").trim();
  if (!Number.isSafeInteger(days) || days <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw+"T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==raw) return null;
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
