// DART CODE GUIDE | backend/tests/platform-data-reset.integration.test.ts
// Verify the selective deletion executes against a disposable database with real schema/FK constraints.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformAdminService } from "../src/modules/platform/platform-admin.service.js";
import { embeddedStore } from "./embedded-store.js";

afterEach(() => vi.unstubAllEnvs());

describe("owner selective reset — executable SQL", () => {
  it("clears selected domains but preserves branding, representatives and unrelated finance", async () => {
    vi.stubEnv("DART_RESET_AFTER_BACKUP_ENABLED", "true");
    const { pool, db } = await embeddedStore(true);
    try {
      const customerId = randomUUID();
      const ownerId = randomUUID();
      await pool.query("INSERT INTO catalog_models (model_id, name) VALUES ('reset-model','Temporary Product')");
      await pool.query(
        "INSERT INTO users (id,account_type,email,email_normalized,password_hash) VALUES ($1,'customer',$2,$2,'isolated-test-hash')",
        [customerId, "reset-test@example.invalid"],
      );
      await pool.query("INSERT INTO customers (user_id,full_name,birthday) VALUES ($1,'Temporary Customer','2000-09-02'::date)", [customerId]);
      await pool.query(
        "INSERT INTO finance_records(domain,record_id,payload) VALUES ('finance_expenses','test-expense','{}'::jsonb), ('finance_budgets','test-budget','{}'::jsonb)",
      );
      await pool.query(
        "INSERT INTO dashboard_domain_state (domain,data) VALUES ('customers','[{\"id\":\"old\"}]'::jsonb), ('representatives','[{\"id\":\"kept\"}]'::jsonb)",
      );
      await pool.query(
        "INSERT INTO site_settings (id,data) VALUES ('main','{\"hero\":\"keep\",\"waiting\":{\"hours\":4},\"modelCards\":[\"old\"]}'::jsonb)",
      );

      // Only the owner's authentication lookup is mocked, while every mutation runs
      // through the isolated real PostgreSQL-compatible migration schema.
      const verifyingPool = {
        connect: async () => {
          const actual = await pool.connect();
          return {
            query: async (sql: string, values?: unknown[]) =>
              sql.includes("SELECT is_owner FROM staff_users")
                ? { rows: [{ is_owner: true }], rowCount: 1 }
                : actual.query(sql, values),
            release: () => actual.release(),
          } as unknown as PoolClient;
        },
      } as unknown as Pool;

      const result = await new PlatformAdminService(verifyingPool)
        .resetBusinessData(ownerId, "test-request");
      expect(result.deleted.catalogModels).toBe(1);
      expect(result.deleted.customers).toBe(1);
      const model = await pool.query("SELECT count(*)::int AS n FROM catalog_models");
      const customers = await pool.query("SELECT count(*)::int AS n FROM customers");
      const finance = await pool.query("SELECT domain FROM finance_records ORDER BY domain");
      const settings = await pool.query("SELECT data FROM site_settings WHERE id='main'");
      const domains = await pool.query("SELECT domain,data FROM dashboard_domain_state ORDER BY domain");
      expect(model.rows[0].n).toBe(0);
      expect(customers.rows[0].n).toBe(0);
      expect(finance.rows).toEqual([{ domain: "finance_budgets" }]);
      expect(settings.rows[0].data).toEqual({ hero: "keep", waiting: { hours: 4 } });
      expect(domains.rows).toEqual([
        { domain: "customers", data: [] },
        { domain: "representatives", data: [{ id: "kept" }] },
      ]);
    } finally {
      await db.close();
    }
  }, 60000);
});
