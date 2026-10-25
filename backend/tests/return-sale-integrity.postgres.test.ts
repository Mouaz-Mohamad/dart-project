import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { CustomerInteractionService } from "../src/modules/commerce/customer-interaction.service.js";
import { embeddedStore } from "./embedded-store.js";

describe("returns preserve each sale's inventory and money on the production schema", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  let commerce: CommerceService;
  let customerReturns: CustomerInteractionService;
  const actor = randomUUID();

  beforeAll(async () => {
    store = await embeddedStore();
    commerce = new CommerceService(store.pool);
    customerReturns = new CustomerInteractionService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','sale-test@example.test','sale-test@example.test','test-only-hash','active',now())`, [actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Sale test')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture() {
    const suffix = randomUUID();
    const user = randomUUID();
    const model = `M-${suffix}`, piece = `I-${suffix}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only-hash','active',now())`, [user, `${user}@example.test`]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer','2000-01-01')", [user]);
    await store.pool.query("INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor) VALUES($1,'Synthetic',30000,50000)", [model]);
    const sale = await order(user, model, piece, 100000);
    // A second physical line makes the 1,000 EGP order total consistent.
    const second = `SECOND-${suffix}`;
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,order_id,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','Sold',$3,30000)`, [second, model, sale.code]);
    await line(sale.id, model, second);
    return { ...sale, user, model, piece, second };
  }

  async function line(orderId: string, model: string, piece: string) {
    const result = await store.pool.query<{ id: string }>(`INSERT INTO order_items(
      order_id,inventory_item_id,item_code,model_id,model_name,color,size,
      original_unit_minor,model_discount_percent,final_unit_minor,cost_snapshot_minor)
      VALUES($1,$2,$2,$3,'Synthetic','Black','M',50000,0,50000,30000) RETURNING id::text`, [orderId, piece, model]);
    return result.rows[0]!.id;
  }

  async function order(user: string, model: string, piece: string, total = 50000) {
    const result = await store.pool.query<{ id: string; order_code: string }>(`INSERT INTO orders(
      customer_user_id,status,payment_method,payment_status,subtotal_minor,final_minor,
      amount_paid_minor,contact_snapshot,delivery_address,delivered_at)
      VALUES($1,'Delivered','Cash on Delivery','Paid',$2,$2,$2,'{"name":"Synthetic"}',
      '{"country":"Egypt","governorate":"Cairo"}',now()) RETURNING id::text,order_code`, [user, total]);
    const sale = result.rows[0]!;
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,order_id,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','Sold',$3,30000)
      ON CONFLICT(id) DO UPDATE SET status='Sold',order_id=$3,cart_reservation_id=NULL,reservation_until=NULL`, [piece, model, sale.order_code]);
    const lineId = await line(sale.id, model, piece);
    return { id: sale.id, code: sale.order_code, lineId };
  }

  const manual = (piece: string, extra = {}) => ({ itemCode: piece, reason: "Synthetic inspection", condition: "Good" as const, refundAmount: 500, ...extra });
  const ownership = async (piece: string) => (await store.pool.query(
    "SELECT status,order_id,cart_reservation_id,return_request_id FROM inventory_items WHERE id=$1", [piece])).rows[0];
  const address = { country: "Egypt", governorate: "Cairo" as const, area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: 30.05, longitude: 31.35 };

  it("caps a manual refund at its immutable line price and rolls back the whole failed command", async () => {
    const f = await fixture();
    await expect(commerce.adminManualReturn(actor, manual(f.piece, { refundAmount: 1000 }), "over-refund"))
      .rejects.toMatchObject({ code: "REFUND_AMOUNT_TOO_HIGH" });
    expect(await ownership(f.piece)).toMatchObject({ status: "Sold", order_id: f.code });
    expect(Number((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [f.id])).rows[0].amount_refunded_minor)).toBe(0);
  });

  it("edits an old manual refund without releasing a new buyer's reservation", async () => {
    const f = await fixture();
    const returned = await commerce.adminManualReturn(actor, manual(f.piece), "first-return");
    const next = await order(f.user, f.model, f.piece);
    const cart = `CART-${randomUUID()}`;
    await store.pool.query("INSERT INTO cart_reservations(id,customer_user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')", [cart, f.user]);
    await store.pool.query("UPDATE inventory_items SET status='In Cart',cart_reservation_id=$2,reservation_until=now()+interval '15 minutes' WHERE id=$1", [f.piece, cart]);
    const before = await ownership(f.piece);
    await commerce.adminManualReturn(actor, manual(f.piece, { existingReturnId: String(returned.id), refundAmount: 450 }), "edit-return");
    expect(await ownership(f.piece)).toEqual(before);
    expect(Number((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [next.id])).rows[0].amount_refunded_minor)).toBe(0);
    expect(Number((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [f.id])).rows[0].amount_refunded_minor)).toBe(45000);
  });

  it("cannot move an old delivered order backwards after a return and resale", async () => {
    const f = await fixture();
    await commerce.adminManualReturn(actor, manual(f.piece), "returned");
    const next = await order(f.user, f.model, f.piece);
    await expect(commerce.adminOrderWorkflowAction(actor, f.code,
      { expectedStatus: "Delivered", target: "Representative On The Way" }, "old-back", false))
      .rejects.toMatchObject({ code: "DELIVERED_ORDER_LOCKED" });
    expect(await ownership(f.piece)).toMatchObject({ status: "Sold", order_id: next.code });
  });

  it("also rejects ownership changes when a legacy order has no return ledger", async () => {
    const f = await fixture();
    const next = await order(f.user, f.model, f.piece);
    await expect(commerce.adminOrderWorkflowAction(actor, f.code,
      { expectedStatus: "Delivered", target: "Representative On The Way" }, "legacy-back", false))
      .rejects.toMatchObject({ code: "ORDER_ITEM_OWNERSHIP_CHANGED" });
    expect(await ownership(f.piece)).toMatchObject({ status: "Sold", order_id: next.code });
    expect((await store.pool.query("SELECT status FROM orders WHERE id=$1", [f.id])).rows[0].status).toBe("Delivered");
  });

  it("preserves an authorized backward correction when no return or settlement exists", async () => {
    const f = await fixture();
    await commerce.adminOrderWorkflowAction(actor, f.code,
      { expectedStatus: "Delivered", target: "Representative On The Way" }, "safe-back", false);
    expect(await ownership(f.piece)).toMatchObject({ status: "Processing/Held", order_id: f.code });
  });

  it("allows a new sale's return even when the same buyer previously returned this physical piece", async () => {
    const f = await fixture();
    await commerce.adminManualReturn(actor, manual(f.piece), "returned-first-sale");
    const next = await order(f.user, f.model, f.piece);
    const request = { itemCode: f.piece, requestType: "Refund" as const, reason: "Synthetic return", address };
    const returned = await customerReturns.submitReturn(f.user, request, "new-sale-return");
    const record = (await store.pool.query("SELECT payload FROM return_requests WHERE record_id=$1", [returned.id])).rows[0].payload;
    expect(record).toMatchObject({ orderId: next.code, orderItemId: next.lineId });
    await expect(customerReturns.submitReturn(f.user, request, "duplicate"))
      .rejects.toMatchObject({ code: "RETURN_ALREADY_OPEN" });
    expect((await commerce.customerSnapshot(f.user)).purchaseStats.totalPieces).toBe(2);
  });

  it("rejects a new manual return against a piece already allocated elsewhere", async () => {
    const f = await fixture();
    await store.pool.query("UPDATE inventory_items SET status='Processing/Held',order_id='OTHER-SALE' WHERE id=$1", [f.piece]);
    await expect(commerce.adminManualReturn(actor, manual(f.piece), "stale-sale"))
      .rejects.toMatchObject({ code: "RETURN_ITEM_OWNERSHIP_CHANGED" });
  });

  it("cannot retarget an existing return to another physical piece", async () => {
    const f = await fixture();
    const returned = await commerce.adminManualReturn(actor, manual(f.piece), "saved-return");
    const other = await fixture();
    await expect(commerce.adminManualReturn(actor, manual(other.piece, { existingReturnId: String(returned.id) }), "retarget"))
      .rejects.toMatchObject({ code: "MANUAL_RETURN_ITEM_INVALID" });
    expect(await ownership(other.piece)).toMatchObject({ status: "Sold", order_id: other.code });
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("serializes simultaneous refund submissions for the same sale", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      commerce.adminManualReturn(actor, manual(f.piece), "concurrent-1"),
      commerce.adminManualReturn(actor, manual(f.piece), "concurrent-2"),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(Number((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [f.id])).rows[0].amount_refunded_minor)).toBe(50000);
  });
});
