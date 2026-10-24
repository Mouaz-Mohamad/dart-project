import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { CommerceService, adaptiveSuggestedStopOrder } from "../src/modules/commerce/commerce.service.js";

function transactionFixture(version = "7") {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT version::text")) return { rows: [{ version }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const service = new CommerceService({ query, connect } as unknown as Pool);
  return { service, query, release };
}

describe("commerce read extraction compatibility", () => {
  it("keeps a stale order snapshot empty and commits/releases its read transaction", async () => {
    const { service, query, release } = transactionFixture();
    await expect(service.adminOrders({ orderIds: ["order-1"], customerIds: [], expectedVersion: 6 }))
      .resolves.toEqual({ version: 7, orders: [], refreshRequired: true });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns an empty current order snapshot with the recorded version", async () => {
    const { service, query, release } = transactionFixture();
    await expect(service.adminOrders()).resolves.toEqual({ version: 7, orders: [] });
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases an order read when the database fails", async () => {
    const { service, query, release } = transactionFixture();
    const failure = new Error("Synthetic database failure");
    query.mockRejectedValueOnce(failure);
    await expect(service.adminOrders()).rejects.toBe(failure);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves the default version when no order version exists", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const service = new CommerceService({ query } as unknown as Pool);
    await expect(service.adminOrdersVersion()).resolves.toBe(1);
  });

  for (const read of ["customerSnapshot", "customerLiveTracking"] as const) {
    it(`${read} still rejects an unknown customer before reading private records`, async () => {
      const query = vi.fn(async () => ({ rows: [] }));
      const service = new CommerceService({ query } as unknown as Pool);
      await expect(service[read]("missing-customer")).rejects.toMatchObject({
        statusCode: 404, code: "CUSTOMER_NOT_FOUND",
      });
      expect(query).toHaveBeenCalledOnce();
    });
  }

  it("keeps the current delivery first when suggesting subsequent stops", () => {
    const current = { id: "current", latitude: 30, longitude: 31, routeState: "current" };
    const near = { id: "near", latitude: 30.001, longitude: 31.001 };
    const far = { id: "far", latitude: 31, longitude: 32 };
    const stops = [far, current, near];
    expect(adaptiveSuggestedStopOrder(null, null, stops)).toEqual([current, near, far]);
    expect(stops).toEqual([far, current, near]);
  });
});
