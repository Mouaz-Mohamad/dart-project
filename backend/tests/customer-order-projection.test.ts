// DART CODE GUIDE | backend/tests/customer-order-projection.test.ts
// Customer-facing order data must not reveal internal courier cost or COGS.
import { describe, expect, it } from "vitest";
import { customerOrderView } from "../src/modules/commerce/commerce.pricing.js";

describe("customer order projection", () => {
  it("returns the customer shipping charge but never internal courier expense", () => {
    const order = customerOrderView({
      orderId: "K-PROJECTION", finalAmount: 510, shippingFee: 100,
      deliveryCost: 55, courierFee: 55, courierFeePerOrder: 55, pendingDispatch: { secret: true },
      priceSnapshot: [{ itemCode: "I-1", originalUnitPrice: 410, finalUnitPrice: 410,
        cost: 130, costSnapshotMinor: 13000, purchaseCost: 130 }],
    });
    expect(order).toMatchObject({ orderId: "K-PROJECTION", finalAmount: 510, shippingFee: 100 });
    for (const privateField of ["deliveryCost", "courierFee", "courierFeePerOrder", "pendingDispatch"]) {
      expect(order).not.toHaveProperty(privateField);
    }
    const line = (order.priceSnapshot as Record<string, unknown>[])[0]!;
    expect(line).toMatchObject({ itemCode: "I-1", finalUnitPrice: 410 });
    for (const privateField of ["cost", "purchaseCost", "costSnapshotMinor"]) {
      expect(line).not.toHaveProperty(privateField);
    }
  });
});
