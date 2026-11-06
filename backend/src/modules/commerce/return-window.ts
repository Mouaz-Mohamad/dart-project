// DART | Per-order return/exchange eligibility snapshot.
export type ReturnRequestType = "Exchange" | "Refund";
export const DEFAULT_RETURN_PERIOD_DAYS = 14;
const DAY_MS = 86_400_000;
export function resolveReturnPeriodDays(policy: Record<string, unknown> | null | undefined, requestType: ReturnRequestType): number {
  const value = policy?.[requestType === "Exchange" ? "exchangePeriodDays" : "refundPeriodDays"];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_RETURN_PERIOD_DAYS;
}
export function snapshotReturnPeriods(settings: Record<string, unknown> | null | undefined) {
  return { exchangePeriodDays: resolveReturnPeriodDays(settings, "Exchange"), refundPeriodDays: resolveReturnPeriodDays(settings, "Refund") };
}
// A zero-day window intentionally disables new requests.
export function isReturnPeriodOpen(deliveredAt: Date, now: number, days: number): boolean {
  const time = deliveredAt.getTime();
  return Number.isFinite(time) && Number.isFinite(now) && Number.isSafeInteger(days)
    && days > 0 && now >= time && (now - time) / DAY_MS <= days;
}
