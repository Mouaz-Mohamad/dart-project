import { describe, expect, it } from "vitest";
import { resolveReturnCourierPolicy } from "../src/modules/commerce/customer-interaction.service.js";

describe("return courier policy snapshots", () => {
  it("reads the current refund fee from site settings", () => {
    expect(resolveReturnCourierPolicy({ refundCustomerFee: 125 }, "Refund", 0))
      .toEqual({ customerFee: 125, brandFee: 0, payer: "Customer" });
  });

  it("keeps the first completed exchange as a fixed Dart-paid 50 EGP benefit", () => {
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 75 }, "Exchange", 0))
      .toEqual({ customerFee: 0, brandFee: 50, payer: "Brand" });
  });

  it("uses the configured customer fee for later exchanges", () => {
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 75 }, "Exchange", 1))
      .toEqual({ customerFee: 75, brandFee: 0, payer: "Customer" });
  });

  it("treats an explicitly configured zero as valid rather than falling back", () => {
    expect(resolveReturnCourierPolicy({ refundCustomerFee: 0 }, "Refund", 0).customerFee).toBe(0);
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 0 }, "Exchange", 2).customerFee).toBe(0);
  });
});
