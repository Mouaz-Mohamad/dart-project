// DART CODE GUIDE | backend/tests/finance-routes.test.ts
// الغرض: يثبت عزل حقول Finance حسب صلاحية القسم وعدم تسريب أرقام مالية أخرى.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { financeReportRanges, financeSummarySection } from "../src/modules/finance/finance.routes.js";
import type { FinanceSummary } from "../src/modules/finance/finance.service.js";

const fixture = {
  grossRevenue: 1000,
  refunds: 100,
  netRevenue: 900,
  grossCogs: 400,
  cogsReversal: 50,
  netCogs: 350,
  operatingExpenses: 100,
  codFees: 20,
  damageLoss: 10,
  damageValue: 80,
  returnCourierCosts: 30,
  deliveryCosts: 100,
  totalOperatingExpenses: 160,
  totalCost: 510,
  grossProfit: 550,
  netProfit: 390,
  physicalItemCost: 2000,
  incrementalDamage: 20,
  brandTotalCost: 2150,
  brandNetProfit: -1250,
  margin: 43.33,
  grossMargin: 61.11,
  marginApplicable: true,
  deliveredOrders: 2,
  grossSoldUnits: 2,
  returnedUnits: 1,
  soldUnits: 1,
  averageOrderValue: 450,
  uniqueCustomers: 2,
  returningCustomers: 0,
  oneTimeCustomers: 2,
  orderFrequencyBuckets: { oneOrder: 2, twoOrders: 0, threeOrders: 0, fourOrders: 0, fivePlusOrders: 0 },
  repeatRate: 0,
  cashIn: 900,
  cashOut: 250,
  netCashFlow: 650,
  paidExpenseCashOut: 100,
  inventoryPurchaseCashOut: 0,
  refundCashOut: 100,
  marketing: { spend: 100, revenue: 500, roas: 5, cac: 50, ctr: 1, cpc: 2, conversion: 3, impressions: 10000, clicks: 100, orders: 2 },
} as FinanceSummary;

describe("finance field-level permissions", () => {
  it("bounds the chart to twelve contiguous periods without dropping its last day", () => {
    const current = { start: "2026-10-01", end: "2026-10-31" };
    const previous = { start: "2026-09-01", end: "2026-09-30" };
    const ranges = financeReportRanges(current, previous, 12);
    expect(ranges.slice(0, 2)).toEqual([current, previous]);
    expect(ranges.length).toBeLessThanOrEqual(14);
    expect(ranges[2]?.start).toBe(current.start);
    expect(ranges.at(-1)?.end).toBe(current.end);
    for (let index = 3; index < ranges.length; index++) {
      expect(Date.parse(ranges[index]!.start) - Date.parse(ranges[index - 1]!.end)).toBe(86400000);
    }
    expect(financeReportRanges(current, previous, 0)).toEqual([current, previous]);
  });
  it("returns revenue metrics without leaking cost or profit", () => {
    const section = financeSummarySection(fixture, "revenue");
    expect(section.netRevenue).toBe(900);
    expect(section).not.toHaveProperty("netCogs");
    expect(section).not.toHaveProperty("netProfit");
    expect(section).not.toHaveProperty("cashIn");
  });

  it("returns cost metrics including Owner Total Cost without leaking revenue", () => {
    const section = financeSummarySection(fixture, "cost");
    expect(section.totalCost).toBe(510);
    expect(section.brandTotalCost).toBe(2150);
    expect(section).not.toHaveProperty("netRevenue");
    expect(section).not.toHaveProperty("netProfit");
  });

  it("keeps cashflow and inventory values in separate sections", () => {
    expect(financeSummarySection(fixture, "cashflow")).toEqual({
      cashIn: 900,
      cashOut: 250,
      netCashFlow: 650,
      paidExpenseCashOut: 100,
      inventoryPurchaseCashOut: 0,
      refundCashOut: 100,
    });
    expect(financeSummarySection(fixture, "inventory")).toEqual({
      physicalItemCost: 2000,
      incrementalDamage: 20,
      damageValue: 80,
    });
  });

  it("requires all three P&L view permissions for the authoritative P&L export path", () => {
    const source = readFileSync(
      new URL("../src/modules/finance/finance.routes.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('section === "pnl" ? ["revenue", "cost", "profit"]');
    expect(source).toContain('requirePermission("finance.export")');
    expect(source).toContain('requiredViews.every((permission) => permissions.includes(permission))');
  });
});
