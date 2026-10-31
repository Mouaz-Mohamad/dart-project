import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import { allocateManualDiscount, manualDiscountSchema, saveManualDiscount } from "../src/modules/promotions/customer-manual-discount.js";
import { customerDetails } from "../src/modules/promotions/customer-details.service.js";

describe("customer details and single-order manual discounts", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  let commerce: CommerceService;
  const owner = randomUUID(), staff = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(); commerce = new CommerceService(store.pool);
    for (const [id, isOwner] of [[owner, true], [staff, false]] as const) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,'staff',$2,$2,'test-only','active',now())`, [id, `${id}@example.test`]);
      await store.pool.query("INSERT INTO staff_users(user_id,display_name,is_owner) VALUES($1,'Synthetic Staff',$2)", [id, isOwner]);
    }
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  const input = (kind: "percent" | "amount" = "amount", value = 10001, pieceLimit = 2) => manualDiscountSchema.parse({
    name: "Owner birthday gift", kind, value, pieceLimit, startsOn: "2020-01-01", endsOn: "2099-01-01",
  });
  async function fixture(reserve = true) {
    const user = randomUUID(), suffix = randomUUID().slice(0, 8), code = `DR-${suffix}`, email = `${suffix}@example.test`;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const birthday = `2000-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only','active',now())`, [user, email]);
    await store.pool.query("INSERT INTO customers(user_id,client_code,full_name,birthday) VALUES($1,$2,'Synthetic Customer',$3)", [user, code, birthday]);
    const models: string[] = [], pieces: string[] = [];
    for (let i = 0; i < 4; i++) {
      const model = `M-${suffix}-${i}`, piece = `I-${suffix}-${i}`; models.push(model); pieces.push(piece);
      await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
        VALUES($1,'Synthetic model',20000,$2,$3,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model, i === 3 ? 200000 : 100000, i === 2 ? 20 : 0]);
      await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
        VALUES($1,$1,$2,'Black','M','In stock',20000)`, [piece, model]);
    }
    const cart = `CART-${suffix}`;
    if (reserve) await commerce.reserveCart(cart, models.map(modelId => ({ modelId, color: "Black", size: "M", quantity: 1 })), user);
    const checkout = { reservationId: cart, contact: { name: "Synthetic Customer", phone1: "+201000000001", email },
      address: { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" } };
    return { user, code, models, pieces, checkout };
  }

  it("allocates a fixed order amount exactly, proportionally, with a piece cap and no negative prices", () => {
    const grant = { id: randomUUID(), version: 1, ...input() };
    const allocation = allocateManualDiscount(grant, [{ id: "a", baseMinor: 100000 }, { id: "b", baseMinor: 200000 }, { id: "c", baseMinor: 500000 }]);
    expect([...allocation.values()].reduce((a, b) => a + b, 0)).toBe(10001);
    expect(allocation.get("a")).toBe(3334); expect(allocation.get("b")).toBe(6667); expect(allocation.has("c")).toBe(false);
    expect(allocateManualDiscount({ ...grant, value: 1_000_000 }, [{ id: "a", baseMinor: 101 }]).get("a")).toBe(101);
    expect(manualDiscountSchema.safeParse({ ...input(), kind: "percent", value: 10001 }).success).toBe(false);
    expect(manualDiscountSchema.safeParse({ ...input(), endsOn: "2019-01-01" }).success).toBe(false);
  });

  it("enforces Owner-only changes, idempotent creation, optimistic edits, overlap rejection and audit", async () => {
    const f = await fixture(), id = randomUUID();
    await expect(saveManualDiscount(store.pool, f.code, staff, "denied", id, input())).rejects.toMatchObject({ statusCode: 403 });
    expect(await saveManualDiscount(store.pool, f.code, owner, "create", id, input())).toEqual({ id, version: 1 });
    expect(await saveManualDiscount(store.pool, f.code, owner, "retry", id, input())).toEqual({ id, version: 1 });
    await expect(saveManualDiscount(store.pool, f.code, owner, "overlap", randomUUID(), input())).rejects.toMatchObject({ code: "DISCOUNT_OVERLAP" });
    expect(await saveManualDiscount(store.pool, f.code, owner, "edit", id, input("percent", 1500), 1)).toEqual({ id, version: 2 });
    await expect(saveManualDiscount(store.pool, f.code, owner, "stale", id, null, 1)).rejects.toMatchObject({ code: "DISCOUNT_CONFLICT" });
    await saveManualDiscount(store.pool, f.code, owner, "cancel", id, null, 2);
    expect((await store.pool.query("SELECT status FROM customer_manual_discounts WHERE id=$1", [id])).rows[0].status).toBe("Cancelled");
    expect((await store.pool.query("SELECT action FROM audit_logs WHERE entity_id=$1", [id])).rows).toHaveLength(3);
  });

  it("prices Campaign > Manual > Birthday, protects model prices and permanently consumes one grant", async () => {
    const f = await fixture(), id = randomUUID();
    await saveManualDiscount(store.pool, f.code, owner, "create", id, input("amount", 10001, 1));
    const campaigns = new PromotionService(store.pool);
    const campaign = await campaigns.create(promotionCampaignInputSchema.parse({ name: "Scoped campaign", code: `P-${randomUUID()}`,
      status: "Active", automatic: true, discountPercent: 10, productScope: { mode: "models", values: [f.models[0]] } }), owner, "campaign");
    const quote = await commerce.customerCartQuote(f.user, f.checkout.reservationId, String(campaign.code));
    const order = await commerce.checkout(f.user, { ...f.checkout, promotionCode: String(campaign.code) }, "checkout", undefined, `key-${id}`);
    expect(Number(order.finalAmount) * 100).toBe("totalMinor" in quote ? quote.totalMinor : -1);
    const lines = (await store.pool.query("SELECT item_code,discount_source,final_unit_minor FROM order_items WHERE order_id=$1 ORDER BY item_code", [order.id])).rows;
    expect(lines.map(line => line.discount_source)).toEqual(["Campaign", "Manual", "Model", "Birthday"]);
    expect(Number(lines[1].final_unit_minor)).toBe(89999);
    expect((await store.pool.query("SELECT status,order_id FROM customer_manual_discounts WHERE id=$1", [id])).rows[0]).toMatchObject({ status: "Used", order_id: order.id });
    await commerce.checkout(f.user, { ...f.checkout, promotionCode: String(campaign.code) }, "retry", undefined, `key-${id}`);
    expect((await store.pool.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='MANUAL_DISCOUNT_USED'", [id])).rows).toHaveLength(1);
    await expect(saveManualDiscount(store.pool, f.code, owner, "reuse", id, input(), 2)).rejects.toMatchObject({ code: "DISCOUNT_CONFLICT" });
    await store.pool.query("UPDATE orders SET status='Representative On The Way' WHERE id=$1", [order.id]);
    await commerce.adminOrderWorkflowAction(owner, String(order.orderId), { expectedStatus: "Representative On The Way", target: "Delivered" }, "deliver", false);
    await commerce.adminManualReturn(owner, { itemCode: f.pieces[1]!, reason: "Synthetic refund", condition: "Good", refundAmount: 899.99 }, "refund");
    expect((await store.pool.query("SELECT status FROM customer_manual_discounts WHERE id=$1", [id])).rows[0].status).toBe("Used");
    await expect(store.pool.query("UPDATE customer_manual_discounts SET status='Active',order_id=NULL,used_at=NULL WHERE id=$1", [id])).rejects.toThrow("MANUAL_DISCOUNT_ALREADY_USED");
    const details = await customerDetails(store.pool, f.code, "orders", 0, owner, ["loyalty.read"]);
    expect(details.rows).toHaveLength(1); expect(details.rows[0]!.orderId).toBe(order.orderId);
    for (const section of ["reviews", "waiting", "returns", "discounts"] as const) {
      const result = await customerDetails(store.pool, f.code, section, 0, owner, ["loyalty.read"]);
      expect(result.rows).toBeInstanceOf(Array);
    }
  });

  it("also applies the same one-order grant to dashboard-created orders", async () => {
    const f = await fixture(false), id = randomUUID();
    await saveManualDiscount(store.pool, f.code, owner, "create", id, input("percent", 1500, 5));
    const result = await commerce.createAdminOrder(owner, { clientId: f.code, clientName: "Synthetic Customer", phone1: "+201000000001", itemCodes: f.pieces }, "admin-create");
    const order = result.orders.find(row => row.clientId === f.code)!;
    expect(order.finalAmount).toBe(4200);
    expect((await store.pool.query("SELECT status FROM customer_manual_discounts WHERE id=$1", [id])).rows[0].status).toBe("Used");
    const lines = (await store.pool.query("SELECT discount_source FROM order_items WHERE order_id=$1", [order.id])).rows;
    expect(lines.filter(line => line.discount_source === "Manual")).toHaveLength(3);
  });
});
