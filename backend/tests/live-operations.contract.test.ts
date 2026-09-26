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

const dashboardLiveMap = readFileSync(
  new URL("../../Eye/dart-live-operations.js", import.meta.url),
  "utf8",
);
const dashboardLiveCss = readFileSync(
  new URL("../../Eye/dart-live-operations.css", import.meta.url),
  "utf8",
);
const dashboardHtml = readFileSync(
  new URL("../../Eye/Dart Eye.html", import.meta.url),
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
  it("uses the authenticated dashboard API client for live operations", () => {
    expect(dashboardLiveMap).toContain("window.DartAdminApi.request");
    expect(dashboardLiveMap).not.toContain("window.DartApi.request");
    expect(dashboardLiveMap).toContain('api("/api/v1/admin/live-operations")');
  });

  it("keeps the live panel closed across polling and renders a real connected road route", () => {
    expect(dashboardLiveMap).toContain("let panelOpen = false");
    expect(dashboardLiveMap).toContain("if (panelOpen && selectedOrderId)");
    expect(dashboardLiveMap).toContain("overview=full&geometries=geojson");
    expect(dashboardLiveMap).toContain("window.L.polyline(geometry");
  });

  it("builds adaptive routes from the current stop and live representative location", () => {
    expect(service).toContain("adaptiveSuggestedStopOrder");
    expect(service).toContain('stop.routeState === "current"');
    expect(dashboardLiveMap).toContain("adaptiveRouteStops(rep)");
    expect(dashboardLiveMap).toContain("nearestStops(orderCoordinates(current), remaining)");
    expect(dashboardLiveMap).toContain("cached?.signature === signature");
    expect(dashboardLiveMap).not.toContain("window.L.polyline(coordinates");
  });

  it("exposes independent Reps and Orders layers with unassigned and delivered order pins", () => {
    expect(dashboardHtml).toContain('data-live-layer="reps"');
    expect(dashboardHtml).toContain('data-live-layer="orders"');
    expect(dashboardLiveMap).toContain("snapshot.orders || []");
    expect(dashboardLiveMap).toContain('isUnassigned ? "#111111"');
    expect(dashboardLiveMap).toContain('state === "delivered" ? COLORS.delivered');
    expect(dashboardLiveMap).toContain("Assigned Rep:");
    expect(service).toContain("orders: Record<string, unknown>[];");
    expect(service).toContain("o.status NOT IN ('Refused','Cancelled','Returned')");
  });

  it("honors saved route order without overriding the current delivery", () => {
    expect(service).toContain("COALESCE(drs.manually_ordered, false) AS manually_ordered");
    expect(service).toContain("manuallyOrdered: Boolean(order.manually_ordered)");
    expect(dashboardLiveMap).toContain("function plannedStops(startPoint, stops)");
    expect(dashboardLiveMap).toContain("order.manuallyOrdered && Number(order.sequenceNumber || 0) > 0");
    expect(dashboardLiveMap).toContain("return [current, ...plannedStops(orderCoordinates(current), remaining)]");
  });

  it("refreshes order-pin assignment handlers and filters fit bounds consistently", () => {
    expect(dashboardLiveMap).toContain("marker.__dartOrderClickHandler");
    expect(dashboardLiveMap).toContain('marker.off("click", marker.__dartOrderClickHandler)');
    const boundsStart = dashboardLiveMap.indexOf("function allBoundsPoints()");
    const boundsEnd = dashboardLiveMap.indexOf("function fitMap", boundsStart);
    expect(dashboardLiveMap.slice(boundsStart, boundsEnd)).toContain("if (!filterEnabled(order.routeState)) continue;");
  });

  it("counts map-eligible orders even when a pin has no coordinates", () => {
    expect(service).toContain("totalOrders: mapOrdersResult.rows.length");
    expect(service).toContain('order.status === "Delivered"');
    expect(service).toContain('order.status === "Representative On The Way"');
  });

  it("reorders every non-terminal assigned order and keeps route controls readable", () => {
    expect(service).toContain("status NOT IN ('Delivered','Cancelled','Refused','Returned')");
    expect(dashboardLiveMap).toContain("activeRouteOrders(rep)");
    expect(dashboardLiveCss).toContain("overflow-x:hidden");
    expect(dashboardLiveCss).toContain("color:#AB012B!important");
    expect(dashboardLiveCss).toContain("color:#111!important");
  });

});
