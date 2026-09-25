// DART CODE GUIDE | backend/tests/traffic-analytics.test.ts
// الغرض: حماية تجميع Traffic Analytics وحدود الخصوصية وربط الـfunnel بقاعدة البيانات.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTrafficSeries } from "../src/modules/analytics/traffic-analytics.service.js";

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

const daily = [
  { day: "2026-09-01", visits: 3, addEvents: 2, itemsAdded: 4, orders: 1 },
  { day: "2026-09-02", visits: 5, addEvents: 1, itemsAdded: 1, orders: 0 },
  { day: "2026-09-08", visits: 7, addEvents: 3, itemsAdded: 5, orders: 2 },
];

describe("traffic analytics", () => {
  it("keeps the general range fixed while changing only aggregation", () => {
    const days = buildTrafficSeries(daily, "2026-09-01", "2026-09-08", "daily");
    expect(days).toHaveLength(8);
    expect(days[0]).toMatchObject({ visits: 3, addToCartEvents: 2, orders: 1 });
    expect(days[2]).toMatchObject({ visits: 0, addToCartEvents: 0, orders: 0 });

    const weeks = buildTrafficSeries(daily, "2026-09-01", "2026-09-08", "weekly");
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ visits: 8, addToCartEvents: 3, itemsAdded: 5, orders: 1 });
    expect(weeks[1]).toMatchObject({ visits: 7, addToCartEvents: 3, itemsAdded: 5, orders: 2 });

    const months = buildTrafficSeries(daily, "2026-09-01", "2026-09-08", "monthly");
    expect(months).toEqual([
      expect.objectContaining({ key: "2026-09", visits: 15, addToCartEvents: 6, itemsAdded: 10, orders: 3 }),
    ]);

    const years = buildTrafficSeries(daily, "2026-09-01", "2026-09-08", "yearly");
    expect(years).toEqual([
      expect.objectContaining({ key: "2026", visits: 15, addToCartEvents: 6, itemsAdded: 10, orders: 3 }),
    ]);
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

  it("requires staff analytics permission and validates order ownership", () => {
    expect(routesSource).toContain('requirePermission("analytics.read")');
    expect(routesSource).toContain('router.post("/analytics/events"');
    expect(routesSource).toContain('"/admin/analytics/traffic"');
    expect(serviceSource).toContain("This order does not belong to the signed-in customer");
    expect(serviceSource).toContain('eventType === "order_completed"');
  });
});
