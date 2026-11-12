import { describe, expect, it } from "vitest";
import { orderDiscountDisplay } from "../src/modules/commerce/commerce.order-discounts.js";

const line = (source: string, reference: string, itemCode = "SWIT001-B-2") => ({
  itemCode, originalUnitPrice: 800, finalUnitPrice: 680,
  discountAmount: 120, discountPercent: 15,
  discountSource: source, discountReference: reference,
});

describe("admin order discount reason history", () => {
  it("displays the exact redeemed coupon in the dashboard for the K-12 scenario", () => {
    const result = orderDiscountDisplay(
      { type: "Discount Code", code: "DART15", discountMinor: 12000, percent: 15 },
      {}, [line("Discount Code", "DART15")], 12000,
    );
    expect(result).toEqual({
      reasonDeduction: "Discount Code: DART15", discountCode: "DART15", promotionCode: "",
    });
  });

  it("labels a manually entered campaign code rather than just its percent", () => {
    const result = orderDiscountDisplay(
      { type: "Promotion", code: "DROP15", discountMinor: 12000, percent: 15 },
      {}, [line("Campaign", "DROP15")], 12000,
    );
    expect(result.reasonDeduction).toBe("Campaign: DROP15");
    expect(result.promotionCode).toBe("DROP15");
  });

  it("recovers a deleted coupon from immutable per-item snapshots", () => {
    const result = orderDiscountDisplay(null, {}, [line("Discount Code", "OLD15")], 12000);
    expect(result.reasonDeduction).toBe("Discount Code: OLD15");
  });

  it("uses existing order legacy code when an older order has no line sources", () => {
    expect(orderDiscountDisplay(null, { discountCode: "OLD15", reasonDeduction: "-" }, [], 12000).reasonDeduction)
      .toBe("Discount Code: OLD15");
  });

  it("shows each piece's source on mixed orders without inventing stacking", () => {
    const result = orderDiscountDisplay({
      type: "Mixed", benefits: [
        { type: "Discount Code", code: "DART15", discountMinor: 12000 },
      ],
    }, {}, [
      line("Discount Code", "DART15", "A-1"),
      { ...line("Model", "M-1", "B-2"), discountPercent: 20 },
    ], 24000);
    expect(result.reasonDeduction).toBe("Discount Code: DART15 (A-1) · Item Discount (B-2)");
  });

  it.each([
    ["Birthday", "Birthday Discount"],
    ["Dart Card", "Dart Card"],
    ["Model", "Item Discount"],
    ["Manual", "Manual Discount"],
  ])("shows a saved %s discount without exposing internal identifiers", (source, reason) => {
    const result = orderDiscountDisplay(null, {}, [line(source, "private-id")], 12000);
    expect(result.reasonDeduction).toBe(reason);
    expect(result.reasonDeduction).not.toContain("private-id");
  });

  it("does not claim a typed code was redeemed when no money was saved", () => {
    expect(orderDiscountDisplay(null, { discountCode: "DART15" }, [], 0))
      .toEqual({ reasonDeduction: "-", discountCode: "", promotionCode: "" });
  });

  it("falls back to an existing descriptive reason for old manual orders", () => {
    expect(orderDiscountDisplay(null, { reasonDeduction: "Special owner discount" }, [], 5000).reasonDeduction)
      .toBe("Special owner discount");
  });
});
