// DART CODE GUIDE | backend/tests/waiting.contract.test.ts
// الغرض: حماية عقود Waiting / Restock Reservation من الرجوع أو الانفصال عن Cart وDashboard.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/0030_waitlist_reservations.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/modules/waiting/waiting.service.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/modules/waiting/waiting.routes.ts", import.meta.url), "utf8");
const commerce = readFileSync(new URL("../src/modules/commerce/commerce.service.ts", import.meta.url), "utf8");
const storefront = readFileSync(new URL("../../Js/dart-storefront.js", import.meta.url), "utf8");
const platform = readFileSync(new URL("../../Js/dart-platform.js", import.meta.url), "utf8");
const profile = readFileSync(new URL("../../profile.html", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../Eye/Dart Eye.html", import.meta.url), "utf8");

describe("Waiting restock reservation contract", () => {
  it("keeps Waiting separate from the normal 15-minute cart until customer confirmation", () => {
    expect(migration).toContain("source IN ('cart','waitlist')");
    expect(commerce).toContain("source='cart'");
    expect(commerce).toContain("dart.skip_waitlist_allocation");
    expect(service).toContain("SET source='cart'");
    expect(service).toContain("SET status='cart'");
  });

  it("uses FIFO by default but supports audited priority overrides", () => {
    expect(migration).toContain("priority_override DESC, requested_at, id");
    expect(migration).toContain("waitlist_priority_seq");
    expect(routes).toContain('"waiting.priority_override"');
    expect(service).toContain("WAITLIST_PRIORITY_MOVED_TOP");
  });

  it("reserves exact color first and only then offers an allowed alternative", () => {
    const exact = migration.indexOf("desired_color=v_item.color");
    const alternative = migration.indexOf("desired_color<>v_item.color");
    expect(exact).toBeGreaterThan(-1);
    expect(alternative).toBeGreaterThan(exact);
    expect(migration).toContain("alternativeColorsEnabled");
    expect(service).toContain("WAITLIST_ALTERNATIVE_DECLINED");
  });

  it("exposes customer self-service and permission-controlled admin actions", () => {
    expect(routes).toContain('"/me/waiting"');
    expect(routes).toContain('"/me/waiting/:entryId/confirm"');
    expect(routes).toContain('"/me/waiting/:entryId/decline-alternative"');
    expect(routes).toContain('"/admin/waiting/:entryId/action"');
    for (const permission of [
      "waiting.cancel","waiting.release","waiting.extend","waiting.edit",
      "waiting.offer_alternative","waiting.resend","waiting.priority_override",
      "waiting.reassign","waiting.audit_read",
    ]) expect(routes).toContain(permission);
  });

  it("lets customers select unavailable variants and manage My Waiting", () => {
    expect(storefront).toContain("is-unavailable");
    expect(storefront).toContain("Notify me when available");
    expect(platform).toContain("joinWaiting");
    expect(platform).toContain("cancelWaiting");
    expect(platform).toContain("confirmWaiting");
    expect(profile).toContain("My Waiting");
    expect(profile).toContain("profileWaitingList");
  });

  it("provides Waiting Queue, Demand, search and settings in Dart Eye", () => {
    expect(dashboard).toContain('data-target="waiting"');
    expect(dashboard).toContain('id="waiting-search"');
    expect(dashboard).toContain('data-waiting-view="queue"');
    expect(dashboard).toContain('data-waiting-view="demand"');
    expect(dashboard).toContain('id="settings-waiting-hours"');
  });

  it("converts confirmed Waiting demand when the final order is created", () => {
    expect(commerce).toContain("WAITLIST_CONVERTED_TO_ORDER");
    expect(commerce).toContain("converted_order_code");
    expect(commerce).toContain("fallbackMatch: true");
  });
});