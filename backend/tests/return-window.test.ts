import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PERIOD_DAYS, isReturnPeriodOpen, resolveReturnPeriodDays, snapshotReturnPeriods } from "../src/modules/commerce/return-window.js";
describe("independent order-snapshotted return windows", () => {
  const delivered = new Date("2026-11-01T12:00:00.000Z");
  it("retains 14 days for pre-change orders", () => {
    expect(resolveReturnPeriodDays(null, "Exchange")).toBe(DEFAULT_RETURN_PERIOD_DAYS);
    expect(resolveReturnPeriodDays({}, "Refund")).toBe(14);
  });
  it("supports independently configured durations without legal caps or floors", () => {
    const policy = snapshotReturnPeriods({ exchangePeriodDays: 2, refundPeriodDays: 3651 });
    expect(policy).toEqual({ exchangePeriodDays: 2, refundPeriodDays: 3651 });
  });
  it("zero disables only the selected request type", () => {
    const policy = snapshotReturnPeriods({ exchangePeriodDays: 0, refundPeriodDays: 7 });
    expect(isReturnPeriodOpen(delivered, delivered.getTime(), policy.exchangePeriodDays)).toBe(false);
    expect(isReturnPeriodOpen(delivered, delivered.getTime() + 86_400_000, policy.refundPeriodDays)).toBe(true);
  });
  it("allows the exact deadline but rejects one millisecond afterward", () => {
    expect(isReturnPeriodOpen(delivered, delivered.getTime() + 172800000, 2)).toBe(true);
    expect(isReturnPeriodOpen(delivered, delivered.getTime() + 172800001, 2)).toBe(false);
  });
  it("does not accept malformed durations", () => {
    expect(resolveReturnPeriodDays({ refundPeriodDays: "50" }, "Refund")).toBe(14);
    expect(resolveReturnPeriodDays({ exchangePeriodDays: -1 }, "Exchange")).toBe(14);
    expect(isReturnPeriodOpen(new Date("invalid"), Date.now(), 14)).toBe(false);
  });
});
