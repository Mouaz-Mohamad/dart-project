// DART CODE GUIDE | backend/tests/set-lifecycle.contract.test.ts
// Static cross-layer guardrails for atomic Set reservations, historical refunds and loyalty lifecycle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("Set lifecycle integrity contracts", () => {
  it("serializes Set/cart and Dart Card writes inside database transactions", () => {
    const cart = source("src/modules/sets/set-cart.service.ts");
    expect(cart).toContain('client.query("BEGIN")');
    expect(cart).toContain("pg_advisory_xact_lock");
    expect(cart).toContain("dart:cart:");
    expect(cart).toContain("dart:set-card:");
    expect(cart).toContain("FOR UPDATE");
    expect(cart).toContain('client.query("COMMIT")');
    expect(cart).toContain('client.query("ROLLBACK")');
  });

  it("validates the selected reserved pieces instead of requiring every offered variant", () => {
    const cart = source("src/modules/sets/set-cart.service.ts");
    expect(cart).not.toContain("assertEveryOfferedVariantAvailable");
    expect(cart).toContain("validateSelections(components, selections)");
    expect(cart).toContain("SET_RESERVED_ITEMS_MISMATCH");
    expect(cart).toContain("usedInventoryIds");
  });

  it("retires Set Waiting without deleting its historical records", () => {
    const app = source("src/app.ts");
    const application = source("src/application.ts");
    const historicalMigration = source("migrations/0054_sets_foundation.sql");
    expect(app).not.toContain("SetWaitingService");
    expect(application).not.toContain("createSetWaitingRouter");
    expect(historicalMigration).toContain("set_waiting_entries");
  });

  it("snapshots the allocated Set amount onto physical order items", () => {
    const bridge = source("migrations/0055_set_cart_order_bridge.sql");
    expect(bridge).toContain("NEW.final_unit_minor := bridge.allocated_final_minor");
    expect(bridge).toContain("order_set_components");
    expect(bridge).toContain("order_set_groups_order_set_unit_unique");
  });

  it("does not consume campaign usage when only Set pieces are present", () => {
    const bridge = source("migrations/0055_set_cart_order_bridge.sql");
    expect(bridge).toContain("IF campaign_count = 0 THEN");
    expect(bridge).toContain("DELETE FROM promotion_usages WHERE order_id=NEW.order_id");
  });

  it("restores Birthday and Dart Card lifecycle from server-side order history", () => {
    const lifecycle = source("migrations/0056_set_lifecycle_integrity.sql");
    expect(lifecycle).toContain("birthday_rewards");
    expect(lifecycle).toContain("set_loyalty_usage");
    expect(lifecycle).toContain("FOR UPDATE");
  });
});
