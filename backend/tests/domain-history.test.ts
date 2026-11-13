// DART CODE GUIDE | backend/tests/domain-history.test.ts
// Regression-safe data and release boundaries.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CatalogAssetService } from "../src/modules/catalog/catalog.asset.service.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";

describe("domain writes preserve row history and isolate unrelated records", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: DashboardStateService;
  const actor = randomUUID();
  beforeAll(async () => {
    store=await embeddedStore(); service=new DashboardStateService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','history@example.test','history@example.test','synthetic','active',now())`,[actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'History Test')",[actor]);
  },30000);
  afterAll(async () => { await store?.db.close(); });

  it("keeps referenced campaign rows, creation time and monotonically increasing versions", async () => {
    await store.pool.query(`INSERT INTO promotion_records(record_id,position,payload,version,created_at,updated_by)
      VALUES ('P-1',1,'{"id":"P-1","code":"ONE","name":"Before"}',7,'2026-01-01',$1),
      ('P-2',2,'{"id":"P-2","code":"TWO","name":"Unchanged"}',4,'2026-01-01',$1)`,[actor]);
    await store.pool.query("CREATE TABLE history_reference(campaign text REFERENCES promotion_records(record_id) ON DELETE RESTRICT)");
    await store.pool.query("INSERT INTO history_reference VALUES('P-1')");
    const before=await store.pool.query("SELECT record_id,version,created_at,updated_at,updated_by FROM promotion_records ORDER BY record_id");
    await store.pool.query(`UPDATE dashboard_domain_state SET data=$1::jsonb,version=version+1,updated_by=$2 WHERE domain='promotions'`,
      [JSON.stringify([{id:"P-1",code:"ONE",name:"After"},{id:"P-2",code:"TWO",name:"Unchanged"}]),actor]);
    const after=await store.pool.query("SELECT record_id,version,created_at,updated_at,updated_by FROM promotion_records ORDER BY record_id");
    expect(Number(after.rows[0].version)).toBe(8);
    expect(after.rows[0].created_at).toEqual(before.rows[0].created_at);
    expect(after.rows[0].updated_by).toBe(actor);
    expect(after.rows[1]).toEqual(before.rows[1]);
    expect((await store.pool.query("SELECT count(*)::int n FROM history_reference")).rows[0].n).toBe(1);
    await expect(store.pool.query(`UPDATE dashboard_domain_state SET data='[]' WHERE domain='promotions'`))
      .rejects.toThrow("DOMAIN_SNAPSHOT_INCOMPLETE");
  });

  it("omits image bytes for redirects and matching ETags in a single database query", async () => {
    await store.pool.query(`INSERT INTO catalog_assets(asset_id,original_name,content_type,content,byte_size,sha256,created_by)
      VALUES('history-image','fixture.png','image/png',decode('010203','hex'),3,'synthetic-hash',$1)`,[actor]);
    const assets=new CatalogAssetService(store.pool);
    expect((await assets.get("history-image",""))?.content).toBeNull();
    expect((await assets.get("history-image","synthetic-hash",'"synthetic-hash"'))?.content).toBeNull();
    expect(Array.from((await assets.get("history-image","synthetic-hash"))!.content!)).toEqual([1,2,3]);
  });

  it("records committed financial changes once and makes old events immutable", async () => {
    const before=await service.read("finance_expenses");
    const expense={id:"EXP-H",amount:150,date:"2026-11-14",category:"Other",status:"Unpaid"};
    await service.write("finance_expenses",before.version,[expense],actor,"history-create");
    const audit=await service.read("finance_audit");
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0]).toMatchObject({action:"INSERT",entityId:"EXP-H",actorId:actor,requestId:"history-create",before:null,after:expense});
    const current=await service.read("finance_expenses");
    await service.write("finance_expenses",current.version,[expense],actor,"history-no-change");
    expect((await service.read("finance_audit")).data).toEqual(audit.data);
    await expect(service.write("finance_audit",audit.version,audit.data,actor,"forge-history")).rejects.toMatchObject({code:"FINANCE_AUDIT_READ_ONLY"});
    await expect(store.pool.query("UPDATE finance_records SET payload=payload || '{\"action\":\"FAKE\"}' WHERE domain='finance_audit'"))
      .rejects.toThrow("FINANCE_AUDIT_IMMUTABLE");
    await expect(store.pool.query("DELETE FROM finance_records WHERE domain='finance_audit'"))
      .rejects.toThrow("FINANCE_AUDIT_IMMUTABLE");
    expect((await service.read("finance_audit")).data).toEqual(audit.data);
    const edited=await service.read("finance_expenses");
    await service.write("finance_expenses",edited.version,[{...expense,amount:200}],actor,"history-edit");
    const events=(await service.read("finance_audit")).data as Array<Record<string,unknown>>;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({action:"UPDATE",before:expense,after:{...expense,amount:200}});
    expect((await service.read("reviews")).data).toEqual([]);
    expect(Number((await store.pool.query("SELECT version FROM promotion_records WHERE record_id='P-1'")).rows[0].version)).toBe(8);
  });
});
