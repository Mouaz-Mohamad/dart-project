// Behavioral rules for current physical stock, net demand rankings and owner ledgers.
import { describe, expect, it } from "vitest";
import { calculateBrandInventory, type BrandInventoryInput } from "../src/modules/finance/brand-inventory.service.js";
import { buildBrandLedger, type FinanceSnapshot } from "../src/modules/finance/finance.service.js";

const visibility = { costs: true, waiting: true };
const now = new Date("2026-10-30T12:00:00Z");
const item = (code: string, status = "In stock", model = "M1") => ({ item_code: code, model_id: model,
  color: "Black", size: "M", status, active: true, cost_snapshot_minor: "12345", created_at: "2026-09-01T12:00:00Z" });
const line = (code: string, order = "O1", event = "2026-10-01T12:00:00Z") => ({ ...item(code), order_code: order, order_id: order, event_at: event });
const returned = (code: string, order = "O1") => ({ id: `R-${code}`, itemCode: code, orderId: order,
  isPostDeliveryReturn: true, status: "Completed", completedAt: "2026-10-15T12:00:00Z", refundAmount: 300,
  originalLineSnapshot: { modelCode: "M1", color: "Black", size: "M" }, requestType: "Refund" });
function data(patch: Partial<BrandInventoryInput> = {}): BrandInventoryInput {
  return { models: [{ model_id: "M1", name: "Hoodie", selling_minor: "50001", cost_minor: "20000", discount_percent: "15", color_options: ["Black", "White"], size_options: ["M", "L"] }],
    items: [item("I1"), item("I2", "Cart reserved"), item("I3", "Sold"), item("I4", "Damaged")],
    lines: [line("I3")], waiting: [{ model_id: "M1", color: "Black", size: "M", quantity: 3 }], returns: [], ...patch };
}
describe("Brand inventory drilldowns", () => {
  it("values current physical stock across acquisition dates, applies the item discount and separates Waiting from cart holds", () => {
    const result = calculateBrandInventory(data(), "2026-10-01", "2026-10-30", visibility, now);
    expect(result.totals).toMatchObject({ pieces: 2, models: 1, sellingMinor: 85002, costMinor: 24690, lowStock: 1, deadStock: 1 });
    expect(result.models[0]).toMatchObject({ total: 4, stock: 2, sold: 1, damaged: 1, waiting: 3, share: 100 });
    expect(result.colors.find((row) => row.key === "White")?.sold).toBe(0);
    expect(result.sizes.find((row) => row.key === "L")?.sold).toBe(0);
  });
  it("subtracts each completed refund once, handles a returned piece sold again, and keeps exchanges neutral", () => {
    const result = calculateBrandInventory(data({ lines: [line("I3"), line("I3", "O2"), line("I5")],
      returns: [returned("I3"), { ...returned("I3"), id: "duplicate" }, { ...returned("I5"), requestType: "Exchange" }] }),
    "2026-10-01", "2026-10-30", visibility, now);
    expect(result.models[0]).toMatchObject({ sold: 2, returned: 1, damaged: 1, share: 100 });
    expect(result.totals.netUnits).toBe(2);
  });
  it("books later-period returns by their event date even if the sale was in a prior period", () => {
    const result = calculateBrandInventory(data({ lines: [line("I3", "O1", "2026-09-01T12:00:00Z")], returns: [returned("I3")] }),
      "2026-10-01", "2026-10-30", visibility, now);
    expect(result.sizes.find((row) => row.key === "M")).toMatchObject({ sold: -1, returned: 1, share: 0 });
  });
  it("ranks dimensions by net units, calculates their share and sorts low stock from the fewest pieces", () => {
    const result = calculateBrandInventory(data({
      models: [...data().models, { model_id: "M2", name: "Jeans", selling_minor: "60000", size_options: ["32"], color_options: ["Blue"] }],
      items: [item("I1"), item("I2"), { ...item("J1", "In stock", "M2"), color: "Blue", size: "32" }],
      lines: [line("I3"), line("I4"), { ...line("J2"), model_id: "M2", color: "Blue", size: "32" }],
    }), "2026-10-01", "2026-10-30", visibility, now);
    expect(result.models.map((row) => [row.key, row.share])).toEqual([["M1", 66.67], ["M2", 33.33]]);
    expect(result.low.map((row) => row.key)).toEqual(["M2", "M1"]);
    expect(result.colors[0]?.key).toBe("Black");
  });
  it("uses the latest sale, or stock entry for never-sold models, at the exact 15-day boundary", () => {
    const recent = calculateBrandInventory(data({ lines: [line("I3", "O1", "2026-10-16T12:00:00Z")] }), "2026-10-01", "2026-10-30", visibility, now);
    expect(recent.dead).toHaveLength(0);
    const boundary = calculateBrandInventory(data({ lines: [line("I3", "O1", "2026-10-15T12:00:00Z")] }), "2026-10-01", "2026-10-30", visibility, now);
    expect(boundary.dead[0]?.idleDays).toBe(15);
    const never = calculateBrandInventory(data({ lines: [], items: [{ ...item("I1"), created_at: "2026-10-20T12:00:00Z" }] }), "2026-10-01", "2026-10-30", visibility, now);
    expect(never.dead).toHaveLength(0);
  });
  it("omits restricted cost and Waiting data and handles an empty store", () => {
    const result = calculateBrandInventory(data(), "2026-10-01", "2026-10-30", { costs: false, waiting: false }, now);
    expect(result.models[0]?.waiting).toBeNull();
    expect(result.models[0]).not.toHaveProperty("costMinor");
    expect(result.totals).not.toHaveProperty("costMinor");
    const empty = calculateBrandInventory({ models: [], items: [], lines: [], waiting: [], returns: [] }, "2026-10-01", "2026-10-30", visibility, now);
    expect(empty.totals).toMatchObject({ pieces: 0, models: 0, netUnits: 0, lowStock: 0, deadStock: 0 });
  });
});

describe("Brand financial contributors", () => {
  it("lists every source, preserves piastres, applies refund corrections on their dates and avoids duplicate damage/inventory costs", () => {
    const snapshot = { delivered: [{ id: "1", order_code: "O1", event_at: new Date("2026-10-01T12:00:00Z"), final_minor: "50001", sold_units: "1" }],
      acquired: [{ item_code: "I1", cost_snapshot_minor: "12345", created_at: new Date("2026-10-01T12:00:00Z") }],
      itemCost: new Map([["OLD", 11111]]), deliveredCodes: new Set(),
      states: new Map([
        ["returns", [{ ...returned("I3"), refundAmount: 100, refundAdjustments: [{ id: "a", amountMinor: 1000, occurredAt: "2026-11-01" }] }]],
        ["finance_expenses", [{ id: "e1", date: "2026-10-02", amount: 10.01 }, { id: "e2", date: "2026-10-02", amount: 999, archivedAt: "2026-10-03" }, { id: "purchase", date: "2026-10-02", amount: 123.45, category: "Inventory Acquisition" }]],
        ["finance_settlements", [{ id: "s1", settlementDate: "2026-10-03", fee: 5.02 }]],
        ["damage", [{ id: "d1", itemCode: "I1", status: "Damaged", date: "2026-10-04", costSnapshot: 123.45 }, { id: "d2", itemCode: "OLD", status: "Destroyed", date: "2026-10-05" }, { id: "duplicate", itemCode: "OLD", status: "Damaged", date: "2026-10-05" }]],
      ]),
    } as unknown as FinanceSnapshot;
    const result = buildBrandLedger(snapshot, "2026-10-01", "2026-10-31");
    expect(result.income.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(41001);
    expect(result.outgoing.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(24959);
    expect(result.damage.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(23456);
    expect(result.outgoing.filter((row) => row.source.includes("Damage"))).toHaveLength(1);
    expect(buildBrandLedger(snapshot, "2026-11-01", "2026-11-30").income[0]?.amountMinor).toBe(-1000);
  });
});
