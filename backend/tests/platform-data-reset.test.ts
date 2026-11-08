// DART CODE GUIDE | backend/tests/platform-data-reset.test.ts
// Owner-only selective data reset: preserve staff, representatives, settings and unrelated finance.
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PlatformAdminService } from "../src/modules/platform/platform-admin.service.js";

function setup(options: { owner?: boolean; failAt?: string; lock?: boolean } = {}) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (options.failAt && sql.includes(options.failAt)) throw new Error("simulated database failure");
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ acquired: options.lock !== false }], rowCount: 1 };
      }
      if (sql.includes("SELECT is_owner FROM staff_users")) {
        return { rows: [{ is_owner: options.owner !== false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { service: new PlatformAdminService(pool), client, queries };
}

describe("owner selective platform data reset", () => {
  it("deletes exactly the requested business areas and their FK dependents, preserving configuration", async () => {
    const { service, queries, client } = setup();
    const result = await service.resetBusinessData("staff-owner", "request-one");
    expect(result.deleted.catalogModels).toBe(1);
    const sql = queries.join("\n");
    for (const table of [
      "catalog_models", "inventory_items", "orders", "order_items", "return_requests",
      "finance_records", "waitlist_entries", "set_waiting_entries", "loyalty_cards",
      "dart_card_draws", "news_articles", "customers", "customer_social_identities",
      "customer_notifications", "cart_set_groups", "catalog_sets", "order_set_components",
      "set_loyalty_returned_items", "order_whatsapp_confirmations",
    ]) {
      expect(sql).toContain(`DELETE FROM ${table}`);
    }
    expect(sql).not.toMatch(/DELETE FROM (representatives|representative_documents|representative_locations|staff_users|audit_logs|site_settings|catalog_assets|traffic_analytics_visitors)/);
    expect(sql).toContain("data=data-'modelCards'");
    expect(sql).toContain("finance_expenses','finance_settlements");
    expect(sql).not.toContain("DELETE FROM finance_records WHERE domain IN ('finance_budgets'");
    expect(sql).toContain("WHERE account_type='customer'");
    expect(queries.indexOf("DELETE FROM news_articles")).toBeLessThan(queries.indexOf("DELETE FROM catalog_models"));
    expect(queries.indexOf("DELETE FROM waitlist_allocations")).toBeLessThan(queries.indexOf("DELETE FROM inventory_items"));
    expect(queries.findIndex((s) => s.includes("orderTrafficEvents"))).toBe(-1);
    expect(queries.findIndex((s) => s.includes("DELETE FROM traffic_analytics_events"))).toBeLessThan(queries.indexOf("DELETE FROM orders"));
    expect(queries.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back on database errors; never reports a partial reset as successful", async () => {
    const { service, queries, client } = setup({ failAt: "DELETE FROM orders" });
    await expect(service.resetBusinessData("staff-owner", "request-failed"))
      .rejects.toThrow("simulated database failure");
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects non-owner staff and concurrent reset requests", async () => {
    const denied = setup({ owner: false });
    await expect(denied.service.resetBusinessData("staff-non-owner", "request-two"))
      .rejects.toThrow("Only the protected Dart owner");
    expect(denied.queries).toContain("ROLLBACK");
    expect(denied.queries.join("\n")).not.toContain("DELETE FROM orders");
    const busy = setup({ lock: false });
    await expect(busy.service.resetBusinessData("staff-owner", "request-three"))
      .rejects.toThrow("Another data reset is already in progress");
    expect(busy.queries).not.toContain("COMMIT");
  });
});
