// Multi-connection locking tests run against CI's disposable loopback PostgreSQL only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

let localTestDatabase = false;
try { localTestDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL || "").hostname); }
catch { /* No disposable PostgreSQL was supplied. */ }

describe.skipIf(!localTestDatabase)("cart owner locking across independent PostgreSQL connections", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  beforeAll(async () => { store = await embeddedStore(true); commerce = new CommerceService(store.pool); }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture() {
    const user = randomUUID(), model = `M-${user}`, guest = `GUEST-${user}`, account = `CART-${user}`;
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, `${user}@example.test`]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Concurrent Customer','2000-01-01')", [user]);
    await store.pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
      VALUES($1,'Concurrent Model',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
    for (let index = 0; index < 3; index++) await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','In stock',40000)`, [`I-${user}-${index}`, model]);
    return { user, model, guest, account, hash: randomUUID().replaceAll("-", "").repeat(2),
      lines: [{ modelId: model, color: "Black", size: "M", quantity: 1 }] };
  }
  async function holds(model: string) {
    return (await store.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM inventory_items WHERE model_id=$1 AND lower(status)='cart reserved'", [model])).rows[0]!.n;
  }
  it("allows one first reservation and preserves it when two tabs concurrently create different cart IDs", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      commerce.reserveCart(f.account, f.lines, f.user), commerce.reserveCart(`OTHER-${f.account}`, f.lines, f.user),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CART_CONFLICT" } });
    expect(await holds(f.model)).toBe("1");
    expect((await commerce.customerCart(f.user)).cart?.lines).toHaveLength(1);
  });
  it("never loses either owner's hold when legacy claim races a new account reservation", async () => {
    const f = await fixture(); await commerce.reserveCart(f.guest, f.lines, undefined, f.hash);
    const results = await Promise.allSettled([
      commerce.claimGuestCart(f.guest, f.user, f.hash), commerce.reserveCart(f.account, f.lines, f.user),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CART_CONFLICT" } });
    const cart = (await commerce.customerCart(f.user)).cart!;
    expect(await holds(f.model)).toBe(cart.reservationId === f.guest ? "1" : "2");
    expect((await store.pool.query("SELECT id FROM cart_reservations WHERE id=$1", [f.guest])).rows).toHaveLength(1);
  });
  it("handles duplicate simultaneous claims without duplicating inventory or extending the hold", async () => {
    const f = await fixture(); const held = await commerce.reserveCart(f.guest, f.lines, undefined, f.hash);
    const replies = await Promise.all([commerce.claimGuestCart(f.guest, f.user, f.hash), commerce.claimGuestCart(f.guest, f.user, f.hash)]);
    expect(replies.every(reply => reply.expiresAt.getTime() === held.expiresAt.getTime())).toBe(true);
    expect(await holds(f.model)).toBe("1");
    expect((await commerce.customerCart(f.user)).cart?.reservationId).toBe(f.guest);
  });
  it("creates one order while a concurrent guest claim either waits or reports an explicit conflict", async () => {
    const f = await fixture();
    await commerce.reserveCart(f.guest, f.lines, undefined, f.hash); await commerce.reserveCart(f.account, f.lines, f.user);
    const input = { reservationId: f.account, contact: { name: "Concurrent Customer", phone1: "+201000000001", email: `${f.user}@example.test` },
      address: { country: "Egypt", governorate: "Cairo", area: "Tahrir", street: "Synthetic", building: "1", floor: "1", latitude: "30.0444", longitude: "31.2357" } };
    const [claim, checkout] = await Promise.allSettled([
      commerce.claimGuestCart(f.guest, f.user, f.hash), commerce.checkout(f.user, input, "synthetic", undefined, `checkout-${f.account}`),
    ]);
    expect(checkout.status).toBe("fulfilled");
    if (claim.status === "rejected") expect(claim.reason).toMatchObject({ code: "CART_CONFLICT" });
    expect((await store.pool.query("SELECT id FROM orders WHERE customer_user_id=$1", [f.user])).rows).toHaveLength(1);
    expect(await holds(f.model)).toBe("1");
  });
});
