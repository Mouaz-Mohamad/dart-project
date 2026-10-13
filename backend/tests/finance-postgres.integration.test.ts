// DART CODE GUIDE | backend/tests/finance-postgres.integration.test.ts
// Actual PostgreSQL finance SQL on an isolated embedded engine; no external database or production rows.
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceService } from "../src/modules/finance/finance.service.js";

let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE orders (
      id text PRIMARY KEY, order_code text, customer_user_id text,
      final_minor bigint, delivery_cost_minor bigint DEFAULT 0, payment_method text,
      payment_status text, amount_paid_minor bigint, amount_refunded_minor bigint DEFAULT 0,
      delivered_at timestamptz, updated_at timestamptz, status text,
      is_deleted boolean DEFAULT false, is_archived boolean DEFAULT false
    );
    CREATE TABLE order_items (id text PRIMARY KEY, order_id text, item_code text, cost_snapshot_minor bigint);
    CREATE TABLE inventory_items (item_code text PRIMARY KEY, cost_snapshot_minor bigint,
      created_at timestamptz, is_deleted boolean DEFAULT false);
    CREATE TABLE return_requests (record_id text, position integer, payload jsonb);
    CREATE TABLE damage_records (record_id text, position integer, payload jsonb);
    CREATE TABLE finance_records (domain text, record_id text, position integer, payload jsonb);
    INSERT INTO orders (id,order_code,customer_user_id,final_minor,payment_method,payment_status,
      amount_paid_minor,delivered_at,updated_at,status) VALUES
      ('o1','K-1','c1',10101,'Card','Paid',10101,'2026-09-30T21:00:00Z','2026-09-30T21:00:00Z','Delivered'),
      ('o2','K-2','c1',22202,'Card','Paid',22202,'2026-10-01T21:00:00Z','2026-10-01T21:00:00Z','Delivered'),
      ('outside','K-3','c2',99900,'Card','Paid',99900,'2026-10-02T21:00:00Z','2026-10-02T21:00:00Z','Delivered');
    INSERT INTO order_items VALUES ('line1','o1','I-1',2001), ('line2','o2','I-2',3002);
    INSERT INTO inventory_items (item_code,cost_snapshot_minor,created_at) VALUES
      ('before',99900,'2026-09-30T20:59:59Z'), ('I-1',3001,'2026-09-30T21:00:00Z'),
      ('I-2',7002,'2026-10-01T21:00:00Z'), ('after',99900,'2026-10-02T21:00:00Z');
  `);
  const expenses = [
    { id: "active-1", date: "2026-10-01", amount: 40, status: "Paid" },
    { id: "archived", date: "2026-10-01", amount: 100, status: "Paid", archivedAt: "2026-10-06T12:28:14Z" },
    { id: "archived-purchase", date: "2026-10-01", amount: 200, status: "Paid", category: "Inventory Acquisition", archivedAt: "2026-10-06T12:28:14Z" },
    { id: "active-2", date: "2026-10-02", amount: 60, status: "Paid" },
  ];
  for (const [position, expense] of expenses.entries()) {
    await db.query("INSERT INTO finance_records VALUES ('finance_expenses',$1,$2,$3::jsonb)",
      [expense.id, position, JSON.stringify(expense)]);
  }
}, 20000);
afterEach(async () => { await db?.close(); });

function pool(failSql = false) {
  let reads = 0;
  const queries: string[] = [];
  const release = vi.fn();
  const connect = vi.fn(async () => ({ release, query: async (sql: string, values: unknown[] = []) => {
    queries.push(sql);
    if (failSql && ++reads === 3) return db.query("SELECT missing_column FROM inventory_items");
    return db.query(sql, values);
  } }));
  return { value: { connect } as unknown as Pool, connect, release, queries };
}

describe("finance SQL snapshot", () => {
  it("reads nine relations once, preserves Cairo midnight boundaries and excludes archived expense payloads", async () => {
    const fixture = pool();
    const results = await new FinanceService(fixture.value).summaries([
      { start: "2026-10-01", end: "2026-10-02" },
      { start: "2026-10-01", end: "2026-10-01" },
      { start: "2026-10-02", end: "2026-10-02" },
    ]);
    expect(results.map((row) => row.netRevenue)).toEqual([323.03, 101.01, 222.02]);
    expect(results.map((row) => row.operatingExpenses)).toEqual([100, 40, 60]);
    expect(results.map((row) => row.paidExpenseCashOut)).toEqual([100, 40, 60]);
    expect(results.map((row) => row.inventoryPurchaseCashOut)).toEqual([0, 0, 0]);
    expect(results.map((row) => row.physicalItemCost)).toEqual([100.03, 30.01, 70.02]);
    expect(results.map((row) => row.grossCogs)).toEqual([50.03, 20.01, 30.02]);
    expect(results[0]?.netProfit).toBe(173);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.queries.filter((sql) => sql.trimStart().startsWith("SELECT"))).toHaveLength(9);
    expect(fixture.queries[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(fixture.queries.at(-1)).toBe("COMMIT");
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM finance_records")).rows[0]?.count).toBe(4);
  });

  it("rolls back a real SQL error and releases the connection without changing records", async () => {
    const fixture = pool(true);
    await expect(new FinanceService(fixture.value).summary("2026-10-01", "2026-10-02")).rejects.toThrow();
    expect(fixture.queries.at(-1)).toBe("ROLLBACK");
    expect(fixture.release).toHaveBeenCalledOnce();
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM orders")).rows[0]?.count).toBe(3);
  });
});
