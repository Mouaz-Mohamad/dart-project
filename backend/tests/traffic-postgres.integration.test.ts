// DART CODE GUIDE | backend/tests/traffic-postgres.integration.test.ts
// الغرض: اختبار SQL والترقيم وتجميع الزيارات على PostgreSQL معزول داخل الذاكرة.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrafficAnalyticsService } from "../src/modules/analytics/traffic-analytics.service.js";

const migration = readFileSync(new URL("../migrations/0062_traffic_visitor_numbers.sql", import.meta.url), "utf8");
const ids = [1, 2, 3].map(n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const accountId = "20000000-0000-4000-8000-000000000001";
let db: PGlite;
let service: TrafficAnalyticsService;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE traffic_analytics_events (
    event_key text UNIQUE, event_type text, visitor_id uuid, session_id uuid, customer_user_id uuid,
    order_code text, reservation_id text, path text, model_id text, color text, size text, quantity int,
    occurred_at timestamptz DEFAULT '2026-10-22T12:00:00Z'
  );
  CREATE TABLE orders (id uuid, customer_user_id uuid, created_at timestamptz, is_deleted bool DEFAULT false, order_source text);
  CREATE TABLE order_items (id uuid, order_id uuid);
  CREATE TABLE customers (user_id uuid, full_name text, client_code text);
  INSERT INTO customers VALUES ('${accountId}', 'Fixture Customer', 'DR-1');
  INSERT INTO traffic_analytics_events (event_key,event_type,visitor_id,session_id,occurred_at) VALUES
    ('visit:${ids[0]}:${ids[0]}','visit','${ids[0]}','${ids[0]}','2026-01-01T00:00:00Z'),
    ('visit:${ids[1]}:${ids[1]}','visit','${ids[1]}','${ids[1]}','2026-06-01T00:00:00Z');
  BEGIN; ${migration} COMMIT;`);
  const pool = { connect: async () => ({ query: (sql: string, values: unknown[] = []) => db.query(sql, values), release() {} }) } as unknown as Pool;
  service = new TrafficAnalyticsService(pool);
}, 20_000);
afterEach(async () => { await db?.close(); });

describe("traffic PostgreSQL identity and reporting", () => {
  it("backfills old visitors and retains visit-N codes while repeated/new sessions change only visits", async () => {
    await service.recordEvent({ eventType: "visit", visitorId: ids[0]!, sessionId: ids[0]! }, null);
    await service.recordEvent({ eventType: "visit", visitorId: ids[0]!, sessionId: accountId }, null);
    await service.recordEvent({ eventType: "visit", visitorId: ids[2]!, sessionId: ids[2]! }, null);
    const report = await service.report("2026-01-01", "2026-12-31", "hourly");
    expect(report.summary).toMatchObject({ uniqueVisitors: 3, visits: 4 });
    expect(report.visitors.find(row => row.visitorId === ids[0])).toMatchObject({ name: "visit-1", visitorCode: "visit-1", visits: 2 });
    expect(report.visitors.find(row => row.visitorId === ids[1])?.name).toBe("visit-2");
    expect(report.visitors.find(row => row.visitorId === ids[2])?.name).toBe("visit-3");
    expect(report.series).toHaveLength(24);
    const shorter = await service.report("2026-10-01", "2026-10-31", "daily");
    expect(shorter.visitors.find(row => row.visitorId === ids[0])?.name).toBe("visit-1");
  });

  it("merges three authenticated browsers under one account without duplicating visit events", async () => {
    for (const id of ids) await service.recordEvent({ eventType: "visit", visitorId: id, sessionId: id }, accountId);
    const report = await service.report("2026-01-01", "2026-12-31", "hourly");
    expect(report.summary).toMatchObject({ uniqueVisitors: 1, visits: 3 });
    expect(report.visitors).toHaveLength(1);
    expect(report.visitors[0]).toMatchObject({ name: "Fixture Customer", clientCode: "DR-1", type: "Customer", visits: 3 });
    expect((await db.query("SELECT count(*)::int AS count FROM traffic_analytics_visitors")).rows[0]).toEqual({ count: 3 });
  });

  it("accepts long hourly periods, respects Cairo year boundaries and keeps the ten-year bound", async () => {
    await db.exec(`INSERT INTO traffic_analytics_events (event_key,event_type,visitor_id,occurred_at) VALUES
      ('year-before','visit','${ids[2]}','2025-12-31T21:59:59Z'),
      ('year-start','visit','${ids[2]}','2025-12-31T22:00:00Z'),
      ('year-end','visit','${ids[2]}','2026-12-31T21:59:59Z'),
      ('year-after','visit','${ids[2]}','2026-12-31T22:00:00Z');`);
    const report = await service.report("2026-01-01", "2026-12-31", "hourly");
    expect(report.summary.visits).toBe(4);
    expect(report.series[0]?.visits).toBe(1);
    expect(report.series[23]?.visits).toBe(1);
    await expect(service.report("2027-01-01", "2026-01-01", "hourly")).rejects.toMatchObject({ code: "INVALID_ANALYTICS_RANGE" });
    await expect(service.report("2010-01-01", "2026-12-31", "hourly")).rejects.toMatchObject({ code: "ANALYTICS_RANGE_TOO_LARGE" });
  });

  it("protects visitor mappings with RLS and exposes no table/sequence privileges to PUBLIC", async () => {
    const result = await db.query<{ enabled: boolean; public_access: boolean }>(`SELECT c.relrowsecurity AS enabled,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) WHERE grantee=0) AS public_access
      FROM pg_class c WHERE c.relname='traffic_analytics_visitors'`);
    expect(result.rows[0]).toEqual({ enabled: true, public_access: false });
  });
});
