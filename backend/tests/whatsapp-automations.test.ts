import { createHmac, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { BirthdayMessagingService } from "../src/modules/outbox/birthday-messaging.service.js";
import { WaitingService } from "../src/modules/waiting/waiting.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { createWhatsAppWebhookRouter } from "../src/modules/outbox/whatsapp-webhook.routes.js";
import { whatsappSendWindow } from "../src/modules/outbox/whatsapp-schedule.js";
import { requestContext } from "../src/middleware/request-context.js";
import { scrubSentryEvent } from "../src/modules/monitoring/sentry-scrub.js";
import { loadConfig } from "../src/config/env.js";

const config = { whatsappSendEnabled: true, whatsappAccessToken: "synthetic-only", whatsappPhoneNumberId: "123",
  whatsappGraphApiVersion: "v26.0", whatsappTemplateLanguage: "ar", whatsappPostDeliveryTemplate: "synthetic_review",
  outboxBatchSize: 5, mfaEncryptionKey: Buffer.alloc(32,7) };
const activeClock = () => { const date = new Date(); date.setUTCHours(12,0,0,0); return date; };
const quietClock = () => { const date = new Date(); date.setUTCHours(22,0,0,0); return date; };
const secret = "synthetic-meta-secret", verify = "v".repeat(40);
describe("durable WhatsApp automations and receipts", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  beforeAll(async () => { store = await embeddedStore(true); },30000);
  afterAll(async () => { await store?.db.close(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  async function customer(birthday = "2000-01-01") {
    const id=randomUUID(), phone="2010"+String(Math.floor(Math.random()*100000000)).padStart(8,"0");
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status)
      VALUES($1,'customer',$2,$2,'synthetic','active')`,[id,`${id}@example.test`]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer',$2::date)",[id,birthday]);
    await store.pool.query(`INSERT INTO account_phones(user_id,account_type,phone_normalized,phone_display,is_primary)
      VALUES($1,'customer',$2,$2,true)`,[id,phone]);
    return {id,phone};
  }
  async function delivered(consent=true, markDelivered=true) {
    const buyer=await customer();
    const preferences=new BirthdayMessagingService(store.pool,"synthetic_birthday");
    if(consent) {
      await preferences.setPreference(buyer.id,false,"synthetic",true);
      await store.pool.query("UPDATE customer_whatsapp_preferences SET review_consented_at=now()-interval '2 days' WHERE customer_user_id=$1",[buyer.id]);
    }
    const order=(await store.pool.query(`INSERT INTO orders(customer_user_id,status,subtotal_minor,final_minor,delivery_address)
      VALUES($1,'New',0,0,'{}') RETURNING id::text`,[buyer.id])).rows[0]!.id as string;
    if(markDelivered)await store.pool.query("UPDATE orders SET status='Delivered',delivered_at=now()-interval '7 hours' WHERE id=$1",[order]);
    const key=`post-delivery-review:${order}`;
    return {...buyer,order,key,preferences};
  }
  const sender=(enabled=true,clock=activeClock) => new OutboxService(store.pool,{...config,whatsappSendEnabled:enabled},null,null,clock);
  const fakeProvider=() => { const fn=vi.fn(async(...args: unknown[])=>{void args;return new Response(JSON.stringify({messages:[{id:`wamid.${randomUUID()}`}]}),{status:200});});vi.stubGlobal("fetch",fn);return fn; };
  async function makeDue(key:string) {
    await store.pool.query("UPDATE outbox_events SET available_at=now()-interval '1 minute' WHERE deduplication_key=$1",[key]);
  }
  it.each([
    ["2026-10-28T05:00:00+03:00","2026-10-28 13:00"],
    ["2026-10-28T07:00:00+03:00","2026-10-28 14:00"],
    ["2026-10-28T14:30:00+03:00","2026-10-28 21:30"],
    ["2026-10-28T15:00:00+03:00","2026-10-29 13:00"],
    ["2026-10-28T23:00:00+03:00","2026-10-29 13:00"],
    ["2026-10-29T20:00:00+03:00","2026-10-30 13:00"],
    ["2026-12-01T06:00:00+02:00","2026-12-01 13:00"],
  ])("schedules delivery %s at %s using Cairo and seven elapsed hours",async(input,expected)=>{
    const row=(await store.pool.query(`SELECT to_char(dart_whatsapp_send_at($1::timestamptz+interval '7 hours')
      AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS scheduled`,[input])).rows[0]!;
    expect(row.scheduled).toBe(expected);
  });
  it("requires independent review consent and queues only a new delivery, once",async()=>{
    const no=await delivered(false);
    expect((await store.pool.query("SELECT id FROM outbox_events WHERE deduplication_key=$1",[no.key])).rows).toHaveLength(0);
    const yes=await delivered();
    await store.pool.query("UPDATE orders SET status='Delivered' WHERE id=$1",[yes.order]);
    const events=await store.pool.query("SELECT payload,available_at FROM outbox_events WHERE deduplication_key=$1",[yes.key]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload).toMatchObject({category:"utility",channel:"whatsapp",orderId:yes.order});
    expect((await yes.preferences.preference(yes.id)).postDeliveryReview).toBe(true);
    expect((await yes.preferences.preference(yes.id)).birthdayMarketing).toBe(false);
  });
  it("keeps WhatsApp pending without using retries when disabled or outside the window",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);const fetch=fakeProvider();
    expect((await sender(false).processBatch(5,buyer.key)).claimed).toBe(0);
    expect((await sender(true,quietClock).processBatch(5,buyer.key)).claimed).toBe(0);
    const event=(await store.pool.query("SELECT status,attempts FROM outbox_events WHERE deduplication_key=$1",[buyer.key])).rows[0]!;
    expect(event).toMatchObject({status:"pending",attempts:0});expect(fetch).not.toHaveBeenCalled();
    expect((await sender(false).health()).duePending).toBe(0);
    expect((await sender(true,quietClock).health()).duePending).toBe(0);
  });
  it("keeps Email working when WhatsApp is disabled",async()=>{
    const key=`synthetic-email:${randomUUID()}`;
    await store.pool.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
      VALUES('synthetic','synthetic','order.created','{"channel":"email","to":"synthetic@example.test","parameters":{}}',$1)`,[key]);
    const send=vi.fn(async()=>{});
    const service=new OutboxService(store.pool,{...config,whatsappSendEnabled:false},{configured:()=>true,send});
    expect((await service.processBatch(1,key)).published).toBe(1);expect(send).toHaveBeenCalledOnce();
  });
  it("rolls back the queued follow-up together with the delivery transaction",async()=>{
    const buyer=await delivered(true,false), key=buyer.key;
    await store.pool.query("BEGIN");
    try {
      await store.pool.query("UPDATE orders SET status='Delivered',delivered_at=now()-interval '7 hours' WHERE id=$1",[buyer.order]);
      expect((await store.pool.query("SELECT id FROM outbox_events WHERE deduplication_key=$1",[key])).rows).toHaveLength(1);
    } finally { await store.pool.query("ROLLBACK"); }
    expect((await store.pool.query("SELECT id FROM outbox_events WHERE deduplication_key=$1",[key])).rows).toHaveLength(0);
  });
  it("sends one eligible order follow-up and never resends on worker replay",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);const fetch=fakeProvider();
    expect((await sender().processBatch(5,buyer.key)).published).toBe(1);
    expect((await sender().processBatch(5,buyer.key)).claimed).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    const payload=JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(payload.template.name).toBe("synthetic_review");
    expect(payload.template.components[0].parameters).toHaveLength(2);
  });
  it("matches approved fixed-text review template without sending obsolete body variables",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);const fetch=fakeProvider();
    const approved=new OutboxService(store.pool,{...config,whatsappPostDeliveryTemplate:"share_your_experience_2"},null,null,activeClock);
    expect((await approved.processBatch(1,buyer.key)).published).toBe(1);
    const sent=JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(sent.template.name).toBe("share_your_experience_2");
    expect(sent.template.components).toBeUndefined();
  });
  it("matches approved birthday template with a required JPEG image header and no body variables",async()=>{
    const today=(await store.pool.query("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS today")).rows[0]!.today as string;
    const buyer=await customer(`2000-${today.slice(5)}`);
    const birthday=new BirthdayMessagingService(store.pool,"birthday");
    await birthday.setPreference(buyer.id,true,"birthday-test");
    await birthday.queueToday();
    const key=`birthday:${buyer.id}:${today}`;await makeDue(key);
    const fetch=fakeProvider();
    expect((await sender().processBatch(1,key)).published).toBe(1);
    const sent=JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(sent.template.name).toBe("birthday");
    expect(sent.template.components).toEqual([{
      type:"header",parameters:[{type:"image",image:{link:"https://www.dartofficial.com/Photos/dart-birthday-reward.jpg"}}],
    }]);
  });
  async function restockFixture(optIn: boolean) {
    const buyer=await customer();
    const modelId="restock-"+randomUUID();
    await store.pool.query(
      `INSERT INTO catalog_models(model_id,name,size_options,color_options)
       VALUES($1,'Restock Test Shirt','[{"name":"M","active":true}]','[{"name":"Burgundy","active":true}]')`,[modelId]);
    const waiting=new WaitingService(store.pool);
    const entry=await waiting.join(buyer.id,{modelId,size:"M",color:"Burgundy",whatsappRestockOptIn:optIn},randomUUID());
    const itemId="restock-item-"+randomUUID();
    // Restock holds remain the normal four hours, even outside WhatsApp quiet hours.
    await store.pool.query(
      `INSERT INTO inventory_items(id,item_code,model_id,color,size,cost_snapshot_minor)
       VALUES($1,$1,$2,'Burgundy','M',10000)`,[itemId,modelId]);
    const rows=await store.pool.query<{deduplication_key:string,payload:Record<string,unknown>}>(
      `SELECT deduplication_key,payload FROM outbox_events
       WHERE aggregate_type='waitlist' AND event_type='WAITLIST_WHATSAPP_RESTOCK' AND aggregate_id=$1`,[entry.id]);
    return {...buyer,entry,itemId,event:rows.rows[0]||null};
  }
  it("atomically reserves stock for Waiting when an admin adds the physical piece via CatalogService",async()=>{
    const buyer=await customer();
    const modelId="restock-admin-"+randomUUID();
    await store.pool.query(
      `INSERT INTO catalog_models(model_id,name,size_options,color_options)
       VALUES($1,'Dashboard restock','[{"name":"M","active":true}]','[{"name":"Red","active":true}]')`,[modelId]);
    const waiting=new WaitingService(store.pool);
    const entry=await waiting.join(buyer.id,{
      modelId,size:"M",color:"Red",whatsappRestockOptIn:true,
    },randomUUID());
    const catalog=new CatalogService(store.pool);
    const prior=await catalog.adminState();
    const id=randomUUID();
    await catalog.replaceState(prior.version,[],[{
      id,itemCode:"test-"+id,modelId,color:"Red",size:"M",
      status:"In stock",active:true,isArchived:false,isDeleted:false,
    }],randomUUID(),"restock-admin-save",{models:{},items:{[id]:0}});
    const allocation=(await store.pool.query(
      `SELECT w.status,wa.status AS allocation_status,wa.match_type,i.status AS item_status,
              e.event_type,e.available_at,e.created_at
         FROM waitlist_entries w JOIN waitlist_allocations wa ON wa.waitlist_entry_id=w.id
         JOIN inventory_items i ON i.id=wa.inventory_item_id
         LEFT JOIN outbox_events e ON e.aggregate_id=w.id::text AND e.event_type='WAITLIST_WHATSAPP_RESTOCK'
        WHERE w.id=$1`,[entry.id])).rows[0];
    expect(allocation).toMatchObject({
      status:"reserved",allocation_status:"active",match_type:"exact",
      item_status:"Cart Reserved",event_type:"WAITLIST_WHATSAPP_RESTOCK",
    });
    expect(Math.abs(new Date(allocation.available_at).getTime()-new Date(allocation.created_at).getTime()))
      .toBeLessThan(30000);
  });
  it("keeps Waiting available when WhatsApp is requested but the account has no primary phone",async()=>{
    const buyer=await customer();
    await store.pool.query("DELETE FROM account_phones WHERE user_id=$1",[buyer.id]);
    const modelId="restock-no-phone-"+randomUUID();
    await store.pool.query(
      `INSERT INTO catalog_models(model_id,name,size_options,color_options)
       VALUES($1,'Unstocked model','[{"name":"M","active":true}]','[{"name":"Burgundy","active":true}]')`,[modelId]);
    const waiting=new WaitingService(store.pool);
    const entry=await waiting.join(buyer.id,{
      modelId,size:"M",color:"Burgundy",whatsappRestockOptIn:true,
    },randomUUID());
    expect(entry.status).toBe("waiting");
    const saved=(await store.pool.query(
      "SELECT whatsapp_restock_opt_in_at,whatsapp_restock_phone_normalized FROM waitlist_entries WHERE id=$1",
      [entry.id])).rows[0];
    expect(saved).toMatchObject({
      whatsapp_restock_opt_in_at:null,whatsapp_restock_phone_normalized:null,
    });
  });
  it("queues a single Marketing restock only after explicit consent for the exact item",async()=>{
    const without=await restockFixture(false);
    expect(without.event).toBeNull();
    const withConsent=await restockFixture(true);
    expect(withConsent.event?.payload).toMatchObject({
      channel:"whatsapp",category:"marketing",to:withConsent.phone,
      parameters:["Restock Test Shirt","Burgundy","M"],
    });
    const count=(await store.pool.query(
      "SELECT count(*)::int AS total FROM outbox_events WHERE deduplication_key=$1",
      [withConsent.event!.deduplication_key])).rows[0]!.total;
    expect(Number(count)).toBe(1);
  });
  it("sends opted-in restock promptly even outside birthday/review WhatsApp hours",async()=>{
    const fresh=await restockFixture(true);
    expect(fresh.event).not.toBeNull();
    const fetch=fakeProvider();
    const send=new OutboxService(store.pool,{...config,whatsappRestockTemplate:"dart_restock_available"},null,null,quietClock);
    expect(whatsappSendWindow(quietClock())).toBe(false);
    expect((await send.health()).duePending).toBeGreaterThan(0);
    expect((await send.processBatch(1,fresh.event!.deduplication_key)).published).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect((await send.processBatch(1,fresh.event!.deduplication_key)).claimed).toBe(0);
    const sent=JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(sent.template.name).toBe("dart_restock_available");
    const queued=(await store.pool.query(
      "SELECT available_at, created_at FROM outbox_events WHERE deduplication_key=$1",
      [fresh.event!.deduplication_key])).rows[0];
    expect(Math.abs(new Date(queued.available_at).getTime()-new Date(queued.created_at).getTime())).toBeLessThan(30000);
  });
  it("sends approved restock variables once; suppresses stale phone after consent",async()=>{
    const fresh=await restockFixture(true);
    expect(fresh.event).not.toBeNull();
    await makeDue(fresh.event!.deduplication_key);
    const fetch=fakeProvider();
    const restockSender=new OutboxService(store.pool,{...config,whatsappRestockTemplate:"dart_restock_available"},null,null,activeClock);
    expect((await restockSender.processBatch(1,fresh.event!.deduplication_key)).published).toBe(1);
    expect((await restockSender.processBatch(1,fresh.event!.deduplication_key)).claimed).toBe(0);
    const sent=JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(sent.template.name).toBe("dart_restock_available");
    expect(sent.template.components[0].parameters.map((p:{text:string})=>p.text))
      .toEqual(["Restock Test Shirt","Burgundy","M"]);
    expect(fetch).toHaveBeenCalledOnce();

    const changed=await restockFixture(true);
    await makeDue(changed.event!.deduplication_key);
    await store.pool.query("UPDATE account_phones SET phone_normalized=$2 WHERE user_id=$1 AND is_primary",
      [changed.id,"2011"+String(Math.floor(Math.random()*100000000)).padStart(8,"0")]);
    expect((await restockSender.processBatch(1,changed.event!.deduplication_key)).published).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    const suppressed=(await store.pool.query(
      `SELECT a.state FROM outbox_delivery_attempts a JOIN outbox_events e ON e.id=a.event_id
       WHERE e.deduplication_key=$1`,[changed.event!.deduplication_key])).rows[0];
    expect(suppressed.state).toBe("suppressed");
  });
  it("defers without an external call or lost retry when a batch crosses 22:00",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);const fetch=fakeProvider();let calls=0;
    const clock=()=>++calls<3?activeClock():quietClock();
    expect(await sender(true,clock).processBatch(1,buyer.key)).toMatchObject({claimed:1,published:0,failed:0,uncertain:0});
    expect(fetch).not.toHaveBeenCalled();
    const row=(await store.pool.query("SELECT status,attempts FROM outbox_events WHERE deduplication_key=$1",[buyer.key])).rows[0]!;
    expect(row).toMatchObject({status:"pending",attempts:0});
    await makeDue(buyer.key);expect((await sender().processBatch(1,buyer.key)).published).toBe(1);expect(fetch).toHaveBeenCalledOnce();
  });
  it("preserves and audits a callback that arrives before provider acknowledgement",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);
    const app=express();app.use("/webhook",createWhatsAppWebhookRouter(store.pool,{whatsappAppSecret:secret,whatsappWebhookVerifyToken:verify,whatsappPhoneNumberId:"123"}));
    const wamid=`wamid.${randomUUID()}`;
    const fetch=vi.fn(async(_url:unknown,options:RequestInit)=>{
      const sent=JSON.parse(String(options.body));
      const body=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:"123"},statuses:[{
        id:wamid,status:"read",biz_opaque_callback_data:sent.biz_opaque_callback_data,
      }]}}]}]});
      expect((await request(app).post("/webhook").set("content-type","application/json")
        .set("x-hub-signature-256","sha256="+createHmac("sha256",secret).update(body).digest("hex")).send(body)).status).toBe(200);
      return new Response(JSON.stringify({messages:[{id:wamid}]}),{status:200});
    });vi.stubGlobal("fetch",fetch);
    expect((await sender().processBatch(1,buyer.key)).published).toBe(1);
    expect((await sender().recentEvents(100)).find(row=>row.eventType==="CUSTOMER_POST_DELIVERY_REVIEW" && row.providerMessageId===wamid))
      .toMatchObject({status:"read",deliveryStatus:"read"});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["opt-out","cancelled","changed-delivery","expired","changed-phone"])("suppresses an order follow-up after %s",async(reason)=>{
    const buyer=await delivered();await makeDue(buyer.key);
    if(reason==="opt-out")await buyer.preferences.setPreference(buyer.id,false,"opt-out",false);
    if(reason==="cancelled")await store.pool.query("UPDATE orders SET status='Cancelled' WHERE id=$1",[buyer.order]);
    if(reason==="changed-delivery")await store.pool.query("UPDATE orders SET delivered_at=delivered_at+interval '1 minute' WHERE id=$1",[buyer.order]);
    if(reason==="expired")await store.pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{expiresAt}',to_jsonb((now()-interval '1 hour')::text)) WHERE deduplication_key=$1",[buyer.key]);
    if(reason==="changed-phone")await store.pool.query("UPDATE customer_whatsapp_preferences SET phone_normalized='201100000000' WHERE customer_user_id=$1",[buyer.id]);
    const fetch=fakeProvider();expect((await sender().processBatch(5,buyer.key)).published).toBe(1);expect(fetch).not.toHaveBeenCalled();
    const row=(await store.pool.query("SELECT a.state FROM outbox_delivery_attempts a JOIN outbox_events e ON e.id=a.event_id WHERE e.deduplication_key=$1",[buyer.key])).rows[0]!;
    expect(row.state).toBe("suppressed");
  });
  it("automatically queues birthday opt-ins at 13:00 and shares manual deduplication",async()=>{
    const today=(await store.pool.query("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS today")).rows[0]!.today as string;
    const buyer=await customer(`2000-${today.slice(5)}`), no=await customer(`2000-${today.slice(5)}`);
    const service=new BirthdayMessagingService(store.pool,"synthetic_birthday");
    await service.setPreference(buyer.id,true,"opt-in");
    expect((await service.queueToday()).queued).toBe(1);
    expect((await service.queueToday()).queued).toBe(0);
    expect((await service.queue([buyer.id],today,null,"manual-retry")).alreadyQueued).toBe(1);
    const row=(await store.pool.query(`SELECT to_char(available_at AT TIME ZONE 'Africa/Cairo','HH24:MI') AS time,
      payload FROM outbox_events WHERE deduplication_key=$1`,[`birthday:${buyer.id}:${today}`])).rows[0]!;
    expect(row.time).toBe("13:00");expect(row.payload.category).toBe("marketing");
    expect((await store.pool.query("SELECT id FROM outbox_events WHERE deduplication_key=$1",[`birthday:${no.id}:${today}`])).rows).toHaveLength(0);
  });
  it("audits real receipt transitions atomically; duplicate or late callbacks create no audit entry",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);fakeProvider();await sender().processBatch(1,buyer.key);
    const event=(await store.pool.query("SELECT e.id::text,a.id::text AS attempt,a.provider_message_id FROM outbox_events e JOIN outbox_delivery_attempts a ON a.event_id=e.id WHERE e.deduplication_key=$1",[buyer.key])).rows[0]!;
    const app=express();app.use("/webhook",createWhatsAppWebhookRouter(store.pool,{whatsappAppSecret:secret,whatsappWebhookVerifyToken:verify,whatsappPhoneNumberId:"123"}));
    for(const status of ["read","read","sent"]){
      const body=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:"123"},statuses:[{id:event.provider_message_id,status,timestamp:"1793210000"}]}}]}]});
      expect((await request(app).post("/webhook").set("content-type","application/json").set("x-hub-signature-256","sha256="+createHmac("sha256",secret).update(body).digest("hex")).send(body)).status).toBe(200);
    }
    const audits=await store.pool.query("SELECT old_values,new_values FROM audit_logs WHERE action='WHATSAPP_DELIVERY_STATUS_CHANGED' AND entity_id=$1",[event.attempt]);
    expect(audits.rows).toHaveLength(1);expect(audits.rows[0]).toMatchObject({old_values:{status:null},new_values:{status:"read"}});
  });
  it("alerts on failed delivery after provider acceptance without paying for a duplicate send",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);const provider=fakeProvider();
    await sender().processBatch(1,buyer.key);
    const event=(await store.pool.query("SELECT a.id::text,a.provider_message_id FROM outbox_delivery_attempts a JOIN outbox_events e ON e.id=a.event_id WHERE e.deduplication_key=$1",[buyer.key])).rows[0]!;
    const app=express();app.use("/webhook",createWhatsAppWebhookRouter(store.pool,{whatsappAppSecret:secret,whatsappWebhookVerifyToken:verify,whatsappPhoneNumberId:"123"}));
    const baseline=Number((await sender().health()).deliveryFailed);
    for(const status of ["failed","failed","delivered"]){
      const body=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:"123"},statuses:[{id:event.provider_message_id,status,timestamp:"1793210000"}]}}]}]});
      expect((await request(app).post("/webhook").set("content-type","application/json").set("x-hub-signature-256","sha256="+createHmac("sha256",secret).update(body).digest("hex")).send(body)).status).toBe(200);
      expect((await sender().health()).deliveryFailed).toBe(baseline+(status==="failed"?1:0));
    }
    expect((await sender().processBatch(1,buyer.key)).claimed).toBe(0);
    expect(provider).toHaveBeenCalledOnce();
  });
  it("does not attach a mismatched provider identity to an acknowledged attempt",async()=>{
    const buyer=await delivered();await makeDue(buyer.key);fakeProvider();await sender().processBatch(1,buyer.key);
    const event=(await store.pool.query("SELECT a.id::text FROM outbox_delivery_attempts a JOIN outbox_events e ON e.id=a.event_id WHERE e.deduplication_key=$1",[buyer.key])).rows[0]!;
    const app=express();app.use("/webhook",createWhatsAppWebhookRouter(store.pool,{whatsappAppSecret:secret,whatsappWebhookVerifyToken:verify,whatsappPhoneNumberId:"123"}));
    const body=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:"123"},statuses:[{
      id:"wamid.different-provider-id",status:"read",biz_opaque_callback_data:event.id,
    }]}}]}]});
    expect((await request(app).post("/webhook").set("content-type","application/json")
      .set("x-hub-signature-256","sha256="+createHmac("sha256",secret).update(body).digest("hex")).send(body)).status).toBe(200);
    expect((await store.pool.query("SELECT delivery_status FROM outbox_delivery_attempts WHERE id=$1",[event.id])).rows[0]!.delivery_status).toBeNull();
  });
});

describe("WhatsApp configuration, window and log privacy",()=>{
  it("keeps sending off when only credentials are configured",()=>{
    const config=loadConfig({NODE_ENV:"test",DATABASE_URL:"postgresql://unused/test",WHATSAPP_CLOUD_API_TOKEN:"synthetic",WHATSAPP_PHONE_NUMBER_ID:"123"});
    expect(config.whatsappSendEnabled).toBe(false);
    expect(()=>loadConfig({NODE_ENV:"test",DATABASE_URL:"postgresql://unused/test",WHATSAPP_SEND_ENABLED:"true"})).toThrow("WHATSAPP_CLOUD_API_TOKEN");
  });
  it.each([["2026-12-01T10:59:59Z",false],["2026-12-01T11:00:00Z",true],
    ["2026-12-01T19:59:59Z",true],["2026-12-01T20:00:00Z",false],
    ["2026-07-01T10:00:00Z",true],["2026-07-01T19:00:00Z",false]])("checks Cairo send boundary %s",(date,expected)=>{
      expect(whatsappSendWindow(new Date(date))).toBe(expected);
  });
  it("scrubs verification tokens from request logs without changing the verification query",async()=>{
    const lines:string[]=[];
    const stream=new Writable({write(chunk,_encoding,next){lines.push(String(chunk));next();}});
    const app=express();app.use(requestContext(pino({level:"info"},stream)));
    app.use("/webhook",createWhatsAppWebhookRouter({query:vi.fn()} as never,{whatsappAppSecret:secret,whatsappWebhookVerifyToken:verify,whatsappPhoneNumberId:"123"}));
    const response=await request(app).get("/webhook").query({"hub.mode":"subscribe","hub.verify_token":verify,"hub.challenge":"12345"});
    expect(response.status).toBe(200);expect(response.text).toBe("12345");
    expect(lines.join("")).toContain("[REDACTED]");expect(lines.join("")).not.toContain(verify);
    const event=scrubSentryEvent({request:{url:`https://example.test/webhook?hub%2Everify_token=${verify}`,query_string:`hub.verify_token=${verify}`}});
    expect(JSON.stringify(event)).not.toContain(verify);
  });
});
