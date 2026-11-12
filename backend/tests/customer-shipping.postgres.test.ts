import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { SiteSettingsService } from "../src/modules/settings/site-settings.service.js";
import { publicSiteSettings, siteSettingsSchema } from "../src/modules/settings/site-settings.schema.js";
import { SetCartService } from "../src/modules/sets/set-cart.service.js";
import { shippingFeeMinor } from "../src/modules/commerce/commerce.pricing.js";

describe("customer shipping snapshots", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  const actor = randomUUID();
  const address = { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" };
  beforeAll(async () => {
    store = await embeddedStore(); commerce = new CommerceService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','shipping@example.test','shipping@example.test','synthetic','active',now())`, [actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Shipping test')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture(count = 2) {
    const user = randomUUID(), suffix = randomUUID(), model = `SHIP-${suffix}`, reservationId = `CART-${suffix}`;
    const email = `${user}@example.test`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, email]);
    const customer = (await store.pool.query(`INSERT INTO customers(user_id,full_name,birthday)
      VALUES($1,'Shipping Customer','2000-01-01') RETURNING client_code`, [user])).rows[0]!;
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
      VALUES($1,'Shipping model',20000,50000,20,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
    const codes: string[] = [];
    for (let i=0; i<count; i++) {
      const code = `PIECE-${suffix}-${i}`; codes.push(code);
      await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
        VALUES($1,$1,$2,'Black','M','In stock',20000)`, [code, model]);
    }
    return { user, model, codes, clientId:String(customer.client_code), input:{reservationId,contact:{name:"Shipping Customer",phone1:"+201000000001",email},address} };
  }
  async function configure(fee: number) {
    const service = new SiteSettingsService(store.pool), current = await service.get(true);
    return service.update(current.version, { ...current.settings, shippingFeePerOrder: fee }, actor, "shipping-test");
  }
  it("validates money, exposes the fee publicly, and allows free shipping", () => {
    expect(shippingFeeMinor({})).toBe(10000);
    expect(shippingFeeMinor({shippingFeePerOrder:0})).toBe(0);
    expect(shippingFeeMinor({shippingFeePerOrder:125.25})).toBe(12525);
    for (const invalid of [-1,1.001,Infinity,"100"]) expect(siteSettingsSchema.safeParse({shippingFeePerOrder:invalid}).success).toBe(false);
    expect(publicSiteSettings({shippingFeePerOrder:100,codRisk:{}})).toEqual({shippingFeePerOrder:100});
  });
  it("adds shipping once after discounts and preserves it on retries and settings changes", async () => {
    await configure(100); const f=await fixture();
    await commerce.reserveCart(f.input.reservationId,[{modelId:f.model,color:"Black",size:"M",quantity:2}],f.user);
    const quote=await commerce.customerCartQuote(f.user,f.input.reservationId);
    expect(quote).toMatchObject({subtotalMinor:100000,discountMinor:20000,shippingMinor:10000,totalMinor:90000});
    if (!("fingerprint" in quote)) throw Error("quote required");
    const input={...f.input,quoteFingerprint:quote.fingerprint,expectedTotalMinor:90000};
    const order=await commerce.checkout(f.user,input,"shipping-test",undefined,`checkout-${f.input.reservationId}`);
    expect(order).toMatchObject({finalAmount:900,shippingFee:100,orderLevelDiscountAmount:200});
    await configure(175);
    expect(await commerce.checkout(f.user,input,"shipping-test",undefined,`checkout-${f.input.reservationId}`)).toMatchObject({orderId:order.orderId,finalAmount:900,shippingFee:100});
    expect((await commerce.adminOrders()).orders.find(row=>row.id===order.id)).toMatchObject({finalAmount:900,shippingFee:100});
    expect((await commerce.customerSnapshot(f.user)).orders.find(row=>row.id===order.id)).toMatchObject({finalAmount:900,shippingFee:100});
  });
  it("requires a new review if shipping changes between quote and confirmation", async () => {
    await configure(100); const f=await fixture(1);
    await commerce.reserveCart(f.input.reservationId,[{modelId:f.model,color:"Black",size:"M",quantity:1}],f.user);
    const quote=await commerce.customerCartQuote(f.user,f.input.reservationId);
    if (!("fingerprint" in quote)) throw Error("quote required");
    await configure(125.25);
    await expect(commerce.checkout(f.user,{...f.input,quoteFingerprint:quote.fingerprint,expectedTotalMinor:50000},"shipping-test",undefined,"stale-shipping"))
      .rejects.toMatchObject({code:"PRICE_CHANGED"});
    expect(await commerce.customerCartQuote(f.user,f.input.reservationId)).toMatchObject({shippingMinor:12525,totalMinor:52525});
  });
  it("snapshots manual orders and keeps shipping when pieces change", async () => {
    await configure(100); const f=await fixture();
    const created=await commerce.createAdminOrder(actor,{clientId:f.clientId,clientName:"Shipping Customer",phone1:"+201000000001",itemCodes:[f.codes[0]!] },"shipping-test");
    const order=created.orders.find(row=>(row.items as string[]).includes(f.codes[0]!))!;
    expect(order).toMatchObject({shippingFee:100,finalAmount:500});
    await configure(250);
    const updated=await commerce.updateAdminOrder(actor,String(order.id),{expectedVersion:Number(order.version),clientName:"Shipping Customer",phone1:"+201000000001",itemCodes:f.codes},"shipping-test");
    expect(updated.orders.find(row=>row.id===order.id)).toMatchObject({shippingFee:100,finalAmount:900});
  });
  it("keeps shipping through deferred Set reconciliation and committed email totals", async () => {
    await configure(100); const f=await fixture(), set=`SET-${randomUUID()}`;
    await store.pool.query("INSERT INTO catalog_sets(set_id,name,base_price_minor,discount_percent) VALUES($1,'Shipping Set',90000,10)",[set]);
    await store.pool.query("INSERT INTO catalog_set_components(set_id,model_id,quantity) VALUES($1,$2,2)",[set,f.model]);
    await commerce.reserveCart(f.input.reservationId,[{modelId:f.model,color:"Black",size:"M",quantity:2}],f.user);
    await new SetCartService(store.pool).attachGroups(f.input.reservationId,[{setId:set,unitIndex:1,selections:[{modelId:f.model,color:"Black",size:"M"},{modelId:f.model,color:"Black",size:"M"}]}],f.user);
    expect(await commerce.customerCartQuote(f.user,f.input.reservationId)).toMatchObject({shippingMinor:10000,totalMinor:91000});
    const order=await commerce.checkout(f.user,f.input,"shipping-set-test",undefined,"shipping-set");
    expect(order).toMatchObject({shippingFee:100,finalAmount:910});
    const row=(await store.pool.query("SELECT final_minor::int,shipping_fee_minor::int FROM orders WHERE id=$1",[order.id])).rows[0];
    expect(row).toEqual({final_minor:91000,shipping_fee_minor:10000});
    const event=(await store.pool.query("SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='order.created'",[order.id])).rows[0];
    expect(event!.payload.parameters.total).toBe("910.00");
  });
  it("supports zero shipping and does not confuse it with the courier cost", async () => {
    await configure(0); const f=await fixture(1);
    await commerce.reserveCart(f.input.reservationId,[{modelId:f.model,color:"Black",size:"M",quantity:1}],f.user);
    const order=await commerce.checkout(f.user,f.input,"shipping-test",undefined,"free-shipping");
    expect(order).toMatchObject({shippingFee:0,finalAmount:400,deliveryCost:100});
  });
});
