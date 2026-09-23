// DART CODE GUIDE | backend/tests/relational-domain.contract.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/0024_relational_business_domains.sql", import.meta.url),
  "utf8",
);
const authoritativeMigration = readFileSync(
  new URL("../migrations/0025_relational_domains_authoritative.sql", import.meta.url),
  "utf8",
);
const typedMigration = readFileSync(
  new URL("../migrations/0026_return_damage_typed_core.sql", import.meta.url),
  "utf8",
);
const store = readFileSync(
  new URL("../src/modules/dashboard/relational-domain.store.ts", import.meta.url),
  "utf8",
);

describe("relational business domain architecture", () => {
  it("creates dedicated row tables for every critical operational family", () => {
    for (const table of [
      "return_requests",
      "damage_records",
      "promotion_records",
      "loyalty_cards",
      "birthday_rewards",
      "notification_records",
      "message_records",
      "finance_records",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(store).toContain(table);
    }
  });

  it("backfills existing state and keeps compatibility writes transactionally mirrored", () => {
    expect(migration).toContain("UPDATE dashboard_domain_state");
    expect(migration).toContain("jsonb_array_elements(NEW.data)");
    expect(authoritativeMigration).toContain(
      "BEFORE INSERT OR UPDATE OF data ON dashboard_domain_state",
    );
    expect(authoritativeMigration).toContain("NEW.data := '[]'::jsonb");
    expect(authoritativeMigration).toContain(
      "DISTINCT ON (dart_domain_record_id(value))",
    );
    expect(authoritativeMigration).toContain("ordinality DESC");
  });

  it("does not persist duplicated critical arrays in the compatibility envelope", () => {
    expect(authoritativeMigration).toContain(
      "DROP TRIGGER IF EXISTS dashboard_domain_relational_sync",
    );
    expect(authoritativeMigration).toContain("SET data='[]'::jsonb");
    expect(authoritativeMigration).toContain(
      "CREATE TRIGGER dashboard_domain_relational_sync",
    );
  });

  it("adds typed relational return and damage cores with real foreign keys", () => {
    expect(typedMigration).toContain("customer_user_id UUID REFERENCES customers");
    expect(typedMigration).toContain("order_id UUID REFERENCES orders");
    expect(typedMigration).toContain("inventory_item_id TEXT REFERENCES inventory_items");
    expect(typedMigration).toContain("original_net_minor BIGINT");
    expect(typedMigration).toContain("return_requests_typed_sync");
    expect(typedMigration).toContain("damage_records_typed_sync");
  });

  it("keeps indexed business keys outside the monolithic JSON array", () => {
    expect(migration).toContain("DISTINCT ON (dart_domain_record_id(value))");
    expect(migration).not.toContain("CREATE UNIQUE INDEX promotion_records_code_unique");
    expect(migration).not.toContain("CREATE UNIQUE INDEX loyalty_cards_code_unique");
    expect(migration).toContain("return_requests_item_idx");
    expect(migration).toContain("return_requests_customer_idx");
    expect(migration).toContain("promotion_records_code_idx");
    expect(migration).toContain("loyalty_cards_customer_idx");
    expect(migration).toContain("finance_records_order_idx");
  });
});
