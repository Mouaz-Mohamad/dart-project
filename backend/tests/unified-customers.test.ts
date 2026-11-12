import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { customerDetails } from "../src/modules/promotions/customer-details.service.js";

const metadata = { requestId: "unified-test" };
let number = 80000000;
const phone = () => `010${number++}`;
const config = { authPepper: "customer-unification-test-pepper-32", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 8) };

describe("unified customer records", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, identity: IdentityService, dashboard: DashboardStateService;
  let actor: string;
  beforeAll(async () => {
    store = await embeddedStore(); identity = new IdentityService(store.pool, config);
    dashboard = new DashboardStateService(store.pool);
    actor = (await store.pool.query(`INSERT INTO users(account_type,email,email_normalized,status,email_verified_at)
      VALUES('staff','unified@example.test','unified@example.test','active',now()) RETURNING id`)).rows[0].id;
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Unified Test Admin')", [actor]);
  }, 120000);
  afterAll(async () => { await store?.db.close(); });
  async function customer() {
    const phone1 = phone();
    const session = await identity.registerCustomer({ name: "Website Name", phone1, birthday: "2001-02-03" }, metadata);
    return { session, phone1, profile: await identity.profile(session.account) };
  }
  async function legacyRow(phone1: string, extra: Record<string, unknown> = {}) {
    const state = await dashboard.read("customers");
    const code = `DA-${randomUUID()}`, id = `CDB-${randomUUID()}`;
    await dashboard.write("customers", state.version, [...state.data,
      { id, clientId: code, clientName: "Dashboard Name", birthday: "1999-03-04", phone1, ...extra }], actor, "legacy-save");
    return { code, id };
  }
  async function order(customerId: string | null, legacyCode = "", second = "", date = "2026-11-01", governorate = "Cairo") {
    return (await store.pool.query(`INSERT INTO orders(customer_user_id,subtotal_minor,final_minor,contact_snapshot,delivery_address,legacy,created_at)
      VALUES($1,10000,10000,$2::jsonb,$3::jsonb,$4::jsonb,$5) RETURNING id,order_code`,
    [customerId, JSON.stringify({ name: "Order Recipient", phone2: second }), JSON.stringify({ governorate, street: "Test Street" }),
      JSON.stringify({ clientId: legacyCode }), date])).rows[0];
  }
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))("serializes simultaneous signup requests for one normalized primary phone", async () => {
    const primary=phone();
    const results=await Promise.all([primary,`+20${primary.slice(1)}`].map(phone1=>identity.registerCustomer({name:"Concurrent Customer",phone1,birthday:"2001-01-01"},metadata)));
    expect(results[0]!.account.userId).toBe(results[1]!.account.userId);
    expect((await store.pool.query("SELECT user_id FROM account_phones WHERE phone_normalized=$1",[`20${primary.slice(1)}`])).rows).toHaveLength(1);
  });
  it("updates Customers version after signup, profile edits and order addresses", async () => {
    const before = (await dashboard.versions()).customers;
    const f = await customer();
    const created = (await dashboard.versions()).customers;
    expect(created).toBeGreaterThan(before);
    await identity.updateCustomerProfile(f.session.account,
      { name: "Website Updated", phone1: f.phone1, phone2: phone() }, metadata);
    const edited = (await dashboard.versions()).customers;
    expect(edited).toBeGreaterThan(created);
    await order(f.profile.id, "", "", "2026-11-11", "Giza");
    expect((await dashboard.versions()).customers).toBeGreaterThan(edited);
  });
  it("keeps birthday usage attached through repeated signup, legacy linking and birthday correction", async () => {
    const f=await customer();
    const year=(await store.pool.query("SELECT dart_cairo_year(now()) AS year")).rows[0].year;
    await store.pool.query("INSERT INTO birthday_discount_usage(customer_user_id,reward_year,status,used_at) VALUES($1,$2,'Used',now())",[f.profile.id,year]);
    await legacyRow(f.phone1);
    const again=await identity.registerCustomer({name:"Customer New Name",phone1:f.phone1,birthday:"2000-04-05"},metadata);
    expect(again.account.userId).toBe(f.profile.id);
    expect((await store.pool.query("SELECT status FROM birthday_discount_usage WHERE customer_user_id=$1 AND reward_year=$2",[f.profile.id,year])).rows).toEqual([{status:"Used"}]);
  });
  it("promotes dashboard records, then signup reuses their identity and updates website name/birthday", async () => {
    const primary = phone(), legacy = await legacyRow(primary);
    const before = (await dashboard.read("customers")).data as Record<string, unknown>[];
    const canonical = before.find(row => (row.aliases as string[]).includes(legacy.code))!;
    const session = await identity.registerCustomer({ name: "Customer Chosen Name", phone1: `+20${primary.slice(1)}`, birthday: "2000-05-06" }, metadata);
    expect(session.account.userId).toBe(canonical.id);
    const profile = await identity.profile(session.account);
    expect(profile.name).toBe("Customer Chosen Name"); expect(profile.birthday).toBe("2000-05-06");
    expect((await dashboard.read("customers")).data.filter(raw => (raw as Record<string, unknown>).id === canonical.id)).toHaveLength(1);
  });
  it("links legacy orders and reviews to the account without changing historical names, prices or order IDs", async () => {
    const f = await customer(), code = `DA-${randomUUID()}`;
    const historical = await order(null, code);
    const state = await dashboard.read("customers");
    await dashboard.write("customers", state.version, [...state.data,
      { id: `CDB-${randomUUID()}`, clientId: code, clientName: "Different Name", phone1: f.phone1, governorate: "Cairo" }], actor, "join");
    await store.pool.query(`UPDATE dashboard_domain_state SET data=$1 WHERE domain='reviews'`,
      [JSON.stringify([{ id: "linked-review", clientId: code, rating: 5 }])]);
    const saved = (await store.pool.query("SELECT customer_user_id,final_minor::text,contact_snapshot FROM orders WHERE id=$1", [historical.id])).rows[0];
    expect(saved).toMatchObject({ customer_user_id: f.profile.id, final_minor: "10000", contact_snapshot: { name: "Order Recipient" } });
    expect((await customerDetails(store.pool, code, "orders", 0, actor, [])).rows.map(row => row.orderId)).toContain(historical.order_code);
    expect((await customerDetails(store.pool, code, "reviews", 0, actor, [])).rows).toHaveLength(1);
  });
  it("collects order contact numbers and address history while keeping the profile name and birthday", async () => {
    const f = await customer(), secondary = phone();
    await order(f.profile.id, "", secondary, "2026-11-01", "Cairo");
    await order(f.profile.id, "", secondary, "2026-11-02", "Giza");
    const profile = await identity.profile(f.session.account);
    expect(profile.phones).toEqual([f.phone1, secondary]); expect(profile.governorate).toBe("Giza");
    expect(profile.addresses).toHaveLength(2); expect(profile.name).toBe("Website Name");
    expect(profile.birthday).toBe("2001-02-03");
    const row = (await dashboard.read("customers")).data.find(raw => (raw as Record<string, unknown>).id === f.profile.id) as Record<string, unknown>;
    expect(row.phone2).toBe(secondary); expect(row.governorate).toBe("Giza");
    await expect(identity.loginCustomer(secondary, metadata)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("allows shared contact phones and never uses them to merge or authenticate another customer", async () => {
    const a = await customer(), b = await customer();
    await identity.updateCustomerProfile(a.session.account, { name: "A Customer", phone1: a.phone1, phone2: b.phone1 }, metadata);
    expect((await identity.loginCustomer(b.phone1, metadata)).account.userId).toBe(b.profile.id);
    expect((await store.pool.query("SELECT user_id FROM account_phones WHERE phone_normalized=$1", [`20${b.phone1.slice(1)}`])).rows).toHaveLength(1);
  });
  it("rejects phone/email identity conflicts and rolls back both records", async () => {
    const a = await customer(), b = await customer(), email = `${randomUUID()}@example.test`;
    await identity.updateCustomerProfile(b.session.account, { name: "B Customer", phone1: b.phone1, email }, metadata);
    await expect(identity.registerCustomer({ name: "Conflict User", phone1: a.phone1, email, birthday: "2000-01-01" }, metadata))
      .rejects.toMatchObject({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    expect((await identity.profile(a.session.account)).name).toBe("Website Name");
    expect((await identity.loginCustomer(email, metadata)).account.userId).toBe(b.profile.id);
  });
  it("does not overwrite an explicit province or website identity from an order or legacy row", async () => {
    const f = await customer();
    await legacyRow(f.phone1, { governorate: "Cairo", birthday: "1990-01-01" });
    await order(f.profile.id, "", "", "2026-11-03", "Giza");
    const profile = await identity.profile(f.session.account);
    expect(profile.governorate).toBe("Cairo"); expect(profile.birthday).toBe("2001-02-03");
    expect(profile.name).toBe("Website Name");
  });
  it("preserves all saved-address history even after clearing the preferred address", async () => {
    const f = await customer(), commerce = new CommerceService(store.pool);
    await commerce.saveCustomerAddress(f.profile.id, { governorate: "Cairo", street: "First" }, "address-one");
    await commerce.saveCustomerAddress(f.profile.id, { governorate: "Giza", street: "Second" }, "address-two");
    await commerce.saveCustomerAddress(f.profile.id, null, "address-clear");
    expect((await identity.profile(f.session.account)).addresses).toHaveLength(2);
  });
  it("protects suspended accounts and accepts equivalent Arabic/international primary phone formats", async () => {
    const f = await customer();
    const international = `0020${f.phone1.slice(1)}`;
    expect((await identity.loginCustomer(international, metadata)).account.userId).toBe(f.profile.id);
    const arabic = f.phone1.replace(/\d/g, value => "٠١٢٣٤٥٦٧٨٩"[Number(value)]!);
    expect((await identity.loginCustomer(arabic, metadata)).account.userId).toBe(f.profile.id);
    await store.pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.profile.id]);
    await expect(identity.registerCustomer({ name: "Bypass", phone1: f.phone1 }, metadata)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });
});
