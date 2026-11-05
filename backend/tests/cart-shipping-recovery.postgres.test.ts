import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import { SetCartService } from "../src/modules/sets/set-cart.service.js";
import { createSetCartRouter } from "../src/modules/sets/set-cart.routes.js";
import { checkoutEligibleCompanies, checkoutShippingRegions } from "../src/modules/commerce/shipping.checkout.js";
import { governoratesAtPoint, matchesDeliveryGovernorate } from "../src/modules/commerce/shipping.geography.js";
import { blockedGovernoratesSchema } from "../src/modules/settings/site-settings.schema.js";
import { SiteSettingsService } from "../src/modules/settings/site-settings.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AppError } from "../src/http/app-error.js";

describe("cart recovery and governorate policy on the production schema", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService, sets: SetCartService;
  const ownerHash = "b".repeat(64);
  const actor = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(true);
    commerce = new CommerceService(store.pool); sets = new SetCartService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff',$2,$2,'synthetic','active',now())`, [actor, `${actor}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic Shipping Admin')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture() {
    const user = randomUUID(), model = `M-${user}`, first = `I-${user}`, second = `J-${user}`;
    const cart = `CART-${user}`, guest = `GUEST-${user}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, `${user}@example.test`]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Recovery Customer','2000-01-01')", [user]);
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Recovery Model',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$3,'Black','M','In stock',40000),($2,$2,$3,'Black','M','In stock',40000)`, [first, second, model]);
    const lines = [{ modelId: model, color: "Black", size: "M", quantity: 1 }];
    const input = { reservationId: cart, contact: { name: "Recovery Customer", phone1: "+201000000001", email: `${user}@example.test` },
      address: { country: "Egypt", governorate: "Cairo", area: "Tahrir", street: "Synthetic", building: "1", floor: "1", latitude: "30.0444", longitude: "31.2357" } };
    return { user, model, first, second, cart, guest, lines, input };
  }
  it("rejects unauthenticated inventory and Set writes through both old and new URLs", async () => {
    const config = { sessionCookieName: "dart_session", authPepper: "synthetic-pepper-32-characters-long", nodeEnv: "test" as const };
    const identity = { authenticate: async () => null } as unknown as IdentityService;
    const app = express(); app.use(express.json(), cookieParser());
    app.use("/api/v1", createCommerceRouter(commerce, identity, config), createSetCartRouter(sets, identity, config));
    app.use((error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.statusCode || 500).json({ code: error.code }); });
    for (const path of ["/cart/reservation", "/me/cart/reservation", "/cart/set-groups", "/me/cart/set-groups"]) {
      const response = await request(app).put(`/api/v1${path}`).send({});
      expect(response.status).toBe(401); expect(response.body.code).toBe("AUTH_REQUIRED");
    }
  });
  it("discovers legacy guest holds by cookie ownership and claims without extending their expiry", async () => {
    const f = await fixture(), token = randomUUID().replaceAll("-", "").repeat(2);
    const held = await commerce.reserveCart(f.guest, f.lines, undefined, token);
    expect((await commerce.guestCartForOwner("wrong-owner")).cart).toBeNull();
    expect((await commerce.guestCartForOwner(token)).cart?.reservationId).toBe(f.guest);
    await expect(commerce.claimGuestCart(f.guest, f.user)).rejects.toMatchObject({ code: "RESERVATION_OWNERSHIP_INVALID" });
    const adopted = await commerce.claimGuestCart(f.guest, f.user, token);
    expect(adopted.expiresAt).toEqual(held.expiresAt);
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(f.guest);
    expect((await commerce.guestCartForOwner(token)).cart).toBeNull();
    await expect(commerce.claimGuestCart(f.guest, f.user, token)).resolves.toMatchObject({ reservationId: f.guest });
  });
  it("rejects missing/wrong guest ownership for signed-in Set reads and writes", async () => {
    const f = await fixture(); await commerce.reserveCart(f.guest, f.lines, undefined, ownerHash);
    for (const hash of [undefined, "wrong-owner"]) {
      await expect(sets.groupsForReservation(f.guest, f.user, hash)).rejects.toMatchObject({ code: "RESERVATION_OWNERSHIP_INVALID" });
      await expect(sets.attachGroups(f.guest, [], f.user, hash)).rejects.toMatchObject({ code: "RESERVATION_OWNERSHIP_INVALID" });
    }
    await expect(sets.groupsForReservation(f.guest, undefined, ownerHash)).resolves.toMatchObject({ groups: [] });
  });
  it("preserves both carts on conflicts and only replaces after an explicit matching choice", async () => {
    const f = await fixture(), hash = randomUUID().replaceAll("-", "").repeat(2);
    await commerce.reserveCart(f.guest, f.lines, undefined, hash);
    await commerce.reserveCart(f.cart, f.lines, f.user);
    await expect(commerce.claimGuestCart(f.guest, f.user, hash)).rejects.toMatchObject({ code: "CART_CONFLICT", details: { reservationId: f.cart } });
    await expect(commerce.reserveCart(`OTHER-${f.cart}`, f.lines, f.user)).rejects.toMatchObject({ code: "CART_CONFLICT" });
    await expect(commerce.claimGuestCart(f.guest, f.user, hash, "stale-cart")).rejects.toMatchObject({ code: "CART_CONFLICT" });
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(f.cart);
    expect((await commerce.guestCartForOwner(hash)).cart?.reservationId).toBe(f.guest);
    const snapshot = await store.pool.query<{ cart_version: string }>("SELECT updated_at::text AS cart_version FROM cart_reservations WHERE id=$1", [f.cart]);
    await expect(commerce.claimGuestCart(f.guest, f.user, hash, f.cart, "stale-version")).rejects.toMatchObject({ code: "CART_CONFLICT" });
    await commerce.claimGuestCart(f.guest, f.user, hash, f.cart, snapshot.rows[0]!.cart_version);
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(f.guest);
    const released = await store.pool.query("SELECT status FROM inventory_items WHERE id=ANY($1::text[])", [[f.first, f.second]]);
    expect(released.rows.map(row => row.status).sort()).toEqual(["Cart Reserved", "In stock"]);
  });
  it("blocks internal and external carriers, keeps unavailable provinces visible, and validates settings", () => {
    const carrier = { id: "test-carrier", name: "Test", active: true, checkoutEnabled: true,
      trackingUrl: "https://example.test/track", governorates: ["Cairo"], coverage: { Cairo: { all: true, cities: {} } } };
    expect(checkoutEligibleCompanies([carrier], { governorate: "محافظة القاهرة" }, ["Cairo"])).toEqual([]);
    expect(checkoutEligibleCompanies([], { governorate: "Giza" }, ["Cairo"])).toHaveLength(1);
    expect(checkoutShippingRegions([carrier], ["Cairo"]).find(g => g.id === "Cairo")).toMatchObject({ available: false, blocked: true, carriers: [] });
    expect(checkoutShippingRegions([], [])).toHaveLength(27);
    expect(blockedGovernoratesSchema.safeParse(["Cairo", "Cairo"]).success).toBe(false);
    expect(blockedGovernoratesSchema.safeParse(["Cair0"]).success).toBe(false);
  });
  it("saves policy with version/audit and preserves it when older Settings clients save", async () => {
    const current = await commerce.shippingCompanies();
    const updated = await commerce.saveShippingCompanies(actor, current.version, [], randomUUID(), ["Cairo"]);
    expect(updated.blockedGovernorates).toEqual(["Cairo"]);
    await expect(commerce.saveShippingCompanies(actor, current.version, [], randomUUID(), [])).rejects.toMatchObject({ code: "SETTINGS_VERSION_CONFLICT" });
    const settings = new SiteSettingsService(store.pool);
    await settings.update(updated.version, { courierFeePerOrder: 100 }, actor, randomUUID());
    expect((await commerce.shippingCompanies()).blockedGovernorates).toEqual(["Cairo"]);
    expect((await commerce.publicShippingCoverage()).governorates.find(g => g.id === "Cairo")?.available).toBe(false);
    await store.pool.query("UPDATE site_settings SET data=data || '{\"blockedGovernorates\":[]}'::jsonb WHERE id='main'");
  });
  it("rejects blocked or mismatched destination server-side without consuming the cart", async () => {
    const f = await fixture(); await commerce.reserveCart(f.cart, f.lines, f.user);
    await store.pool.query("UPDATE site_settings SET data=data || '{\"blockedGovernorates\":[\"Cairo\"]}'::jsonb WHERE id='main'");
    await expect(commerce.checkout(f.user, f.input, "synthetic", undefined, `blocked-${f.cart}`)).rejects.toMatchObject({ code: "DELIVERY_REGION_UNAVAILABLE" });
    await store.pool.query("UPDATE site_settings SET data=data || '{\"blockedGovernorates\":[]}'::jsonb WHERE id='main'");
    await expect(commerce.checkout(f.user, { ...f.input, address: { ...f.input.address, latitude: "31.2001", longitude: "29.9187" } }, "synthetic", undefined, `mismatch-${f.cart}`)).rejects.toMatchObject({ code: "DELIVERY_GOVERNORATE_MISMATCH" });
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(f.cart);
    await expect(commerce.checkout(f.user, f.input, "synthetic", undefined, `allowed-${f.cart}`)).resolves.toHaveProperty("orderId");
  });
  it("matches real administrative polygons rather than a broad Egypt rectangle", () => {
    expect(matchesDeliveryGovernorate("Cairo", 30.0444, 31.2357)).toBe(true);
    expect(matchesDeliveryGovernorate("Alexandria", 31.2001, 29.9187)).toBe(true);
    expect(matchesDeliveryGovernorate("Giza", 30.0131, 31.2089)).toBe(true);
    expect(matchesDeliveryGovernorate("Cairo", 31.2001, 29.9187)).toBe(false);
    expect(governoratesAtPoint(30, 24.6)).toEqual([]);
    expect(governoratesAtPoint("", 31)).toEqual([]);
  });
});
