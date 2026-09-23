import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  new URL("../src/modules/commerce/commerce.service.ts", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../src/modules/commerce/commerce.routes.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../migrations/0038_live_operations.sql", import.meta.url),
  "utf8",
);

describe("live operations contracts", () => {
  it("enforces one current delivery stop per representative", () => {
    expect(migration).toContain("delivery_route_one_current_per_representative");
    expect(migration).toContain("WHERE route_state='current'");
  });

  it("registers dedicated live-map permissions", () => {
    for (const permission of [
      "live_map.read",
      "live_map.manage",
      "representative_location.read",
    ]) {
      expect(migration).toContain(permission);
    }
  });

  it("exposes protected admin live operations endpoints", () => {
    expect(routes).toContain('"/admin/live-operations"');
    expect(routes).toContain('"live_map.read"');
    expect(routes).toContain('"live_map.manage"');
    expect(routes).toContain('"/admin/live-operations/orders/:orderRef/state"');
    expect(routes).toContain('"/admin/live-operations/representatives/:representativeId/reorder"');
  });

  it("supports representative waiting and problem actions", () => {
    expect(routes).toContain('z.enum(["start", "cancel", "delivered", "waiting", "problem"])');
    expect(service).toContain('"start" | "cancel" | "delivered" | "waiting" | "problem"');
    expect(service).toContain("DELIVERY_ROUTE_SWITCHED");
  });

  it("keeps GPS writes within the approved three-second budget", () => {
    const locationRoute = routes.indexOf('"/representatives/location"');
    expect(locationRoute).toBeGreaterThan(-1);
    expect(routes.slice(locationRoute, locationRoute + 280)).toContain("limit: 30");
  });

  it("derives the four owner-facing live totals on the server", () => {
    expect(service).toContain("totalOrders");
    expect(service).toContain("deliveredOrders");
    expect(service).toContain("deliveringNow");
    expect(service).toContain("activeRepresentatives");
  });

  it("audits manual live state and route-order changes", () => {
    expect(service).toContain("LIVE_ROUTE_STATE_CHANGED");
    expect(service).toContain("LIVE_ROUTE_REORDERED");
  });
});
