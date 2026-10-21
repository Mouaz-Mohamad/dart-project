import { randomUUID } from "node:crypto";
import pino from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { CatalogService } from "../src/modules/catalog/catalog.service.js";
import type { CommerceService } from "../src/modules/commerce/commerce.service.js";
import type { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";

const csrf = "synthetic-staff-csrf-token", sessionId = randomUUID();
const cookie = `dart_session=${sessionId}.${"a".repeat(43)}`;
const point = { lat: 30.0444, lng: 31.2357 };
function snapshot() {
  return { version: 1, responseMode: "delta", baseVersion: 0,
    orders: [{ id: "O-1", courierLocation: point, latitude: 30.1, longitude: 31.1,
      history: [{ courierLocation: point }], finalAmount: 100 }],
    representatives: [{ id: "R-1", location: point, lastLocation: point,
      orders: [{ latitude: 30.2, longitude: 31.2 }] }],
  };
}
function fixture(permissions: string[], type: AuthenticatedAccount["accountType"] = "staff") {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused/test", LOG_LEVEL: "silent" });
  const auth: AuthenticatedAccount = { userId: randomUUID(), accountType: type, status: "active",
    email: "synthetic@example.test", emailVerified: true, mustChangePassword: false, sessionId,
    sessionFamilyId: randomUUID(), csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
    mfaRequired: false, mfaSatisfied: true, permissions };
  const catalog = { adminState: vi.fn().mockResolvedValue({ version: 1, models: [], items: [] }),
    replaceState: vi.fn().mockResolvedValue({ version: 2, models: [], items: [] }) };
  const original = snapshot();
  const commerce = { adminLiveOperations: vi.fn().mockResolvedValue(original),
    adminOrders: vi.fn().mockResolvedValue(original), adminOrderStateAction: vi.fn().mockResolvedValue(original),
    customerLiveTracking: vi.fn().mockResolvedValue(original) };
  const dashboard = { readMany: vi.fn().mockResolvedValue([
    { domain: "representatives", version: 1, data: [{ id: "R-1", location: point, latitude: 30.3 }] },
  ]) };
  const app = createApp(config, { identityService: { authenticate: vi.fn().mockResolvedValue(auth) } as unknown as IdentityService,
    catalogService: catalog as unknown as CatalogService, commerceService: commerce as unknown as CommerceService,
    dashboardStateService: dashboard as unknown as DashboardStateService,
    logger: pino({ level: "silent" }), databasePing: async () => undefined, startedAt: new Date(), version: "test" });
  return { app, catalog, original };
}
const edit = { expectedVersion: 1, models: [], items: [{ id: "I-1", modelId: "M-1" }],
  recordVersions: { models: {}, items: { "I-1": 1 } } };

describe("Staff inventory permission", () => {
  it("loads inventory context with inventory.manage alone", async () => {
    const { app } = fixture(["inventory.manage"]);
    expect((await request(app).get("/api/v1/admin/catalog-state").set("Cookie", cookie)).status).toBe(200);
  });
  it.each(["patch", "put"] as const)("%s patches only explicit item rows and preserves missing models", async method => {
    const { app, catalog } = fixture(["inventory.manage"]);
    const response = await request(app)[method]("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(edit);
    expect(response.status).toBe(200);
    expect(catalog.replaceState).toHaveBeenCalledWith(1, [], edit.items, expect.any(String), expect.any(String), edit.recordVersions);
  });
  it.each(["patch", "put"] as const)("%s refuses model/price edits for inventory-only Staff", async method => {
    const { app, catalog } = fixture(["inventory.manage"]);
    const response = await request(app)[method]("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ ...edit, models: [{ modelId: "M-1", selling: 1 }] });
    expect(response.status).toBe(403); expect(catalog.replaceState).not.toHaveBeenCalled();
  });
  it("refuses a versionless full replacement and keeps read-only grants read-only", async () => {
    const { app, catalog } = fixture(["inventory.manage"]);
    expect((await request(app).put("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ expectedVersion: 1, models: [], items: [] })).status).toBe(422);
    expect(catalog.replaceState).not.toHaveBeenCalled();
    const readOnly = fixture(["catalog.read"]);
    expect((await request(readOnly.app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(edit)).status).toBe(403);
    expect(readOnly.catalog.replaceState).not.toHaveBeenCalled();
  });
});

describe("independent representative location access", () => {
  it("redacts live coordinates but preserves customer-address pins and immutable totals", async () => {
    const { app, original } = fixture(["orders.read"]);
    for (const url of ["/api/v1/admin/live-operations", "/api/v1/admin/orders-state", "/API/v1/ADMIN/live-operations"]) {
      const response = await request(app).get(url).set("Cookie", cookie);
      expect(response.status).toBe(200);
      expect(response.body.representatives[0].location).toBeNull();
      expect(response.body.representatives[0].lastLocation).toBeNull();
      expect(response.body.orders[0]).toMatchObject({ courierLocation: null, latitude: 30.1, longitude: 31.1, finalAmount: 100 });
      expect(response.body.orders[0].history[0].courierLocation).toBeNull();
      expect(response.body.representatives[0].orders[0].latitude).toBe(30.2);
    }
    expect(original.representatives[0]!.location).toEqual(point);
  });
  it("filters versioned mutation responses and representative domain records", async () => {
    const { app } = fixture(["orders.archive", "representatives.manage"]);
    const changed = await request(app).post("/api/v1/admin/orders/O-1/state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ action: "archive" });
    expect(changed.status).toBe(200); expect(changed.body.orders[0].courierLocation).toBeNull();
    expect(changed.body.responseMode).toBe("delta"); expect(changed.body.version).toBe(1);
    const domains = await request(app).get("/api/v1/admin/domain-state").set("Cookie", cookie);
    expect(domains.body.domains[0].data[0]).toMatchObject({ location: null, latitude: null });
  });
  it("retains authorized coordinates without granting unrelated map access", async () => {
    const { app } = fixture(["orders.read", "representative_location.read"]);
    const response = await request(app).get("/api/v1/admin/live-operations").set("Cookie", cookie);
    expect(response.status).toBe(200); expect(response.body.representatives[0].location).toEqual(point);
    const locationOnly = fixture(["representative_location.read"]);
    expect((await request(locationOnly.app).get("/api/v1/admin/live-operations").set("Cookie", cookie)).status).toBe(403);
  });
  it("preserves the existing customer's own delivery tracking", async () => {
    const { app } = fixture([], "customer");
    const response = await request(app).get("/api/v1/me/tracking/live").set("Cookie", cookie);
    expect(response.status).toBe(200); expect(response.body.orders[0].courierLocation).toEqual(point);
  });
});
