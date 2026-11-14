// Guest checkout runs against the production migrations, including identity and Set triggers.
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import { createSetCartRouter } from "../src/modules/sets/set-cart.routes.js";
import { SetCartService } from "../src/modules/sets/set-cart.service.js";
import { guestCheckoutCustomer } from "../src/modules/identity/customer-record.js";
import { CustomerEmailAuthService } from "../src/modules/identity/customer-email-auth.service.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { loadConfig } from "../src/config/env.js";
import { decryptSecret } from "../src/security/crypto.js";
import { PromotionService, promotionCampaignInputSchema } from "../src/modules/promotions/promotion.service.js";
import type { AppError } from "../src/http/app-error.js";
import type { CheckoutInput } from "../src/modules/commerce/commerce.types.js";

describe("guest cart and atomic account/order creation", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService, app: express.Express;
  let serial = 100;
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused:unused@localhost/unused",
    AUTH_PEPPER: "synthetic-guest-checkout-pepper-with-32-characters", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") });
  beforeAll(async () => {
    store = await embeddedStore(true); commerce = new CommerceService(store.pool);
    const identity = new IdentityService(store.pool, config);
    app = express(); app.use(express.json(), cookieParser());
    app.use("/api/v1", createCommerceRouter(commerce, identity, config),
      createSetCartRouter(new SetCartService(store.pool), identity, config));
    app.use((error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.statusCode || 422).json({ error: { code: error.code || "VALIDATION_ERROR" } });
    });
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture(count = 1) {
    const suffix = randomUUID(), model = `GUEST-${suffix}`, reservationId = `CART-${suffix}`;
    const phone1 = `010${String(++serial).padStart(8, "0")}`, email = `${suffix}@example.test`;
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,discount_percent,size_options,color_options)
      VALUES($1,'Guest model',20000,50000,20,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
    for (let i = 0; i < count; i++) await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',20000)`, [`ITEM-${suffix}-${i}`, model]);
    const input: CheckoutInput = { reservationId, contact: { name: "Guest Customer", phone1, email, birthday: "2000-09-02" },
      address: { country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "2", addressSource: "manual" } };
    return { model, input, lines: [{ modelId: model, color: "Black", size: "M", quantity: count }], owner: suffix.replaceAll("-", "").repeat(2) };
  }
  const count = async (table: string) => Number((await store.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n);

  it("reserves/restores a guest cart over HTTP, creates account and order, and recovers a lost success reply", async () => {
    const f = await fixture(), agent = request.agent(app), before = await count("customers");
    const held = await agent.put("/api/v1/cart/reservation").set("X-Dart-Guest-Cart", "1").send({ reservationId: f.input.reservationId, lines: f.lines });
    expect(held.status).toBe(200);
    expect(await count("customers")).toBe(before);
    expect((await agent.get("/api/v1/cart/reservation")).body.cart.lines).toHaveLength(1);
    expect((await request(app).get(`/api/v1/cart/quote?reservationId=${f.input.reservationId}`)).status).toBe(403);
    const quote = await agent.get(`/api/v1/cart/quote?reservationId=${f.input.reservationId}`);
    expect(quote.body).toMatchObject({ subtotalMinor: 50000, discountMinor: 10000, shippingMinor: 10000, totalMinor: 50000 });
    const input = { ...f.input, quoteFingerprint: quote.body.fingerprint, expectedTotalMinor: quote.body.totalMinor };
    const submit = () => agent.post("/api/v1/guest/orders").set("X-Dart-Guest-Cart", "1")
      .set("Idempotency-Key", `checkout-${f.input.reservationId}`).send(input);
    const created = await submit(); expect(created.status).toBe(201);
    expect(created.headers["set-cookie"]).toBeUndefined();
    expect(created.body.order).toMatchObject({ finalAmount: 500, shippingFee: 100, birthday: "2000-09-02" });
    const customer = (await store.pool.query(`SELECT u.email,u.email_verified_at,c.full_name,c.birthday::text
      FROM users u JOIN customers c ON c.user_id=u.id WHERE u.email_normalized=$1`, [f.input.contact.email])).rows[0]!;
    expect(customer).toMatchObject({ email: f.input.contact.email, email_verified_at: null, full_name: "Guest Customer", birthday: "2000-09-02" });
    expect(await count("customers")).toBe(before + 1);
    expect((await submit()).body.order.id).toBe(created.body.order.id);
    const recovered = await agent.get(`/api/v1/cart/quote?reservationId=${f.input.reservationId}`);
    expect(recovered.body.completedOrder.id).toBe(created.body.order.id);
    expect((await agent.get("/api/v1/cart/reservation")).body.cart).toBeNull();
    const reusedCart = await agent.put("/api/v1/cart/reservation").set("X-Dart-Guest-Cart", "1")
      .send({ reservationId: f.input.reservationId, lines: f.lines });
    expect(reusedCart.status).toBe(409); expect(reusedCart.body.error.code).toBe("CART_ALREADY_CHECKED_OUT");
    expect((await agent.get("/api/v1/cart/reservation")).body.cart).toBeNull();
    const changed = await agent.post("/api/v1/guest/orders").set("X-Dart-Guest-Cart", "1")
      .set("Idempotency-Key", `checkout-${f.input.reservationId}`).send({ ...input, deliveryNotes: "changed" });
    expect(changed.status).toBe(409); expect(changed.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await store.pool.query("SELECT count(*)::int n FROM orders WHERE id=$1", [created.body.order.id])).rows[0]!.n).toBe(1);
  });

  it("rolls back both new customer and order on failure and retains the guest reservation for retry", async () => {
    const f = await fixture(), before = await count("customers");
    await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    await expect(commerce.checkout(null, { ...f.input, address: { ...f.input.address, country: "France" } }, "fail", f.owner, `checkout-${f.input.reservationId}`))
      .rejects.toMatchObject({ code: "DELIVERY_LOCATION_OUTSIDE_EGYPT" });
    expect(await count("customers")).toBe(before);
    expect((await commerce.guestCartForOwner(f.owner)).cart?.lines).toHaveLength(1);
    await expect(commerce.checkout(null, f.input, "retry", f.owner, `checkout-${f.input.reservationId}`)).resolves.toMatchObject({ finalAmount: 500 });
  });

  it("links normalized contacts without overwriting an existing identity or revealing its personal rewards", async () => {
    const f = await fixture(), client = await store.pool.connect();
    const user = await guestCheckoutCustomer(client, f.input.contact); client.release();
    const before = await count("customers");
    await store.pool.query("UPDATE customers SET birthday=CURRENT_DATE,full_name='Original Name' WHERE user_id=$1", [user]);
    await store.pool.query("UPDATE catalog_models SET discount_percent=0 WHERE model_id=$1", [f.model]);
    await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    const quote = await commerce.customerCartQuote(null, f.input.reservationId, undefined, f.owner);
    expect(quote).toMatchObject({ totalMinor: 60000 });
    const input = { ...f.input, contact: { ...f.input.contact, name: "Different Name", phone1: `+20${f.input.contact.phone1.slice(1)}` } };
    const order = await commerce.checkout(null, input, "existing", f.owner, `checkout-${f.input.reservationId}`);
    expect(order).toMatchObject({ finalAmount: 600, name: "Different Name", birthdayRewardId: "", dartCardId: "" });
    expect(await count("customers")).toBe(before);
    expect((await store.pool.query("SELECT customer_user_id::text FROM orders WHERE id=$1", [order.id])).rows[0]!.customer_user_id).toBe(user);
    expect((await store.pool.query("SELECT full_name FROM customers WHERE user_id=$1", [user])).rows[0]!.full_name).toBe("Original Name");
    expect((await store.pool.query("SELECT count(*)::int n FROM customer_address_history WHERE customer_user_id=$1", [user])).rows[0]!.n).toBe(1);
    expect((await commerce.customerCartQuote(null, f.input.reservationId, undefined, "another-browser").catch(error => error)).code).toBe("RESERVATION_EXPIRED");
  });

  it("rejects contradictory phone/email matches without merging customers or losing the cart", async () => {
    const f = await fixture(), other = await fixture(), db = await store.pool.connect();
    await guestCheckoutCustomer(db, f.input.contact); await guestCheckoutCustomer(db, other.input.contact); db.release();
    const before = await count("customers");
    await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    await expect(commerce.checkout(null, { ...f.input, contact: { ...f.input.contact, email: other.input.contact.email } }, "conflict", f.owner, `checkout-${f.input.reservationId}`))
      .rejects.toMatchObject({ code: "CHECKOUT_CONTACT_CONFLICT" });
    expect(await count("customers")).toBe(before);
    expect((await commerce.guestCartForOwner(f.owner)).cart?.lines).toHaveLength(1);
  });

  it("does not attach a buyer's address to a different email owner merely because a phone matches", async () => {
    const f = await fixture(), client = await store.pool.connect();
    await guestCheckoutCustomer(client, { ...f.input.contact, email: "different-owner@example.test" }); client.release();
    await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    await expect(commerce.checkout(null, f.input, "phone-preclaimed", f.owner, `checkout-${f.input.reservationId}`))
      .rejects.toMatchObject({ code: "CHECKOUT_CONTACT_CONFLICT" });
    expect((await commerce.guestCartForOwner(f.owner)).cart?.lines).toHaveLength(1);
    expect((await store.pool.query("SELECT 1 FROM orders WHERE contact_snapshot->>'email'=$1", [f.input.contact.email])).rows).toHaveLength(0);
  });

  it("requires all guest account fields and protects write and reservation ownership", async () => {
    const f = await fixture(), agent = request.agent(app);
    const held = await agent.put("/api/v1/cart/reservation").set("X-Dart-Guest-Cart", "1").send({ reservationId: f.input.reservationId, lines: f.lines });
    expect(held.status).toBe(200);
    expect((await agent.post("/api/v1/guest/orders").send(f.input)).status).toBe(403);
    for (const contact of [{ ...f.input.contact, email: "" }, { ...f.input.contact, birthday: undefined },
      { ...f.input.contact, birthday: "2099-01-01" }, { ...f.input.contact, phone1: "123" }, { ...f.input.contact, birthday: "2000-02-30" }]) {
      expect((await agent.post("/api/v1/guest/orders").set("X-Dart-Guest-Cart", "1")
        .set("Idempotency-Key", `checkout-${f.input.reservationId}`).send({ ...f.input, contact })).status).toBe(422);
    }
    expect((await request(app).post("/api/v1/guest/orders").set("X-Dart-Guest-Cart", "1")
      .set("Idempotency-Key", `checkout-${f.input.reservationId}`).send(f.input)).status).toBe(403);
    expect((await agent.get("/api/v1/cart/reservation")).body.cart).not.toBeNull();
  });

  it("keeps guest Sets attached through checkout and charges shipping once", async () => {
    const f = await fixture(2), agent = request.agent(app), set = `SET-${randomUUID()}`;
    await store.pool.query("INSERT INTO catalog_sets(set_id,name,base_price_minor,discount_percent) VALUES($1,'Guest Set',90000,10)", [set]);
    await store.pool.query("INSERT INTO catalog_set_components(set_id,model_id,quantity) VALUES($1,$2,2)", [set, f.model]);
    expect((await agent.put("/api/v1/cart/reservation").set("X-Dart-Guest-Cart", "1").send({ reservationId: f.input.reservationId, lines: f.lines })).status).toBe(200);
    expect((await agent.put("/api/v1/cart/set-groups").set("X-Dart-Guest-Cart", "1").send({ reservationId: f.input.reservationId,
      groups: [{ setId: set, unitIndex: 1, selections: [f.lines[0], f.lines[0]] }] })).status).toBe(200);
    const quote = await agent.get(`/api/v1/cart/quote?reservationId=${f.input.reservationId}`);
    expect(quote.body).toMatchObject({ totalMinor: 91000, shippingMinor: 10000 });
    const order = await agent.post("/api/v1/guest/orders").set("X-Dart-Guest-Cart", "1")
      .set("Idempotency-Key", `checkout-${f.input.reservationId}`).send({ ...f.input, quoteFingerprint: quote.body.fingerprint });
    expect(order.status).toBe(201); expect(order.body.order).toMatchObject({ finalAmount: 910, shippingFee: 100 });
  });

  it("applies public campaign pricing for guests while retaining per-piece model priority and usage limits", async () => {
    const f = await fixture(), other = await fixture(), actor = randomUUID(), code = `PUBLIC-${randomUUID().slice(0, 8)}`.toUpperCase();
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,status,email_verified_at) VALUES($1,'staff',$2,$2,'active',now())`, [actor, `${actor}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Guest test admin')", [actor]);
    await store.pool.query("UPDATE catalog_models SET discount_percent=0 WHERE model_id=$1", [other.model]);
    await new PromotionService(store.pool).create(promotionCampaignInputSchema.parse({
      name: "Guest public campaign", code, status: "Active", discountPercent: 15,
      automatic: true, perCustomerUsageLimit: 1, productScope: { mode: "models", values: [f.model, other.model] },
    }), actor, "guest-campaign");
    const lines = [...f.lines, ...other.lines];
    await commerce.reserveCart(f.input.reservationId, lines, undefined, f.owner);
    const quote = await commerce.customerCartQuote(null, f.input.reservationId, code, f.owner);
    expect(quote).toMatchObject({ subtotalMinor: 100000, totalMinor: 92500 });
    if (!("fingerprint" in quote)) throw Error("Quote required");
    expect(quote.lines.map(line => line.discountSource)).toEqual(expect.arrayContaining(["Model", "Campaign"]));
    const order = await commerce.checkout(null, { ...f.input, promotionCode: code, quoteFingerprint: quote.fingerprint },
      "guest-campaign", f.owner, `checkout-${f.input.reservationId}`);
    expect(order.finalAmount).toBe(925);
    expect((await store.pool.query("SELECT count(*)::int n FROM promotion_usages WHERE order_id=$1", [order.id])).rows[0]!.n).toBe(1);
    const retryCart = `CART-${randomUUID()}`, retryOwner = randomUUID().replaceAll("-", "").repeat(2);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',20000)`, [`ITEM-${randomUUID()}`, other.model]);
    await commerce.reserveCart(retryCart, other.lines, undefined, retryOwner);
    const anonymous = await commerce.customerCartQuote(null, retryCart, undefined, retryOwner);
    if (!("fingerprint" in anonymous)) throw Error("Quote required");
    expect(anonymous.totalMinor).toBe(52500);
    const retryInput = { ...f.input, reservationId: retryCart, quoteFingerprint: anonymous.fingerprint, expectedTotalMinor: anonymous.totalMinor };
    const changed = await commerce.checkout(null, retryInput, "used-campaign", retryOwner, `checkout-${retryCart}`).catch(error => error);
    expect(changed.code).toBe("PRICE_CHANGED");
    expect(changed.details.quote.totalMinor).toBe(60000);
    const reviewed = await commerce.checkout(null, { ...retryInput, quoteFingerprint: changed.details.quote.fingerprint,
      expectedTotalMinor: 60000, acceptPriceChanges: true }, "reviewed-campaign", retryOwner, `checkout-${retryCart}`);
    expect(reviewed.finalAmount).toBe(600);
    const next = await fixture();
    await store.pool.query("UPDATE catalog_models SET discount_percent=0 WHERE model_id=$1", [next.model]);
    await commerce.reserveCart(next.input.reservationId, next.lines, undefined, next.owner);
    // A customer-specific code may never be redeemed merely by typing the owner's phone.
    const customerId = (await store.pool.query("SELECT customer_user_id FROM orders WHERE id=$1", [order.id])).rows[0]!.customer_user_id;
    await store.pool.query(`INSERT INTO discount_codes(code,name,kind,percent,customer_user_id,status)
      VALUES($1,'Personal code','percent',30,$2,'Active')`, [`PERSONAL-${code}`, customerId]);
    await expect(commerce.customerCartQuote(null, next.input.reservationId, `PERSONAL-${code}`, next.owner))
      .rejects.toMatchObject({ code: "DISCOUNT_CODE_NOT_FOR_CUSTOMER" });
  });

  it("lets a new guest account verify its own email later without re-registering", async () => {
    const f = await fixture(); await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    await commerce.checkout(null, f.input, "account", f.owner, `checkout-${f.input.reservationId}`);
    const identity = new IdentityService(store.pool, config), auth = new CustomerEmailAuthService(store.pool, config, identity);
    const challenge = await auth.startLogin(f.input.contact.email); expect(challenge.sent).toBe(true);
    const event = (await store.pool.query("SELECT payload FROM outbox_events WHERE deduplication_key=$1", [`customer-email-login:${challenge.challengeId}`])).rows[0]!;
    const code = decryptSecret(Buffer.from(event.payload.encryptedParameters.otp, "base64"), config.mfaEncryptionKey);
    const session = await auth.verify(challenge.challengeId, code, "login", { ipAddress: "127.0.0.1", userAgent: "synthetic guest test", requestId: "guest-email" });
    expect(session.account.accountType).toBe("customer");
    expect((await store.pool.query("SELECT email_verified_at IS NOT NULL verified FROM users WHERE email_normalized=$1", [f.input.contact.email])).rows[0]!.verified).toBe(true);
  });

  it("cannot use an old email challenge after the account email changes", async () => {
    const f = await fixture(); await commerce.reserveCart(f.input.reservationId, f.lines, undefined, f.owner);
    await commerce.checkout(null, f.input, "account", f.owner, `checkout-${f.input.reservationId}`);
    const identity = new IdentityService(store.pool, config), auth = new CustomerEmailAuthService(store.pool, config, identity);
    const challenge = await auth.startLogin(f.input.contact.email);
    const event = (await store.pool.query("SELECT payload FROM outbox_events WHERE deduplication_key=$1", [`customer-email-login:${challenge.challengeId}`])).rows[0]!;
    const code = decryptSecret(Buffer.from(event.payload.encryptedParameters.otp, "base64"), config.mfaEncryptionKey);
    const nextEmail = `${randomUUID()}@example.test`;
    await store.pool.query("UPDATE users SET email=$2,email_normalized=$2 WHERE email_normalized=$1", [f.input.contact.email, nextEmail]);
    await expect(auth.verify(challenge.challengeId, code, "login", { ipAddress: "127.0.0.1", userAgent: "synthetic", requestId: "changed-email" }))
      .rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });
});
