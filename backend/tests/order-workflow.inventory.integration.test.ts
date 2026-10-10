// DART CODE GUIDE | backend/tests/order-workflow.inventory.integration.test.ts
// الغرض: Regression test لمسار قبول/رفض أوردر حقيقي مرتبط بقطعة فعلية على schema الإنتاج الكامل.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/database/migrate.js";
import { bindMigrationFunctionsToIsolatedTestSchema } from "./integration-schema.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_order_workflow_${randomUUID().replaceAll("-", "")}`;
const migrationsPath = resolve(process.cwd(), "migrations");
let adminPool: Pool | undefined;
let testPool: Pool | undefined;

describe.skipIf(!databaseUrl)("order workflow with physical inventory", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schemaName},public`,
    });
    await runMigrations(testPool, migrationsPath);
    await bindMigrationFunctionsToIsolatedTestSchema(testPool);
  });

  afterAll(async () => {
    await testPool?.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  async function createPhysicalOrder(label: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const modelId = `WF-${label}-${suffix}`;
    const itemId = `ITEM-${label}-${suffix}`;
    const itemCode = `IT-${label}-${suffix}`;
    const orderId = randomUUID();
    const orderCode = `K-${label}-${suffix}`;

    await testPool!.query(
      `INSERT INTO catalog_models (
         model_id, name, cost_minor, selling_minor, size_options, color_options
       ) VALUES ($1,$2,40000,60000,$3::jsonb,$4::jsonb)`,
      [
        modelId,
        `Workflow ${label}`,
        JSON.stringify([{ name: "M", active: true }]),
        JSON.stringify([{ name: "Black", active: true }]),
      ],
    );
    await testPool!.query(
      `INSERT INTO inventory_items (
         id, item_code, model_id, color, size, status, cost_snapshot_minor, order_id
       ) VALUES ($1,$2,$3,'Black','M','Processing/Held',40000,$4)`,
      [itemId, itemCode, modelId, orderCode],
    );
    await testPool!.query(
      `INSERT INTO orders (
         id, order_code, status, payment_method, payment_status,
         subtotal_minor, final_minor, contact_snapshot, delivery_address
       ) VALUES (
         $1,$2,'New','Cash on Delivery','Unpaid',60000,60000,
         $3::jsonb,$4::jsonb
       )`,
      [
        orderId,
        orderCode,
        JSON.stringify({ name: "Workflow Customer", phone1: "+201000000000" }),
        JSON.stringify({
          country: "Egypt",
          governorate: "Cairo",
          area: "Nasr City",
          street: "Test Street",
          building: "1",
          floor: "1",
        }),
      ],
    );
    await testPool!.query(
      `INSERT INTO order_items (
         order_id, inventory_item_id, item_code, model_id, model_name,
         color, size, original_unit_minor, model_discount_percent,
         final_unit_minor, cost_snapshot_minor
       ) VALUES ($1,$2,$3,$4,$5,'Black','M',60000,0,60000,40000)`,
      [orderId, itemId, itemCode, modelId, `Workflow ${label}`],
    );

    return { orderId, orderCode, itemId, itemCode };
  }

  it("returns only affected orders for an opted-in contiguous response and preserves the full legacy response", async () => {
    const fixture = await createPhysicalOrder("DELTA");
    await createPhysicalOrder("UNRELATED");
    const commerce = new CommerceService(testPool!);
    const before = await commerce.adminOrders();
    const delta = await commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
      { expectedStatus: "New", target: "Accepted" }, "delta", true,
      { responseMode: "delta", baseVersion: before.version });
    expect(delta).toMatchObject({ responseMode: "delta", baseVersion: before.version, version: before.version + 1 });
    expect(delta.orders).toHaveLength(1);
    expect(delta.orders[0]).toMatchObject({ id: fixture.orderId, orderId: fixture.orderCode, status: "Accepted", finalAmount: 600 });
    const noop = await commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
      { expectedStatus: "Accepted", target: "Accepted" }, "noop-delta", true,
      { responseMode: "delta", baseVersion: delta.version });
    expect(noop).toMatchObject({ responseMode: "delta", version: delta.version, baseVersion: delta.version });
    const legacy = await commerce.adminOrders();
    expect(legacy.responseMode).toBeUndefined();
    expect(legacy.orders.length).toBeGreaterThan(delta.orders.length);
  });

  it("keeps a command successful but requires full recovery when the supplied base version has a gap", async () => {
    const fixture = await createPhysicalOrder("DELTA-GAP");
    const other = await createPhysicalOrder("GAP-WRITER");
    const commerce = new CommerceService(testPool!);
    const before = await commerce.adminOrders();
    await commerce.adminOrderWorkflowAction(randomUUID(), other.orderCode,
      { expectedStatus: "New", target: "Accepted" }, "other-writer", false);
    const response = await commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
      { expectedStatus: "New", target: "Accepted" }, "delta-gap", true,
      { responseMode: "delta", baseVersion: before.version });
    expect(response).toMatchObject({ refreshRequired: true, orders: [], version: before.version + 2 });
    expect((await commerce.adminOrders()).orders.find((row) => row.id === fixture.orderId)?.status).toBe("Accepted");
  });

  it("detects a writer committing between a command and its scoped response read", async () => {
    const fixture = await createPhysicalOrder("AFTER-COMMIT");
    const other = await createPhysicalOrder("AFTER-COMMIT-WRITER");
    const commerce = new CommerceService(testPool!);
    const writer = new CommerceService(testPool!);
    const baseVersion = await commerce.adminOrdersVersion();
    const original = commerce.adminOrders.bind(commerce);
    const spy = vi.spyOn(commerce, "adminOrders").mockImplementationOnce(async (scope) => {
      await writer.adminOrderWorkflowAction(randomUUID(), other.orderCode,
        { expectedStatus: "New", target: "Accepted" }, "after-commit-writer", false);
      return original(scope);
    });
    try {
      const response = await commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
        { expectedStatus: "New", target: "Accepted" }, "after-commit", true,
        { responseMode: "delta", baseVersion });
      expect(response).toMatchObject({ refreshRequired: true, orders: [], version: baseVersion + 2 });
    } finally { spy.mockRestore(); }
  });

  it("includes other orders of the same customer when a refusal changes COD risk and history", async () => {
    const fixture = await createPhysicalOrder("CUSTOMER-REFUSED");
    const sibling = await createPhysicalOrder("CUSTOMER-ACTIVE");
    const customerId = randomUUID();
    const email = `${customerId}@example.test`;
    await testPool!.query(`INSERT INTO users (id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES ($1,'customer',$2,$2,'test-only-hash','active',now())`, [customerId, email]);
    await testPool!.query("INSERT INTO customers(user_id,full_name,birthday) VALUES ($1,'Delta Customer','2000-01-01')", [customerId]);
    await testPool!.query("UPDATE orders SET customer_user_id=$1 WHERE id=ANY($2::uuid[])",
      [customerId, [fixture.orderId, sibling.orderId]]);
    await testPool!.query("UPDATE orders SET status='Out With Representative' WHERE id=$1", [fixture.orderId]);
    const commerce = new CommerceService(testPool!);
    const baseVersion = await commerce.adminOrdersVersion();
    const response = await commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
      { expectedStatus: "Out With Representative", target: "Refused", reason: "Test refusal" }, "customer-refusal", true,
      { responseMode: "delta", baseVersion });
    expect(response.responseMode).toBe("delta");
    expect(response.orders.map((row) => row.id).sort()).toEqual([fixture.orderId, sibling.orderId].sort());
    expect(response.orders.find((row) => row.id === sibling.orderId)).toMatchObject({
      status: "New", refusalsInWindow: 1,
      refusalHistory: expect.arrayContaining([expect.objectContaining({ orderId: fixture.orderCode })]),
    });
  });

  it("keeps manual create/edit/COD/archive responses compact while including both affected customer groups", async () => {
    const suffix = randomUUID().slice(0, 8);
    const model = `MANUAL-M-${suffix}`;
    const item = `MANUAL-I-${suffix}`;
    const actorId = randomUUID();
    const staffEmail = `${actorId}@example.test`;
    await testPool!.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES ($1,'staff',$2,$2,'test-only-hash','active',now())`, [actorId, staffEmail]);
    await testPool!.query("INSERT INTO staff_users(user_id,display_name) VALUES ($1,'Delta Test Staff')", [actorId]);
    async function customer() {
      const id = randomUUID(); const email = `${id}@example.test`;
      await testPool!.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES ($1,'customer',$2,$2,'test-only-hash','active',now())`, [id, email]);
      const row = await testPool!.query<{ client_code: string }>(
        "INSERT INTO customers(user_id,full_name,birthday) VALUES ($1,'Manual Customer','2000-01-01') RETURNING client_code", [id]);
      return { id, code: row.rows[0]!.client_code };
    }
    const oldCustomer = await customer(); const newCustomer = await customer();
    const oldSibling = await createPhysicalOrder("OLD-CUSTOMER");
    const newSibling = await createPhysicalOrder("NEW-CUSTOMER");
    await testPool!.query("UPDATE orders SET customer_user_id=$1 WHERE id=$2", [oldCustomer.id, oldSibling.orderId]);
    await testPool!.query("UPDATE orders SET customer_user_id=$1 WHERE id=$2", [newCustomer.id, newSibling.orderId]);
    await testPool!.query("INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor) VALUES ($1,'Manual Delta',40000,60000)", [model]);
    await testPool!.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
      VALUES ($1,$1,$2,'Black','M','In stock',40000)`, [item, model]);
    const commerce = new CommerceService(testPool!);
    const options = async () => ({ responseMode: "delta" as const, baseVersion: await commerce.adminOrdersVersion() });
    const input = { clientName: "Manual Customer", phone1: "+201000000000", itemCodes: [item],
      clientId: oldCustomer.code, discountPercent: 10 };
    const created = await commerce.createAdminOrder(actorId, input, "manual-delta-create", await options());
    const changed = created.orders.find((row) => row.id !== oldSibling.orderId)!;
    expect(created.responseMode).toBe("delta");
    expect(changed).toMatchObject({ status: "New", finalAmount: 540 });
    const edited = await commerce.updateAdminOrder(actorId, String(changed.orderId),
      { ...input, clientId: newCustomer.code, discountPercent: 0 }, "manual-delta-edit", await options());
    expect(edited.responseMode).toBe("delta");
    expect(edited.orders.map((row) => row.id).sort()).toEqual([changed.id, oldSibling.orderId, newSibling.orderId].sort());
    const current = edited.orders.find((row) => row.id === changed.id)!;
    expect(current.finalAmount).toBe(600);
    const cod = await commerce.adminCodVerificationAction(actorId, String(changed.orderId),
      { expectedVersion: Number(current.version), decision: "verify", reason: "Test verification" }, "manual-delta-cod", await options());
    expect(cod).toMatchObject({ responseMode: "delta", orders: expect.arrayContaining([
      expect.objectContaining({ id: changed.id, verificationStatus: "Verified" }),
    ]) });
    await commerce.adminOrderWorkflowAction(actorId, String(changed.orderId),
      { expectedStatus: "New", target: "Cancelled" }, "manual-delta-cancel", false);
    for (const action of ["archive", "restore", "delete"] as const) {
      const state = await commerce.adminOrderStateAction(actorId, String(changed.orderId), action, `manual-${action}`, await options());
      expect(state).toMatchObject({ responseMode: "delta", orders: expect.arrayContaining([
        expect.objectContaining({ id: changed.id, isArchived: action !== "restore", isDeleted: action === "delete", finalAmount: 600 }),
      ]) });
    }
  });

  it("accepts New -> Accepted while keeping the physical item held", async () => {
    const actorId = randomUUID();
    const { orderId, orderCode, itemId } = await createPhysicalOrder("ACCEPT");
    const commerce = new CommerceService(testPool!);

    await expect(
      commerce.adminOrderWorkflowAction(
        actorId,
        orderCode,
        { expectedStatus: "New", target: "Accepted" },
        `accept-${orderCode}`,
      ),
    ).resolves.toMatchObject({ orders: expect.any(Array) });

    const order = await testPool!.query<{ status: string }>(
      "SELECT status FROM orders WHERE id=$1",
      [orderId],
    );
    const item = await testPool!.query<{ status: string; order_id: string | null }>(
      "SELECT status, order_id FROM inventory_items WHERE id=$1",
      [itemId],
    );

    expect(order.rows[0]?.status).toBe("Accepted");
    expect(item.rows[0]).toEqual({ status: "Processing/Held", order_id: orderCode });
  });

  it("rejects New -> Cancelled and releases the physical item back to stock", async () => {
    const actorId = randomUUID();
    const { orderId, orderCode, itemId } = await createPhysicalOrder("REJECT");
    const commerce = new CommerceService(testPool!);

    await expect(
      commerce.adminOrderWorkflowAction(
        actorId,
        orderCode,
        {
          expectedStatus: "New",
          target: "Cancelled",
          reason: "Rejected by admin",
        },
        `reject-${orderCode}`,
      ),
    ).resolves.toMatchObject({ orders: expect.any(Array) });

    const order = await testPool!.query<{ status: string }>(
      "SELECT status FROM orders WHERE id=$1",
      [orderId],
    );
    const item = await testPool!.query<{
      status: string;
      order_id: string | null;
      cart_reservation_id: string | null;
      reservation_until: Date | null;
    }>(
      `SELECT status, order_id, cart_reservation_id, reservation_until
         FROM inventory_items WHERE id=$1`,
      [itemId],
    );
    const audit = await testPool!.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE entity_type='items' AND entity_id=$1
        ORDER BY occurred_at DESC`,
      [itemId],
    );

    expect(order.rows[0]?.status).toBe("Cancelled");
    expect(item.rows[0]).toEqual({
      status: "In stock",
      order_id: null,
      cart_reservation_id: null,
      reservation_until: null,
    });
    expect(audit.rows.map((row) => row.action)).toContain("INVENTORY_ITEM_CHANGED");
  });

  it("updates valid orders in one bulk request and reports stale orders without rolling back successes", async () => {
    const actorId = randomUUID();
    const first = await createPhysicalOrder("BULK-FIRST");
    const stale = await createPhysicalOrder("BULK-STALE");
    const commerce = new CommerceService(testPool!);

    await commerce.adminOrderWorkflowAction(
      actorId,
      stale.orderCode,
      { expectedStatus: "New", target: "Accepted" },
      `pre-bulk-${stale.orderCode}`,
      false,
    );

    const refresh = vi.spyOn(commerce, "adminOrders").mockRejectedValueOnce(new Error("Bulk response read unavailable"));
    const response = await commerce.adminBulkOrderWorkflowAction(
      actorId,
      {
        orderRefs: [first.orderCode, stale.orderCode],
        expectedStatus: "New",
        target: "Accepted",
      },
      `bulk-${first.orderCode}`,
    );

    refresh.mockRestore();
    expect(response).toMatchObject({ refreshRequired: true, orders: [] });
    expect(response.result).toEqual({
      requested: 2,
      succeeded: [{ orderRef: first.orderCode }],
      failed: [{
        orderRef: stale.orderCode,
        code: "ORDER_STATE_STALE",
        message: expect.stringContaining("changed"),
      }],
    });
    const rows = await testPool!.query<{ order_code: string; status: string }>(
      "SELECT order_code, status FROM orders WHERE order_code=ANY($1::text[]) ORDER BY order_code",
      [[first.orderCode, stale.orderCode]],
    );
    expect(rows.rows.every((row) => row.status === "Accepted")).toBe(true);
  });
  it("rejects direct and bulk New -> Delivered jumps without changing inventory or money", async () => {
    const fixture = await createPhysicalOrder("NO-JUMP");
    const commerce = new CommerceService(testPool!);
    await expect(commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
      { expectedStatus: "New", target: "Delivered" }, "forbidden-jump"))
      .rejects.toMatchObject({ code: "ORDER_STATE_INVALID" });
    const bulk = await commerce.adminBulkOrderWorkflowAction(randomUUID(), {
      orderRefs: [fixture.orderCode], expectedStatus: "New", target: "Delivered",
    }, "forbidden-bulk-jump");
    expect(bulk.result.succeeded).toEqual([]);
    expect(bulk.result.failed[0]?.code).toBe("ORDER_STATE_INVALID");
    const result = await testPool!.query(
      `SELECT o.status, o.final_minor::text, o.amount_paid_minor::text, i.status AS item_status
         FROM orders o JOIN inventory_items i ON i.item_code=$2 WHERE o.id=$1`,
      [fixture.orderId, fixture.itemCode]);
    expect(result.rows[0]).toMatchObject({ status: "New", final_minor: "60000",
      amount_paid_minor: "0", item_status: "Processing/Held" });
  });

  it("allows exactly one of two concurrent conflicting actions on the same order", async () => {
    const fixture = await createPhysicalOrder("RACE");
    const commerce = new CommerceService(testPool!);
    const responses = await Promise.allSettled([
      commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
        { expectedStatus: "New", target: "Accepted" }, "race-accept", false),
      commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
        { expectedStatus: "New", target: "Cancelled" }, "race-cancel", false),
    ]);
    expect(responses.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = responses.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason.code).toBe("ORDER_STATE_STALE");
    const audit = await testPool!.query(
      "SELECT action FROM audit_logs WHERE entity_id=$1 AND action='ORDER_WORKFLOW_CHANGED'", [fixture.orderId]);
    expect(audit.rows).toHaveLength(1);
  });

  it.each(["full", "delta"] as const)("does not deadlock with a one-connection pool when reading the committed %s response", async (mode) => {
    const fixture = await createPhysicalOrder("ONE-CONNECTION");
    const pool = new Pool({ connectionString: databaseUrl, max: 1,
      connectionTimeoutMillis: 1000, options: `-c search_path=${schemaName},public` });
    try {
      const commerce = new CommerceService(pool);
      const baseVersion = await commerce.adminOrdersVersion();
      await expect(commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
        { expectedStatus: "New", target: "Accepted" }, "one-connection", true,
        mode === "delta" ? { responseMode: "delta", baseVersion } : undefined))
        .resolves.toMatchObject({ orders: expect.arrayContaining([expect.objectContaining({
          orderId: fixture.orderCode, status: "Accepted" })]) });
    } finally { await pool.end(); }
  });

  it("reports a committed command as successful if its response refresh fails", async () => {
    const fixture = await createPhysicalOrder("REFRESH-FAIL");
    const commerce = new CommerceService(testPool!);
    const refresh = vi.spyOn(commerce, "adminOrders").mockRejectedValue(new Error("Read connection unavailable"));
    try {
      await expect(commerce.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
        { expectedStatus: "New", target: "Accepted" }, "refresh-failed"))
        .resolves.toMatchObject({ refreshRequired: true, orders: [] });
      const result = await testPool!.query("SELECT status FROM orders WHERE id=$1", [fixture.orderId]);
      expect(result.rows[0]?.status).toBe("Accepted");
    } finally { refresh.mockRestore(); }
  });

  it("reads orders and their version from the same snapshot during a concurrent commit", async () => {
    const fixture = await createPhysicalOrder("SNAPSHOT");
    const writer = new CommerceService(testPool!);
    let readVersion = 0;
    const snapshotPool = { connect: async () => {
      const client = await testPool!.connect();
      return { release: () => client.release(), query: async (sql: string) => {
        const result = await client.query(sql);
        if (sql === "SELECT version::text FROM domain_state_versions WHERE domain='orders'") {
          readVersion = Number(result.rows[0]?.version);
          await writer.adminOrderWorkflowAction(randomUUID(), fixture.orderCode,
            { expectedStatus: "New", target: "Accepted" }, "during-snapshot", false);
        }
        return result;
      } };
    } } as unknown as Pool;
    const snapshot = await new CommerceService(snapshotPool).adminOrders();
    expect(snapshot.version).toBe(readVersion);
    expect(snapshot.orders.find((order) => order.orderId === fixture.orderCode)?.status).toBe("New");
    const latest = await writer.adminOrders();
    expect(latest.version).toBeGreaterThan(snapshot.version);
    expect(latest.orders.find((order) => order.orderId === fixture.orderCode)?.status).toBe("Accepted");
  });

});
