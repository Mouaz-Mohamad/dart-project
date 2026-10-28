import { createHmac, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { BirthdayMessagingService } from "../src/modules/outbox/birthday-messaging.service.js";
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
