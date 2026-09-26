// DART CODE GUIDE | backend/tests/traffic-analytics.test.ts
// الغرض: حماية تجميع Traffic Analytics وحدود الخصوصية وربط الـfunnel بقاعدة البيانات.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHourlyTrafficSeries, buildTrafficSeries } from "../src/modules/analytics/traffic-analytics.service.js";

const serviceSource = readFileSync(
  new URL("../src/modules/analytics/traffic-analytics.service.ts", import.meta.url),
  "utf8",
);
const routesSource = readFileSync(
  new URL("../src/modules/analytics/traffic-analytics.routes.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0046_traffic_analytics.sql", import.meta.url),
  "utf8",
);
const storefrontSource = readFileSync(
  new URL("../../Js/dart-platform.js", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../Eye/dart-traffic-analytics.js", import.meta.url),
  "utf8",
);
const queryIndexMigrationSource = readFileSync(
  new URL("../migrations/0047_traffic_analytics_query_indexes.sql", import.meta.url),
  "utf8",
);

const grouped = [
  { key: "2026-09-01", uniqueVisitors: 2, visits: 3, addToCartVisitors: 1, addToCartEvents: 2, itemsAdded: 4, orders: 1, orderedPieces: 2 },
  { key: "2026-09-02", uniqueVisitors: 4, visits: 5, addToCartVisitors: 1, addToCartEvents: 1, itemsAdded: 1, orders: 0, orderedPieces: 0 },
  { key: "2026-09-08", uniqueVisitors: 5, visits: 7, addToCartVisitors: 2, addToCartEvents: 3, itemsAdded: 5, orders: 2, orderedPieces: 3 },
];

describe("traffic analytics", () => {
  it("keeps the general range fixed while changing only aggregation", () => {
    const days = buildTrafficSeries(grouped, "2026-09-01", "2026-09-08", "daily");
    expect(days).toHaveLength(8);
    expect(days[0]).toMatchObject({ uniqueVisitors: 2, visits: 3, addToCartVisitors: 1, orderedPieces: 2 });
    expect(days[2]).toMatchObject({ uniqueVisitors: 0, visits: 0, addToCartVisitors: 0, orderedPieces: 0 });

    const weeklyRows = [
      { key: "week-1", uniqueVisitors: 5, visits: 8, addToCartVisitors: 2, addToCartEvents: 3, itemsAdded: 5, orders: 1, orderedPieces: 2 },
      { key: "week-2", uniqueVisitors: 5, visits: 7, addToCartVisitors: 2, addToCartEvents: 3, itemsAdded: 5, orders: 2, orderedPieces: 3 },
    ];
    const weeks = buildTrafficSeries(weeklyRows, "2026-09-01", "2026-09-08", "weekly");
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ uniqueVisitors: 5, visits: 8, addToCartVisitors: 2, orderedPieces: 2 });
    expect(weeks[1]).toMatchObject({ uniqueVisitors: 5, visits: 7, addToCartVisitors: 2, orderedPieces: 3 });
  });

  it("builds a complete 24-hour Cairo audience pattern", () => {
    const hours = buildHourlyTrafficSeries([
      { hour: 18, uniqueVisitors: 12, visits: 17, addToCartVisitors: 5, addEvents: 7, itemsAdded: 9, orders: 2, orderedPieces: 3 },
      { hour: 21, uniqueVisitors: 20, visits: 28, addToCartVisitors: 8, addEvents: 11, itemsAdded: 14, orders: 4, orderedPieces: 6 },
    ]);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toMatchObject({ key: "hour-00", label: "12 AM", uniqueVisitors: 0, addToCartVisitors: 0 });
    expect(hours[18]).toMatchObject({ key: "hour-18", label: "6 PM", uniqueVisitors: 12, visits: 17, addToCartVisitors: 5, orders: 2 });
    expect(hours[21]).toMatchObject({ key: "hour-21", label: "9 PM", uniqueVisitors: 20, addToCartVisitors: 8, orders: 4, orderedPieces: 6 });
    expect(routesSource).toContain('["hourly", "daily", "weekly", "monthly", "yearly"]');
    expect(serviceSource).toContain("EXTRACT(HOUR FROM event.occurred_at AT TIME ZONE 'Africa/Cairo')");
    expect(serviceSource).toContain("orders.order_source='Website'");
    expect(serviceSource).toContain("count(order_items.id)::text AS ordered_pieces");
  });

  it("uses PostgreSQL, explicit visitor/session IDs and no IP analytics storage", () => {
    expect(migrationSource).toContain("CREATE TABLE traffic_analytics_events");
    expect(migrationSource).toContain("visitor_id UUID NOT NULL");
    expect(migrationSource).toContain("session_id UUID NOT NULL");
    expect(migrationSource).not.toMatch(/ip_address|ip_hash|user_agent/i);
    expect(serviceSource).toContain("INSERT INTO traffic_analytics_events");
    expect(serviceSource).toContain("FROM cart_reservations reservation");
    expect(serviceSource).toContain("items.cart_reservation_id=reservation.id");
    expect(serviceSource).toContain("COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)");
    expect(serviceSource).toContain("WHERE visitor_id=$1::uuid");
    expect(serviceSource).toContain("Guest ${row.visitor_id.slice(0, 8)}");
  });

  it("refreshes sessions on activity and renders a real hourly empty state", () => {
    expect(storefrontSource).toContain("function ensureAnalyticsSession()");
    expect(storefrontSource).toContain('session.started && eventType !== "visit"');
    expect(storefrontSource).not.toContain('trackAnalyticsEvent("order_completed"');
    expect(routesSource).not.toContain('z.enum(["visit", "add_to_cart", "order_completed"])');
    expect(dashboardSource).toContain("No hourly audience activity was recorded in this window.");
    expect(dashboardSource).toContain('datasets[2].label = "Ordered Pieces"');
  });

  it("requires staff analytics permission and enforces signed-in or guest cart ownership", () => {
    expect(routesSource).toContain('requirePermission("analytics.read")');
    expect(routesSource).toContain('router.post("/analytics/events"');
    expect(routesSource).toContain('"/admin/analytics/traffic"');
    expect(routesSource).toContain("hashGuestCartToken");
    expect(serviceSource).toContain("This guest cart reservation does not belong to this browser");
    expect(serviceSource).toContain("row.customer_user_id !== customerUserId");
    expect(serviceSource).not.toContain('eventType === "order_completed"');
    expect(serviceSource).toContain("count(DISTINCT orders.id)::text AS orders");
    expect(routesSource).toContain("analyticsEventLimiter");
  });

  it("caps hourly analytics, clears stale dashboard data and indexes website order time queries", () => {
    expect(serviceSource).toContain('group === "hourly" && spanDays > 31');
    expect(dashboardSource).toContain("function renderTrafficErrorTow(message)");
    expect(dashboardSource).toContain('trafficAggregationTow !== "hourly"');
    expect(dashboardSource).toContain("audienceRows");
    expect(queryIndexMigrationSource).toContain("orders_website_created_idx");
    expect(queryIndexMigrationSource).toContain("order_source='Website'");
  });
});
