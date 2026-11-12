import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import { allocateFixedSaving, quantityRefund } from "../src/modules/promotions/quantity-offer.js";
import { embeddedStore } from "./embedded-store.js";

describe("quantity offers on the production schema", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService, promotions: PromotionService, catalog: CatalogService;
  const actor = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(); commerce = new CommerceService(store.pool); promotions = new PromotionService(store.pool); catalog = new CatalogService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','quantity-staff@example.test','quantity-staff@example.test','test-only-hash','active',now())`, [actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Quantity test')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture(kind = "percent", min = 3) {
    const user = randomUUID(), suffix = randomUUID().slice(0, 8), email = `${user}@example.test`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only-hash','active',now())`, [user, email]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Quantity customer','2000-01-01')", [user]);
    const models: string[] = [], pieces: string[][] = [];
    for (let index = 0; index < 4; index++) {
      const model = `Q-${suffix}-${index}`; models.push(model); pieces.push([]);
      await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
        VALUES($1,'Quantity model',40000,100000,$2,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model, index === 3 ? 20 : 0]);
      for (let number = 0; number < 3; number++) {
        const piece = `QI-${suffix}-${index}-${number}`; pieces[index]!.push(piece);
        await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
          VALUES($1,$1,$2,'Black','M','In stock',40000)`, [piece, model]);
      }
    }
    const campaign = await promotions.create(promotionCampaignInputSchema.parse({ name: "Quantity synthetic", code: `Q-${suffix}`,
      status: "Active", discountPercent: kind === "fixed" ? 0 : 10, discountKind: kind, discountAmountMinor: kind === "fixed" ? 30001 : 0,
      distinctModels: true, automatic: true, minQuantity: min, perCustomerUsageLimit: 1, marketingText: "كمّل اللوك",
      productScope: { mode: "models", values: models } }), actor, "quantity-test");
    const reservation = `CART-QUANTITY-${suffix}`;
    const reserve = (indexes: number[], quantity = 1) => commerce.reserveCart(reservation, indexes.map((index) => ({ modelId: models[index]!, color: "Black", size: "M", quantity })), user);
    const input = { reservationId: reservation, contact: { name: "Quantity", phone1: "+201000000001", email },
      address: { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" }, promotionCode: String(campaign.code) };
    return { user, models, pieces, campaign, reservation, input, reserve };
  }
  async function deliver(order: Record<string, unknown>) {
    await store.pool.query("UPDATE orders SET status='Representative On The Way' WHERE id=$1", [order.id]);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "Representative On The Way", target: "Delivered" }, "quantity-delivery", false);
  }
  it("rejects repeated models and excludes independently discounted models from the threshold", async () => {
    const f = await fixture();
    await f.reserve([0], 3);
    expect((await promotions.resolveForCheckout(f.user, f.reservation)).code).toBeNull();
    await f.reserve([0, 1, 3]);
    expect((await promotions.resolveForCheckout(f.user, f.reservation)).code).toBeNull();
    await expect(commerce.checkout(f.user, f.input, "invalid", undefined, `KEY-${f.reservation}`)).rejects.toMatchObject({ code: "PROMOTION_NOT_ELIGIBLE" });
  });
  it("quotes and freezes per-piece prices, claws back a broken offer, and refunds merchandise exactly once without refunding shipping", async () => {
    const f = await fixture(); await f.reserve([0, 1, 2, 3]);
    const quote = await commerce.customerCartQuote(f.user, f.reservation);
    expect(quote).toMatchObject({ totalMinor: 360000, discountMinor: 50000, shippingMinor: 10000 });
    const order = await commerce.checkout(f.user, f.input, "quantity-checkout", undefined, `KEY-${f.reservation}`);
    expect(order.finalAmount).toBe(3600);
    const again = await commerce.checkout(f.user, f.input, "retry", undefined, `KEY-${f.reservation}`);
    expect(again.id).toBe(order.id);
    const lines = (await store.pool.query("SELECT * FROM order_items WHERE order_id=$1", [order.id])).rows;
    expect(lines.filter((line) => line.discount_source === "Campaign")).toHaveLength(3);
    expect(lines.filter((line) => line.discount_source === "Model")).toHaveLength(1);
    await deliver(order);
    // Changes to today's campaign/model cannot rewrite the sold order's policy.
    await store.pool.query("UPDATE catalog_models SET selling_minor=200000 WHERE model_id=ANY($1::text[])", [f.models]);
    await store.pool.query("UPDATE promotion_records SET payload=jsonb_set(payload,'{minQuantity}','2') WHERE record_id=$1", [f.campaign.id]);
    const first = await commerce.adminManualReturn(actor, { itemCode: f.pieces[0]![0]!, condition: "Good", reason: "Test", refundAmount: 9999 }, "quantity-refund");
    expect(first.refundAmount).toBe(700);
    // Archiving a completed return does not undo the money or model removal.
    await store.pool.query("UPDATE return_requests SET payload=jsonb_set(payload,'{isDeleted}','true') WHERE record_id=$1", [first.id]);
    const second = await commerce.adminManualReturn(actor, { itemCode: f.pieces[1]![0]!, condition: "Good", reason: "Test", refundAmount: 9999 }, "quantity-refund");
    expect(second.refundAmount).toBe(1000);
    await commerce.adminManualReturn(actor, { itemCode: f.pieces[2]![0]!, condition: "Good", reason: "Test", refundAmount: 0 }, "quantity-refund");
    await commerce.adminManualReturn(actor, { itemCode: f.pieces[3]![0]!, condition: "Good", reason: "Test", refundAmount: 0 }, "quantity-refund");
    const paid = (await store.pool.query("SELECT final_minor,amount_refunded_minor FROM orders WHERE id=$1", [order.id])).rows[0];
    expect(Number(paid.amount_refunded_minor)).toBe(Number(paid.final_minor) - 10000);
    expect((await store.pool.query("SELECT status FROM promotion_usages WHERE order_id=$1", [order.id])).rows).toEqual([{ status: "Used" }]);
    await expect(commerce.adminManualReturn(actor, { itemCode: f.pieces[0]![0]!, condition: "Good", reason: "Duplicate", refundAmount: 1 }, "repeat")).rejects.toMatchObject({ code: "RETURN_ITEM_OWNERSHIP_CHANGED" });
    expect((await promotions.quantityOffers(f.user)).some((row) => row.id === f.campaign.id)).toBe(false);
  });
  it("allocates a fixed saving in piastres and preserves it while enough different models remain", async () => {
    const f = await fixture("fixed", 2); await f.reserve([0, 1, 2]);
    const order = await commerce.checkout(f.user, f.input, "fixed-quantity", undefined, `KEY-${f.reservation}`);
    expect(Math.round(Number(order.finalAmount) * 100)).toBe(279999);
    const allocation = (await store.pool.query("SELECT discount_minor FROM order_items WHERE order_id=$1", [order.id])).rows;
    expect(allocation.reduce((sum, row) => sum + Number(row.discount_minor), 0)).toBe(30001);
    await deliver(order);
    const first = await commerce.adminManualReturn(actor, { itemCode: f.pieces[0]![0]!, condition: "Good", reason: "Test", refundAmount: 0 }, "fixed-return");
    expect(first.refundAmount).toBe(1000);
    const second = await commerce.adminManualReturn(actor, { itemCode: f.pieces[1]![0]!, condition: "Good", reason: "Test", refundAmount: 0 }, "fixed-return");
    expect(second.refundAmount).toBe(699.99);
  });
  it("applies the same policy to staff intake and representative pickup, including a safe retry", async () => {
    const f = await fixture(); await f.reserve([0, 1, 2]);
    const order = await commerce.checkout(f.user, f.input, "pickup-quantity", undefined, `KEY-${f.reservation}`);
    await deliver(order);
    const first = await commerce.recordAdminReturn(actor, { itemCode: f.pieces[0]![0]!, condition: "Good", reason: "Test", refundAmount: 900 }, "legacy-intake");
    expect(first.refundAmount).toBe(700);
    const rep = randomUUID(), ref = `PICKUP-${randomUUID()}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'representative',$2,$2,'test-only-hash','active',now())`, [rep, `${rep}@example.test`]);
    await store.pool.query("INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at) VALUES($1,'Quantity courier',$2,'1234','approved',$3,now())", [rep, rep.replaceAll('-', '').padEnd(64, 'a'), actor]);
    const repCode = (await store.pool.query("SELECT representative_code FROM representatives WHERE user_id=$1", [rep])).rows[0].representative_code;
    const record = { id: ref, returnId: ref, orderId: order.orderId, itemCode: f.pieces[1]![0], requestType: "Refund", status: "Pickup On The Way",
      pickupStartedAt: new Date().toISOString(), representativeId: repCode, representativeBusinessId: repCode,
      latitude: 30.05, longitude: 31.35, inspectionStatus: "Pending" };
    await store.pool.query("INSERT INTO return_requests(record_id,payload) VALUES($1,$2::jsonb)", [ref, JSON.stringify(record)]);
    await store.pool.query("INSERT INTO representative_locations(representative_user_id,latitude,longitude,accuracy_meters) VALUES($1,30.05,31.35,5)", [rep]);
    const second = await commerce.representativeReturnAction(rep, ref, "complete");
    expect(second.refundAmount).toBe(1000);
    const before = (await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [order.id])).rows[0].amount_refunded_minor;
    await expect(commerce.representativeReturnAction(rep, ref, "complete")).rejects.toMatchObject({ code: "RETURN_STATE_INVALID" });
    expect((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [order.id])).rows[0].amount_refunded_minor).toBe(before);
  });
  it("preserves the offer's model slot when a physical piece is exchanged before a refund", async () => {
    const f = await fixture("percent", 2); await f.reserve([0, 1, 2]);
    const order = await commerce.checkout(f.user, f.input, "exchange-quantity", undefined, `KEY-${f.reservation}`); await deliver(order);
    const rep = randomUUID(), ref = `EXCHANGE-${randomUUID()}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'representative',$2,$2,'test-only-hash','active',now())`, [rep, `${rep}@example.test`]);
    await store.pool.query("INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at) VALUES($1,'Quantity courier',$2,'1234','approved',$3,now())", [rep, rep.replaceAll('-', '').padEnd(64, 'a'), actor]);
    const repCode = (await store.pool.query("SELECT representative_code FROM representatives WHERE user_id=$1", [rep])).rows[0].representative_code;
    const replacement = f.pieces[0]![1]!;
    await store.pool.query("UPDATE inventory_items SET status='Processing/Held' WHERE item_code=$1", [replacement]);
    const record = { id: ref, returnId: ref, orderId: order.orderId, itemCode: f.pieces[0]![0], replacementItemCode: replacement,
      requestType: "Exchange", status: "Pickup On The Way", pickupStartedAt: new Date().toISOString(), representativeId: repCode,
      requestedColor: "Black", requestedSize: "M", latitude: 30.05, longitude: 31.35, inspectionStatus: "Pending" };
    await store.pool.query("INSERT INTO return_requests(record_id,payload) VALUES($1,$2::jsonb)", [ref, JSON.stringify(record)]);
    await store.pool.query("INSERT INTO representative_locations(representative_user_id,latitude,longitude,accuracy_meters) VALUES($1,30.05,31.35,5)", [rep]);
    await commerce.representativeReturnAction(rep, ref, "complete");
    const first = await commerce.adminManualReturn(actor, { itemCode: f.pieces[1]![0]!, condition: "Good", reason: "Test", refundAmount: 0 }, "post-exchange-return");
    expect(first.refundAmount).toBe(900); // Exchanged A + retained C still qualify.
    const second = await commerce.adminManualReturn(actor, { itemCode: replacement, condition: "Good", reason: "Test", refundAmount: 0 }, "replacement-return");
    expect(second.refundAmount).toBe(800); // Only C remains, so its 100 EGP saving is recovered.
  });
  it.skipIf(!process.env.TEST_DATABASE_URL)("serializes competing refunds and never grants two cumulative refunds", async () => {
    const f = await fixture(); await f.reserve([0, 1, 2]);
    const order = await commerce.checkout(f.user, f.input, "parallel-quantity", undefined, `KEY-${f.reservation}`); await deliver(order);
    await Promise.all([0, 1].map((i) => commerce.adminManualReturn(actor, { itemCode: f.pieces[i]![0]!, condition: "Good", reason: "Parallel", refundAmount: 900 }, `parallel-${i}`)));
    expect(Number((await store.pool.query("SELECT amount_refunded_minor FROM orders WHERE id=$1", [order.id])).rows[0].amount_refunded_minor)).toBe(170000);
  });
  it("persists selected related models, exposes only safe public fields, and rejects self/duplicate/unknown links", async () => {
    const f = await fixture(); const state = await catalog.adminState(); const model = state.models.find((row) => row.modelId === f.models[0])!;
    const patch = (links: string[]) => catalog.replaceState(state.version, [{ ...model, relatedModelIds: links }], [], actor, "related-model", {
      models: { [String(model.modelId)]: Number(model.version) }, items: {},
    });
    await expect(patch([String(model.modelId)])).rejects.toMatchObject({ code: "RELATED_MODELS_INVALID" });
    await expect(patch([f.models[1]!, f.models[1]!])).rejects.toMatchObject({ code: "RELATED_MODELS_INVALID" });
    await expect(patch(["NO-SUCH-MODEL"])).rejects.toMatchObject({ code: "RELATED_MODEL_NOT_FOUND" });
    await patch([f.models[2]!, f.models[1]!]);
    const publicModel = (await catalog.publicCatalog()).models.find((row) => row.modelId === model.modelId)!;
    expect(publicModel.relatedModelIds).toEqual([f.models[2], f.models[1]]);
    expect(publicModel).not.toHaveProperty("cost"); expect(publicModel).not.toHaveProperty("legacy");
    await expect(patch([])).rejects.toMatchObject({ code: "CATALOG_VERSION_CONFLICT" });
  });
});

describe("quantity offer input and rounding", () => {
  it("requires automatic offers, distinct threshold >= 2, and a positive discount", () => {
    const input = { name: "Quantity", code: "Q-TEST", distinctModels: true, discountPercent: 10, minQuantity: 3 };
    expect(promotionCampaignInputSchema.safeParse(input).success).toBe(false);
    expect(promotionCampaignInputSchema.safeParse({ ...input, automatic: true, minQuantity: 1 }).success).toBe(false);
    expect(promotionCampaignInputSchema.safeParse({ ...input, automatic: true, discountPercent: 0 }).success).toBe(false);
  });
  it("does not lose a piastre or over-allocate on small or large prices", () => {
    const parts = allocateFixedSaving([{ id: "a", baseMinor: 1 }, { id: "b", baseMinor: 2 }], 100);
    expect([...parts.values()]).toEqual([1, 2]);
    const large = allocateFixedSaving([{ id: "a", baseMinor: 999999999 }, { id: "b", baseMinor: 999999998 }], 999999999);
    expect([...large.values()].reduce((a, b) => a + b, 0)).toBe(999999999);
  });
  it("handles zero refunds without debt and restores the full payment when all pieces return", () => {
    const policy = { minQuantity: 2, minOrderMinor: 0, eligibleItemCodes: ["a", "b"], discountKind: "percent" as const, discountAmountMinor: 0 };
    const lines = ["a", "b"].map((id) => ({ itemCode: id, modelId: id, baseMinor: 10000, finalMinor: 1000 }));
    expect(quantityRefund(policy, lines, new Set(["a"]), 2000, 0).refundMinor).toBe(0);
    expect(quantityRefund(policy, lines, new Set(["a", "b"]), 2000, 0).refundMinor).toBe(2000);
  });
});
