// DART CODE GUIDE | backend/tests/database.integration.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/database/migrate.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_test_${randomUUID().replaceAll("-", "")}`;
const migrationsPath = resolve(process.cwd(), "migrations");
const expectedMigrations = readdirSync(migrationsPath)
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
let adminPool: Pool | undefined;
let testPool: Pool | undefined;

describe.skipIf(!databaseUrl)("PostgreSQL production schema", () => {
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

  it("applies every current migration and creates production-critical tables", async () => {
    const result = await testPool!.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `,
      [schemaName],
    );
    const tableNames = result.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "users",
        "customers",
        "staff_users",
        "representatives",
        "sessions",
        "audit_logs",
        "outbox_events",
        "catalog_models",
        "inventory_items",
        "catalog_assets",
        "cart_reservations",
        "orders",
        "order_items",
        "order_events",
        "site_settings",
        "dashboard_domain_state",
        "representative_documents",
        "representative_locations",
        "return_requests",
        "damage_records",
        "promotion_records",
        "loyalty_cards",
        "birthday_rewards",
        "notification_records",
        "message_records",
        "finance_records",
        "cod_verification_events",
        "customer_social_auth_challenges",
        "customer_social_identities",
        "dart_card_draw_winners",
      ]),
    );

    const applied = await testPool!.query<{ name: string }>(
      "SELECT name FROM dart_schema_migrations ORDER BY name",
    );
    expect(applied.rows.map((row) => row.name)).toEqual(expectedMigrations);
  });

  it("is a no-op when every migration is already current", async () => {
    await expect(runMigrations(testPool!, migrationsPath)).resolves.toEqual([]);
  });

  it("allows only one cart to reserve the final physical item under concurrency", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const modelId = `CONC-${suffix}`;
    const itemId = `ITEM-${suffix}`;
    const itemCode = `IT-${suffix}`;

    await testPool!.query(
      `INSERT INTO catalog_models (
         model_id, name, cost_minor, selling_minor, size_options, color_options
       ) VALUES ($1,$2,40000,60000,$3::jsonb,$4::jsonb)`,
      [
        modelId,
        "Concurrency Test",
        JSON.stringify([{ name: "M", active: true }]),
        JSON.stringify([{ name: "Black", active: true }]),
      ],
    );
    await testPool!.query(
      `INSERT INTO inventory_items (
         id, item_code, model_id, color, size, status, cost_snapshot_minor
       ) VALUES ($1,$2,$3,'Black','M','In stock',40000)`,
      [itemId, itemCode, modelId],
    );

    const commerce = new CommerceService(testPool!);
    const line = [{ modelId, color: "Black", size: "M", quantity: 1 }];
    const results = await Promise.allSettled([
      commerce.reserveCart(
        `CART-A-${suffix}`,
        line,
        undefined,
        "a".repeat(64),
      ),
      commerce.reserveCart(
        `CART-B-${suffix}`,
        line,
        undefined,
        "b".repeat(64),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "STOCK_INSUFFICIENT",
      statusCode: 409,
    });

    const item = await testPool!.query<{
      status: string;
      cart_reservation_id: string | null;
    }>(
      "SELECT status, cart_reservation_id FROM inventory_items WHERE id=$1",
      [itemId],
    );
    expect(item.rows[0]?.status).toBe("Cart Reserved");
    expect(item.rows[0]?.cart_reservation_id).toMatch(/^CART-[AB]-/);
  });

  it("backfills and transactionally mirrors critical dashboard domains into relational rows", async () => {
    const row = {
      id: "rel-return-1",
      returnId: "R-REL-1",
      itemCode: "ITEM-REL-1",
      requestType: "Refund",
      status: "Pending Request",
      reason: "Size issue",
      governorate: "Cairo",
      originalNetAmount: 420,
      customerCourierFee: 100,
      courierFeePayer: "Customer",
      isDeleted: false,
    };
    await testPool!.query(
      `UPDATE dashboard_domain_state
          SET data=$2::jsonb, version=version+1, updated_at=now()
        WHERE domain=$1`,
      ["returns", JSON.stringify([row])],
    );
    const relational = await testPool!.query<{
      record_id: string;
      return_code: string;
      item_code: string;
      status: string;
      payload: Record<string, unknown>;
    }>(
      "SELECT record_id, return_code, item_code, status, payload FROM return_requests",
    );
    expect(relational.rows).toHaveLength(1);
    expect(relational.rows[0]).toMatchObject({
      record_id: "rel-return-1",
      return_code: "R-REL-1",
      item_code: "ITEM-REL-1",
      status: "Pending Request",
    });
    expect(relational.rows[0]!.payload.requestType).toBe("Refund");

    const typedReturn = await testPool!.query<{
      reason: string;
      pickup_governorate: string;
      original_net_minor: string;
      customer_courier_fee_minor: string;
      courier_fee_payer: string;
    }>(
      `SELECT reason, pickup_governorate, original_net_minor::text,
              customer_courier_fee_minor::text, courier_fee_payer
         FROM return_requests WHERE record_id='rel-return-1'`,
    );
    expect(typedReturn.rows[0]).toMatchObject({
      reason: "Size issue",
      pickup_governorate: "Cairo",
      original_net_minor: "42000",
      customer_courier_fee_minor: "10000",
      courier_fee_payer: "Customer",
    });

    const envelope = await testPool!.query<{ data: unknown[] }>(
      "SELECT data FROM dashboard_domain_state WHERE domain='returns'",
    );
    expect(envelope.rows[0]!.data).toEqual([]);

    await testPool!.query(
      `UPDATE dashboard_domain_state
          SET data=$2::jsonb, version=version+1, updated_at=now()
        WHERE domain=$1`,
      ["returns", JSON.stringify([row, { ...row, status: "Duplicate Legacy" }])],
    );
    const deduped = await testPool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM return_requests WHERE record_id='rel-return-1'",
    );
    expect(deduped.rows[0]!.count).toBe("1");
    const dedupedPayload = await testPool!.query<{ status: string }>(
      "SELECT status FROM return_requests WHERE record_id='rel-return-1'",
    );
    expect(dedupedPayload.rows[0]!.status).toBe("Duplicate Legacy");

    await testPool!.query(
      `UPDATE dashboard_domain_state
          SET data='[]'::jsonb, version=version+1, updated_at=now()
        WHERE domain='returns'`,
    );
    const cleared = await testPool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM return_requests",
    );
    expect(cleared.rows[0]!.count).toBe("0");
  });

  it("blocks COD Preparing until verification, then accepts a verified order and rejects a stale verification retry", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const customerUserId = randomUUID();
    const staffUserId = randomUUID();
    const orderId = randomUUID();
    const orderCode = `K-RISK-${suffix}`;

    await testPool!.query(
      `INSERT INTO users (
         id, account_type, email, email_normalized, password_hash, status, email_verified_at
       ) VALUES
         ($1,'customer',$2,$2,'test-hash','active',now()),
         ($3,'staff',$4,$4,'test-hash','active',now())`,
      [
        customerUserId,
        `risk-customer-${suffix}@example.com`,
        staffUserId,
        `risk-staff-${suffix}@example.com`,
      ],
    );
    await testPool!.query(
      "INSERT INTO customers (user_id, full_name, birthday) VALUES ($1,'Risk Test Customer','2000-01-01')",
      [customerUserId],
    );
    await testPool!.query(
      `INSERT INTO staff_users (user_id, display_name, is_owner, mfa_required)
       VALUES ($1,'Risk Test Staff',false,false)`,
      [staffUserId],
    );
    await testPool!.query(
      `INSERT INTO account_phones (
         user_id, account_type, phone_normalized, phone_display, is_primary, verified_at
       ) VALUES ($1,'customer',$2,$3,true,now())`,
      [customerUserId, "201000000001", "+201000000001"],
    );
    await testPool!.query(
      `INSERT INTO orders (
         id, order_code, customer_user_id, status, payment_method, payment_status,
         subtotal_minor, final_minor, contact_snapshot, delivery_address
       ) VALUES (
         $1,$2,$3,'Accepted','Cash on Delivery','Unpaid',
         60000,60000,$4::jsonb,$5::jsonb
       )`,
      [
        orderId,
        orderCode,
        customerUserId,
        JSON.stringify({ name: "Risk Test Customer", phone1: "+201000000000" }),
        JSON.stringify({
          country: "Egypt",
          governorate: "Cairo",
          area: "Nasr City",
          street: "Test Street",
          building: "1",
        }),
      ],
    );

    const commerce = new CommerceService(testPool!);
    await expect(
      commerce.adminOrderWorkflowAction(
        staffUserId,
        orderCode,
        { expectedStatus: "Accepted", target: "Preparing" },
        `risk-block-${suffix}`,
      ),
    ).rejects.toMatchObject({
      code: "COD_VERIFICATION_REQUIRED",
      statusCode: 409,
    });

    const blocked = await testPool!.query<{
      status: string;
      version: string;
      cod_verification_status: string;
      cod_risk_level: string;
    }>(
      `SELECT status, version::text, cod_verification_status, cod_risk_level
         FROM orders WHERE id=$1`,
      [orderId],
    );
    expect(blocked.rows[0]).toMatchObject({
      status: "Accepted",
      cod_verification_status: "Required",
      cod_risk_level: "Medium",
    });
    const expectedVersion = Number(blocked.rows[0]!.version);

    await commerce.adminCodVerificationAction(
      staffUserId,
      orderCode,
      {
        expectedVersion,
        decision: "verify",
        reason: "Customer confirmed COD order details",
      },
      `risk-verify-${suffix}`,
    );

    const verified = await testPool!.query<{
      version: string;
      cod_verification_status: string;
      cod_verified_by: string | null;
    }>(
      `SELECT version::text, cod_verification_status, cod_verified_by::text
         FROM orders WHERE id=$1`,
      [orderId],
    );
    expect(verified.rows[0]).toMatchObject({
      cod_verification_status: "Verified",
      cod_verified_by: staffUserId,
    });

    await expect(
      commerce.adminCodVerificationAction(
        staffUserId,
        orderCode,
        {
          expectedVersion,
          decision: "verify",
          reason: "Duplicate retry with stale version",
        },
        `risk-stale-${suffix}`,
      ),
    ).rejects.toMatchObject({
      code: "ORDER_VERSION_CONFLICT",
      statusCode: 409,
    });

    await commerce.adminOrderWorkflowAction(
      staffUserId,
      orderCode,
      { expectedStatus: "Accepted", target: "Preparing" },
      `risk-prepare-${suffix}`,
    );

    const prepared = await testPool!.query<{
      status: string;
      cod_verification_status: string;
    }>(
      "SELECT status, cod_verification_status FROM orders WHERE id=$1",
      [orderId],
    );
    expect(prepared.rows[0]).toEqual({
      status: "Preparing",
      cod_verification_status: "Verified",
    });

    const events = await testPool!.query<{ event_type: string }>(
      `SELECT event_type FROM cod_verification_events
        WHERE order_id=$1
        ORDER BY occurred_at`,
      [orderId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(["RISK_EVALUATED", "VERIFICATION_APPROVED"]),
    );
  });

  it("enforces append-only audit records", async () => {
    const inserted = await testPool!.query<{ id: string }>(
      `
        INSERT INTO audit_logs (actor_type, action, entity_type, entity_id)
        VALUES ('system', 'TEST', 'test', 'one')
        RETURNING id
      `,
    );
    await expect(
      testPool!.query("UPDATE audit_logs SET action = 'CHANGED' WHERE id = $1", [
        inserted.rows[0]!.id,
      ]),
    ).rejects.toThrow("audit_logs is append-only");
  });

  it("enforces outbox and idempotency deduplication", async () => {
    await testPool!.query(
      `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, deduplication_key
        ) VALUES ('order', 'one', 'order.created', '{}', 'order-one-created')
      `,
    );
    await expect(
      testPool!.query(
        `
          INSERT INTO outbox_events (
            aggregate_type, aggregate_id, event_type, payload, deduplication_key
          ) VALUES ('order', 'one', 'order.created', '{}', 'order-one-created')
        `,
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const hash = "a".repeat(64);
    await testPool!.query(
      `
        INSERT INTO idempotency_keys (scope, key_hash, request_hash, expires_at)
        VALUES ('order.create', $1, $1, now() + interval '1 day')
      `,
      [hash],
    );
    await expect(
      testPool!.query(
        `
          INSERT INTO idempotency_keys (scope, key_hash, request_hash, expires_at)
          VALUES ('order.create', $1, $1, now() + interval '1 day')
        `,
        [hash],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
