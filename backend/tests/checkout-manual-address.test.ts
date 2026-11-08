import { describe, expect, it } from "vitest";
import { checkoutSchema } from "../src/modules/commerce/commerce.routes.js";

const order = {
  reservationId: "ABCDEF0123456789ABCD",
  contact: { name: "Test Customer", phone1: "01000000000", email: "test@example.com" },
  address: { country: "Egypt", governorate: "Cairo", area: "Nasr City",
    street: "Example Street", building: "21", floor: "3", addressSource: "manual" as const },
};
describe("map-free checkout input", () => {
  it("accepts manual addresses without invented coordinates", () => {
    const parsed = checkoutSchema.parse(order);
    expect(parsed.address.latitude).toBeUndefined();
    expect(parsed.address.longitude).toBeUndefined();
  });
  it("rejects a partial coordinate pair", () => {
    expect(() => checkoutSchema.parse({...order,address:{...order.address,latitude:"30.0444"}})).toThrow();
  });
  it("requires coordinates in map mode", () => {
    expect(() => checkoutSchema.parse({...order,address:{...order.address,addressSource:"map"}})).toThrow();
  });
  it("preserves previously supported verified coordinates", () => {
    const parsed = checkoutSchema.parse({...order,address:{...order.address,latitude:"30.0444",longitude:"31.2357"}});
    expect(parsed.address.latitude).toBe("30.0444");
    expect(parsed.address.longitude).toBe("31.2357");
  });
});
