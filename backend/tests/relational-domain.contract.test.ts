import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/0018_relational_business_domains.sql", import.meta.url),
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
    expect(migration).toContain("CREATE TRIGGER dashboard_domain_relational_sync");
    expect(migration).toContain("UPDATE dashboard_domain_state");
    expect(migration).toContain("jsonb_array_elements(NEW.data)");
  });

  it("keeps indexed business keys outside the monolithic JSON array", () => {
    expect(migration).toContain("return_requests_item_idx");
    expect(migration).toContain("return_requests_customer_idx");
    expect(migration).toContain("promotion_records_code_unique");
    expect(migration).toContain("loyalty_cards_customer_idx");
    expect(migration).toContain("finance_records_order_idx");
  });
});
