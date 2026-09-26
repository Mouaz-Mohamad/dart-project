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
const roadRoutingProvider = readFileSync(
  new URL("../src/modules/commerce/road-routing-provider.ts", import.meta.url),
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

  it("keeps the live panel closed across polling and resolves real road routes through the backend adapter", () => {
    expect(dashboardLiveMap).toContain("let panelOpen = false");
    expect(dashboardLiveMap).toContain("if (panelOpen && selectedOrderId)");
    expect(dashboardLiveMap).toContain('api("/api/v1/admin/live-operations/route"');
    expect(dashboardLiveMap).not.toContain("router.project-osrm.org");
    expect(routes).toContain('"/admin/live-operations/route"');
    expect(roadRoutingProvider).toContain("/route/v1/driving/");
    expect(roadRoutingProvider).toContain('url.searchParams.set("steps", "true")');
  });

  it("builds adaptive routes from every assigned active stop regardless of UI visibility filters", () => {
    expect(service).toContain("adaptiveSuggestedStopOrder");
    expect(service).toContain('stop.routeState === "current"');
    expect(dashboardLiveMap).toContain("adaptiveRouteStops(rep)");
    expect(dashboardLiveMap).toContain("plannedStops(orderCoordinates(current), remaining)");
    const adaptiveStart = dashboardLiveMap.indexOf("function adaptiveRouteStops(rep)");
    const adaptiveEnd = dashboardLiveMap.indexOf("function routeCoordinates", adaptiveStart);
    expect(dashboardLiveMap.slice(adaptiveStart, adaptiveEnd)).not.toContain("filterEnabled");
    expect(dashboardLiveMap).toContain("cached?.signature === signature");
  });

  it("makes Reps own assigned order pins while Orders contains only unassigned pins", () => {
    expect(dashboardHtml).toContain('data-live-layer="reps"');
    expect(dashboardHtml).toContain('data-live-layer="orders"');
    expect(dashboardLiveMap).toContain("for (const order of rep.orders || [])");
    expect(dashboardLiveMap).toContain("if (order.assigned !== false || order.representativeId) continue;");
    expect(dashboardLiveMap).toContain("COLORS.orderPin");
    expect(dashboardLiveMap).toContain("const color = COLORS.orderPin");
    expect(dashboardLiveMap).toContain("Assigned Rep:");
    expect(service).toContain(".filter((order) => !order.representative_user_id)");
    expect(service).toContain("orders: Record<string, unknown>[];");
  });

  it("honors saved route order without overriding the current delivery", () => {
    expect(service).toContain("COALESCE(drs.manually_ordered, false) AS manually_ordered");
    expect(service).toContain("manuallyOrdered: Boolean(order.manually_ordered)");
    expect(dashboardLiveMap).toContain("function plannedStops(startPoint, stops)");
    expect(dashboardLiveMap).toContain("order.manuallyOrdered && Number(order.sequenceNumber || 0) > 0");
    expect(dashboardLiveMap).toContain("return [current, ...plannedStops(orderCoordinates(current), remaining)]");
  });

  it("keeps Leaflet road rendering independent from the dashboard global canvas reset", () => {
    expect(dashboardLiveMap).toContain("preferCanvas: false");
    expect(dashboardLiveMap).not.toContain("preferCanvas: true");
    expect(dashboardLiveCss).toContain("#dart-live-operations-map .leaflet-pane > canvas{max-width:none!important;max-height:none!important}");
  });

  it("keeps Orders independent from assigned-status filters and protects layer ownership", () => {
    expect(dashboardLiveMap).toContain("marker.__dartOrderClickHandler");
    expect(dashboardLiveMap).toContain('marker.off("click", marker.__dartOrderClickHandler)');
    expect(dashboardLiveMap).toContain("let assignedOrderMarkers = new Map()");
    expect(dashboardLiveMap).toContain("let unassignedOrderMarkers = new Map()");
    expect(dashboardLiveMap).not.toContain("let orderMarkers = new Map()");

    const boundsStart = dashboardLiveMap.indexOf("function allBoundsPoints()");
    const boundsEnd = dashboardLiveMap.indexOf("function fitMap", boundsStart);
    const boundsBlock = dashboardLiveMap.slice(boundsStart, boundsEnd);
    const boundsOrdersStart = boundsBlock.indexOf('if (layerEnabled("orders"))');
    const boundsOrdersBlock = boundsBlock.slice(boundsOrdersStart);
    expect(boundsBlock.slice(0, boundsOrdersStart)).toContain("if (!filterEnabled(order.routeState)) continue;");
    expect(boundsOrdersBlock).toContain("if (order.assigned !== false || order.representativeId) continue;");
    expect(boundsOrdersBlock).not.toContain("filterEnabled(order.routeState)");

    const markersStart = dashboardLiveMap.indexOf("function renderMarkers()");
    const markersEnd = dashboardLiveMap.indexOf("function renderCards", markersStart);
    const markersBlock = dashboardLiveMap.slice(markersStart, markersEnd);
    const unassignedStart = markersBlock.indexOf('if (layerEnabled("orders"))');
    const unassignedBlock = markersBlock.slice(unassignedStart);
    expect(markersBlock.slice(0, unassignedStart)).toContain("if (!filterEnabled(order.routeState)) continue;");
    expect(unassignedBlock).toContain("unassignedOrderMarkers");
    expect(unassignedBlock).not.toContain("filterEnabled(order.routeState)");
  });

  it("serializes route renders, fetches representative routes concurrently, and keeps prior roads on provider gaps", () => {
    expect(dashboardLiveMap).toContain("let routeRenderRunning = false");
    expect(dashboardLiveMap).toContain("let routeRenderPending = false");
    expect(dashboardLiveMap).toContain("function scheduleRouteRender()");
    expect(dashboardLiveMap).toContain("async function runRouteRenderQueue()");
    expect(dashboardLiveMap).toContain("await Promise.all(candidates.map(async (candidate)");
    expect(dashboardLiveMap).not.toContain("routeRenderVersion");
    expect(dashboardLiveMap).toContain('routeStatusByRep.set(repId, "unavailable")');
    expect(dashboardLiveMap).toContain("keeping the last road route where available");
    expect(dashboardLiveMap).toContain("Road route active");
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
    expect(dashboardLiveMap).toContain('upcoming: "#2563eb"');
    expect(dashboardLiveMap).toContain('orderPin: "#2563eb"');
    expect(dashboardLiveMap).toContain('const color = COLORS.orderPin');
    expect(dashboardLiveMap).toContain('targetStop?.routeState === "current" ? COLORS.current : COLORS.upcoming');
    expect(dashboardLiveMap).toContain("Route Provider Unavailable · live stops are still visible");
  });

});
