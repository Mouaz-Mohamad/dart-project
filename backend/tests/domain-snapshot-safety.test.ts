import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { SiteSettingsService } from "../src/modules/settings/site-settings.service.js";
import { protectRelationalMigration } from "../src/database/relational-migration-safety.js";

describe("authoritative snapshots survive partial and migration writes", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: DashboardStateService;
  const actor = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(); service = new DashboardStateService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','safety@example.test','safety@example.test','synthetic','active',now())`,[actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Safety Test')",[actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  it("rejects an empty expense list with the correct version and retains all values", async () => {
    const state = await service.read("finance_expenses");
    await service.write("finance_expenses",state.version,[{id:"EXP-1",amount:150,status:"Unpaid",date:"2026-11-12",category:"Other"}],actor,"seed-expense");
    const before = await service.read("finance_expenses");
    await expect(service.write("finance_expenses",before.version,[],actor,"bad-save")).rejects.toMatchObject({code:"DOMAIN_SNAPSHOT_INCOMPLETE"});
    expect(await service.read("finance_expenses")).toEqual(before);
    await service.write("finance_expenses",before.version,[{...before.data[0] as object,amount:200}],actor,"edit-expense");
    const audit = await store.pool.query("SELECT old_values,new_values FROM audit_logs WHERE request_id='edit-expense'");
    expect(audit.rows[0].old_values.data[0].amount).toBe(150);
    expect(audit.rows[0].new_values.data[0].amount).toBe(200);
  });

  it("blocks direct SQL replay of an empty envelope", async () => {
    await expect(store.pool.query("UPDATE dashboard_domain_state SET data=data,version=version+1 WHERE domain='finance_expenses'"))
      .rejects.toThrow("DOMAIN_SNAPSHOT_INCOMPLETE");
    expect((await service.read("finance_expenses")).data).toHaveLength(1);
  });

  it("protects existing row data while running the historical identity migration", async () => {
    await store.pool.query("BEGIN");
    try {
      await protectRelationalMigration(store.pool,"0085_unified_customer_records.sql",true);
      await store.pool.query("ALTER TABLE dashboard_domain_state DISABLE TRIGGER a_dashboard_snapshot_guard");
      await store.pool.query("UPDATE dashboard_domain_state SET data=data,version=version+1 WHERE domain='finance_expenses'");
      await protectRelationalMigration(store.pool,"0085_unified_customer_records.sql",false);
      expect((await store.pool.query("SELECT count(*)::int n FROM finance_records WHERE domain='finance_expenses'")).rows[0].n).toBe(1);
    } finally { await store.pool.query("ROLLBACK"); }
  });

  it("permits an explicit deletion of one notification and rejects stale retries", async () => {
    const before = await service.read("notifications");
    const saved = await service.write("notifications",before.version,[{id:"N-1",title:"One"},{id:"N-2",title:"Two"}],actor,"seed-notification");
    await expect(service.write("notifications",saved.version,[],actor,"empty-notification")).rejects.toMatchObject({code:"DOMAIN_SNAPSHOT_INCOMPLETE"});
    const removed = await service.write("notifications",saved.version,[],actor,"remove-notification","N-1");
    expect(removed.data).toEqual([{id:"N-2",title:"Two"}]);
    await expect(service.write("notifications",saved.version,[],actor,"retry-notification","N-1")).rejects.toMatchObject({code:"DOMAIN_VERSION_CONFLICT"});
    const empty = await service.write("notifications",removed.version,[],actor,"remove-last-notification","N-2");
    expect(empty.data).toEqual([]);
  });

  it("keeps unrelated settings when saving a single field", async () => {
    const settings = new SiteSettingsService(store.pool), initial = await settings.get(true);
    const saved = await settings.update(initial.version,{founderImage:"/founder.webp",birthdayDiscountPercent:30,shippingFeePerOrder:100},actor,"settings-seed");
    const next = await settings.update(saved.version,{shippingFeePerOrder:150},actor,"settings-partial");
    expect(next.settings).toMatchObject({founderImage:"/founder.webp",birthdayDiscountPercent:30,shippingFeePerOrder:150});
  });

  it("rejects a full empty catalogue without hiding current stock", async () => {
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES('SAFE-M','Synthetic',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
      VALUES('SAFE-I','SAFE-I','SAFE-M','Black','M',40000)`);
    const catalog = new CatalogService(store.pool), before = await catalog.adminState();
    await expect(catalog.replaceState(before.version,[],[],actor,"empty-catalog")).rejects.toMatchObject({code:"CATALOG_SNAPSHOT_INCOMPLETE"});
    expect((await catalog.adminState()).items).toHaveLength(1);
  });
});
