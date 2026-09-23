// DART CODE GUIDE | backend/tests/rewards-promotions-settings.contract.test.ts
// الغرض: Regression contracts للقواعد الجديدة التي لا يجب أن تعود للاعتماد على المتصفح أو validation مرن.
import { describe, expect, it } from "vitest";
import { validateCustomerPasswordPolicy, validatePasswordPolicy } from "../src/security/password.js";
import { publicSiteSettings, siteSettingsSchema } from "../src/modules/settings/site-settings.schema.js";
import { promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";

describe("Dart rewards/promotions/settings contracts", () => {
  it("keeps the storefront customer password policy separate from representative security", () => {
    expect(validateCustomerPasswordPolicy("abc123")).toEqual([]);
    expect(validateCustomerPasswordPolicy("123456")).toEqual([]);
    expect(validateCustomerPasswordPolicy("!!!!!!")).toEqual([]);
    expect(validateCustomerPasswordPolicy("دارت12")).toEqual([]);
    expect(validateCustomerPasswordPolicy("short")).not.toHaveLength(0);
    expect(validatePasswordPolicy("abc123")).not.toHaveLength(0);
    expect(validatePasswordPolicy("StrongPass123")).toEqual([]);
  });

  it("rejects unknown Settings root keys and keeps codRisk private", () => {
    const parsed = siteSettingsSchema.safeParse({
      birthdayDiscountPercent: 30,
      dartCardDiscountPercent: 40,
      rogueSecret: "must-never-be-accepted",
    });
    expect(parsed.success).toBe(false);

    const projected = publicSiteSettings({
      birthdayDiscountPercent: 30,
      codRisk: { version: 9 },
      heroDayImage: "/Photos/hero.png",
    });
    expect(projected).toMatchObject({
      birthdayDiscountPercent: 30,
      heroDayImage: "/Photos/hero.png",
    });
    expect(projected).not.toHaveProperty("codRisk");
  });

  it("accepts nested AND/OR promotion eligibility and strict product scope", () => {
    const result = promotionCampaignInputSchema.safeParse({
      name: "Winback October",
      code: "winback-oct",
      status: "Active",
      discountPercent: 15,
      automatic: true,
      minOrderMinor: 50_000,
      minQuantity: 1,
      totalUsageLimit: 500,
      perCustomerUsageLimit: 1,
      customerRules: {
        mode: "AND",
        rules: [
          { field: "lastOrderDaysAgo", operator: "gte", value: 30 },
          {
            mode: "OR",
            rules: [
              { field: "ordersCount", operator: "eq", value: 0 },
              { field: "purchasedPieces", operator: "gte", value: 10 },
            ],
          },
        ],
      },
      productScope: { mode: "categories", values: ["Shirts", "Pants"] },
      stacking: "none",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("WINBACK-OCT");
  });

  it("rejects invalid campaign dates and empty scoped campaigns", () => {
    expect(promotionCampaignInputSchema.safeParse({
      name: "Broken",
      code: "BROKEN",
      status: "Active",
      discountPercent: 10,
      startsAt: "2026-10-10",
      endsAt: "2026-10-01",
      productScope: { mode: "models", values: [] },
    }).success).toBe(false);
  });
});
