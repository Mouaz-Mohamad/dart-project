// DART CODE GUIDE | backend/tests/whatsapp-analytics.test.ts
// الغرض: العد الحقيقي حسب حالة Meta، لا حسب مجرد نشر الحدث.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { whatsappAnalytics } from "../src/modules/outbox/whatsapp-analytics.service.js";

describe("WhatsApp dashboard analytics", () => {
  it("counts all types once, includes read in delivered, and redacts recipient details", async () => {
    const store=await embeddedStore(true);
    try {
      const samples=[
        {type:"ORDER_WHATSAPP_CONFIRMATION",delivery:"read",state:"accepted"},
        {type:"ORDER_WHATSAPP_DISPATCHED",delivery:"delivered",state:"accepted"},
        {type:"CUSTOMER_POST_DELIVERY_REVIEW",delivery:null,state:"accepted"},
        {type:"CUSTOMER_BIRTHDAY_MESSAGE",delivery:null,state:null},
        {type:"WAITLIST_WHATSAPP_RESTOCK",delivery:null,state:"terminal"},
        {type:"ORDER_WHATSAPP_ACK",delivery:null,state:"suppressed"},
        {type:"ORDER_WHATSAPP_ACK",delivery:null,state:"unknown"},
      ] as const;
      let firstId="";
      for(const [index,row] of samples.entries()){
        const id=randomUUID();if(index===0)firstId=id;
        const orderId=randomUUID();
        await store.pool.query(
          `INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,status,attempts)
           VALUES($1,'order',$2,$3,$4::jsonb,$5,$6)`,
          [id,orderId,row.type,JSON.stringify({channel:"whatsapp",to:"201001234567",category:"utility"}),
            row.state ? "published" : "pending",row.state ? 1 : 0]);
        if(row.state) await store.pool.query(
          `INSERT INTO outbox_delivery_attempts(id,event_id,state,delivery_status,delivery_error_code)
           VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(),id,row.state,row.delivery,index===4?"131026":null]);
      }
      // Exclude non-WhatsApp channels, even if the event names look similar.
      await store.pool.query(
        `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload)
         VALUES('order',$1,'ORDER_WHATSAPP_CONFIRMATION',$2::jsonb)`,
        [randomUUID(),JSON.stringify({channel:"email",to:"synthetic@example.test"})]);
      const data=await whatsappAnalytics(store.pool,{period:"all",type:"all",status:"all",limit:50});
      expect(data.totals).toEqual({total:7,delivered:2,read:1,pending:2,sent:1,failed:1,attention:1,suppressed:1});
      expect(data.templates.find(x=>x.eventType==="ORDER_WHATSAPP_ACK")).toMatchObject({total:2,attention:1,suppressed:1});
      expect(data.items).toHaveLength(7);
      expect(data.items!.every(row=>row.recipient==="***4567")).toBe(true);
      const read=await whatsappAnalytics(store.pool,{period:"today",type:"ORDER_WHATSAPP_CONFIRMATION",status:"read"});
      expect(read.items).toHaveLength(1);
      expect(read.items![0]!.id).toBe(firstId);
      const delivered=await whatsappAnalytics(store.pool,{period:"today",type:"all",status:"delivered"});
      expect(delivered.items).toHaveLength(2);
      const pending=await whatsappAnalytics(store.pool,{period:"today",type:"all",status:"pending"});
      expect(pending.items).toHaveLength(2);
      const failed=await whatsappAnalytics(store.pool,{period:"all",type:"all",status:"failed"});
      expect(failed.items).toHaveLength(1);
      expect(failed.items![0]!.errorCode).toBe("131026");
      const paged=await whatsappAnalytics(store.pool,{period:"all",type:"all",status:"all",limit:2,offset:0});
      expect(paged.items).toHaveLength(2);
      expect(paged.hasMore).toBe(true);
    } finally { await store.db.close(); }
  },60000);
});
