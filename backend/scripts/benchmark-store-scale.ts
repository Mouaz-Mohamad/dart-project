// Isolated synthetic catalog benchmark; never uses production DATABASE_URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import pino from "pino";
import { createApp } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { bindMigrationFunctionsToIsolatedTestSchema } from "../tests/integration-schema.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required; production DATABASE_URL is never used.");
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.includes("test"))
  throw new Error("Only a local test database is permitted for synthetic fixtures.");
const schema = `dart_scale_bench_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({ connectionString: databaseUrl, max: 10, options: `-c search_path=${schema},public` });
let server: Server | undefined, monitor: ReturnType<typeof setInterval> | undefined;
let created = false;
const sizes = { models: 1000, items: 10000, customers: 10000 };
const summarize = (samples: Array<{ ms: number; ok: boolean }>) => {
  const values = samples.map((row) => row.ms).sort((a, b) => a - b);
  const percentile = (q: number) => Math.round(values[Math.max(0, Math.ceil(values.length * q) - 1)]!);
  return { requests: samples.length, errors: samples.filter((row) => !row.ok).length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
};
try {
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  await runMigrations(pool, resolve(process.cwd(), "migrations"));
  await bindMigrationFunctionsToIsolatedTestSchema(pool);
  await pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
    SELECT 'BENCH-'||n,'Synthetic Model '||n,40000,60000,
      '[{"name":"M","active":true}]'::jsonb,'[{"name":"Black","active":true}]'::jsonb
    FROM generate_series(1,$1::int) n`, [sizes.models]);
  await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
    SELECT 'BENCH-I-'||n,'BENCH-I-'||n,'BENCH-'||((n-1)%$2::int+1),'Black','M',40000
    FROM generate_series(1,$1::int) n`, [sizes.items, sizes.models]);
  await pool.query(`INSERT INTO users(account_type,email,email_normalized,password_hash,status,email_verified_at)
    SELECT 'customer','scale-'||n||'@example.test','scale-'||n||'@example.test','synthetic-only','active',now()
    FROM generate_series(1,$1::int) n`, [sizes.customers]);
  await pool.query(`INSERT INTO customers(user_id,full_name,birthday)
    SELECT id,'Synthetic Customer','2000-01-01' FROM users WHERE account_type='customer'`);
  const catalog = new CatalogService(pool), commerce = new CommerceService(pool), actor = randomUUID();
  const state = await catalog.adminState(), item = state.items.find((row) => row.id === "BENCH-I-1")!;
  const patch = { expectedVersion: state.version, models: [], items: [{ ...item, regDate: "2026-10-13" }],
    recordVersions: { models: {}, items: { [String(item.id)]: Number(item.version) } } };
  const startEdit = performance.now();
  const saved = await catalog.replaceState(state.version, patch.models, patch.items, actor, "scale-benchmark", patch.recordVersions);
  const unchanged = await pool.query<{ total: number }>("SELECT count(*)::int AS total FROM inventory_items WHERE version=1");
  assert.equal(unchanged.rows[0]?.total, sizes.items - 1);
  const edit = { fullRequestBytes: Buffer.byteLength(JSON.stringify({ expectedVersion: state.version, models: state.models, items: state.items })),
    patchRequestBytes: Buffer.byteLength(JSON.stringify(patch)), patchResponseBytes: Buffer.byteLength(JSON.stringify(saved)),
    directServiceMs: Math.round(performance.now() - startEdit), untouchedItems: unchanged.rows[0]!.total };

  const sessionId = randomUUID(), cookie = `dart_session=${sessionId}.${"b".repeat(43)}`;
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, LOG_LEVEL: "silent", RATE_LIMIT_MAX: "100000" });
  const identity = { authenticate: async () => ({ userId: actor, accountType: "staff", status: "active",
    email: "scale-benchmark@example.test", emailVerified: true, mustChangePassword: false, sessionId,
    sessionFamilyId: randomUUID(), csrfTokenHash: "unused-for-reads", mfaRequired: true, mfaSatisfied: true,
    permissions: ["catalog.read"] }) } as unknown as IdentityService;
  const app = createApp(config, { logger: pino({ level: "silent" }), identityService: identity,
    catalogService: catalog, commerceService: commerce, databasePing: async () => { await pool.query("SELECT 1"); },
    startedAt: new Date(), version: "synthetic-scale-benchmark" });
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const paths = ["/api/v1/catalog?page=1&limit=50", "/api/v1/catalog/version", "/api/v1/admin/catalog-state?page=1&limit=50"];
  let peakPoolWaiters = 0;
  monitor = setInterval(() => { peakPoolWaiters = Math.max(peakPoolWaiters, pool.waitingCount); }, 10);
  const stages = [];
  for (const users of [25, 100, 250, 1000]) {
    const samples: Array<{ ms: number; ok: boolean }> = [], started = performance.now();
    await Promise.all(Array.from({ length: users }, async (_, user) => {
      for (let turn = 0; turn < 2; turn++) {
        const startedRequest = performance.now(); let ok = false;
        try {
          const response = await fetch(`${origin}${paths[(user * 2 + turn) % paths.length]}`, {
            headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000),
          });
          await response.arrayBuffer(); ok = response.ok;
        } catch { /* Count failures without dumping credentials or responses. */ }
        samples.push({ ms: performance.now() - startedRequest, ok });
      }
    }));
    const result = summarize(samples);
    stages.push({ users, ...result, elapsedMs: Math.round(performance.now() - started), passesDiagnosticTarget: result.errors === 0 && result.p95Ms < 2000 });
  }
  const cartSamples = await Promise.all(Array.from({ length: 100 }, async (_, n) => {
    const started = performance.now();
    try {
      await commerce.reserveCart(`BENCH-CART-${n}`, [{ modelId: `BENCH-${n + 1}`, color: "Black", size: "M", quantity: 1 }], undefined, n.toString(16).padStart(64, "0"));
      return { ms: performance.now() - started, ok: true };
    } catch { return { ms: performance.now() - started, ok: false }; }
  }));
  assert.equal(summarize(cartSamples).errors, 0);
  await pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
    VALUES ('BENCH-LAST','Last unit',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`);
  await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
    VALUES ('BENCH-LAST-ITEM','BENCH-LAST-ITEM','BENCH-LAST','Black','M',40000)`);
  const contenders = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => commerce.reserveCart(`BENCH-LAST-CART-${n}`,
    [{ modelId: "BENCH-LAST", color: "Black", size: "M", quantity: 1 }], undefined, (n + 100).toString(16).padStart(64, "0"))));
  const winners = contenders.filter((row) => row.status === "fulfilled").length;
  assert.equal(winners, 1);
  assert.ok(contenders.filter((row) => row.status === "rejected").every((row) => row.reason?.code === "STOCK_INSUFFICIENT"));
  console.log(JSON.stringify({ environment: "local PostgreSQL; synthetic identity and data; not a production capacity proof",
    sizes, poolMax: 10, edit, stages, peakPoolWaiters, carts: summarize(cartSamples), lastUnit: { contenders: 20, winners } }, null, 2));
  process.exitCode = stages.every((stage) => stage.passesDiagnosticTarget) ? 0 : 1;
} finally {
  clearInterval(monitor);
  if (server) { server.closeIdleConnections(); await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done())); }
  await pool.end();
  if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
