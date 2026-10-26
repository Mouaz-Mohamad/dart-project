import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import { createPromotionRouter } from "../src/modules/promotions/promotion.routes.js";
import { SetCartService } from "../src/modules/sets/set-cart.service.js";
import { FinanceService } from "../src/modules/finance/finance.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AppError } from "../src/http/app-error.js";

describe("second Council regressions on the production schema", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>;
  let commerce: CommerceService, promotions: PromotionService;
  const actor = randomUUID(), representative = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(); commerce = new CommerceService(store.pool); promotions = new PromotionService(store.pool);
    for (const [user, type] of [[actor, "staff"], [representative, "representative"]]) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,$2,$3,$3,'synthetic','active',now())`, [user, type, `${user}@example.test`]);
    }
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Council repair')", [actor]);
    await store.pool.query("INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4) VALUES($1::uuid,'Synthetic courier',$1::text,'0000')", [representative]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture(options: { birthday?: boolean; cardUsed?: number; setDiscount?: number; ordinary?: boolean } = {}) {
    const user = randomUUID(), suffix = randomUUID().slice(0, 10), email = `${user}@example.test`;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + (options.birthday ? 0 : 40 * 86400000)));
    const birthday = `2000-${day.find((x) => x.type === "month")!.value}-${day.find((x) => x.type === "day")!.value}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, email]);
    const client = (await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer',$2) RETURNING client_code", [user, birthday])).rows[0].client_code as string;
    const models: string[] = [], pieces: string[] = [];
    for (let index = 0; index < (options.ordinary ? 3 : 2); index++) {
      const model = `M-${suffix}-${index}`, piece = `I-${suffix}-${index}`; models.push(model); pieces.push(piece);
      await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
        VALUES($1,'Synthetic model',40000,100000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
      await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
        VALUES($1,$1,$2,'Black','M','In stock',40000)`, [piece, model]);
    }
    const set = `SET-${suffix}`, card = `DC-${suffix}`, reservation = `CART-SYNTHETIC-${suffix}`;
    await store.pool.query("INSERT INTO catalog_sets(set_id,name,base_price_minor,discount_percent) VALUES($1,'Synthetic Set',150000,$2)", [set, options.setDiscount || 0]);
    for (const model of models.slice(0, 2)) await store.pool.query("INSERT INTO catalog_set_components(set_id,model_id) VALUES($1,$2)", [set, model]);
    if (options.cardUsed !== undefined) await store.pool.query("INSERT INTO loyalty_cards(record_id,position,payload) VALUES($1,0,$2::jsonb)", [card, JSON.stringify({
      id: card, cardId: card, clientId: client, status: "Active", discountPercent: 40, itemLimit: 10, purchasedItems: options.cardUsed, reservedItems: 0, expDate: "2099-12-31",
    })]);
    await commerce.reserveCart(reservation, models.map((modelId) => ({ modelId, color: "Black", size: "M", quantity: 1 })), user);
    await new SetCartService(store.pool).attachGroups(reservation, [{ setId: set, unitIndex: 1, selections: models.slice(0, 2).map((modelId) => ({ modelId, color: "Black", size: "M" })) }], user);
    const input = { reservationId: reservation, contact: { name: "Synthetic Customer", phone1: "+201000000001", email },
      address: { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Synthetic", building: "1", floor: "1", latitude: "30.05", longitude: "31.35", addressSource: "map" } };
    return { user, client, models, pieces, set, card, reservation, input };
  }
  async function checkout(f: Awaited<ReturnType<typeof fixture>>) { return commerce.checkout(f.user, f.input, "synthetic", undefined, `checkout-${f.reservation}`); }
  async function deliver(order: Record<string, unknown>) {
    await store.pool.query("UPDATE orders SET status='Representative On The Way',representative_user_id=$2 WHERE id=$1", [order.id, representative]);
    await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "Representative On The Way", target: "Delivered" }, "synthetic", false);
  }
  async function refund(piece: string, amount: number) { return commerce.adminManualReturn(actor, { itemCode: piece, reason: "Synthetic refund", condition: "Good", refundAmount: amount }, "synthetic"); }
  async function cardCount(card: string) { return Number((await store.pool.query("SELECT payload->>'purchasedItems' AS count FROM loyalty_cards WHERE record_id=$1", [card])).rows[0].count); }

  it("uses the allocated Set total in quotes, committed responses, emails and replays without phantom Card slots", async () => {
    const f = await fixture({ setDiscount: 20, cardUsed: 0 });
    const quote = await commerce.customerCartQuote(f.user, f.reservation);
    expect(quote).toMatchObject({ subtotalMinor: 150000, totalMinor: 120000 });
    const order = await checkout(f);
    expect(order.finalAmount).toBe(1200); expect(order.totalPrice).toBe(1500);
    await commerce.updateAdminOrder(actor, String(order.orderId), { clientName: "Set metadata edit", phone1: "+201000000001", itemCodes: f.pieces, discountPercent: 0 }, "synthetic");
    expect((await store.pool.query("SELECT final_minor::text,promotion FROM orders WHERE id=$1", [order.id])).rows[0]).toMatchObject({ final_minor: "120000", promotion: null });
    expect(JSON.stringify(order)).not.toContain("costSnapshot");
    expect((await store.pool.query("SELECT final_minor::text FROM orders WHERE id=$1", [order.id])).rows[0].final_minor).toBe("120000");
    const email = (await store.pool.query("SELECT payload FROM outbox_events WHERE aggregate_id=$1::text AND event_type='order.created'", [order.id])).rows[0];
    expect(email.payload.parameters.total).toBe("1200.00");
    await deliver(order); expect(await cardCount(f.card)).toBe(0);
    await refund(f.pieces[0]!, 600); await refund(f.pieces[1]!, 600); expect(await cardCount(f.card)).toBe(0);
    // Older idempotency records are sanitized at their public boundary too.
    await store.pool.query("UPDATE idempotency_keys SET response_body=jsonb_set(response_body,'{priceSnapshot,0,costSnapshot}','400') WHERE scope=$1", [`order.create:${f.user}`]);
    const replay = await checkout(f); expect(JSON.stringify(replay)).not.toContain("costSnapshot");
    const recovery = await commerce.customerCartQuote(f.user, f.reservation);
    expect(recovery).toMatchObject({ completedOrder: { orderId: order.orderId, finalAmount: 1200 } });
    expect(JSON.stringify(recovery)).not.toContain("costSnapshot");
  });

  it("shares the last two Card slots between Set and ordinary lines and restores the actual returned slots", async () => {
    const f = await fixture({ cardUsed: 8, ordinary: true }); const order = await checkout(f);
    const rows = (await store.pool.query("SELECT item_code,discount_source,final_unit_minor FROM order_items WHERE order_id=$1", [order.id])).rows;
    expect(rows.filter((row) => row.discount_source === "Dart Card")).toHaveLength(2);
    expect(rows.find((row) => row.item_code === f.pieces[2])?.discount_source).toBe("None");
    await deliver(order); expect(await cardCount(f.card)).toBe(10);
    await refund(f.pieces[0]!, 675); expect(await cardCount(f.card)).toBe(9);
    await refund(f.pieces[1]!, 675); expect(await cardCount(f.card)).toBe(8);
  });

  it("finalizes legacy Set Card aggregates once even when its parent has no Card benefit", async () => {
    const f = await fixture({ cardUsed: 8 }); const order = await checkout(f);
    await store.pool.query("UPDATE orders SET promotion=NULL WHERE id=$1", [order.id]);
    await store.pool.query(`UPDATE loyalty_cards SET payload=payload || '{"reservedItems":0,"reservedOrders":[]}'::jsonb WHERE record_id=$1`, [f.card]);
    await deliver(order); expect(await cardCount(f.card)).toBe(10);
    await refund(f.pieces[0]!, 675); await refund(f.pieces[1]!, 675); expect(await cardCount(f.card)).toBe(8);
  });

  it("preserves metadata edits, financial snapshots, reward ownership and verified COD", async () => {
    const f = await fixture({ birthday: true, ordinary: true }); const order = await checkout(f);
    await store.pool.query("UPDATE orders SET amount_paid_minor=50000,amount_refunded_minor=10000,payment_status='Partially Refunded',cod_verification_status='Verified' WHERE id=$1", [order.id]);
    const read = async () => (await store.pool.query("SELECT promotion,amount_paid_minor,amount_refunded_minor,payment_status,delivery_address,cod_verification_status FROM orders WHERE id=$1", [order.id])).rows[0];
    const before = await read();
    await commerce.updateAdminOrder(actor, String(order.orderId), { clientName: "Updated name", phone1: "+201000000001", itemCodes: f.pieces, deliveryNotes: "Updated notes" }, "synthetic");
    expect(await read()).toMatchObject(before);
    await deliver(order);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1", [f.user])).rows[0].status).toBe("Used");
    expect(JSON.stringify(await commerce.customerSnapshot(f.user))).not.toContain("costSnapshot");
  });

  it("keeps an ordinary New order's saved price during a metadata edit after catalog prices changed", async () => {
    const f = await fixture({ ordinary: true });
    await commerce.reserveCart(f.reservation, [{ modelId: f.models[2]!, color: "Black", size: "M", quantity: 1 }], f.user);
    const order = await checkout(f);
    await store.pool.query("UPDATE catalog_models SET selling_minor=200000 WHERE model_id=$1", [f.models[2]]);
    await commerce.updateAdminOrder(actor, String(order.orderId), { clientName: "Metadata only", phone1: "+201000000001", itemCodes: [f.pieces[2]!], discountPercent: 0 }, "synthetic");
    expect((await store.pool.query("SELECT final_minor::text FROM orders WHERE id=$1", [order.id])).rows[0].final_minor).toBe("100000");
  });

  it("releases legacy Set-only Birthday reservations on cancellation and full return within the reward window", async () => {
    for (const cancel of [true, false]) {
      const f = await fixture({ birthday: true }); const order = await checkout(f);
      await store.pool.query("UPDATE orders SET promotion=NULL WHERE id=$1", [order.id]);
      if (cancel) await commerce.adminOrderWorkflowAction(actor, String(order.orderId), { expectedStatus: "New", target: "Cancelled" }, "synthetic", false);
      else {
        await deliver(order); await refund(f.pieces[0]!, 675);
        expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1", [f.user])).rows[0].status).toBe("Used");
        await refund(f.pieces[1]!, 675);
      }
      expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1", [f.user])).rows[0].status).toBe("Released");
    }
  });

  it("quotes campaign scope per ordinary line and refuses stale acceptance even when acceptPriceChanges is true", async () => {
    const f = await fixture({ ordinary: true });
    const campaign = await promotions.create(promotionCampaignInputSchema.parse({ name: "Scoped repair", code: `P-${randomUUID()}`, status: "Active", automatic: true,
      discountPercent: 20, productScope: { mode: "models", values: [f.models[2]] } }), actor, "synthetic");
    const quote = await commerce.customerCartQuote(f.user, f.reservation);
    expect(quote).toMatchObject({ totalMinor: 230000 });
    if (!("fingerprint" in quote)) throw new Error("quote required");
    await promotions.update(String(campaign.id), 1, promotionCampaignInputSchema.parse({ ...Object.fromEntries(Object.entries(campaign).filter(([key]) => !["id", "version"].includes(key))), discountPercent: 30 }), actor, "synthetic");
    await expect(commerce.checkout(f.user, { ...f.input, quoteFingerprint: quote.fingerprint, expectedTotalMinor: quote.totalMinor, acceptPriceChanges: true }, "synthetic", undefined, `checkout-${f.reservation}`)).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect((await store.pool.query("SELECT count(*)::int AS n FROM orders WHERE customer_user_id=$1", [f.user])).rows[0].n).toBe(0);
  });

  it("replays the complete HTTP pipeline after commit without preflighting a consumed reservation", async () => {
    const f = await fixture({ setDiscount: 20 }); const csrf = "synthetic-csrf-token", session = randomUUID();
    const config = { sessionCookieName: "dart_session", authPepper: "synthetic-secret-32-characters-long", nodeEnv: "test" as const };
    const identity = { authenticate: async () => ({ userId: f.user, accountType: "customer", csrfTokenHash: hashCsrfToken(csrf, config.authPepper) }) } as unknown as IdentityService;
    const app = express(); app.use(express.json(), cookieParser());
    app.use("/api/v1", createPromotionRouter(promotions, identity, config), createCommerceRouter(commerce, identity, config));
    app.use((error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.statusCode || 500).json({ code: error.code, message: error.message }); });
    const post = () => request(app).post("/api/v1/orders").set("Cookie", `dart_session=${session}.${"a".repeat(43)}`).set("x-csrf-token", csrf).set("Idempotency-Key", `checkout-${f.reservation}`).send(f.input);
    const first = await post(), replay = await post();
    expect(first.status, JSON.stringify(first.body)).toBe(201); expect(replay.status).toBe(201); expect(replay.body).toEqual(first.body);
    const recovered = await request(app).get(`/api/v1/me/cart/quote?reservationId=${f.reservation}`).set("Cookie", `dart_session=${session}.${"a".repeat(43)}`);
    expect(recovered.status).toBe(200); expect(recovered.headers["cache-control"]).toBe("no-store");
    expect(recovered.body.completedOrder).toEqual(first.body.order);
    await expect(commerce.customerCartQuote(randomUUID(), f.reservation)).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
    expect((await store.pool.query("SELECT count(*)::int AS n FROM orders WHERE customer_user_id=$1", [f.user])).rows[0].n).toBe(1);
    const denied = await request(app).get(`/api/v1/me/cart/quote?reservationId=${f.reservation}`); expect(denied.status).toBe(401);
  });

  it("accepts an exact pre-release automatic-code replay while rejecting other changed checkout data", async () => {
    const f = await fixture({ ordinary: true });
    const campaign = await promotions.create(promotionCampaignInputSchema.parse({ name: "Legacy replay", code: `P-${randomUUID()}`, status: "Active", automatic: true,
      discountPercent: 20, productScope: { mode: "models", values: [f.models[2]] } }), actor, "synthetic");
    const order = await checkout(f);
    const oldHash = createHash("sha256").update(JSON.stringify({ customerUserId: f.user, input: { ...f.input, promotionCode: campaign.code } })).digest("hex");
    await store.pool.query("UPDATE idempotency_keys SET request_hash=$2 WHERE scope=$1", [`order.create:${f.user}`, oldHash]);
    expect((await checkout(f)).orderId).toBe(order.orderId);
    await expect(commerce.checkout(f.user, { ...f.input, contact: { ...f.input.contact, name: "Different" } }, "synthetic", undefined, `checkout-${f.reservation}`)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("ties leaderboard refunds to the original sale when the same physical item is sold again", async () => {
    const f = await fixture();
    await store.pool.query("UPDATE customers SET full_name='Resale regression' WHERE user_id=$1", [f.user]);
    const first = await checkout(f); await deliver(first); await refund(f.pieces[0]!, 750);
    const reservation = `CART-RESALE-${randomUUID()}`;
    await commerce.reserveCart(reservation, [{ modelId: f.models[0]!, color: "Black", size: "M", quantity: 1 }], f.user);
    const second = await commerce.checkout(f.user, { ...f.input, reservationId: reservation }, "synthetic", undefined, `checkout-${reservation}`);
    await deliver(second);
    const leaderboard = await commerce.publicLeaderboard();
    expect(leaderboard.rows.find((row) => row.name === "Resale regression")).toMatchObject({ orders: 2, items: 2 });
  });

  it("books dated gross COD receipts and refunds once regardless of event order, preserving closed periods", async () => {
    const finance = new FinanceService(store.pool);
    for (const refundFirst of [true, false]) {
      const f = await fixture(); const order = await checkout(f); await deliver(order);
      await store.pool.query("UPDATE orders SET final_minor=100000,delivery_cost_minor=10000,delivered_at='2025-01-15T12:00Z',amount_paid_minor=100000,payment_status='Paid' WHERE id=$1", [order.id]);
      const receipt = () => finance.createCodSettlement(actor, { id: `COD-${randomUUID()}`, orderId: String(order.orderId), settlementDate: "2025-02-15", amountReceived: 900, fee: 0 }, "synthetic");
      const before = await finance.summary("2025-01-01", "2025-01-31"); expect(before.cashIn).toBe(0);
      if (refundFirst) await refund(f.pieces[0]!, 500);
      const received = await receipt(); expect(received.outstandingMinor).toBe(0);
      if (!refundFirst) await refund(f.pieces[0]!, 500);
      await store.pool.query("UPDATE return_requests SET payload=payload || '{\"completedAt\":\"2025-02-16T12:00:00Z\"}'::jsonb WHERE order_code=$1", [order.orderId]);
      const after = await finance.summary("2025-01-01", "2025-01-31"); expect(after.cashIn).toBe(0);
    }
    const february = await finance.summary("2025-02-01", "2025-02-28");
    expect(february.cashIn).toBe(1800); expect(february.refundCashOut).toBe(1000); expect(february.netCashFlow).toBe(800);
  });
});
