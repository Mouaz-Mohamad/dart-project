import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/database/migrate.js";

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
      max: 1,
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
      ]),
    );

    const applied = await testPool!.query<{ name: string }>(
      "SELECT name FROM dart_schema_migrations ORDER BY name",
    );
    expect(applied.rows.map((row) => row.name)).toEqual(expectedMigrations);
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
