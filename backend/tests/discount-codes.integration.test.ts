import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import { DiscountCodeService, discountCodeInputSchema } from "../src/modules/promotions/discount-code.js";
import { saveManualDiscount, manualDiscountSchema } from "../src/modules/promotions/customer-manual-discount.js";

describe("Discount Code: line-level priority, single order amount, lifecycle", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  let commerce: CommerceService;
  let promotions: PromotionService;
  let coupons: DiscountCodeService;
  const owner = randomUUID();

  beforeAll(async () => {
    store = await embeddedStore();
    // Keep these existing benefit/ledger fixtures on free shipping.
    await store.pool.query("UPDATE site_settings SET data=data || '{\"shippingFeePerOrder\":0}'::jsonb WHERE id='main'");
    commerce = new CommerceService(store.pool);
    promotions = new PromotionService(store.pool);
    coupons = new DiscountCodeService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','coupon-owner@example.test','coupon-owner@example.test','test-only','active',now())`, [owner]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name,is_owner) VALUES($1,'Coupon owner',true)", [owner]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture() {
    const user = randomUUID(), suffix = randomUUID().slice(0,8);
    const email = `${suffix}@example.test`;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(Date.now() + 40 * 86400000));
    const birthday = `2000-${parts.find(x=>x.type==="month")!.value}-${parts.find(x=>x.type==="day")!.value}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only','active',now())`,[user,email]);
    const customer = (await store.pool.query<{client_code:string}>(
      "INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Coupon Test',$2) RETURNING client_code",
      [user,birthday])).rows[0]!.client_code;
    const models: string[] = [], pieces:string[] = [];
    for (let index=0;index<4;index++) {
      const id=`COUPON-M-${suffix}-${index}`,piece=`COUPON-I-${suffix}-${index}`;
      models.push(id);pieces.push(piece);
      await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
        VALUES($1,'Coupon Model',50000,100000,$2,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`,
        [id,index===2?20:0]);
      await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
        VALUES($1,$1,$2,'Black','M','In stock',50000)`,[piece,id]);
    }
    await promotions.create(promotionCampaignInputSchema.parse({
      name:"Coupon priority campaign",code:`CP-${suffix}`,status:"Active",discountPercent:10,
      automatic:true,productScope:{mode:"models",values:[models[0]!]},
    }),owner,"coupon-campaign");
    await saveManualDiscount(store.pool,customer,owner,"coupon-personal",randomUUID(),
      manualDiscountSchema.parse({name:"Personal saving",kind:"amount",value:10000,pieceLimit:1,
        startsOn:"2020-01-01",endsOn:"2099-01-01"}));
    const couponCode=`CODE-${suffix}`;
    const offer = await coupons.save(discountCodeInputSchema.parse({
      name:"Special 150",code:couponCode,status:"Active",kind:"amount",amountMinor:15000,
      totalUsageLimit:1,perCustomerUsageLimit:1,customerRef:customer,
    }),owner,"coupon-create");
    const reservationId=`CART-${suffix}`;
    await commerce.reserveCart(reservationId,models.map(modelId=>({modelId,color:"Black",size:"M",quantity:1})),user);
    const input={reservationId,promotionCode:couponCode,
      contact:{name:"Coupon Test",phone1:"+201000000001",email},
      address:{country:"Egypt",governorate:"Cairo",area:"Nasr City",
        street:"Test",building:"1",floor:"1",latitude:"30.05",longitude:"31.35"}};
    return {user,customer,couponCode,offer,models,pieces,input,reservationId};
  }

  it("allocates Campaign > Manual > Code > Birthday > Dart Card, and protects model discounts",async()=>{
    const f=await fixture();
    const quote=await commerce.customerCartQuote(f.user,f.reservationId,f.couponCode);
    expect("totalMinor" in quote ? quote.totalMinor : 0).toBe(345000);
    const order=await commerce.checkout(f.user,f.input,"coupon-checkout",undefined,`checkout-${f.reservationId}`);
    const lines=(await store.pool.query(`SELECT item_code,discount_source,final_unit_minor
      FROM order_items WHERE order_id=$1 ORDER BY item_code`,[order.id])).rows;
    expect(lines.map(x=>x.discount_source)).toEqual(["Campaign","Manual","Model","Discount Code"]);
    expect(lines.map(x=>Number(x.final_unit_minor))).toEqual([90000,90000,80000,85000]);
    expect((await store.pool.query("SELECT status,discount_minor::integer AS discount_minor FROM discount_code_usages WHERE order_id=$1",[order.id])).rows)
      .toEqual([{status:"Reserved",discount_minor:15000}]);
    // Retrying a committed checkout must not redeem another usage.
    await commerce.checkout(f.user,f.input,"coupon-retry",undefined,`checkout-${f.reservationId}`);
    expect((await store.pool.query("SELECT count(*)::int AS c FROM discount_code_usages WHERE discount_code_id=$1",[f.offer.id])).rows[0]?.c).toBe(1);
    await store.pool.query("UPDATE orders SET status='Representative On The Way' WHERE id=$1",[order.id]);
    await commerce.adminOrderWorkflowAction(owner,String(order.orderId),
      {expectedStatus:"Representative On The Way",target:"Delivered"},"coupon-delivered",false);
    expect((await store.pool.query("SELECT status FROM discount_code_usages WHERE order_id=$1",[order.id])).rows[0].status).toBe("Used");
    await commerce.adminManualReturn(owner,{itemCode:f.pieces[3]!,reason:"Coupon return",condition:"Good",refundAmount:850},"coupon-return");
    expect((await store.pool.query("SELECT status FROM discount_code_usages WHERE order_id=$1",[order.id])).rows[0].status).toBe("Used");
  },30000);

  it("permanently deletes an unused code, rejects stale writes and future redemption", async()=>{
    const f=await fixture();
    await expect(coupons.delete(f.offer.id,f.offer.version+1,owner,"stale"))
      .rejects.toMatchObject({code:"DISCOUNT_CODE_CONFLICT"});
    expect(await coupons.delete(f.offer.id,f.offer.version,owner,"delete-unused"))
      .toMatchObject({deleted:true,code:f.offer.code});
    expect((await store.pool.query("SELECT count(*)::int AS n FROM discount_codes WHERE id=$1",[f.offer.id])).rows[0].n).toBe(0);
    await expect(coupons.delete(f.offer.id,f.offer.version,owner,"delete-again"))
      .rejects.toMatchObject({code:"DISCOUNT_CODE_NOT_FOUND"});
    await expect(commerce.customerCartQuote(f.user,f.reservationId,f.couponCode))
      .rejects.toMatchObject({code:"PROMOTION_NOT_ELIGIBLE"});
    expect((await store.pool.query("SELECT action FROM audit_logs WHERE entity_id=$1 AND action='DISCOUNT_CODE_DELETED'",[f.offer.id])).rows).toHaveLength(1);
  },30000);

  it("preserves ledger and order history when permanently deleting a previously redeemed code", async()=>{
    const f=await fixture();
    const order=await commerce.checkout(f.user,f.input,"before-removal",undefined,`checkout-${f.reservationId}`);
    await coupons.delete(f.offer.id,f.offer.version,owner,"delete-redeemed");
    const usage=(await store.pool.query(`SELECT discount_code_id,code_snapshot,discount_minor::int AS discount_minor,status
      FROM discount_code_usages WHERE order_id=$1`,[order.id])).rows[0];
    expect(usage).toEqual({discount_code_id:null,code_snapshot:f.offer.code,discount_minor:15000,status:"Reserved"});
    expect((await store.pool.query("SELECT count(*)::int AS n FROM orders WHERE id=$1",[order.id])).rows[0].n).toBe(1);
    expect((await store.pool.query("SELECT count(*)::int AS n FROM order_items WHERE order_id=$1 AND discount_source='Discount Code'",[order.id])).rows[0].n).toBe(1);
    await store.pool.query("UPDATE orders SET status='Representative On The Way' WHERE id=$1",[order.id]);
    await commerce.adminOrderWorkflowAction(owner,String(order.orderId),
      {expectedStatus:"Representative On The Way",target:"Delivered"},"after-deletion-delivered",false);
    expect((await store.pool.query("SELECT status FROM discount_code_usages WHERE order_id=$1",[order.id])).rows[0].status).toBe("Used");
  },30000);

  it("rejects an assigned code for another customer", async()=>{
    const f=await fixture();
    const alternate = randomUUID(), email=`${alternate}@example.test`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only','active',now())`,[alternate,email]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Other customer','2000-01-01')",[alternate]);
    const client=await store.pool.connect();
    try{
      await client.query("BEGIN");
      await expect(coupons.resolveInTransaction(client,alternate,f.couponCode,
        [{id:"x",itemCode:f.pieces[3]!,modelId:f.models[3]!,category:"",sellingMinor:100000,modelDiscountPercent:0,isSet:false}]))
        .rejects.toMatchObject({code:"DISCOUNT_CODE_NOT_FOR_CUSTOMER"});
      await client.query("ROLLBACK");
    }finally{client.release();}
  });
});