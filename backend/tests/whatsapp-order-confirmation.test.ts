import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { queueOrderConfirmation } from "../src/modules/commerce/commerce.whatsapp.js";
import { createWhatsAppWebhookRouter } from "../src/modules/outbox/whatsapp-webhook.routes.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";

describe("interactive WhatsApp order confirmation", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  const phone="201000000001", secret="synthetic-meta-secret";
  beforeAll(async()=>{ store=await embeddedStore(true); commerce=new CommerceService(store.pool); },30000);
  afterAll(async()=>{await store?.db.close();});
  afterEach(()=>{vi.unstubAllGlobals();});
  async function fixture() {
    const id=randomUUID(), model=`M-${id}`, piece=`I-${id}`, cart=`CART-${id}`, email=`${id}@example.test`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status)
      VALUES($1,'customer',$2,$2,'synthetic','active')`,[id,email]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer','2000-01-01')",[id]);
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Synthetic Model',20000,50000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`,[model]);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',20000)`,[piece,model]);
    await commerce.reserveCart(cart,[{modelId:model,color:"Black",size:"M",quantity:1}],id);
    const order=await commerce.checkout(id,{reservationId:cart,contact:{name:"Synthetic Customer",phone1:"01000000001",email},
      address:{country:"Egypt",governorate:"Cairo",area:"Nasr City",street:"Synthetic",building:"1",floor:"1",latitude:"30.05",longitude:"31.35"}},"synthetic-checkout",undefined,randomUUID());
    const confirmation=(await store.pool.query("SELECT id::text FROM order_whatsapp_confirmations WHERE order_id=$1",[order.id])).rows[0]!.id as string;
    return {id,order,confirmation,piece,key:`order-whatsapp-confirmation:${order.id}`};
  }
  const tap=(f: {confirmation:string},action="confirm",messageId=`wamid.${randomUUID()}`,from=phone)=>({
    messageId,from,payload:`${action}:${f.confirmation}`,timestamp:Math.floor(Date.now()/1000),
  });
  async function status(id:unknown) { return (await store.pool.query("SELECT status,cod_verification_status,version FROM orders WHERE id=$1",[id])).rows[0]!; }
  const sender=(enabled=true)=>new OutboxService(store.pool,{whatsappSendEnabled:enabled,whatsappAccessToken:"synthetic",whatsappPhoneNumberId:"123",
    whatsappGraphApiVersion:"v26.0",whatsappTemplateLanguage:"ar",outboxBatchSize:5,mfaEncryptionKey:Buffer.alloc(32,7)},null,null,
    ()=>{const d=new Date();d.setUTCHours(22,0,0,0);return d;});
  const provider=()=>{const fn=vi.fn(async()=>new Response(JSON.stringify({messages:[{id:`wamid.${randomUUID()}`}]}),{status:200}));vi.stubGlobal("fetch",fn);return fn;};
  it("queues exactly once with final saved amount and sends both bound buttons immediately outside review hours",async()=>{
    const f=await fixture();const client=await store.pool.connect();await queueOrderConfirmation(client,String(f.order.id));client.release();
    const rows=(await store.pool.query("SELECT payload FROM outbox_events WHERE deduplication_key=$1",[f.key])).rows;
    expect(rows).toHaveLength(1);expect(rows[0]!.payload.parameters).toEqual([f.order.orderId,Number(f.order.finalAmount).toFixed(2)]);
    const fetch=provider();expect((await sender(false).processBatch(1,f.key)).claimed).toBe(0);
    expect((await sender().processBatch(1,f.key)).published).toBe(1);
    const body=JSON.parse((fetch.mock.calls[0] as unknown as [string,{body:string}])[1].body);
    expect(body.template.name).toBe("dart_order_confirmation");
    expect(body.template.components.slice(1)).toEqual(["confirm","cancel"].map((action,index)=>({type:"button",sub_type:"quick_reply",index:String(index),parameters:[{type:"payload",payload:`${action}:${f.confirmation}`}]})));
  });
  it("verifies and accepts atomically; duplicate webhook and repeated taps do not duplicate side effects",async()=>{
    const f=await fixture(), input=tap(f);await commerce.orderWhatsAppReply(input);
    const first=await status(f.order.id);expect(first).toMatchObject({status:"Accepted",cod_verification_status:"Verified"});
    await commerce.orderWhatsAppReply(input);await commerce.orderWhatsAppReply(tap(f));
    expect(await status(f.order.id)).toEqual(first);
    expect((await store.pool.query("SELECT id FROM order_events WHERE order_id=$1 AND to_status='Accepted'",[f.order.id])).rows).toHaveLength(1);
    expect((await store.pool.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_ACK'",[f.order.id])).rows).toHaveLength(1);
    expect((await commerce.adminOrders()).orders.find(o=>o.id===f.order.id || o.orderId===f.order.orderId)).toBeDefined();
  });
  it.each([false,true])("cancels via the existing inventory path (previously confirmed=%s), cannot reopen",async(confirmed)=>{
    const f=await fixture();if(confirmed)await commerce.orderWhatsAppReply(tap(f));
    const input=tap(f,"cancel");await commerce.orderWhatsAppReply(input);await commerce.orderWhatsAppReply(input);
    await commerce.orderWhatsAppReply(tap(f));expect((await status(f.order.id)).status).toBe("Cancelled");
    expect((await store.pool.query("SELECT status,order_id FROM inventory_items WHERE id=$1",[f.piece])).rows[0]).toMatchObject({status:"In stock",order_id:null});
  });
  it("ignores other senders, plain text and arbitrary token actions",async()=>{
    const f=await fixture();await commerce.orderWhatsAppReply(tap(f,"confirm",undefined,"201100000001"));
    await commerce.orderWhatsAppReply({...tap(f),payload:"تأكيد الطلب"});
    expect((await status(f.order.id)).status).toBe("New");
    expect((await store.pool.query("SELECT message_id FROM order_whatsapp_replies WHERE confirmation_id=$1",[f.confirmation])).rows).toHaveLength(0);
  });
  it.each(["version","expired","preparing"])("rejects stale %s and suppresses an unsent confirmation",async(kind)=>{
    const f=await fixture();if(kind==="expired") await store.pool.query("UPDATE order_whatsapp_confirmations SET expires_at=now()-interval '1 minute' WHERE id=$1",[f.confirmation]);
    else await store.pool.query("UPDATE orders SET version=version+1,status=$2 WHERE id=$1",[f.order.id,kind==="preparing"?"Preparing":"New"]);
    const before=await status(f.order.id);await commerce.orderWhatsAppReply(tap(f));expect(await status(f.order.id)).toEqual(before);
    const fetch=provider();expect((await sender().processBatch(1,f.key)).published).toBe(1);expect(fetch).not.toHaveBeenCalled();
  });
  it("rolls back verification, acceptance, inbox and acknowledgment when inventory transition fails; retries safely",async()=>{
    const f=await fixture(),input=tap(f);await store.pool.query("UPDATE inventory_items SET order_id=NULL WHERE id=$1",[f.piece]);
    await expect(commerce.orderWhatsAppReply(input)).rejects.toMatchObject({code:"ORDER_ITEM_OWNERSHIP_CHANGED"});
    expect((await status(f.order.id)).status).toBe("New");
    expect((await store.pool.query("SELECT message_id FROM order_whatsapp_replies WHERE message_id=$1",[input.messageId])).rows).toHaveLength(0);
    expect((await store.pool.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_ACK'",[f.order.id])).rows).toHaveLength(0);
    await store.pool.query("UPDATE inventory_items SET order_id=$2 WHERE id=$1",[f.piece,f.order.orderId]);
    await commerce.orderWhatsAppReply(input);expect((await status(f.order.id)).status).toBe("Accepted");
  });
  it("keeps order sending independent of the legacy birthday/review switch",async()=>{
    const f=await fixture(),fetch=provider();
    const service=new OutboxService(store.pool,{whatsappSendEnabled:false,whatsappOrderConfirmationEnabled:true,
      whatsappAccessToken:"synthetic",whatsappPhoneNumberId:"123",outboxBatchSize:5,mfaEncryptionKey:Buffer.alloc(32,7)});
    expect(service.configured("whatsapp")).toBe(false);expect(service.configured()).toBe(true);
    expect((await service.processBatch(1,f.key)).published).toBe(1);expect(fetch).toHaveBeenCalledOnce();
  });
  it("sends one text acknowledgment and suppresses an obsolete confirmed acknowledgment after cancellation",async()=>{
    const f=await fixture();await commerce.orderWhatsAppReply(tap(f));await commerce.orderWhatsAppReply(tap(f,"cancel"));
    const rows=(await store.pool.query("SELECT deduplication_key,payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_ACK' ORDER BY created_at",[f.order.id])).rows;
    const fetch=provider();await sender().processBatch(1,rows[0]!.deduplication_key);expect(fetch).not.toHaveBeenCalled();
    expect((await sender().processBatch(1,rows[1]!.deduplication_key)).published).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    const body=JSON.parse((fetch.mock.calls[0] as unknown as [string,{body:string}])[1].body);
    expect(body.type).toBe("text");expect(body.text.body).toContain("تم إلغاء");
    expect((await sender().processBatch(1,rows[1]!.deduplication_key)).claimed).toBe(0);
  });
  it("never sends acknowledgments after their inbound 24-hour service window",async()=>{
    const f=await fixture();await commerce.orderWhatsAppReply(tap(f));
    const key=`order-whatsapp-ack:${f.confirmation}:confirm:confirmed`;
    await store.pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{expiresAt}',to_jsonb((now()-interval '1 day')::text)) WHERE deduplication_key=$1",[key]);
    const fetch=provider();await sender().processBatch(1,key);expect(fetch).not.toHaveBeenCalled();
  });
  it("processes template and interactive callbacks, rejects bad signatures, and retries failed transactions",async()=>{
    const f=await fixture();const app=express();app.use("/whatsapp",createWhatsAppWebhookRouter(store.pool,{
      whatsappAppSecret:secret,whatsappWebhookVerifyToken:"v".repeat(40),whatsappPhoneNumberId:"123",
    },r=>commerce.orderWhatsAppReply(r)));
    const input=tap(f);
    const data={entry:[{changes:[{value:{metadata:{phone_number_id:"123"},messages:[{
      id:input.messageId,from:phone,timestamp:String(input.timestamp),type:"button",button:{payload:input.payload},
    }]}}]}]};
    const body=JSON.stringify(data), signature="sha256="+createHmac("sha256",secret).update(body).digest("hex");
    expect((await request(app).post("/whatsapp").set("Content-Type","application/json").send(body)).status).toBe(401);
    const send=()=>request(app).post("/whatsapp").set("Content-Type","application/json").set("x-hub-signature-256",signature).send(body);
    await store.pool.query("UPDATE inventory_items SET order_id=NULL WHERE id=$1",[f.piece]);expect((await send()).status).toBe(503);
    await store.pool.query("UPDATE inventory_items SET order_id=$2 WHERE id=$1",[f.piece,f.order.orderId]);
    expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);expect((await status(f.order.id)).status).toBe("Accepted");
    const interactive=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:"123"},messages:[{
      id:`wamid.${randomUUID()}`,from:phone,timestamp:String(input.timestamp),type:"interactive",
      interactive:{type:"button_reply",button_reply:{id:`cancel:${f.confirmation}`}},
    }]}}]}]});
    expect((await request(app).post("/whatsapp").set("Content-Type","application/json")
      .set("x-hub-signature-256","sha256="+createHmac("sha256",secret).update(interactive).digest("hex")).send(interactive)).status).toBe(200);
    expect((await status(f.order.id)).status).toBe("Cancelled");
  });
});
