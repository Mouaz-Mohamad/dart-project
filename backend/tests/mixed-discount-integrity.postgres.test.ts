import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import { embeddedStore } from "./embedded-store.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import type { EmailMessage } from "../src/modules/outbox/email-provider.js";

describe("mixed line discounts and reward ledgers on the production schema", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  let commerce: CommerceService;
  let promotions: PromotionService;
  const actor = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(); commerce = new CommerceService(store.pool); promotions = new PromotionService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','mixed-staff@example.test','mixed-staff@example.test','test-only-hash','active',now())`, [actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Mixed test')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture(birthday = true) {
    const user = randomUUID(); const suffix = randomUUID().slice(0, 10); const email = `${user}@example.test`;
    const birthdayDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(Date.now() + (birthday ? 0 : 40 * 86400000)));
    const date = `2000-${birthdayDay.find((x) => x.type === "month")!.value}-${birthdayDay.find((x) => x.type === "day")!.value}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'test-only-hash','active',now())`, [user, email]);
    const client = (await store.pool.query<{ client_code: string }>(
      "INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Mixed Customer',$2) RETURNING client_code", [user, date])).rows[0]!.client_code;
    const models: string[] = [], pieces: string[][] = [];
    for (let index = 0; index < 3; index++) {
      const model = `M-${suffix}-${index}`; models.push(model); pieces.push([]);
      await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
        VALUES($1,'Mixed model',40000,100000,$2,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model, index === 2 ? 20 : 0]);
      for (let number = 0; number < (index === 1 ? 2 : 1); number++) {
        const piece = `I-${suffix}-${index}-${number}`; pieces[index]!.push(piece);
        await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
          VALUES($1,$1,$2,'Black','M','In stock',40000)`, [piece, model]);
      }
    }
    const campaign = await promotions.create(promotionCampaignInputSchema.parse({ name: "Scoped synthetic", code: `P-${suffix}`,
      status: "Active", discountPercent: 10, automatic: true, productScope: { mode: "models", values: [models[0]] } }), actor, "mixed");
    const reservation = `CART-${suffix}`;
    await commerce.reserveCart(reservation, models.map((modelId, index) => ({ modelId, color: "Black", size: "M", quantity: index === 1 ? 2 : 1 })), user);
    const input = { reservationId: reservation, contact: { name: "Mixed Customer", phone1: "+201000000001", email },
      address: { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" }, promotionCode: String(campaign.code) };
    return { user, client, models, pieces, campaign, reservation, input };
  }

  async function deliver(order: Record<string, unknown>) {
    await store.pool.query("UPDATE orders SET status='Representative On The Way' WHERE id=$1", [order.id]);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId),
      { expectedStatus: "Representative On The Way", target: "Delivered" }, "mixed-delivery", false);
  }
  async function refund(piece: string, amount: number) {
    await commerce.adminManualReturn(actor, { itemCode: piece, reason: "Synthetic refund", condition: "Good", refundAmount: amount }, "mixed-refund");
  }

  it("allocates campaign, birthday and model prices separately and restores only fully returned birthday lines", async () => {
    const f = await fixture();
    expect((await promotions.resolveForCheckout(f.user, f.reservation)).code).toBe(f.campaign.code);
    const order = await commerce.checkout(f.user, f.input, "mixed-checkout", undefined, `key-${f.reservation}`);
    expect(order.finalAmount).toBe(3100);
    const lines = (await store.pool.query("SELECT item_code,discount_source,final_unit_minor FROM order_items WHERE order_id=$1", [order.id])).rows;
    expect(lines.filter((x) => x.discount_source === "Campaign")).toHaveLength(1);
    expect(lines.filter((x) => x.discount_source === "Birthday")).toHaveLength(2);
    expect(lines.filter((x) => x.discount_source === "Model")).toHaveLength(1);
    await commerce.checkout(f.user, f.input, "retry", undefined, `key-${f.reservation}`);
    expect((await store.pool.query("SELECT status FROM promotion_usages WHERE order_id=$1", [order.id])).rows).toEqual([{ status: "Reserved" }]);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE order_id=$1", [order.id])).rows).toEqual([{ status: "Reserved" }]);
    await deliver(order);
    await refund(f.pieces[0]![0]!, 900);
    const campaignUsage = (await store.pool.query("SELECT status,discount_minor FROM promotion_usages WHERE order_id=$1", [order.id])).rows[0];
    expect(campaignUsage.status).toBe("Used"); expect(Number(campaignUsage.discount_minor)).toBe(10000);
    await refund(f.pieces[1]![0]!, 700);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE order_id=$1", [order.id])).rows[0].status).toBe("Used");
    await refund(f.pieces[1]![1]!, 700);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1", [f.user])).rows[0].status).toBe("Released");
    expect((await store.pool.query("SELECT status FROM promotion_usages WHERE order_id=$1", [order.id])).rows[0].status).toBe("Used");
  });

  it("allocates a scoped campaign and the remaining Dart Card slot without charging protected or excess pieces", async () => {
    const f = await fixture(false); const card = `DC-${randomUUID()}`;
    await store.pool.query("INSERT INTO loyalty_cards(record_id,position,payload) VALUES($1,0,$2::jsonb)", [card, JSON.stringify({
      id: card, cardId: card, clientId: f.client, status: "Active", discountPercent: 40,
      itemLimit: 10, purchasedItems: 9, reservedItems: 0, expDate: new Date(Date.now() + 100 * 86400000).toISOString(),
    })]);
    const order = await commerce.checkout(f.user, f.input, "card-mixed", undefined, `key-${f.reservation}`);
    expect(order.finalAmount).toBe(3300);
    const lines = (await store.pool.query("SELECT item_code,discount_source FROM order_items WHERE order_id=$1", [order.id])).rows;
    const cardLine = lines.find((x) => x.discount_source === "Dart Card")!;
    expect(lines.filter((x) => x.discount_source === "Dart Card")).toHaveLength(1);
    expect(lines.filter((x) => x.discount_source === "None")).toHaveLength(1);
    expect(Number((await store.pool.query("SELECT payload FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].payload.reservedItems)).toBe(1);
    await deliver(order);
    expect(Number((await store.pool.query("SELECT payload FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].payload.purchasedItems)).toBe(10);
    await refund(String(cardLine.item_code), 600);
    expect(Number((await store.pool.query("SELECT payload FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].payload.purchasedItems)).toBe(9);
  });

  it("re-reserves only the discounted Card pieces when an unchanged delivered order moves Back", async () => {
    const f = await fixture(false); const card = `DC-${randomUUID()}`;
    await store.pool.query("INSERT INTO loyalty_cards(record_id,position,payload) VALUES($1,0,$2::jsonb)", [card, JSON.stringify({
      id: card, cardId: card, clientId: f.client, status: "Active", discountPercent: 40,
      itemLimit: 10, purchasedItems: 9, reservedItems: 0, expDate: new Date(Date.now() + 100 * 86400000).toISOString(),
    })]);
    const order = await commerce.checkout(f.user, f.input, "card-back", undefined, `key-${f.reservation}`);
    await deliver(order);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId),
      { expectedStatus: "Delivered", target: "Representative On The Way" }, "card-back", false);
    const payload = (await store.pool.query("SELECT payload FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].payload;
    expect(Number(payload.purchasedItems)).toBe(9);
    expect(Number(payload.reservedItems)).toBe(1);
    expect(payload.reservedOrders[0].itemCount).toBe(1);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId),
      { expectedStatus: "Representative On The Way", target: "Delivered" }, "card-redeliver", false);
    const delivered = (await store.pool.query("SELECT payload FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].payload;
    expect(Number(delivered.purchasedItems)).toBe(10);
    expect(Number(delivered.reservedItems)).toBe(0);
  });

  it("releases both campaign and birthday reservations on cancellation", async () => {
    const f = await fixture();
    const order = await commerce.checkout(f.user, f.input, "cancel-mixed", undefined, `key-${f.reservation}`);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "New", target: "Cancelled" }, "cancel", false);
    expect((await store.pool.query("SELECT status FROM promotion_usages WHERE order_id=$1", [order.id])).rows[0].status).toBe("Released");
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1", [f.user])).rows[0].status).toBe("Released");
  });

  it("does not restore an expired birthday window after all birthday lines are returned", async () => {
    const f = await fixture();
    const order = await commerce.checkout(f.user, f.input, "expired-birthday", undefined, `key-${f.reservation}`);
    await deliver(order);
    await store.pool.query(`UPDATE birthday_rewards SET payload=payload || jsonb_build_object('expiresAt','2000-01-01') WHERE customer_code=$1`, [f.client]);
    for (const piece of f.pieces[1]!) await refund(piece, 700);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE order_id=$1", [order.id])).rows[0].status).toBe("Used");
  });

  it("never stacks a manual order percentage over the model discount, including after editing", async () => {
    const f = await fixture(false);
    await commerce.reserveCart(f.reservation, [], f.user);
    const input = { clientId: f.client, clientName: "Mixed Customer", phone1: "+201000000001", itemCodes: [f.pieces[2]![0]!], discountPercent: 10 };
    const created = await commerce.createAdminOrder(actor, input, "manual-no-stack");
    const order = created.orders.find((x) => (x.items as string[]).includes(input.itemCodes[0]!))!;
    expect(order.finalAmount).toBe(800);
    const edited = await commerce.updateAdminOrder(actor, String(order.orderId), { ...input, discountPercent: 30 }, "manual-edit-no-stack");
    expect(edited.orders.find((x) => x.id === order.id)!.finalAmount).toBe(800);
  });

  it("delivers real committed order events through the email outbox exactly once and keeps orders successful during SMTP retry", async () => {
    const f = await fixture();
    f.input.contact.name = "Synthetic <script>unsafe</script>";
    const accountEmail = f.input.contact.email;
    f.input.contact.email = "different-recipient@example.test";
    const order = await commerce.checkout(f.user, f.input, "order-email", undefined, `key-${f.reservation}`);
    await commerce.checkout(f.user, f.input, "duplicate-checkout", undefined, `key-${f.reservation}`);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "New", target: "Accepted" }, "accepted", false);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "Accepted", target: "Accepted" }, "noop", false);
    const events = (await store.pool.query("SELECT event_type,payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY created_at", [order.id])).rows;
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload.to)).toEqual([accountEmail, accountEmail]);
    const messages: EmailMessage[] = [];
    const provider = { configured: () => true, send: vi.fn(async (message: EmailMessage) => { messages.push(message); }) };
    const outbox = new OutboxService(store.pool, { whatsappAccessToken: null, whatsappPhoneNumberId: null,
      whatsappGraphApiVersion: "v26.0", whatsappTemplateLanguage: "ar", outboxBatchSize: 10, mfaEncryptionKey: Buffer.alloc(32, 5) }, provider);
    for (let batch = 0; batch < 20; batch++) if (!(await outbox.processBatch(10)).claimed) break;
    const ownMessages = messages.filter((message) => message.subject.includes(String(order.orderId)));
    expect(ownMessages).toHaveLength(2);
    expect(ownMessages[0]!.html).not.toContain("<script>");
    expect(ownMessages[0]!.html).toContain("&lt;script&gt;");
    expect((await outbox.processBatch(10)).claimed).toBe(0);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "Accepted", target: "New" }, "back", false);
    provider.send.mockRejectedValueOnce(Object.assign(new Error("Synthetic transient SMTP failure"), { responseCode: 451 }));
    expect((await outbox.processBatch(10)).failed).toBe(1);
    expect((await store.pool.query("SELECT status FROM orders WHERE id=$1", [order.id])).rows[0].status).toBe("New");
    await store.pool.query("UPDATE outbox_events SET available_at=now() WHERE aggregate_id=$1 AND status='failed'", [order.id]);
    expect((await outbox.processBatch(10)).published).toBe(1);
    expect((await outbox.processBatch(10)).claimed).toBe(0);
  });
});
