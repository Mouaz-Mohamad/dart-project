import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Pool } from "pg";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import { CustomerInteractionService } from "../src/modules/commerce/customer-interaction.service.js";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import { createDashboardStateRouter } from "../src/modules/dashboard/dashboard-state.routes.js";
import { FinanceService } from "../src/modules/finance/finance.service.js";
import { staffFieldAccess } from "../src/middleware/staff-field-access.js";
import { verifyRecoveredStore } from "../src/modules/monitoring/store-recovery-check.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { AppError } from "../src/http/app-error.js";

describe("fourth Council: order, return, finance and least-privilege acceptance", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService, finance: FinanceService;
  let interactions: CustomerInteractionService, state: DashboardStateService;
  const actor = randomUUID(), customer = randomUUID(), rep = randomUUID();
  const csrf = "synthetic-council-fourth-csrf", config = { sessionCookieName: "dart_session", authPepper: "synthetic-pepper-32-characters-long", nodeEnv: "test" as const };
  const address = { country: "Egypt", governorate: "Cairo" as const, area: "Nasr City", street: "Synthetic", building: "1", floor: "1", latitude: 30.05, longitude: 31.35 };
  let auth: AuthenticatedAccount;
  const cookie = `dart_session=${randomUUID()}.${"x".repeat(43)}`;
  let app: express.Express;
  beforeAll(async () => {
    store = await embeddedStore(true); commerce = new CommerceService(store.pool); finance = new FinanceService(store.pool);
    interactions = new CustomerInteractionService(store.pool); state = new DashboardStateService(store.pool);
    for (const [id, type] of [[actor, "staff"], [customer, "customer"], [rep, "representative"]]) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,$2,$3,$3,'synthetic','active',now())`, [id, type, `${id}@example.test`]);
    }
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic Staff')", [actor]);
    await store.pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer','2000-01-01')", [customer]);
    await store.pool.query(`INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at)
      VALUES($1,'Synthetic Courier',repeat('1',64),'1111','approved',$2,now())`, [rep, actor]);
    auth = { userId: actor, accountType: "staff", mfaSatisfied: true, permissions: [], csrfTokenHash: hashCsrfToken(csrf, config.authPepper) } as unknown as AuthenticatedAccount;
    const identity = { authenticate: async () => auth } as unknown as IdentityService;
    app = express(); app.use(express.json(), cookieParser(), staffFieldAccess);
    app.use((req, _res, next) => { req.id = "synthetic-fourth-council"; next(); });
    app.use("/api/v1", createCommerceRouter(commerce, identity, config), createDashboardStateRouter(state, identity, config));
    app.use((error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ZodError) { res.status(422).json({ code: "VALIDATION_ERROR" }); return; }
      res.status(error.statusCode || 500).json({ code: error.code, message: error.message });
    });
  }, 30000);
  afterAll(async () => { await store?.db.close(); });

  async function fixture() {
    const suffix = randomUUID(), model = `M-${suffix}`, item = `I-${suffix}`, replacement = `J-${suffix}`;
    await store.pool.query("INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor) VALUES($1,'Synthetic Model',30000,50000)", [model]);
    const order = (await store.pool.query(`INSERT INTO orders(customer_user_id,status,payment_status,subtotal_minor,final_minor,amount_paid_minor,contact_snapshot,delivery_address,delivered_at)
      VALUES($1,'Delivered','Paid',50000,50000,50000,$2::jsonb,$3::jsonb,now()) RETURNING id::text,order_code`,
    [customer, JSON.stringify({ name: "Private Customer", phone1: "+201000000001", email: "private@example.test" }), JSON.stringify(address)])).rows[0] as { id: string; order_code: string };
    await store.pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,order_id,cost_snapshot_minor)
      VALUES($1,$1,$2,'Black','M','Sold',$3,30000),($4,$4,$2,'Navy','L','In stock',NULL,30000)`, [item, model, order.order_code, replacement]);
    await store.pool.query(`INSERT INTO order_items(order_id,inventory_item_id,item_code,model_id,model_name,color,size,original_unit_minor,final_unit_minor,cost_snapshot_minor)
      VALUES($1,$2,$2,$3,'Synthetic Model','Black','M',50000,50000,30000)`, [order.id, item, model]);
    return { ...order, item, model, replacement };
  }
  async function orderRow(f: Awaited<ReturnType<typeof fixture>>) {
    return (await store.pool.query("SELECT version::int,amount_refunded_minor::int,payment_status,contact_snapshot FROM orders WHERE id=$1", [f.id])).rows[0]!;
  }
  async function beginReturn(f: Awaited<ReturnType<typeof fixture>>, requestType: "Refund" | "Exchange") {
    const r = await interactions.submitReturn(customer, { itemCode: f.item, requestType, reason: "Synthetic return", address,
      ...(requestType === "Exchange" ? { requestedColor: "Navy", requestedSize: "L" } : {}) }, "synthetic");
    await commerce.adminReturnAction(actor, String(r.id), { action: "approve", ...(requestType === "Exchange" ? { replacementItemCode: f.replacement } : {}) }, "synthetic");
    await commerce.adminReturnAction(actor, String(r.id), { action: "assign", representativeId: rep }, "synthetic");
    await commerce.representativeReturnAction(rep, String(r.id), "start");
    await commerce.updateRepresentativeLocation(rep, address.latitude, address.longitude, 5);
    return r;
  }
  const manualInput = (itemCode: string, condition: "Good" | "Bad" = "Good", refundAmount = 500) => ({ itemCode, condition, refundAmount, reason: "Synthetic refund" });
  const metadataInput = (item: string) => ({ clientName: "Contact corrected", phone1: "+201000000001", itemCodes: [item] });

  it.each(["Refund", "Exchange"] as const)("invalidates both order versions on %s completion and makes retry harmless", async (kind) => {
    const f = await fixture(), r = await beginReturn(f, kind), before = await commerce.adminOrders(), oldRow = await orderRow(f);
    const completed = await commerce.representativeReturnAction(rep, String(r.id), "complete");
    expect(completed.status).toBe("Completed");
    const after = await commerce.adminOrders(), newRow = await orderRow(f);
    expect(after.version).toBeGreaterThan(before.version); expect(newRow.version).toBeGreaterThan(oldRow.version);
    const order = after.orders.find((row) => row.id === f.id)!;
    if (kind === "Refund") expect(order.amountRefunded).toBe(500);
    else expect(order.items).toContain(f.replacement);
    await expect(commerce.representativeReturnAction(rep, String(r.id), "complete")).rejects.toMatchObject({ code: "RETURN_STATE_INVALID" });
    expect(await orderRow(f)).toEqual(newRow);
  });

  it("rejects a stale payment form, preserves refunds on contact edits and enforces the completed-refund ledger", async () => {
    const f = await fixture(), before = await orderRow(f), r = await beginReturn(f, "Refund");
    await commerce.representativeReturnAction(rep, String(r.id), "complete");
    await expect(commerce.updateAdminOrder(actor, f.order_code, { ...metadataInput(f.item), expectedVersion: before.version, amountPaid: 500, amountRefunded: 0, paymentStatus: "Paid" }, "synthetic"))
      .rejects.toMatchObject({ code: "ORDER_VERSION_CONFLICT" });
    const fresh = await orderRow(f);
    await commerce.updateAdminOrder(actor, f.order_code, { ...metadataInput(f.item), expectedVersion: fresh.version }, "synthetic");
    expect(await orderRow(f)).toMatchObject({ amount_refunded_minor: 50000, payment_status: "Refunded", contact_snapshot: { name: "Contact corrected" } });
    await expect(commerce.updateAdminOrder(actor, f.order_code, { ...metadataInput(f.item), expectedVersion: (await orderRow(f)).version, amountRefunded: 0, paymentStatus: "Paid" }, "synthetic"))
      .rejects.toMatchObject({ code: "ORDER_REFUND_LEDGER_CONFLICT" });
  });

  it("requires an observed version before any payment change, including HTTP PATCH", async () => {
    const f = await fixture();
    await expect(commerce.updateAdminOrder(actor, f.order_code, { ...metadataInput(f.item), amountPaid: 1 }, "synthetic"))
      .rejects.toMatchObject({ code: "ORDER_VERSION_REQUIRED" });
    auth.permissions = ["orders.edit"];
    const missing = await request(app).patch(`/api/v1/admin/orders/${f.order_code}`).set("Cookie", cookie).set("x-csrf-token", csrf).send(metadataInput(f.item));
    expect(missing.status).toBe(422); expect(missing.body.code).toBe("VALIDATION_ERROR");
  });

  it("finishes an approved customer refund for an archived delivered sale", async () => {
    const f = await fixture(); await commerce.adminOrderStateAction(actor, f.order_code, "archive", "synthetic");
    const r = await beginReturn(f, "Refund");
    expect(await commerce.representativeReturnAction(rep, String(r.id), "complete")).toMatchObject({ status: "Completed", refundAmount: 500 });
    expect(await orderRow(f)).toMatchObject({ amount_refunded_minor: 50000 });
  });

  it("keeps the original refund posting date and books deliberate amount corrections in their own period", async () => {
    const f = await fixture(), r = await commerce.adminManualReturn(actor, manualInput(f.item, "Good", 300), "synthetic");
    const originalDate = "2025-09-16T12:00:00.000Z";
    await store.pool.query("UPDATE return_requests SET payload=payload || $2::jsonb WHERE record_id=$1", [r.id, JSON.stringify({ completedAt: originalDate, inspectedAt: originalDate, updatedAt: originalDate })]);
    const before = await finance.summary("2025-09-01", "2025-09-30"); expect(before.refunds).toBe(300);
    const metadata = await commerce.adminManualReturn(actor, { ...manualInput(f.item, "Good", 300), existingReturnId: String(r.id), expectedUpdatedAt: originalDate, reason: "Description corrected" }, "synthetic");
    expect(metadata.completedAt).toBe(originalDate); expect(metadata.inspectedAt).toBe(originalDate);
    expect(await finance.summary("2025-09-01", "2025-09-30")).toEqual(before);
    const currentStart = new Date().toISOString().slice(0, 7) + "-01";
    const currentBefore = await finance.summary(currentStart, "2099-12-31");
    const changed = await commerce.adminManualReturn(actor, { ...manualInput(f.item, "Good", 400), existingReturnId: String(r.id), expectedUpdatedAt: String(metadata.updatedAt) }, "synthetic");
    expect(changed.completedAt).toBe(originalDate); expect(changed.refundAdjustments).toHaveLength(1);
    expect(await finance.summary("2025-09-01", "2025-09-30")).toEqual(before);
    const currentAfter = await finance.summary(currentStart, "2099-12-31");
    expect(currentAfter.refunds - currentBefore.refunds).toBe(100); expect(currentAfter.refundCashOut - currentBefore.refundCashOut).toBe(100);
    const repeated = await commerce.adminManualReturn(actor, { ...manualInput(f.item, "Good", 400), existingReturnId: String(r.id), expectedUpdatedAt: String(changed.updatedAt) }, "synthetic");
    expect(repeated.refundAdjustments).toHaveLength(1);
    await expect(commerce.adminManualReturn(actor, { ...manualInput(f.item, "Good", 200), existingReturnId: String(r.id), expectedUpdatedAt: originalDate }, "synthetic"))
      .rejects.toMatchObject({ code: "RETURN_VERSION_CONFLICT" });
    const corrected = await commerce.adminManualReturn(actor, { ...manualInput(f.item, "Good", 250), existingReturnId: String(r.id), expectedUpdatedAt: String(repeated.updatedAt) }, "synthetic");
    expect(corrected.refundAdjustments).toHaveLength(2);
    expect(await finance.summary("2025-09-01", "2025-09-30")).toEqual(before);
    expect((await finance.summary(currentStart, "2099-12-31")).refunds - currentBefore.refunds).toBe(-50);
    expect(await orderRow(f)).toMatchObject({ amount_refunded_minor: 25000 });
  });

  it.each(["Good", "Bad"] as const)("preserves every booked finance total across archive/delete/restore of a %s returned sale", async (condition) => {
    const f = await fixture(); await commerce.adminManualReturn(actor, manualInput(f.item, condition), "synthetic");
    const before = await finance.summary("2020-01-01", "2099-12-31");
    for (const action of ["archive", "restore", "delete", "restore"] as const) {
      await commerce.adminOrderStateAction(actor, f.order_code, action, "synthetic");
      expect(await finance.summary("2020-01-01", "2099-12-31")).toEqual(before);
    }
  });

  it.each(["full", "delta"] as const)("does not attach readable order data to an archive-only %s command response", async (mode) => {
    const target = await fixture(), unrelated = await fixture(); auth.permissions = ["orders.archive"];
    expect((await request(app).get("/api/v1/admin/orders-state").set("Cookie", cookie)).status).toBe(403);
    const response = await request(app).post(`/api/v1/admin/orders/${target.order_code}/state${mode === "delta" ? "?responseMode=delta&baseVersion=1" : ""}`)
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ action: "archive" });
    expect(response.status, JSON.stringify(response.body)).toBe(200); expect(response.body.orders).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain("private@example.test"); expect(JSON.stringify(response.body)).not.toContain(unrelated.order_code);
    auth.permissions = ["orders.archive", "orders.read"];
    const readable = await request(app).post(`/api/v1/admin/orders/${target.order_code}/state`).set("Cookie", cookie).set("x-csrf-token", csrf).send({ action: "restore" });
    expect(readable.status).toBe(200); expect(readable.body.orders.some((row: { id: string }) => row.id === unrelated.id)).toBe(true);
  });

  it("does not leak the orders snapshot through bulk workflow commands without orders.read", async () => {
    const f = await fixture(); auth.permissions = ["orders.bulk_manage"];
    await store.pool.query("UPDATE orders SET status='New' WHERE id=$1", [f.id]);
    const response = await request(app).post("/api/v1/admin/orders/bulk-workflow").set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ orderRefs: [f.order_code], expectedStatus: "New", target: "Accepted" });
    expect(response.status).toBe(200); expect(response.body.result.succeeded).toHaveLength(1);
    expect(response.body.orders).toEqual([]); expect(JSON.stringify(response.body)).not.toContain("private@example.test");
  });

  it("scopes audit snapshots by readable resource and redacts customer/cost fields independently", async () => {
    await store.pool.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,new_values)
      VALUES('staff',$1,'SYNTHETIC_CATALOG_TEST','catalog_inventory',$2,$3::jsonb)`, [actor, randomUUID(), JSON.stringify({ items: [{ itemCode: "I-private", clientName: "Private", email: "private@example.test", costSnapshot: 300 }] })]);
    const audit = () => request(app).get("/api/v1/admin/audit?entityType=catalog_inventory&limit=20").set("Cookie", cookie);
    auth.permissions = ["dashboard_state.read"]; expect((await audit()).body.audit).toEqual([]);
    auth.permissions = ["dashboard_state.read", "catalog.read"];
    const restricted = await audit(); expect(restricted.status).toBe(200);
    const row = restricted.body.audit.find((entry: { action: string }) => entry.action === "SYNTHETIC_CATALOG_TEST");
    expect(row.newValues.items[0]).toEqual({ itemCode: "I-private" });
    auth.permissions.push("customers.read", "finance.view_cost");
    const allowed = (await audit()).body.audit.find((entry: { action: string }) => entry.action === "SYNTHETIC_CATALOG_TEST");
    expect(allowed.newValues.items[0]).toMatchObject({ email: "private@example.test", costSnapshot: 300 });
  });

  it("pushes all four customer-domain filters into SQL and reads only that customer's payloads", async () => {
    const code = (await store.pool.query("SELECT client_code FROM customers WHERE user_id=$1", [customer])).rows[0].client_code as string;
    for (const table of ["loyalty_cards", "birthday_rewards"]) {
      await store.pool.query(`INSERT INTO ${table}(record_id,position,payload)
        SELECT $1 || n,n,jsonb_build_object('id',$1 || n,'clientId','DR-FOREIGN') FROM generate_series(1,500) n`, [`synthetic-${table}-`]);
      await store.pool.query(`INSERT INTO ${table}(record_id,position,payload) VALUES($1,0,$2::jsonb)`, [`own-${table}`, JSON.stringify({ id: `own-${table}`, clientId: code })]);
    }
    await store.pool.query(`INSERT INTO message_records(domain,record_id,position,payload)
      SELECT 'birthday_messages','synthetic-message-' || n,n,jsonb_build_object('id','synthetic-message-' || n,'clientId','DR-FOREIGN') FROM generate_series(1,500) n`);
    await store.pool.query("INSERT INTO message_records(domain,record_id,position,payload) VALUES('birthday_messages','own-message',0,$1::jsonb)", [JSON.stringify({ id: "own-message", clientId: code })]);
    const queries: { sql: string; values: unknown[]; rows: number }[] = [];
    const execute = async (sql: string, values: unknown[] = []) => { const result = await store.pool.query(sql, values); queries.push({ sql, values, rows: result.rows.length }); return result; };
    const observed = { query: execute, connect: async () => ({ query: execute, release() {} }) } as unknown as Pool;
    const snapshot = await new CommerceService(observed).customerSnapshot(customer);
    expect(snapshot.cards).toHaveLength(1); expect(snapshot.birthdayRewards).toHaveLength(1); expect(snapshot.birthdayMessages).toHaveLength(1);
    const reads = queries.filter((entry) => /SELECT .*payload|SELECT payload/s.test(entry.sql) && /FROM (?:return_requests|loyalty_cards|birthday_rewards|message_records)/.test(entry.sql));
    expect(reads).toHaveLength(4);
    for (const read of reads) { expect(read.sql).toMatch(/customer_code\s*=\s*\$/); expect(read.values).toContain(code); }
    expect(reads.reduce((sum, row) => sum + row.rows, 0)).toBeLessThan(50);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("serializes two real PostgreSQL editors observing the same order version", async () => {
    const f = await fixture(), version = (await orderRow(f)).version;
    const results = await Promise.allSettled(["Editor one", "Editor two"].map((name) => commerce.updateAdminOrder(actor, f.order_code,
      { ...metadataInput(f.item), clientName: name, expectedVersion: version }, "synthetic-concurrency")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "ORDER_VERSION_CONFLICT" });
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("serializes concurrent corrections of a completed refund without replacing an unseen posting", async () => {
    const f = await fixture(), record = await commerce.adminManualReturn(actor, manualInput(f.item, "Good", 300), "synthetic");
    const results = await Promise.allSettled([350, 400].map((amount) => commerce.adminManualReturn(actor,
      { ...manualInput(f.item, "Good", amount), existingReturnId: String(record.id), expectedUpdatedAt: String(record.updatedAt) }, "synthetic-concurrency")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "RETURN_VERSION_CONFLICT" });
    const saved = (await store.pool.query("SELECT payload FROM return_requests WHERE record_id=$1", [record.id])).rows[0].payload;
    expect(saved.refundAdjustments).toHaveLength(1);
    expect((await orderRow(f)).amount_refunded_minor).toBe(Math.round(saved.refundAmount * 100));
  });

  it("accepts recoverable application state and rejects a database with a lost refund posting", async () => {
    const migrations = readdirSync("migrations").filter((file) => /^\d+.*\.sql$/.test(file));
    // The deliberately incomplete bulk workflow fixture above is not a posted sale.
    const accepted = await verifyRecoveredStore(store.pool, migrations);
    expect(accepted).toMatchObject({ migrations: migrations.length, financeProjection: "passed", customerProjection: "passed" });
    const f = await fixture(); await commerce.adminManualReturn(actor, manualInput(f.item), "synthetic");
    await store.pool.query("UPDATE orders SET amount_refunded_minor=0 WHERE id=$1", [f.id]);
    await expect(verifyRecoveredStore(store.pool, migrations)).rejects.toThrow("lost completed refunds");
    await store.pool.query("UPDATE orders SET amount_refunded_minor=50000 WHERE id=$1", [f.id]);
  });
});
