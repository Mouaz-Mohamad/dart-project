// DART CODE GUIDE | backend/tests/reward-integrity-migrations.contract.test.ts
// الغرض: يثبت وجود قيود DB الحرجة لـBirthday/Promotions/Dart Card حتى لا تتحول مرة أخرى إلى UI-only rules.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function migration(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
}

describe("reward database integrity migrations", () => {
  it("enforces one Birthday usage record per customer/year and finalizes only from order state", async () => {
    const sql = await migration("0034_rewards_promotions_draw_integrity.sql");
    const timing = await migration("0037_reward_reservation_after_order_insert.sql");
    expect(sql).toContain("UNIQUE(customer_user_id, reward_year)");
    expect(sql).toContain("BIRTHDAY_DISCOUNT_ALREADY_USED_THIS_YEAR");
    expect(sql).toContain("last_birthday_discount_used_at");
    expect(sql).toContain("AFTER UPDATE OF status ON orders");
    expect(sql).toContain("CUSTOMER_BIRTHDAY_CHANGED");
    expect(timing).toContain("AFTER INSERT ON orders");
  });

  it("serializes Promotion limits and releases cancelled/refused reservations", async () => {
    const sql = await migration("0034_rewards_promotions_draw_integrity.sql");
    expect(sql).toContain("FROM promotion_records");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("PROMOTION_TOTAL_USAGE_LIMIT_REACHED");
    expect(sql).toContain("PROMOTION_CUSTOMER_USAGE_LIMIT_REACHED");
    expect(sql).toContain("status='Released'");
  });

  it("keeps draw history compatibility and serializes active-card decisions", async () => {
    const compatibility = await migration("0035_reward_history_reference_compatibility.sql");
    const lock = await migration("0036_dart_card_active_concurrency_lock.sql");
    expect(compatibility).toContain("DROP CONSTRAINT IF EXISTS promotion_usages_promotion_record_id_fkey");
    expect(compatibility).toContain("DROP CONSTRAINT IF EXISTS dart_card_draws_card_record_id_fkey");
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain("CUSTOMER_ALREADY_HAS_ACTIVE_DART_CARD");
  });
});
