// DART CODE GUIDE | backend/tests/item-discount-priority.test.ts
// الغرض: تثبيت أولوية الخصم لكل قطعة وعدم جمع خصمين واستنفاد Dart Card بالقطعة فقط.
import { describe, expect, it } from "vitest";
import { resolveItemDiscount } from "../src/modules/commerce/commerce.service.js";
import { promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";

describe("item-level discount priority", () => {
  it("keeps the model discount even when a larger campaign is available", () => {
    expect(resolveItemDiscount(10, { type: "Promotion", percent: 20, code: "FIRST100" })).toEqual({
      percent: 10,
      source: "Model",
      reference: "",
      consumesDartCardSlot: false,
    });
  });

  it("uses campaign before birthday or Dart Card for an undiscounted item", () => {
    expect(resolveItemDiscount(0, { type: "Promotion", percent: 20, code: "FIRST100" })).toMatchObject({
      percent: 20,
      source: "Campaign",
      reference: "FIRST100",
    });
    expect(resolveItemDiscount(0, { type: "Birthday", percent: 30, rewardId: "BDAY-1" })).toMatchObject({
      percent: 30,
      source: "Birthday",
    });
  });

  it("applies Dart Card only while a piece slot remains", () => {
    expect(resolveItemDiscount(0, { type: "Dart Card", percent: 40, cardId: "DC-1" }, 1)).toMatchObject({
      percent: 40,
      source: "Dart Card",
      consumesDartCardSlot: true,
    });
    expect(resolveItemDiscount(0, { type: "Dart Card", percent: 40, cardId: "DC-1" }, 0).source).toBe("None");
  });

  it("accepts first-customer campaigns as a strict server contract", () => {
    const parsed = promotionCampaignInputSchema.parse({
      name: "First 100 customers",
      code: "FIRST100",
      status: "Active",
      discountPercent: 10,
      automatic: true,
      totalUsageLimit: 100,
      perCustomerUsageLimit: 1,
      limitBasis: "customers",
      audience: "all",
    });
    expect(parsed.limitBasis).toBe("customers");
    expect(parsed.totalUsageLimit).toBe(100);
  });
});
