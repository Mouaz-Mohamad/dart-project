// DART CODE GUIDE | backend/tests/order-workflow.inventory.integration.test.ts
// الغرض: Regression test لمسار قبول/رفض أوردر حقيقي مرتبط بقطعة فعلية على schema الإنتاج الكامل.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/database/migrate.js";
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
});
