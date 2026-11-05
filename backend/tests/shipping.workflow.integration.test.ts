// Shipping flow integration tests use an isolated Postgres schema, never Dart's live Neon data.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runIsolatedMigrations } from "./integration-schema.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

const databaseUrl=process.env.TEST_DATABASE_URL;
const schema="dart_shipping_"+randomUUID().replaceAll("-","");
let admin:Pool|undefined;
let db:Pool|undefined;
describe.skipIf(!databaseUrl)("external shipping warehouse -> carrier -> return inspection",()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:databaseUrl,max:1});
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db=new Pool({connectionString:databaseUrl,max:4,options:`-c search_path=${schema},public`});
    await runIsolatedMigrations(db,resolve(process.cwd(),"migrations"));
    await db.query(`UPDATE site_settings SET data=jsonb_set(COALESCE(data,'{}'::jsonb),
      '{shippingCompanies}', $1::jsonb, true) WHERE id='main'`,[
      JSON.stringify([{id:"carrier-test",name:"Test Carrier",trackingUrl:"https://example.com/track",
        active:true,checkoutEnabled:true,governorates:["Alexandria"],
        coverage:{Alexandria:{all:true,cities:{}}}}]),
    ]);
  });
  afterAll(async()=>{
    await db?.end();
    if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end()}
  });
  async function fixture(label:string){
    const token=randomUUID().replaceAll("-","").slice(0,12),orderId=randomUUID();
    const code=`SC-${label}-${token}`,model=`MODEL-${token}`,item=`IT-${token}`;
    await db!.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Shipping test',40000,60000,'[{"name":"M","active":true}]'::jsonb,
        '[{"name":"Black","active":true}]'::jsonb)`,[model]);
    await db!.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor,order_id)
      VALUES($1,$1,$2,'Black','M','Processing/Held',40000,$3)`,[item,model,code]);
    await db!.query(`INSERT INTO orders(id,order_code,status,payment_method,payment_status,
      subtotal_minor,final_minor,contact_snapshot,delivery_address)
      VALUES($1,$2,'Preparing','Cash on Delivery','Unpaid',60000,60000,$3::jsonb,$4::jsonb)`,
      [orderId,code,JSON.stringify({name:"Test Recipient",phone1:"+201000000001"}),
        JSON.stringify({country:"Egypt",governorate:"Alexandria",city:"montaza",area:"Sidi Bishr",
          street:"Test St",building:"1",floor:"1"})]);
    await db!.query(`INSERT INTO order_items(order_id,inventory_item_id,item_code,model_id,model_name,
      color,size,original_unit_minor,model_discount_percent,final_unit_minor,cost_snapshot_minor)
      VALUES($1,$2,$2,$3,'Shipping test','Black','M',60000,0,60000,40000)`,[orderId,item,model]);
    return {code,orderId,item};
  }
  async function snapshot(id:string){
    const r=await db!.query<{status:string;legacy:Record<string,unknown>;representative_user_id:string|null;
      version:string}>(`SELECT status,legacy,representative_user_id,version::text FROM orders WHERE id=$1`,[id]);
    return r.rows[0]!;
  }
  it("dispatches an external carrier without creating any Dart representative or duplicate order",async()=>{
    const f=await fixture("DISPATCH"),commerce=new CommerceService(db!);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Preparing",target:"Ready for Dispatch",
        shippingCompanyId:"carrier-test",trackingNumber:"SHIP-123"},randomUUID(),false);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Ready for Dispatch",target:"Out With Representative",expectedVersion:Number((await snapshot(f.orderId)).version)},randomUUID(),false);
    const order=await snapshot(f.orderId);
    expect(order.status).toBe("Out With Representative");
    expect(order.representative_user_id).toBeNull();
    expect(order.legacy.deliveryShipment).toMatchObject({type:"external",companyId:"carrier-test",
      trackingNumber:"SHIP-123",status:"Handed Over"});
    const count=await db!.query<{n:string}>("SELECT count(*)::text AS n FROM orders WHERE id=$1",[f.orderId]);
    expect(count.rows[0]?.n).toBe("1");
  });
  it("serializes simultaneous physical handover confirmations across real connections",async()=>{
    const f=await fixture("RACE"),commerce=new CommerceService(db!);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Preparing",target:"Ready for Dispatch",shippingCompanyId:"carrier-test",trackingNumber:"SHIP-RACE"},randomUUID(),false);
    const version=Number((await snapshot(f.orderId)).version);
    const outcomes=await Promise.allSettled([1,2].map(()=>commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Ready for Dispatch",target:"Out With Representative",expectedVersion:version},randomUUID(),false)));
    expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1);
    expect((await db!.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_DISPATCHED'",[f.orderId])).rows).toHaveLength(1);
  });
  it("does not restock refused goods before the carrier returns the parcel",async()=>{
    const f=await fixture("RETURN"),commerce=new CommerceService(db!);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Preparing",target:"Ready for Dispatch",
        shippingCompanyId:"carrier-test",trackingNumber:"SHIP-456"},randomUUID(),false);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Ready for Dispatch",target:"Out With Representative",expectedVersion:Number((await snapshot(f.orderId)).version)},randomUUID(),false);
    await expect(commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Out With Representative",target:"Refused",reason:"Refused delivery"},
      randomUUID(),false)).rejects.toMatchObject({code:"EXTERNAL_SHIPMENT_STILL_OUT"});
    const out=await snapshot(f.orderId);
    expect(out.status).toBe("Out With Representative");
    await commerce.externalShipmentReturned(randomUUID(),f.code,Number(out.version),"Physically returned to Dart",randomUUID());
    const returned=await snapshot(f.orderId);
    expect((returned.legacy.deliveryShipment as Record<string,unknown>).status).toBe("Returned to Sender");
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Out With Representative",target:"Refused",reason:"Return inspection"},
      randomUUID(),false);
    const after=await snapshot(f.orderId);
    expect(after.status).toBe("Refused");
    const stock=await db!.query<{status:string}>("SELECT status FROM inventory_items WHERE id=$1",[f.item]);
    // Refusal only starts return inspection; it does not declare physically returned stock sellable.
    expect(stock.rows[0]?.status).not.toBe("Available");
  });
  it("marks delivered goods sold but keeps the courier COD remittance unsettled",async()=>{
    const f=await fixture("DELIVERY"),commerce=new CommerceService(db!);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Preparing",target:"Ready for Dispatch",
        shippingCompanyId:"carrier-test",trackingNumber:"SHIP-789"},randomUUID(),false);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Ready for Dispatch",target:"Out With Representative",expectedVersion:Number((await snapshot(f.orderId)).version)},randomUUID(),false);
    await commerce.adminOrderWorkflowAction(randomUUID(),f.code,
      {expectedStatus:"Out With Representative",target:"Delivered"},randomUUID(),false);
    const row=await db!.query<{status:string;payment_status:string;cod_settled_minor:string}>(
      "SELECT status,payment_status,cod_settled_minor::text FROM orders WHERE id=$1",[f.orderId]);
    expect(row.rows[0]?.status).toBe("Delivered");
    expect(Number(row.rows[0]?.cod_settled_minor||0)).toBe(0);
    const stock=await db!.query<{status:string}>("SELECT status FROM inventory_items WHERE id=$1",[f.item]);
    expect(stock.rows[0]?.status).toBe("Sold");
  });
});
