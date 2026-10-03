// DART CODE GUIDE | backend/tests/set-pricing.test.ts
// Critical Set pricing invariants: exclusive benefit priority, full-card eligibility and exact piece allocation.
import { describe, expect, it } from "vitest";
import {
  allocateSetPrices,
  applyPercentMinor,
  resolveSetBenefit,
} from "../src/modules/sets/set-pricing.js";

describe("Set pricing policy", () => {
  it("keeps Set discount exclusive and ahead of Birthday and Dart Card", () => {
    expect(resolveSetBenefit({
      setDiscountPercent: 20,
      birthdayEligible: true,
      birthdayPercent: 10,
      dartCardEligible: true,
      dartCardPercent: 10,
      dartCardRemainingPieces: 10,
      setPieceCount: 2,
    })).toEqual({ source: "Set", percent: 20, consumesDartCardPieces: 0 });
  });

  it("uses Birthday before Dart Card when the Set has no discount", () => {
    expect(resolveSetBenefit({
      setDiscountPercent: 0,
      birthdayEligible: true,
      birthdayPercent: 10,
      dartCardEligible: true,
      dartCardPercent: 10,
      dartCardRemainingPieces: 10,
      setPieceCount: 2,
    })).toEqual({ source: "Birthday", percent: 10, consumesDartCardPieces: 0 });
  });

  it("consumes one Dart Card slot per physical piece only when the whole Set fits", () => {
    const eligible = resolveSetBenefit({
      setDiscountPercent: 0,
      birthdayEligible: false,
      birthdayPercent: 10,
      dartCardEligible: true,
      dartCardPercent: 10,
      dartCardRemainingPieces: 3,
      setPieceCount: 3,
    });
    expect(eligible).toEqual({ source: "Dart Card", percent: 10, consumesDartCardPieces: 3 });

    const insufficient = resolveSetBenefit({
      setDiscountPercent: 0,
      birthdayEligible: false,
      birthdayPercent: 10,
      dartCardEligible: true,
      dartCardPercent: 10,
      dartCardRemainingPieces: 2,
      setPieceCount: 3,
    });
    expect(insufficient).toEqual({ source: "None", percent: 0, consumesDartCardPieces: 0 });
  });

  it("applies percentage money math in integer minor units", () => {
    expect(applyPercentMinor(140_000, 20)).toBe(112_000);
    expect(applyPercentMinor(129_900, 10)).toBe(116_910);
  });

  it("allocates the paid Set price proportionally and preserves every piastre", () => {
    const rows = allocateSetPrices([
      { modelSellingMinor: 80_000 },
      { modelSellingMinor: 70_000 },
    ], 140_000, 112_000);

    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.baseAllocatedMinor, 0)).toBe(140_000);
    expect(rows.reduce((sum, row) => sum + row.finalAllocatedMinor, 0)).toBe(112_000);
    expect(rows[0]!.finalAllocatedMinor).toBeGreaterThan(rows[1]!.finalAllocatedMinor);
  });

  it("expands component quantity into physical-piece allocations", () => {
    const rows = allocateSetPrices([
      { modelSellingMinor: 50_000, quantity: 2 },
      { modelSellingMinor: 30_000, quantity: 1 },
    ], 120_001, 108_001);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row.componentIndex, row.unitIndex])).toEqual([[0, 1], [0, 2], [1, 1]]);
    expect(rows.reduce((sum, row) => sum + row.finalAllocatedMinor, 0)).toBe(108_001);
  });
});
