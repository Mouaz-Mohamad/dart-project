// Security regression: suggestions must never become physical cart reservations.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const safety = readFileSync(
  new URL("../migrations/0096_waitlist_alternative_suggestions_only.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/waiting/waiting.service.ts", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../../Eye/dart-waiting.js", import.meta.url),
  "utf8",
);
const customer = readFileSync(
  new URL("../../src/storefront/platform/waiting.js", import.meta.url),
  "utf8",
);

function part(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
}

describe("waitlist alternative-color reservation safety", () => {
  it("reserves only exact model, size and color at the SQL boundary", () => {
    const assign = part(safety, "CREATE OR REPLACE FUNCTION dart_waitlist_assign_item(", "CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_item(");
    expect(assign).toContain("IF p_match_type <> 'exact' THEN");
    expect(assign).toContain("IF v_entry.desired_color <> v_item.color THEN");
    expect(safety).toContain("CREATE TRIGGER waitlist_exact_allocation_only");
    expect(safety).toContain("BEFORE INSERT OR UPDATE OF match_type ON waitlist_allocations");
    expect(safety).toContain("WAITLIST_ALTERNATIVE_SUGGESTION_ONLY");
  });

  it("checks FIFO for exact restocks first and only suggests alternate colors", () => {
    const item = part(safety, "CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_item(", "CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_entry(");
    const entry = safety.slice(safety.indexOf("CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_entry("));
    expect(item.indexOf("desired_color=v_item.color")).toBeLessThan(item.indexOf("dart_waitlist_suggest_alternative"));
    expect(item).toContain("'exact'");
    expect(entry).toContain("'exact'");
    expect(item).not.toContain("'alternative_color'");
    expect(entry).not.toContain("'alternative_color'");
    expect(item).toContain("NOT EXISTS (");
    expect(entry).toContain("dart_waitlist_suggest_alternative(");
  });

  it("is idempotent, does not reserve stock, and discloses that alternatives are suggestions", () => {
    const suggest = part(safety, "CREATE OR REPLACE FUNCTION dart_waitlist_suggest_alternative(", "-- Fail closed");
    expect(suggest).toContain("CONFLICT(waitlist_entry_id,offered_color) DO NOTHING");
    expect(suggest).toContain("WAITLIST_ALTERNATIVE_SUGGESTED");
    expect(suggest).toContain("'reserved',false");
    expect(suggest).not.toContain("UPDATE inventory_items");
    expect(suggest).not.toContain("INSERT INTO waitlist_allocations");
    expect(suggest).not.toContain("INSERT INTO cart_reservations");
    expect(safety).toContain("UNIQUE(waitlist_entry_id,offered_color)");
  });

  it("prevents admin reassignment to a different color and never allocates suggested stock", () => {
    const offer = part(service, "private async adminOfferAlternative(", "private async adminPriority(");
    const reassign = part(service, "private async adminReassign(", "private async emitReservationNotification(");
    expect(offer).toContain("SELECT dart_waitlist_suggest_alternative(");
    expect(offer).not.toContain("SELECT dart_waitlist_assign_item(");
    expect(offer).not.toContain("UPDATE inventory_items");
    expect(reassign).toContain("if (target.desired_color !== item.color)");
    expect(reassign).toContain('const matchType = "exact" as const;');
    expect(dashboard).toContain("Alternative color to suggest (stock will not be held)");
  });

  it("exposes a suggested color only if currently available and keeps reads compatible before migration", () => {
    expect(service).toContain("to_regclass('waitlist_alternative_suggestions')");
    expect(service).toContain("lower(candidate.status)='in stock'");
    expect(service).toContain("suggestedColors: Array.isArray(row.suggested_colors)");
    expect(customer).toContain("entry.suggestedColors");
    expect(customer).toContain("مفيش أي قطعة اتحجزت لك منها");
    expect(customer).toContain('href="products.html"');
  });
});
