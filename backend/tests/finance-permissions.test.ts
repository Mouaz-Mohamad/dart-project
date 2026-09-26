// DART CODE GUIDE | backend/tests/finance-permissions.test.ts
// الغرض: يثبت أن صلاحيات Finance المجزأة لا تكشف حقول أقسام مالية غير مصرح بها.
import { describe, expect, it } from "vitest";
import { financeSummarySection } from "../src/modules/finance/finance.routes.js";
import type { FinanceSummary } from "../src/modules/finance/finance.service.js";

const summary = {
  grossRevenue: 1000, refunds: 100, netRevenue: 900,
  grossCogs: 400, cogsReversal: 0, netCogs: 400,
  operatingExpenses: 50, codFees: 10, damageLoss: 0, damageValue: 20,
  returnCourierCosts: 5, deliveryCosts: 100, totalOperatingExpenses: 65,
  totalCost: 465, grossProfit: 500, netProfit: 435,
  physicalItemCost: 800, incrementalDamage: 20, brandTotalCost: 885,
  brandNetProfit: 15, margin: 48.33, grossMargin: 55.56, marginApplicable: true,
  deliveredOrders: 2, grossSoldUnits: 2, returnedUnits: 0, soldUnits: 2,
  averageOrderValue: 450, uniqueCustomers: 2, returningCustomers: 0,
  oneTimeCustomers: 2,
  orderFrequencyBuckets: { oneOrder: 2, twoOrders: 0, threeOrders: 0, fourOrders: 0, fivePlusOrders: 0 },
  repeatRate: 0, cashIn: 900, cashOut: 165, netCashFlow: 735,
  paidExpenseCashOut: 50, inventoryPurchaseCashOut: 0, refundCashOut: 100,
  marketing: { spend: 100, revenue: 500, roas: 5, cac: 50, ctr: 10, cpc: 2, conversion: 4, impressions: 1000, clicks: 100, orders: 2 },
} satisfies FinanceSummary;

describe("granular finance summary sections", () => {
  it("revenue does not expose cost, profit or cash-flow values", () => {
    const selected = financeSummarySection(summary, "revenue");
    expect(selected.netRevenue).toBe(900);
    expect(selected).not.toHaveProperty("netCogs");
    expect(selected).not.toHaveProperty("netProfit");
    expect(selected).not.toHaveProperty("cashIn");
  });

  it("cost does not expose revenue or profit", () => {
    const selected = financeSummarySection(summary, "cost");
    expect(selected.totalCost).toBe(465);
    expect(selected).not.toHaveProperty("netRevenue");
    expect(selected).not.toHaveProperty("netProfit");
  });

  it("profit exposes only profit and margin outputs", () => {
    const selected = financeSummarySection(summary, "profit");
    expect(selected.netProfit).toBe(435);
    expect(selected.marginApplicable).toBe(true);
    expect(selected).not.toHaveProperty("netRevenue");
    expect(selected).not.toHaveProperty("netCogs");
  });

  it("cashflow and inventory stay separated", () => {
    expect(financeSummarySection(summary, "cashflow")).toHaveProperty("netCashFlow", 735);
    expect(financeSummarySection(summary, "cashflow")).not.toHaveProperty("physicalItemCost");
    expect(financeSummarySection(summary, "inventory")).toEqual({
      physicalItemCost: 800,
      incrementalDamage: 20,
      damageValue: 20,
    });
  });
});
