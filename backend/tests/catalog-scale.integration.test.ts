import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { runIsolatedMigrations as runMigrations } from "./integration-schema.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { PostgresRateLimitStore, pruneRateLimits } from "../src/security/shared-rate-limit.js";
import { applyScaleFoundationMigration } from "../src/database/scale-foundation-migration.js";
import { readFileSync } from "node:fs";
import type { Options } from "express-rate-limit";

const url = process.env.TEST_DATABASE_URL;
const schema = `dart_scale_${randomUUID().replaceAll("-", "")}`;
let admin: Pool, pool: Pool, catalog: CatalogService;
const actor = randomUUID();
describe.skipIf(!url)("catalogue scaling preserves commerce authority", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema},public` });
    await runMigrations(pool, resolve(process.cwd(), "migrations"));
    await pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      SELECT 'SCALE-'||n,'Model '||n,40000,60000,
        '[{"name":"M","active":true}]'::jsonb,'[{"name":"Black","active":true}]'::jsonb
      FROM generate_series(1,12) n`);
    await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
      SELECT 'SCALE-I-'||n,'SCALE-I-'||n,'SCALE-'||((n-1)%12+1),'Black','M',40000
      FROM generate_series(1,120) n`);
    catalog = new CatalogService(pool);
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); } });

  it("pages stable model IDs without duplication and counts the entire matching set", async () => {
    const pages = [];
    for (let page=1; page<=3; page++) pages.push(await catalog.publicCatalog({ page, limit: 5 }));
    const ids = pages.flatMap((part) => part.models.map((row) => row.modelId));
    expect(ids).toHaveLength(12); expect(new Set(ids).size).toBe(12);
    expect(pages.every((part) => part.pagination?.total === 12)).toBe(true);
    for (const part of pages) for (const key of Object.keys(part.stock)) {
      expect(part.models.some((row) => row.modelId===JSON.parse(key)[0])).toBe(true);
    }
  });
  it("searches beyond the first page and never exposes physical inventory or cost", async () => {
    const page = await catalog.publicCatalog({ page:1, limit:1, q:"SCALE-12" });
    expect(page.pagination?.total).toBe(1); expect(page.models[0]?.modelId).toBe("SCALE-12");
    expect(page.models[0]).not.toHaveProperty("cost"); expect(page).not.toHaveProperty("items");
  });
  it("returns authoritative admin totals even when only three rows are returned", async () => {
    const page = await catalog.adminState({ page: { page:2, limit:3 } });
    expect(page.models).toHaveLength(3); expect(page.items).toHaveLength(3);
    expect(page.pagination).toEqual({ page:2, limit:3, totalModels:12, totalItems:120 });
  });
  it("patches one item without deleting or rewriting omitted models and items", async () => {
    const state = await catalog.adminState(); const item = state.items.find((row) => row.id==="SCALE-I-1")!;
    const result = await catalog.replaceState(state.version, [], [{ ...item, regDate:"2026-10-13" }], actor, "scale-item-edit", {
      models:{}, items:{ [String(item.id)]:Number(item.version) },
    });
    expect(result.items).toHaveLength(1); expect(result.models).toHaveLength(0);
    const counts = await pool.query("SELECT count(*)::int AS total, count(*) FILTER(WHERE version=1)::int AS untouched FROM inventory_items");
    expect(counts.rows[0]).toEqual({ total:120, untouched:119 });
    const models = await pool.query("SELECT count(*)::int AS total FROM catalog_models WHERE NOT is_deleted");
    expect(models.rows[0].total).toBe(12);
    const audit = await pool.query("SELECT old_values,new_values FROM audit_logs WHERE action='CATALOG_RECORDS_PATCHED'");
    expect(audit.rows[0].old_values.items).toHaveLength(1);
  });
  it("rejects a stale edit and permits independent records from the same older catalogue snapshot", async () => {
    const state = await catalog.adminState(), items = state.items.filter((row) => ["SCALE-I-2","SCALE-I-3"].includes(String(row.id)));
    const patch = (item: Record<string, unknown>) => catalog.replaceState(state.version, [], [{ ...item, regDate:"new" }], actor,"parallel-edit",{
      models:{},items:{ [String(item.id)]:Number(item.version) },
    });
    await expect(Promise.all(items.map(patch))).resolves.toHaveLength(2);
    await expect(patch(items[0]!)).rejects.toMatchObject({ code:"CATALOG_VERSION_CONFLICT" });
  });
  it("validates changed model variants against every related physical unit", async () => {
    const state = await catalog.adminState(), model=state.models.find((row) => row.modelId==="SCALE-4")!;
    await expect(catalog.replaceState(state.version,[{ ...model,sizeOptions:[{name:"L",active:true}] }],[],actor,"invalid-variant",{
      models:{ "SCALE-4":Number(model.version) },items:{},
    })).rejects.toMatchObject({ code:"ITEM_VARIANT_INVALID" });
  });
  it("releases the write connection before reading its response with a one-connection pool", async () => {
    const single = new Pool({ connectionString:url,max:1,connectionTimeoutMillis:1000,options:`-c search_path=${schema},public` });
    try {
      const service = new CatalogService(single), state=await service.adminState();
      const item=state.items.find((row)=>row.id==="SCALE-I-6")!;
      const saved=await service.replaceState(state.version,[],[{...item,regDate:"single-pool"}],actor,"single-pool",{
        models:{},items:{[String(item.id)]:Number(item.version)},
      });
      expect(saved.items[0]?.regDate).toBe("single-pool");
      expect(single.waitingCount).toBe(0);
    } finally { await single.end(); }
  });
  it("invalidates public metadata by database version and always reads fresh stock", async () => {
    const before = await catalog.publicCatalog({ page:1,limit:20 });
    const state = await catalog.adminState(), model = state.models.find((row) => row.modelId==="SCALE-5")!;
    await catalog.replaceState(state.version,[{ ...model,selling:750 }],[],actor,"price-edit",{
      models:{ "SCALE-5":Number(model.version) },items:{},
    });
    const after = await catalog.publicCatalog({ page:1,limit:20 });
    expect(before.models.find((row) => row.modelId==="SCALE-5")?.selling).toBe(600);
    expect(after.models.find((row) => row.modelId==="SCALE-5")?.selling).toBe(750);
    const cart=new CommerceService(pool), token="c".repeat(64);
    const reserved=await cart.reserveCart("SCALE-CART",[{modelId:"SCALE-5",color:"Black",size:"M",quantity:1}],undefined,token);
    const current=await catalog.publicCatalog({page:1,limit:20});
    expect(current.stock[JSON.stringify(["SCALE-5","Black","M"])]).toBe(9);
    const privateState=await catalog.adminState();
    const held=privateState.items.find((row) => row.cartReservationId===reserved.reservationId)!;
    await expect(catalog.replaceState(privateState.version,[],[{...held,active:false}],actor,"unsafe-archive",{
      models:{},items:{[String(held.id)]:Number(held.version)},
    })).rejects.toMatchObject({code:"ITEM_STATE_PROTECTED"});
    await pool.query("UPDATE inventory_items SET reservation_until=now()-interval '1 second' WHERE cart_reservation_id=$1",[reserved.reservationId]);
    const expired=await catalog.publicCatalog({page:1,limit:20});
    expect(expired.stock[JSON.stringify(["SCALE-5","Black","M"])]).toBe(10);
  });
  it("increments one shared counter atomically across two independent server instances", async () => {
    const first=new PostgresRateLimitStore(pool,"test-login","p".repeat(32));
    const second=new PostgresRateLimitStore(pool,"test-login","p".repeat(32));
    first.init({windowMs:60000} as Options);second.init({windowMs:60000} as Options);
    const hits=await Promise.all(Array.from({length:20},(_,n)=>(n%2?first:second).increment("192.0.2.1")));
    expect(hits.map((row) => row.totalHits).sort((a,b)=>a-b)).toEqual(Array.from({length:20},(_,n)=>n+1));
    const stored=await pool.query("SELECT key_hash,hits FROM api_rate_limits WHERE scope='test-login'");
    expect(stored.rows[0].key_hash).toHaveLength(32); expect(Number(stored.rows[0].hits)).toBe(20);
    await pool.query("UPDATE api_rate_limits SET expires_at=now()-interval '2 hours' WHERE scope='test-login'");
    expect(await pruneRateLimits(pool)).toBe(1);
    expect((await first.increment("192.0.2.1")).totalHits).toBe(1);
  });
  it("verifies the reviewed release migration and refuses modified migration bytes", async () => {
    const sql=readFileSync(resolve(process.cwd(),"migrations/0060_scale_foundation.sql"),"utf8");
    await expect(applyScaleFoundationMigration(pool,sql,"0060_scale_foundation")).resolves.toBe(false);
    await expect(applyScaleFoundationMigration(pool,sql+"\n-- changed","0060_scale_foundation")).rejects.toThrow("checksum mismatch");
  });
  it("reserves independent carts concurrently without a global stock sweep deadlock", async () => {
    const commerce = new CommerceService(pool);
    const results = await Promise.all(Array.from({ length:12 }, (_, index) => commerce.reserveCart(
      `SCALE-PARALLEL-${index}`, [{ modelId:`SCALE-${index+1}`, color:"Black", size:"M", quantity:1 }],
      undefined, index.toString(16).padStart(64,"0"),
    )));
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.reservedItems===1)).toBe(true);
  }, 20000);
  it("skips a locked stock row while allocating an unrelated waiting request", async () => {
    const userId=randomUUID();
    await pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES ($1,'customer','scale-waiting@example.test','scale-waiting@example.test','isolated-test','active',now())`,[userId]);
    await pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES ($1,'Scale Waiting Customer','2000-01-01')",[userId]);
    await pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES ('SCALE-WAITING','Waiting Model',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`);
    await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
      VALUES ('SCALE-WAITING-ITEM','SCALE-WAITING-ITEM','SCALE-WAITING','Black','M',40000)`);
    await pool.query(`INSERT INTO waitlist_entries(customer_user_id,model_id,size,desired_color)
      VALUES ($1,'SCALE-WAITING','M','Black')`,[userId]);
    const locked=await pool.connect();
    try {
      await locked.query("BEGIN");
      await locked.query("SELECT id FROM inventory_items WHERE id='SCALE-I-120' FOR UPDATE");
      const commerce=new CommerceService(pool);
      await commerce.reserveCart("SCALE-WAITING-TRIGGER",[{modelId:"SCALE-1",color:"Black",size:"M",quantity:1}],undefined,"d".repeat(64));
      const waiting=await pool.query("SELECT status FROM waitlist_entries WHERE customer_user_id=$1",[userId]);
      expect(waiting.rows[0]?.status).toBe("reserved");
    } finally { await locked.query("ROLLBACK"); locked.release(); }
  }, 10000);
});
