import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import pino from "pino";
import { createApp } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { bindMigrationFunctionsToIsolatedTestSchema } from "../tests/integration-schema.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required; this benchmark never uses DATABASE_URL.");
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.includes("test"))
  throw new Error("This synthetic fixture is restricted to a local test database.");
const orderCount = Number(process.env.BENCH_ORDER_COUNT || 1000);
if (!Number.isInteger(orderCount) || orderCount < 100 || orderCount > 5000)
  throw new Error("BENCH_ORDER_COUNT must be between 100 and 5000.");

const schema = `dart_order_bench_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({ connectionString: databaseUrl, max: 10, options: `-c search_path=${schema},public` });
let server: Server | undefined;
let monitor: ReturnType<typeof setInterval> | undefined;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await runMigrations(pool, resolve(process.cwd(), "migrations"));
  await bindMigrationFunctionsToIsolatedTestSchema(pool);
  await pool.query(`INSERT INTO orders(order_code,status,payment_method,subtotal_minor,final_minor,contact_snapshot,delivery_address)
    SELECT 'BENCH-' || value,'New','Cash on Delivery',60000,60000,
      '{"name":"Synthetic Customer","phone1":"+201000000000"}'::jsonb,'{}'::jsonb
    FROM generate_series(1,$1::int) value`, [orderCount]);
  const order = await pool.query<{ id: string }>("SELECT id::text FROM orders WHERE order_code='BENCH-1'");
  await pool.query("INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor) VALUES ('BENCH-MODEL','Synthetic Model',40000,60000)");
  await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor,order_id)
    VALUES ('BENCH-ITEM','BENCH-ITEM','BENCH-MODEL','Black','M','Processing/Held',40000,'BENCH-1')`);
  await pool.query(`INSERT INTO order_items(order_id,inventory_item_id,item_code,model_id,model_name,color,size,
    original_unit_minor,final_unit_minor,cost_snapshot_minor)
    VALUES ($1,'BENCH-ITEM','BENCH-ITEM','BENCH-MODEL','Synthetic Model','Black','M',60000,60000,40000)`, [order.rows[0]!.id]);

  const commerce = new CommerceService(pool);
  const actorId = randomUUID();
  const samples: Record<"full" | "delta", Array<{ ms: number; bytes: number; rows: number }>> = { full: [], delta: [] };
  for (let index = 0; index < 10; index += 1) {
    for (const mode of ["full", "delta"] as const) {
      const baseVersion = await commerce.adminOrdersVersion();
      const start = performance.now();
      const result = await commerce.adminOrderWorkflowAction(actorId, "BENCH-1",
        { expectedStatus: mode === "full" ? "New" : "Accepted", target: mode === "full" ? "Accepted" : "New" },
        `benchmark-${index}-${mode}`, true, mode === "delta" ? { responseMode: "delta", baseVersion } : undefined);
      if (mode === "delta" && result.responseMode !== "delta") throw new Error("Synthetic delta failed its version guard.");
      samples[mode].push({ ms: performance.now() - start, bytes: Buffer.byteLength(JSON.stringify(result)), rows: result.orders.length });
    }
  }
  const summarize = (rows: typeof samples.full) => ({
    meanMs: Math.round(rows.reduce((total, row) => total + row.ms, 0) / rows.length * 100) / 100,
    meanBytes: Math.round(rows.reduce((total, row) => total + row.bytes, 0) / rows.length), returnedOrders: rows[0]!.rows,
  });

  const sessionId = randomUUID();
  const cookie = `dart_session=${sessionId}.${"b".repeat(43)}`;
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, LOG_LEVEL: "silent", RATE_LIMIT_MAX: "100000" });
  // Test identity only: real routes, permissions, services and PostgreSQL reads remain in the load path.
  const identity = { authenticate: async () => ({ userId: actorId, accountType: "staff", status: "active",
    email: "benchmark@example.test", emailVerified: true, mustChangePassword: false, sessionId,
    sessionFamilyId: randomUUID(), csrfTokenHash: "unused-for-reads", mfaRequired: true, mfaSatisfied: true,
    permissions: ["orders.read", "inventory.read", "returns.read"] }) } as unknown as IdentityService;
  const app = createApp(config, { logger: pino({ level: "silent" }), identityService: identity,
    commerceService: commerce, catalogService: new CatalogService(pool), dashboardStateService: new DashboardStateService(pool),
    databasePing: async () => { await pool.query("SELECT 1"); }, startedAt: new Date(), version: "synthetic-benchmark" });
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const moduleUrl = new URL("../../scripts/load-store.mjs", import.meta.url).href;
  const { runLoad }: { runLoad: (options: Record<string, unknown>) => Promise<{ passed: boolean }> } = await import(moduleUrl);
  let peakPoolWaiters = 0;
  monitor = setInterval(() => { peakPoolWaiters = Math.max(peakPoolWaiters, pool.waitingCount); }, 10);
  const stages = [];
  for (const users of [10, 25, 50]) stages.push(await runLoad({ baseUrl, users, duration: 3,
    thinkMs: 100, maxRequests: 250, profile: "admin", cookie }));
  console.log(JSON.stringify({ environment: "isolated local PostgreSQL; synthetic identity and data; not production capacity",
    orderCount, poolMax: 10, responseComparison: { full: summarize(samples.full), delta: summarize(samples.delta) },
    peakPoolWaiters, stages }, null, 2));
  process.exitCode = stages.every((stage) => stage.passed) ? 0 : 1;
} finally {
  clearInterval(monitor);
  if (server) { server.closeIdleConnections(); await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done())); }
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
