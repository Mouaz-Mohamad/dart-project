// DART CODE GUIDE | backend/tests/income.postgres.test.ts
// Real production migrations, income SQL, gift creation/delivery and financial reports.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { IncomeService, type IncomeInput } from "../src/modules/finance/income.service.js";
import { FinanceService } from "../src/modules/finance/finance.service.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

describe("income and third party order collection", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, incomes: IncomeService, finance: FinanceService, commerce: CommerceService;
  const actor = randomUUID();
  let today: string;
  beforeAll(async () => {
    store = await embeddedStore(true);
    incomes = new IncomeService(store.pool); finance = new FinanceService(store.pool); commerce = new CommerceService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff',$2,$2,'synthetic','active',now())`, [actor, `${actor}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Income fixture')", [actor]);
    today = (await store.pool.query("SELECT to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD') AS today")).rows[0]!.today;
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  const input = (patch: Partial<IncomeInput> = {}): IncomeInput => ({id:randomUUID(),kind:"Other Income",category:"Compensation",
    description:"Synthetic extra income",amountMinor:12345,expectedOn:"2020-01-01",sourceName:"Source",sourcePhone:"",notes:"",...patch});
  async function gift() {
    const suffix=randomUUID(), model=`GIFT-${suffix}`, code=`GIFT-PIECE-${suffix}`;
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Gift Model',30000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`,[model]);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',30000)`,[code,model]);
    const user=randomUUID();
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`,[user,`${user}@example.test`]);
    const customer=(await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Gift Recipient','2000-01-01') RETURNING client_code",[user])).rows[0]!;
    const body={clientId:String(customer.client_code),clientName:"Gift Recipient",phone1:"+201000000001",itemCodes:[code],collectionMode:"Third Party" as const,payerName:"Gift Sender",payerPhone:"01000000002"};
    const created=await commerce.createAdminOrder(actor,body,"gift-create");
    const order=created.orders.find(row=>(row.items as string[]).includes(code))!;
    const income=(await incomes.list(today,today)).find(row=>row.orderId===order.orderId)!;
    return {order,income,body,model};
  }

  it("keeps Pending outside cash/profit, and counts Received on its actual date only", async () => {
    const body=input(); const pending=await incomes.create(actor,body,"create-pending");
    expect(pending).toMatchObject({status:"Pending",amountMinor:12345,currency:"EGP",receivedOn:null});
    expect(await finance.summary("2020-01-01","2020-01-01")).toMatchObject({pendingIncome:123.45,cashIn:0,otherIncome:0,netRevenue:0});
    await incomes.change(actor,pending.id,pending.version,"receive",{receivedOn:"2020-01-02"},"receive");
    expect(await finance.summary("2020-01-01","2020-01-01")).toMatchObject({pendingIncome:0,cashIn:0,otherIncome:0});
    expect(await finance.summary("2020-01-02","2020-01-02")).toMatchObject({cashIn:123.45,otherIncome:123.45,totalIncome:123.45,netProfit:123.45,netRevenue:0});
    expect(await incomes.list("2020-01-01","2020-01-01")).not.toEqual(expect.arrayContaining([expect.objectContaining({id:pending.id})]));
    expect(await incomes.list("2020-01-02","2020-01-02")).toEqual(expect.arrayContaining([expect.objectContaining({id:pending.id,status:"Received"})]));
  });

  it("makes create/confirm retries harmless, preserves other entries and rejects stale edits", async () => {
    const body=input({expectedOn:"2020-02-01"}), first=await incomes.create(actor,body,"one");
    await expect(incomes.create(actor,body,"retry")).resolves.toMatchObject({id:first.id,version:1});
    await expect(incomes.create(actor,{...body,amountMinor:200},"conflict")).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    const second=await incomes.create(actor,input({expectedOn:"2020-02-01"}),"two");
    const edited=await incomes.change(actor,first.id,1,"edit",{...body,amountMinor:10101},"edit");
    await expect(incomes.change(actor,first.id,1,"edit",body,"stale")).rejects.toMatchObject({code:"INCOME_VERSION_CONFLICT"});
    await incomes.change(actor,first.id,edited.version,"receive",{receivedOn:"2020-02-02"},"confirm");
    await incomes.change(actor,first.id,edited.version,"receive",{receivedOn:"2020-02-02"},"duplicate");
    expect(await finance.summary("2020-02-02","2020-02-02")).toMatchObject({cashIn:101.01});
    expect(await incomes.list("2020-02-01","2020-02-01")).toEqual(expect.arrayContaining([expect.objectContaining({id:second.id,status:"Pending"})]));
    const events=await store.pool.query("SELECT action,actor_id::text,request_id FROM audit_logs WHERE entity_type='finance_income' AND entity_id=$1 ORDER BY occurred_at",[first.id]);
    expect(events.rows).toHaveLength(3);
    expect(events.rows[2]).toMatchObject({action:"INCOME_RECEIVED",actor_id:actor,request_id:"confirm"});
  });

  it("separates loan/capital cash from profit and records repayment through expenses", async () => {
    for (const kind of ["Capital","Loan"] as const) {
      const row=await incomes.create(actor,input({kind,expectedOn:"2020-03-01",amountMinor:50000}),kind);
      await incomes.change(actor,row.id,row.version,"receive",{receivedOn:"2020-03-02"},"receive");
    }
    await store.pool.query(`INSERT INTO finance_records(domain,record_id,position,payload)
      VALUES('finance_expenses',$1,1,$2::jsonb)`,[randomUUID(),JSON.stringify({id:randomUUID(),category:"Loan Repayment",date:"2020-03-02",paidAt:"2020-03-02",amount:100,status:"Paid"})]);
    expect(await finance.summary("2020-03-02","2020-03-02")).toMatchObject({cashIn:1000,financingCashOut:100,cashOut:100,netCashFlow:900,otherIncome:0,netProfit:0,operatingExpenses:0});
  });

  it("cancels pending entries, locks received history and rejects future receipt dates", async () => {
    const row=await incomes.create(actor,input({expectedOn:"2020-04-01"}),"create");
    await expect(incomes.change(actor,row.id,1,"receive",{receivedOn:"9999-01-01"},"future")).rejects.toMatchObject({code:"INCOME_DATE_INVALID"});
    await incomes.change(actor,row.id,1,"void",{},"void");
    await expect(incomes.change(actor,row.id,1,"void",{},"retry")).resolves.toMatchObject({status:"Void"});
    expect(await finance.summary("2020-04-01","2020-04-01")).toMatchObject({pendingIncome:0,cashIn:0});
    const received=await incomes.create(actor,input({expectedOn:"2020-04-02"}),"create");
    await incomes.change(actor,received.id,1,"receive",{receivedOn:"2020-04-02"},"receive");
    await expect(incomes.change(actor,received.id,2,"void",{},"erase")).rejects.toMatchObject({code:"INCOME_LOCKED"});
  });

  it("creates a gift receivable at the real order price and tells the recipient to pay zero", async () => {
    const f=await gift();
    expect(f.order).toMatchObject({collectionMode:"Third Party",collectionAmount:0,discount:0,paymentStatus:"Unpaid",amountPaid:0,payerPhone:"201000000002"});
    expect(f.income).toMatchObject({kind:"Order Collection",status:"Pending",amountMinor:Math.round(Number(f.order.finalAmount)*100),orderId:f.order.orderId});
    expect(Number(f.order.finalAmount)).toBeGreaterThan(600);
    const message=(await store.pool.query("SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_WHATSAPP_CONFIRMATION'",[f.order.id])).rows[0];
    expect(message!.payload.parameters[1]).toBe("0.00");
    const before=await finance.summary(today,today);
    const received=await incomes.change(actor,f.income.id,f.income.version,"receive",{receivedOn:today},"gift-receipt");
    expect(received.status).toBe("Received");
    expect((await commerce.adminOrders()).orders.find(row=>row.id===f.order.id)).toMatchObject({paymentStatus:"Paid",collectionAmount:0,amountPaid:f.order.finalAmount});
    const collected=await finance.summary(today,today);
    expect(collected.cashIn-before.cashIn).toBe(Number(f.order.finalAmount));
    expect(collected.netRevenue).toBe(before.netRevenue);
    // Move the synthetic parcel to its real external-delivery confirmation path.
    await store.pool.query(`UPDATE orders SET status='Out With Representative',legacy=legacy||'{"deliveryShipment":{"type":"external","companyId":"synthetic","status":"In Transit"}}'::jsonb WHERE id=$1`,[f.order.id]);
    await commerce.adminOrderWorkflowAction(actor,String(f.order.id),{expectedStatus:"Out With Representative",target:"Delivered"},"deliver");
    const delivered=await finance.summary(today,today);
    expect(delivered.cashIn).toBe(collected.cashIn);
    expect(delivered.grossRevenue-before.grossRevenue).toBe(Number(f.order.finalAmount));
    await incomes.change(actor,f.income.id,f.income.version,"receive",{receivedOn:today},"retry-gift");
    expect((await finance.summary(today,today)).cashIn).toBe(delivered.cashIn);
    await expect(finance.createCodSettlement(actor,{id:randomUUID(),orderId:String(f.order.orderId),settlementDate:today,amountReceived:1,fee:0},"wrong-ledger"))
      .rejects.toMatchObject({code:"THIRD_PARTY_COLLECTION_REQUIRED"});
  });

  it("delivery before gift payment keeps the payer unpaid; cancellations void pending receivables", async () => {
    const f=await gift();
    await store.pool.query(`UPDATE orders SET status='Out With Representative',legacy=legacy||'{"deliveryShipment":{"type":"external","companyId":"synthetic","status":"In Transit"}}'::jsonb WHERE id=$1`,[f.order.id]);
    await commerce.adminOrderWorkflowAction(actor,String(f.order.id),{expectedStatus:"Out With Representative",target:"Delivered"},"deliver-unpaid");
    expect((await commerce.adminOrders()).orders.find(row=>row.id===f.order.id)).toMatchObject({paymentStatus:"Unpaid",amountPaid:0});
    const cancelled=await gift();
    await commerce.adminOrderWorkflowAction(actor,String(cancelled.order.id),{expectedStatus:"New",target:"Cancelled",reason:"Customer cancelled"},"cancel");
    const row=(await incomes.list(today,today)).find(row=>row.id===cancelled.income.id)!;
    expect(row.status).toBe("Void");
    await expect(incomes.change(actor,row.id,row.version,"receive",{receivedOn:today},"late")).rejects.toMatchObject({code:"INCOME_LOCKED"});
  });

  it("shows zero to the courier and does not mark an unpaid gift paid when the courier delivers",async()=>{
    const f=await gift(), rep=randomUUID();
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'representative',$2,$2,'synthetic','active',now())`,[rep,`${rep}@example.test`]);
    await store.pool.query(
      "INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at) VALUES($1,'Gift courier',repeat('a',64),'1234','approved',$2,now())",
      [rep,actor],
    );
    await store.pool.query("INSERT INTO representative_locations(representative_user_id,latitude,longitude,accuracy_meters,updated_at) VALUES($1,30.0444,31.2357,5,now())",[rep]);
    await store.pool.query(`UPDATE orders SET status='Representative On The Way',representative_user_id=$2,
      delivery_address=delivery_address||'{"latitude":"30.0444","longitude":"31.2357"}'::jsonb WHERE id=$1`,[f.order.id,rep]);
    expect((await commerce.representativeWork(rep)).orders.find(row=>row.id===f.order.id)).toMatchObject({collectionAmount:0,finalAmount:f.order.finalAmount});
    await commerce.representativeOrderAction(rep,String(f.order.orderId),"delivered");
    expect((await commerce.adminOrders()).orders.find(row=>row.id===f.order.id)).toMatchObject({amountPaid:0,paymentStatus:"Unpaid",collectionAmount:0});
  });

  it("keeps an ordinary 100 percent item discount separate from third party payments",async()=>{
    const f=await gift(), piece=`FREE-${randomUUID()}`;
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',30000)`,[piece,f.model]);
    const body={...f.body,itemCodes:[piece],collectionMode:"Recipient" as const,discountPercent:100};
    const state=await commerce.createAdminOrder(actor,body,"free-order");
    const row=state.orders.find(order=>(order.items as string[]).includes(piece))!;
    expect(row).toMatchObject({collectionMode:"Recipient",discount:100});
    expect((await incomes.list(today,today)).some(entry=>entry.orderId===row.orderId)).toBe(false);
    const edited=await commerce.updateAdminOrder(actor,String(row.id),{...body,clientName:"Free order note",expectedVersion:Number(row.version)},"free-note");
    expect(edited.orders.find(order=>order.id===row.id)).toMatchObject({discount:100,finalAmount:row.finalAmount});
    expect((await incomes.list(today,today)).some(entry=>entry.orderId===row.orderId)).toBe(false);
  });

  it("locks gift payment to Income, synchronizes pending amount changes and rejects manual relinking", async () => {
    const f=await gift();
    await expect(commerce.updateAdminOrder(actor,String(f.order.id),{...f.body,expectedVersion:Number(f.order.version),amountPaid:10,paymentStatus:"Partially Paid"},"bypass"))
      .rejects.toMatchObject({code:"GIFT_PAYMENT_RECEIPT_REQUIRED"});
    const changed=await commerce.updateAdminOrder(actor,String(f.order.id),{...f.body,expectedVersion:Number(f.order.version),discountPercent:10},"discount");
    const order=changed.orders.find(row=>row.id===f.order.id)!;
    const row=(await incomes.list(today,today)).find(row=>row.id===f.income.id)!;
    expect(row.amountMinor).toBe(Math.round(Number(order.finalAmount)*100));
    await expect(incomes.change(actor,row.id,f.income.version,"receive",{receivedOn:today},"stale")).rejects.toMatchObject({code:"INCOME_VERSION_CONFLICT"});
    await incomes.change(actor,row.id,row.version,"receive",{receivedOn:today},"receive");
    await expect(commerce.updateAdminOrder(actor,String(order.id),{...f.body,discountPercent:0},"reprice-paid")).rejects.toMatchObject({code:"ORDER_FINANCIAL_SNAPSHOT_LOCKED"});
    await expect(incomes.create(actor,input({kind:"Order Collection",orderId:String(order.orderId)}),"manual-link"))
      .rejects.toMatchObject({code:"GIFT_ORDER_REQUIRED"});
  });
});
