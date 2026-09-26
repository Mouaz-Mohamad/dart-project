// DART CODE GUIDE | backend/tests/finance.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FinanceService } from "../src/modules/finance/finance.service.js";

const financeSource = readFileSync(
  new URL("../src/modules/finance/finance.service.ts", import.meta.url),
  "utf8",
);

function financePool(options: {
  failDelivered?: boolean;
  deliveredRows?: Array<Record<string, unknown>>;
  returnPayloads?: Array<Record<string, unknown>>;
  itemCosts?: Array<{ item_code: string; cost_snapshot_minor: string }>;
} = {}) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      queries.push(sql);
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM orders o") && sql.includes("sum(oi.cost_snapshot_minor)")) {
        if (options.failDelivered) throw new Error("database unavailable");
        return {
          rows: options.deliveredRows ?? [
            {
              id: "1", order_code: "K-1", customer_user_id: null,
              final_minor: "10001", delivery_cost_minor: "0",
              payment_method: "COD", payment_status: "Paid",
              amount_paid_minor: "10001", amount_refunded_minor: "0",
              event_at: new Date("2026-09-10T10:00:00Z"), cogs_minor: "0", sold_units: "1",
            },
            {
              id: "2", order_code: "K-2", customer_user_id: "customer-1",
              final_minor: "5000", delivery_cost_minor: "0",
              payment_method: "Cash on Delivery", payment_status: "Refunded",
              amount_paid_minor: "5000", amount_refunded_minor: "2000",
              event_at: new Date("2026-09-11T10:00:00Z"), cogs_minor: "0", sold_units: "1",
            },
          ],
        };
      }
      if (sql.includes("FROM inventory_items") && sql.includes("created_at >=")) return { rows: [] };
      if (sql.includes("FROM inventory_items")) return { rows: options.itemCosts ?? [] };
      if (sql.includes("SELECT DISTINCT oi.item_code")) return { rows: [] };
      if (sql.includes("FROM return_requests")) {
        const payloads = options.returnPayloads ?? [{
          id: "return-1", orderId: "K-2", itemCode: "I-2",
          requestType: "Refund", status: "Completed",
          isPostDeliveryReturn: true, completedAt: "2026-09-12T10:00:00Z",
          refundAmount: 20, inspectionStatus: "Damaged",
        }];
        return { rows: payloads.map((payload) => ({ payload })) };
      }
      if (sql.includes("FROM damage_records")) return { rows: [] };
      if (sql.includes("FROM finance_records")) {
        const domain = String(values[0] || "");
        if (domain === "finance_settlements") {
          return {
            rows: [{
              payload: {
                id: "settlement-1", orderId: "K-1", amountReceived: 100.01,
                fee: 0, settlementDate: "2026-10-01",
              },
            }],
          };
        }
        if (["finance_expenses", "finance_marketing"].includes(domain)) {
          return { rows: [] };
        }
      }
      throw new Error(`Unexpected finance query: ${sql}`);
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
    queries,
  };
}

describe("finance summary integrity", () => {
  it("uses one snapshot and keeps refunds as cash-out instead of deducting them twice", async () => {
    const fixture = financePool();
    const summary = await new FinanceService(fixture.pool as never).summary(
      "2026-09-01",
      "2026-09-30",
    );

    expect(fixture.queries[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(fixture.queries.at(-1)).toBe("COMMIT");
    expect(summary.cashIn).toBe(50);
    expect(summary.refundCashOut).toBe(20);
    expect(summary.netCashFlow).toBe(30);
    expect(summary.uniqueCustomers).toBe(1);
    expect(summary.orderFrequencyBuckets).toEqual({
      oneOrder: 1,
      twoOrders: 0,
      threeOrders: 0,
      fourOrders: 0,
      fivePlusOrders: 0,
    });
    expect(summary.averageOrderValue).toBe(65.01);
  });

  it("books a good refund in its actual later period, including negative COGS and units", async () => {
    const fixture = financePool({
      deliveredRows: [],
      itemCosts: [{ item_code: "I-LATE", cost_snapshot_minor: "40000" }],
      returnPayloads: [{
        id: "return-late", orderId: "K-OLD", itemCode: "I-LATE",
        requestType: "Refund", status: "Completed",
        isPostDeliveryReturn: true, completedAt: "2026-09-12T10:00:00Z",
        refundAmount: 1000, inspectionStatus: "Good",
        originalLineSnapshot: { costSnapshot: 400 },
      }],
    });
    const summary = await new FinanceService(fixture.pool as never).summary(
      "2026-09-01",
      "2026-09-30",
    );

    expect(summary.grossRevenue).toBe(0);
    expect(summary.netRevenue).toBe(-1000);
    expect(summary.netCogs).toBe(-400);
    expect(summary.netProfit).toBe(-600);
    expect(summary.soldUnits).toBe(-1);
    expect(summary.margin).toBe(0);
    expect(summary.marginApplicable).toBe(false);
  });

  it("reads relational domains sequentially on one pg client", () => {
    expect(financeSource).not.toMatch(
      /relationalRows\s*=\s*await Promise\.all/,
    );
    expect(financeSource).toContain("for (const domain of relationalDomains)");
    expect(financeSource).toContain(
      "await readRelationalDashboardDomain(client, domain)",
    );
  });

  it("rolls the read transaction back when a finance query fails", async () => {
    const fixture = financePool({ failDelivered: true });
    await expect(
      new FinanceService(fixture.pool as never).summary("2026-09-01", "2026-09-30"),
    ).rejects.toThrow("database unavailable");
    expect(fixture.queries.at(-1)).toBe("ROLLBACK");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });
});
