import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { queueOrderDispatch } from "../src/modules/commerce/commerce.whatsapp.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { customerOrderView } from "../src/modules/commerce/commerce.pricing.js";

describe("reversible dispatch preparation and physical handover", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  const actor = randomUUID(), rep = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(true); commerce = new CommerceService(store.pool);
    for (const [id, type] of [[actor,"staff"],[rep,"representative"]]) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,$2,$3,$3,'synthetic','active',now())`, [id,type,`${id}@example.test`]);
    }
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic Staff')", [actor]);
    await store.pool.query(`INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at)
      VALUES($1,'Synthetic Courier',$2,'0001','approved',$3,now())`, [rep,"1".repeat(64),actor]);
    await store.pool.query(`UPDATE site_settings SET data=jsonb_set(data,'{shippingCompanies}',$1::jsonb,true) WHERE id='main'`,
      [JSON.stringify([{id:"test-carrier",name:"Synthetic Carrier",trackingUrl:"https://example.test/track",active:true,
        coverage:{Alexandria:{all:true,cities:{}}}}])]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  async function fixture(external = false) {
    const id = randomUUID(), model = `M-${id}`, piece = `I-${id}`, code = `DIS-${id}`;
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Synthetic Model',20000,50000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`,[model]);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor,order_id)
      VALUES($1,$1,$2,'Black','M','Processing/Held',20000,$3)`,[piece,model,code]);
    await store.pool.query(`INSERT INTO orders(id,order_code,status,payment_method,subtotal_minor,final_minor,contact_snapshot,delivery_address)
      VALUES($1,$2,'Preparing','Card',50000,50000,$3::jsonb,$4::jsonb)`,[id,code,
      JSON.stringify({name:"Synthetic Customer",phone1:"01000000001"}),JSON.stringify({governorate:external?"Alexandria":"Cairo"})]);
    await store.pool.query(`INSERT INTO order_items(order_id,inventory_item_id,item_code,model_id,model_name,color,size,
      original_unit_minor,model_discount_percent,final_unit_minor,cost_snapshot_minor)
      VALUES($1,$2,$2,$3,'Synthetic Model','Black','M',50000,0,50000,20000)`,[id,piece,model]);
    return {id,code,piece,external};
  }
  async function snapshot(id: string) { return (await store.pool.query("SELECT status,version,legacy,representative_user_id FROM orders WHERE id=$1",[id])).rows[0]!; }
  async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Preparing",target:"Ready for Dispatch",
      ...(f.external?{shippingCompanyId:"test-carrier",trackingNumber:"SYN-123"}:{representativeId:rep})},"synthetic",false);
    return snapshot(f.id);
  }
  async function confirm(f: Awaited<ReturnType<typeof fixture>>) {
    const s = await snapshot(f.id);
    return commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Ready for Dispatch",target:"Out With Representative",expectedVersion:Number(s.version)},"synthetic",false);
  }
  async function events(id: string) { return (await store.pool.query("SELECT * FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_DISPATCHED'",[id])).rows; }
  const sender = (enabled = true) => new OutboxService(store.pool,{whatsappDispatchEnabled:enabled,
    whatsappDispatchTemplate:"on_the_way",whatsappSendEnabled:false,whatsappOrderConfirmationEnabled:false,
    whatsappAccessToken:"synthetic",whatsappPhoneNumberId:"123",mfaEncryptionKey:Buffer.alloc(32,7),outboxBatchSize:5});
  const provider = () => { const fn = vi.fn(async () => new Response(JSON.stringify({messages:[{id:`wamid.${randomUUID()}`}]}),{status:200})); vi.stubGlobal("fetch",fn); return fn; };

  it.each([false,true])("plans and rolls back without releasing stock, publishing tracking or queuing WhatsApp (external=%s)",async external => {
    const f=await fixture(external), s=await prepare(f);
    expect(s).toMatchObject({status:"Ready for Dispatch",representative_user_id:null});
    expect(s.legacy.deliveryShipment).toBeNull(); expect(s.legacy.dispatchConfirmedAt).toBeUndefined();
    expect(await events(f.id)).toHaveLength(0);
    expect(customerOrderView({...s.legacy,status:s.status})).not.toHaveProperty("pendingDispatch");
    await expect(commerce.representativeOrderAction(rep,f.code,"start")).rejects.toBeDefined();
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:s.status,target:"Preparing",expectedVersion:Number(s.version)},"synthetic",false);
    expect((await snapshot(f.id)).legacy.pendingDispatch).toBeNull();
    expect((await store.pool.query("SELECT status FROM inventory_items WHERE id=$1",[f.piece])).rows[0].status).toBe("Processing/Held");
  });
  it.each([false,true])("confirms the saved assignment and queues exactly once, rejects rewind/cancellation (external=%s)",async external => {
    const f=await fixture(external); await prepare(f); await confirm(f);
    const s=await snapshot(f.id); expect(s.status).toBe("Out With Representative"); expect(s.legacy.dispatchConfirmedAt).toBeTruthy();
    expect(s.representative_user_id).toBe(external?null:rep);
    if(external) expect(s.legacy.deliveryShipment).toMatchObject({type:"external",status:"Handed Over",trackingNumber:"SYN-123"});
    const c=await store.pool.connect(); await queueOrderDispatch(c,f.id); c.release(); expect(await events(f.id)).toHaveLength(1);
    for(const target of ["Ready for Dispatch","Preparing","Cancelled"] as const) {
      await expect(commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:s.status,target},"synthetic",false)).rejects.toBeDefined();
    }
    expect(await events(f.id)).toHaveLength(1);
  });
  it("rejects stale confirmation after assignment changes, and requires a version",async () => {
    const f=await fixture(), s=await prepare(f);
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:s.status,target:"Ready for Dispatch",expectedVersion:Number(s.version),representativeId:rep},"synthetic",false);
    await expect(commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:s.status,target:"Out With Representative",expectedVersion:Number(s.version)},"synthetic",false)).rejects.toMatchObject({code:"ORDER_STATE_STALE"});
    await expect(commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:s.status,target:"Out With Representative"},"synthetic",false)).rejects.toMatchObject({code:"ORDER_VERSION_REQUIRED"});
    expect(await events(f.id)).toHaveLength(0);
  });
  it("requires returning to preparation before editing a planned order's address/items",async () => {
    const f=await fixture(); await prepare(f);
    await expect(commerce.updateAdminOrder(actor,f.code,{clientName:"Changed",phone1:"01000000001",itemCodes:[f.piece],governorate:"Giza"},"synthetic"))
      .rejects.toMatchObject({code:"DISPATCH_PLAN_LOCKED"});
    expect((await snapshot(f.id)).status).toBe("Ready for Dispatch"); expect(await events(f.id)).toHaveLength(0);
  });
  it.each(["inactive","blocked"])("rechecks %s carrier coverage at physical handover",async reason => {
    const f=await fixture(true); await prepare(f);
    const saved=(await store.pool.query("SELECT data FROM site_settings WHERE id='main'")).rows[0].data;
    const next={...saved, ...(reason==="blocked" ? {blockedGovernorates:["Alexandria"]} : {
      shippingCompanies:saved.shippingCompanies.map((c: Record<string,unknown>)=>({...c,active:false}))})};
    await store.pool.query("UPDATE site_settings SET data=$1::jsonb WHERE id='main'",[JSON.stringify(next)]);
    try { await expect(confirm(f)).rejects.toBeDefined(); }
    finally { await store.pool.query("UPDATE site_settings SET data=$1::jsonb WHERE id='main'",[JSON.stringify(saved)]); }
    expect((await snapshot(f.id)).status).toBe("Ready for Dispatch"); expect(await events(f.id)).toHaveLength(0);
  });
  it("rolls back the confirmed status and WhatsApp intent if physical inventory ownership changed",async () => {
    const f=await fixture(); await prepare(f);
    await store.pool.query("UPDATE inventory_items SET order_id=NULL WHERE id=$1",[f.piece]);
    await expect(confirm(f)).rejects.toMatchObject({code:"ORDER_ITEM_OWNERSHIP_CHANGED"});
    expect((await snapshot(f.id)).status).toBe("Ready for Dispatch"); expect(await events(f.id)).toHaveLength(0);
  });
  it("retains completed COD verification when confirming an unchanged verified policy",async () => {
    const f=await fixture();
    await store.pool.query("UPDATE orders SET payment_method='Cash on Delivery',cod_verification_status='Verified' WHERE id=$1",[f.id]);
    await prepare(f); await confirm(f);
    expect((await snapshot(f.id)).status).toBe("Out With Representative"); expect(await events(f.id)).toHaveLength(1);
    expect((await store.pool.query("SELECT cod_verification_status FROM orders WHERE id=$1",[f.id])).rows[0].cod_verification_status).toBe("Verified");
  });
  it("rechecks changed COD policy at confirmation but allows returning the held parcel to preparation",async () => {
    const f=await fixture();
    await store.pool.query("UPDATE orders SET payment_method='Cash on Delivery',cod_verification_status='Verified' WHERE id=$1",[f.id]);
    await prepare(f);
    const saved=(await store.pool.query("SELECT data FROM site_settings WHERE id='main'")).rows[0].data;
    await store.pool.query("UPDATE site_settings SET data=jsonb_set(data,'{codRisk}',$1::jsonb,true) WHERE id='main'",[JSON.stringify({highOrderValueMinor:20000,restrictedOrderValueMinor:40000})]);
    try {
      await expect(confirm(f)).rejects.toMatchObject({code:"COD_VERIFICATION_REQUIRED"});
      expect(await events(f.id)).toHaveLength(0);
      await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Ready for Dispatch",target:"Preparing"},"synthetic",false);
      expect((await snapshot(f.id)).status).toBe("Preparing");
    } finally { await store.pool.query("UPDATE site_settings SET data=$1::jsonb WHERE id='main'",[JSON.stringify(saved)]); }
  });
  it("rechecks a suspended courier at handover",async () => {
    const f=await fixture(); await prepare(f);
    await store.pool.query("UPDATE users SET status='suspended' WHERE id=$1",[rep]);
    try { await expect(confirm(f)).rejects.toMatchObject({code:"REPRESENTATIVE_UNAVAILABLE"}); }
    finally { await store.pool.query("UPDATE users SET status='active' WHERE id=$1",[rep]); }
    expect((await snapshot(f.id)).status).toBe("Ready for Dispatch"); expect(await events(f.id)).toHaveLength(0);
  });
  it("rejects bypassing preparation, and never queues old outbound orders",async () => {
    const f=await fixture();
    await expect(commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Preparing",target:"Out With Representative",representativeId:rep},"synthetic",false)).rejects.toMatchObject({code:"ORDER_STATE_INVALID"});
    await store.pool.query("UPDATE orders SET status='Out With Representative',representative_user_id=$2 WHERE id=$1",[f.id,rep]);
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Out With Representative",target:"Representative On The Way"},"synthetic",false);
    expect(await events(f.id)).toHaveLength(0);
  });
  it("bulk-confirms independently prepared couriers/carriers with version checks",async () => {
    const a=await fixture(),b=await fixture(true); const sa=await prepare(a),sb=await prepare(b);
    const result=await commerce.adminBulkOrderWorkflowAction(actor,{orderRefs:[a.code,b.code],expectedStatus:"Ready for Dispatch",target:"Out With Representative",
      expectedVersions:{[a.code]:Number(sa.version),[b.code]:Number(sb.version)}},"synthetic");
    expect(result.result.failed).toHaveLength(0); expect(result.result.succeeded).toHaveLength(2);
    expect(await events(a.id)).toHaveLength(1); expect(await events(b.id)).toHaveLength(1);
  });
  it("sends one Utility template, independently of birthday/review settings, and never blindly retries unknown outcome",async () => {
    const f=await fixture(); await prepare(f); await confirm(f); const [event]=await events(f.id);
    const fetch=provider(); expect((await sender(false).processBatch(1,event.deduplication_key)).claimed).toBe(0);
    expect((await sender().processBatch(1,event.deduplication_key)).published).toBe(1);
    expect((await sender().processBatch(1,event.deduplication_key)).claimed).toBe(0); expect(fetch).toHaveBeenCalledOnce();
    const body=JSON.parse((fetch.mock.calls[0] as unknown as [string,{body:string}])[1].body);
    expect(body.template.name).toBe("on_the_way"); expect(body.template.components[0].parameters).toEqual([{type:"text",text:"Synthetic Customer"},{type:"text",text:f.code}]);
    const g=await fixture(); await prepare(g); await confirm(g); const [unknown]=await events(g.id);
    fetch.mockImplementationOnce(async () => { throw new Error("Synthetic response lost after sending"); });
    expect((await sender().processBatch(1,unknown.deduplication_key)).uncertain).toBe(1);
    expect((await sender().processBatch(1,unknown.deduplication_key)).claimed).toBe(0); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["expired","refused","delivered","phone"])("suppresses a queued message made obsolete by %s",async reason => {
    const f=await fixture(true); await prepare(f); await confirm(f); const [event]=await events(f.id);
    if(reason==="expired") await store.pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{expiresAt}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",[event.id]);
    else if(reason==="phone") await store.pool.query("UPDATE orders SET contact_snapshot=jsonb_set(contact_snapshot,'{phone1}','\"01100000001\"') WHERE id=$1",[f.id]);
    else await store.pool.query("UPDATE orders SET status=$2 WHERE id=$1",[f.id,reason==="refused"?"Refused":"Delivered"]);
    const fetch=provider(); await sender().processBatch(1,event.deduplication_key); expect(fetch).not.toHaveBeenCalled();
  });
  it("route interruption preserves the original handover timestamp and message intent",async () => {
    const f=await fixture(); await prepare(f); await confirm(f); const first=await snapshot(f.id);
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Out With Representative",target:"Representative On The Way"},"synthetic",false);
    await commerce.adminOrderWorkflowAction(actor,f.code,{expectedStatus:"Representative On The Way",target:"Out With Representative"},"synthetic",false);
    expect((await snapshot(f.id)).legacy.dispatchConfirmedAt).toBe(first.legacy.dispatchConfirmedAt); expect(await events(f.id)).toHaveLength(1);
  });
});
