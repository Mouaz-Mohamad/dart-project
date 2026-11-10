import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { orderRemainingPaymentMinor, queueOrderConfirmation } from "../src/modules/commerce/commerce.whatsapp.js";

describe("WhatsApp amount due in order confirmation", () => {
  it.each([
    { total: 100000, paid: 30000, refunded: 0, expected: 70000 },
    { total: 100000, paid: 100000, refunded: 0, expected: 0 },
    { total: 100000, paid: 30000, refunded: 5000, expected: 75000 },
    { total: 100000, paid: 120000, refunded: 0, expected: 0 },
  ])("calculates the outstanding minor units: $expected", ({ total, paid, refunded, expected }) => {
    expect(orderRemainingPaymentMinor(total, paid, refunded)).toBe(expected);
  });

  it.each(["Website", "Manual"])("queues the due amount for %s orders", async (source) => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM orders WHERE")) {
        return { rows: [{ order_code: "K-7", final_minor: "100000",
          amount_paid_minor: "30000", amount_refunded_minor: "0",
          version: "2", phone: "01012345678" }] };
      }
      if (sql.includes("INSERT INTO order_whatsapp_confirmations")) {
        return { rows: [{ id: "d07cbf56-a1cf-4d9b-ae7e-2698b0558523" }] };
      }
      return { rows: [] };
    });
    await queueOrderConfirmation({ query } as unknown as PoolClient, "cf467a15-42a4-4ca0-bf20-e1066a728c3e");
    const lookup = calls.find((call) => call.sql.includes("FROM orders WHERE"));
    expect(lookup?.sql).not.toContain("order_source='Website'");
    const outbox = calls.find((call) => call.sql.includes("'ORDER_WHATSAPP_CONFIRMATION'"));
    expect(outbox).toBeDefined();
    const payload = JSON.parse(String(outbox?.params[1] || "{}"));
    expect(payload.parameters).toEqual(["K-7", "700.00"]);
    expect(payload.category).toBe("utility");
    expect(source).toMatch(/Website|Manual/);
  });

  it("does not queue a second send if confirmation already exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM orders WHERE")) return { rows: [{ order_code: "K-7",
        final_minor: "100000", amount_paid_minor: "0", amount_refunded_minor: "0",
        version: "2", phone: "01012345678" }] };
      return { rows: [] };
    });
    await queueOrderConfirmation({ query } as unknown as PoolClient, "cf467a15-42a4-4ca0-bf20-e1066a728c3e");
    expect(query.mock.calls.some(([sql]) => sql.includes("'ORDER_WHATSAPP_CONFIRMATION'"))).toBe(false);
  });
});
