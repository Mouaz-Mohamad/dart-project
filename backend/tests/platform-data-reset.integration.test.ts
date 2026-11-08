// DART CODE GUIDE | backend/tests/platform-data-reset.integration.test.ts
// Verify the selective deletion executes against a disposable database with real schema/FK constraints.
import { randomUUID } from "node:crypto";
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
      await pool.query(
        "INSERT INTO users (id,account_type,email,email_normalized,status,email_verified_at) VALUES ($1,'staff','reset-owner@example.invalid','reset-owner@example.invalid','active',now())",
        [ownerId],
      );
      await pool.query(
        "INSERT INTO staff_users (user_id,display_name,is_owner) VALUES ($1,'Dart Reset Test Owner',true)",
        [ownerId],
      );
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
        "INSERT INTO dashboard_domain_state (domain,data) VALUES ('customers','[{\"id\":\"old\"}]'::jsonb), ('representatives','[{\"id\":\"kept\"}]'::jsonb) ON CONFLICT(domain) DO UPDATE SET data=excluded.data",
      );
      await pool.query(
        "INSERT INTO site_settings (id,data) VALUES ('main','{\"hero\":\"keep\",\"waiting\":{\"hours\":4},\"modelCards\":[\"old\"]}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      );

      // Run the real owner lookup and all SQL against the isolated schema.
      const result = await new PlatformAdminService(pool)
        .resetBusinessData(ownerId, "test-request");
      expect(result.deleted.catalogModels).toBe(1);
      expect(result.deleted.customers).toBe(1);
      const model = await pool.query("SELECT count(*)::int AS n FROM catalog_models");
      const customers = await pool.query("SELECT count(*)::int AS n FROM customers");
      const owners = await pool.query("SELECT count(*)::int AS n FROM staff_users WHERE is_owner");
      const finance = await pool.query("SELECT domain FROM finance_records WHERE domain IN ('finance_expenses','finance_budgets') ORDER BY domain");
      const settings = await pool.query("SELECT data FROM site_settings WHERE id='main'");
      const domains = await pool.query("SELECT domain,data FROM dashboard_domain_state WHERE domain IN ('customers','representatives') ORDER BY domain");
      expect(model.rows[0].n).toBe(0);
      expect(customers.rows[0].n).toBe(0);
      expect(owners.rows[0].n).toBe(1);
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
