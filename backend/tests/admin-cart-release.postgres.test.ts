// DART CODE GUIDE | backend/tests/admin-cart-release.postgres.test.ts
// Synthetic cart releases against the production PostgreSQL schema and triggers.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { hashCsrfToken } from "../src/security/session-token.js";

describe("admin physical cart release", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  const actor = randomUUID();
  beforeAll(async () => {
    store = await embeddedStore(true);
    commerce = new CommerceService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff',$2,$2,'synthetic','active',now())`, [actor, `${actor}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic Inventory Admin')", [actor]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture(quantity = 2, guest = false) {
    const user = randomUUID(), model = `M-${user}`, cart = `CART-${user}`, hash = "b".repeat(64);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, `${user}@example.test`]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Release Customer','2000-01-01')", [user]);
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Release Model',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
    for (let index = 0; index < 3; index++) {
      await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
        VALUES($1,$1,$2,'Black','M','In stock',40000)`, [`I${index}-${user}`, model]);
    }
    const lines = [{ modelId: model, color: "Black", size: "M", quantity }];
    const reservation = await commerce.reserveCart(cart, lines, guest ? undefined : user, guest ? hash : undefined);
    const held = (await store.pool.query<{ id: string; version: string }>(
      "SELECT id,version::text FROM inventory_items WHERE cart_reservation_id=$1 ORDER BY id", [cart],
    )).rows;
    const item = held[0]!;
    const release = (version = Number(item.version), reservationId = cart) =>
      commerce.adminReleaseCartItem(actor, item.id, version, reservationId, "release-request");
    const input = { reservationId: cart, contact: { name: "Release Customer", phone1: "+201000000001", email: `${user}@example.test` },
      address: { country: "Egypt", governorate: "Cairo", area: "Tahrir", street: "Synthetic", building: "1", floor: "1", latitude: "30.0444", longitude: "31.2357" } };
    return { user, model, cart, hash, held, item, lines, release, reservation, input };
  }
  it("removes only one physical unit, preserves the other unit and expiry, and audits the override", async () => {
    const f = await fixture();
    await expect(f.release()).resolves.toMatchObject({ released: true, alreadyReleased: false });
    expect((await commerce.customerCart(f.user)).cart).toMatchObject({ reservationId: f.cart,
      expiresAt: f.reservation.expiresAt.toISOString(), lines: [{ modelId: f.model, quantity: 1 }] });
    const rows = (await store.pool.query("SELECT id,status,cart_reservation_id,reservation_until,version::text FROM inventory_items WHERE id=ANY($1::text[]) ORDER BY id", [f.held.map(row => row.id)])).rows;
    expect(rows[0]).toMatchObject({ id: f.item.id, status: "In stock", cart_reservation_id: null, reservation_until: null });
    expect(rows[1]).toMatchObject({ id: f.held[1]!.id, status: "Cart Reserved", cart_reservation_id: f.cart, version: f.held[1]!.version });
    const audit = (await store.pool.query("SELECT actor_id::text,request_id,old_values,new_values FROM audit_logs WHERE action='CART_ITEM_RELEASED' AND entity_id=$1", [f.item.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: actor, request_id: "release-request",
      old_values: { cartReservationId: f.cart, status: "Cart Reserved" }, new_values: { status: "In stock", cartReservationId: null } });
  });
  it("releases guest items while preserving a different cart's reservation", async () => {
    const f = await fixture(2, true), otherCart = `OTHER-${randomUUID()}`;
    await commerce.reserveCart(otherCart, [{ ...f.lines[0]!, quantity: 1 }], f.user);
    await f.release();
    expect((await commerce.guestCart(f.cart, f.hash)).cart?.lines[0]?.quantity).toBe(1);
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(otherCart);
  });
  it("cleans up an empty cart, makes duplicate retries harmless, and never releases a later reservation", async () => {
    const f = await fixture(1);
    await f.release();
    expect((await commerce.customerCart(f.user)).cart).toBeNull();
    expect((await store.pool.query("SELECT 1 FROM cart_reservations WHERE id=$1", [f.cart])).rows).toHaveLength(0);
    await expect(f.release()).resolves.toMatchObject({ alreadyReleased: true });
    await commerce.reserveCart(f.cart, f.lines, f.user);
    await expect(f.release()).resolves.toMatchObject({ alreadyReleased: true });
    expect((await commerce.customerCart(f.user)).cart?.lines[0]?.quantity).toBe(1);
    expect((await store.pool.query("SELECT 1 FROM audit_logs WHERE action='CART_ITEM_RELEASED' AND entity_id=$1", [f.item.id])).rows).toHaveLength(1);
  });
  it("rejects stale versions, wrong cart identities and missing pieces without changing stock", async () => {
    const f = await fixture();
    await expect(f.release(Number(f.item.version) + 1)).rejects.toMatchObject({ code: "CART_ITEM_CHANGED" });
    await expect(f.release(Number(f.item.version), `WRONG-${f.cart}`)).rejects.toMatchObject({ code: "CART_ITEM_CHANGED" });
    await expect(commerce.adminReleaseCartItem(actor, "missing", 1, f.cart, "test")).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    expect((await commerce.customerCart(f.user)).cart?.lines[0]?.quantity).toBe(2);
  });
  it("refuses an old checkout quote after release; a reviewed checkout buys only the remaining piece", async () => {
    const f = await fixture();
    const oldQuote = await commerce.customerCartQuote(f.user, f.cart);
    if (!("fingerprint" in oldQuote)) throw new Error("Expected a cart quote");
    await f.release();
    await expect(commerce.checkout(f.user, { ...f.input, quoteFingerprint: oldQuote.fingerprint }, "test", undefined, `stale-${f.cart}`))
      .rejects.toMatchObject({ code: "PRICE_CHANGED" });
    const quote = await commerce.customerCartQuote(f.user, f.cart);
    if (!("fingerprint" in quote)) throw new Error("Expected a cart quote");
    await commerce.checkout(f.user, { ...f.input, quoteFingerprint: quote.fingerprint }, "test", undefined, `reviewed-${f.cart}`);
    expect((await store.pool.query("SELECT inventory_item_id FROM order_items WHERE inventory_item_id=ANY($1::text[])", [f.held.map(row => row.id)])).rows)
      .toEqual([{ inventory_item_id: f.held[1]!.id }]);
    expect((await store.pool.query("SELECT status FROM inventory_items WHERE id=$1", [f.item.id])).rows[0]?.status).toBe("In stock");
  });
  it("cannot release a piece when checkout won the race and already created its order", async () => {
    const f = await fixture(1);
    await commerce.checkout(f.user, f.input, "test", undefined, `first-${f.cart}`);
    await expect(f.release()).rejects.toMatchObject({ code: "CART_ITEM_CHANGED" });
    expect((await store.pool.query("SELECT order_id,status FROM inventory_items WHERE id=$1", [f.item.id])).rows[0]?.order_id).toBeTruthy();
  });
  it("expires the selected Waiting allocation without immediately re-reserving the piece", async () => {
    const f = await fixture(3), other = await fixture(1);
    const entry = (await store.pool.query<{ id: string }>(`INSERT INTO waitlist_entries(customer_user_id,model_id,size,desired_color,status,reserved_until)
      VALUES($1,$2,'M','Black','confirmed',now()+interval '15 minutes') RETURNING id::text`, [f.user, f.model])).rows[0]!;
    await store.pool.query(`INSERT INTO waitlist_allocations(waitlist_entry_id,inventory_item_id,cart_reservation_id,match_type,offered_color,status,expires_at)
      VALUES($1,$2,$3,'exact','Black','cart',now()+interval '15 minutes')`, [entry.id, f.item.id, f.cart]);
    await store.pool.query(`INSERT INTO waitlist_entries(customer_user_id,model_id,size,desired_color)
      VALUES($1,$2,'M','Black')`, [other.user, f.model]);
    await f.release();
    expect((await store.pool.query("SELECT status,reserved_until FROM waitlist_entries WHERE id=$1", [entry.id])).rows[0])
      .toMatchObject({ status: "expired", reserved_until: null });
    expect((await store.pool.query("SELECT status,release_reason FROM waitlist_allocations WHERE waitlist_entry_id=$1", [entry.id])).rows[0])
      .toMatchObject({ status: "expired", release_reason: "admin_cart_item_released" });
    expect((await store.pool.query("SELECT status FROM inventory_items WHERE id=$1", [f.item.id])).rows[0]?.status).toBe("In stock");
    expect((await store.pool.query("SELECT status FROM waitlist_entries WHERE customer_user_id=$1 AND model_id=$2", [other.user, f.model])).rows[0]?.status).toBe("waiting");
  });
  it("dissolves only an incomplete Set unit while retaining the other physical piece", async () => {
    const f = await fixture(), setId = `SET-${randomUUID()}`;
    await store.pool.query("INSERT INTO catalog_sets(set_id,name,base_price_minor) VALUES($1,'Synthetic Set',90000)", [setId]);
    const group = (await store.pool.query<{ id: string }>(`INSERT INTO cart_set_groups(reservation_id,set_id,set_version,unit_index,set_name_snapshot,
      components_total_minor,set_base_price_minor,final_minor,piece_count)
      VALUES($1,$2,1,1,'Synthetic Set',120000,90000,90000,2) RETURNING id::text`, [f.cart, setId])).rows[0]!;
    for (const [index, row] of f.held.entries()) {
      await store.pool.query(`INSERT INTO cart_set_components(group_id,inventory_item_id,model_id,model_name_snapshot,color,size,component_unit_index,
        original_model_selling_minor,cost_snapshot_minor,allocated_base_minor,allocated_final_minor)
        VALUES($1,$2,$3,'Synthetic','Black','M',$4,60000,40000,45000,45000)`, [group.id, row.id, f.model, index + 1]);
    }
    await store.pool.query(`INSERT INTO set_loyalty_cart_reservations(cart_set_group_id,customer_user_id,card_code,piece_count,expires_at)
      VALUES($1,$2,'SYNTHETIC-CARD',2,now()+interval '15 minutes')`, [group.id, f.user]);
    await expect(f.release()).resolves.toMatchObject({ dissolvedSetGroups: [{ id: group.id, set_id: setId }] });
    expect((await store.pool.query("SELECT 1 FROM cart_set_components WHERE group_id=$1", [group.id])).rows).toHaveLength(0);
    expect((await store.pool.query("SELECT 1 FROM set_loyalty_cart_reservations WHERE cart_set_group_id=$1", [group.id])).rows).toHaveLength(0);
    const lines = (await commerce.customerCart(f.user)).cart?.lines;
    expect(lines).toHaveLength(1); expect(lines?.[0]).toMatchObject({ quantity: 1 });
    expect(lines?.[0]).not.toHaveProperty("setGroupId");
    const quote = await commerce.customerCartQuote(f.user, f.cart);
    if (!("lines" in quote)) throw new Error("Expected a cart quote");
    expect(quote.lines[0]).toMatchObject({ isSet: false, baseMinor: 60000 });
  });
  it("rolls stock and cart state back if the audit write fails", async () => {
    const f = await fixture();
    const realClient = await store.pool.connect();
    const pool = { connect: async () => ({
      query: (sql: string, params?: unknown[]) => {
        if (sql.includes("VALUES('staff',$1,'CART_ITEM_RELEASED'")) throw new Error("Synthetic audit outage");
        return realClient.query(sql, params);
      }, release() { realClient.release(); },
    }) } as unknown as Pool;
    await expect(new CommerceService(pool).adminReleaseCartItem(actor, f.item.id, Number(f.item.version), f.cart, "test"))
      .rejects.toThrow("Synthetic audit outage");
    expect((await commerce.customerCart(f.user)).cart?.lines[0]?.quantity).toBe(2);
    expect((await store.pool.query("SELECT version::text FROM inventory_items WHERE id=$1", [f.item.id])).rows[0]?.version).toBe(f.item.version);
  });
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))("serializes simultaneous checkout and release on real PostgreSQL", async () => {
    const f = await fixture(1);
    const outcomes = await Promise.allSettled([
      f.release(), commerce.checkout(f.user, f.input, "test", undefined, `parallel-${f.cart}`),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const orderItems = (await store.pool.query("SELECT 1 FROM order_items WHERE inventory_item_id=$1", [f.item.id])).rows;
    const state = (await store.pool.query("SELECT status,cart_reservation_id FROM inventory_items WHERE id=$1", [f.item.id])).rows[0]!;
    if (outcomes[0]!.status === "fulfilled") {
      expect(orderItems).toHaveLength(0); expect(state.status).toBe("In stock");
    } else {
      expect(orderItems).toHaveLength(1); expect(state.status).not.toBe("In stock");
    }
    expect(state.cart_reservation_id).toBeNull();
  });
});

describe("admin cart release HTTP authority", () => {
  const config = { sessionCookieName: "dart_session", authPepper: "cart-release-synthetic-pepper-at-least-32-chars", nodeEnv: "test" as const };
  const cookie = `dart_session_staff=123e4567-e89b-12d3-a456-426614174100.${"a".repeat(43)}`;
  function fixture(permissions = ["inventory.manage"], type = "staff", mfaSatisfied = true) {
    const service = { adminReleaseCartItem: vi.fn().mockResolvedValue({ itemId: "I1", released: true }) };
    const account = { userId: "123e4567-e89b-12d3-a456-426614174101", accountType: type, permissions,
      mfaRequired: true, mfaSatisfied, csrfTokenHash: hashCsrfToken("csrf", config.authPepper) } as AuthenticatedAccount;
    const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
    const app = express(); app.use(express.json(), cookieParser());
    app.use("/api/v1", createCommerceRouter(service as unknown as CommerceService, identity, config));
    app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.statusCode || 422).json({ code: error.code || "INVALID_INPUT" });
    });
    return { app, service };
  }
  const path = "/api/v1/admin/items/I1/release-cart", body = { expectedVersion: 2, reservationId: "CART-SYNTHETIC-RELEASE" };
  it("requires staff identity, write permission, MFA and CSRF before any mutation", async () => {
    for (const [permissions, type, mfa] of [[[], "staff", true], [["catalog.read"], "staff", true], [["inventory.manage"], "customer", true], [["inventory.manage"], "staff", false]] as [string[], string, boolean][]) {
      const f = fixture(permissions, type, mfa);
      expect((await request(f.app).post(path).set("Cookie", cookie).set("X-CSRF-Token", "csrf").send(body)).status).toBe(403);
      expect(f.service.adminReleaseCartItem).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect((await request(f.app).post(path).send(body)).status).toBe(401);
    expect((await request(f.app).post(path).set("Cookie", cookie).send(body)).status).toBe(403);
    expect(f.service.adminReleaseCartItem).not.toHaveBeenCalled();
  });
  it("validates the target version/cart and derives the actor from the staff session", async () => {
    const f = fixture();
    for (const invalid of [{ ...body, expectedVersion: 0 }, { ...body, reservationId: "short" }, { ...body, actorId: "spoofed" }]) {
      expect((await request(f.app).post(path).set("Cookie", cookie).set("X-CSRF-Token", "csrf").send(invalid)).status).toBe(422);
    }
    expect(f.service.adminReleaseCartItem).not.toHaveBeenCalled();
    const response = await request(f.app).post(path).set("Cookie", cookie).set("X-CSRF-Token", "csrf").send(body);
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(f.service.adminReleaseCartItem).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174101", "I1", 2, body.reservationId, expect.any(String));
  });
});
