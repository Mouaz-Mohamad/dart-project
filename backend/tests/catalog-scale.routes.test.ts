import { randomUUID } from "node:crypto";
import request from "supertest";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { CatalogService } from "../src/modules/catalog/catalog.service.js";

const sessionId = randomUUID(), csrf = "c".repeat(43);
const cookie = `dart_session_staff=${sessionId}.${"b".repeat(43)}; dart_staff_csrf=${csrf}`;
function application(options: { permissions?: string[]; mfaSatisfied?: boolean; accountType?: "staff" | "customer" } = {}) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused/test", LOG_LEVEL: "silent" });
  const account: AuthenticatedAccount = { userId: randomUUID(), accountType: options.accountType ?? "staff", status: "active",
    email: "catalogue@example.test", emailVerified: true, mustChangePassword: false, sessionId,
    sessionFamilyId: randomUUID(), csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
    mfaRequired: true, mfaSatisfied: options.mfaSatisfied ?? true, permissions: options.permissions ?? ["catalog.read", "catalog.edit"] };
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const service = { publicCatalog: vi.fn().mockResolvedValue({ version: 1, models: [], stock: {} }),
    adminState: vi.fn().mockResolvedValue({ version: 1, models: [], items: [] }),
    replaceState: vi.fn().mockResolvedValue({ version: 2, models: [], items: [] }) };
  const app = createApp(config, { identityService: identity, catalogService: service as unknown as CatalogService,
    logger: pino({ level: "silent" }), databasePing: async () => undefined, startedAt: new Date(), version: "fixture" });
  return { app, service };
}
const body = { expectedVersion: 1, models: [], items: [{ id: "I-1", modelId: "M-1" }], recordVersions: { models: {}, items: { "I-1": 1 } } };

describe("catalogue scale HTTP boundaries", () => {
  it("preserves the legacy response and forwards explicit bounded paging", async () => {
    const { app, service } = application();
    expect((await request(app).get("/api/v1/catalog")).status).toBe(200);
    expect(service.publicCatalog).toHaveBeenLastCalledWith(undefined);
    const response = await request(app).get("/api/v1/catalog").query({ page: 2, limit: 50, q: " shirt ", sort: "price-low" });
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-cache, max-age=0, must-revalidate");
    expect(service.publicCatalog).toHaveBeenLastCalledWith({ page: 2, limit: 50, q: "shirt", sort: "price-low" });
  });
  it("revalidates cached public bytes against current stock and transfers only changes", async () => {
    const { app, service } = application();
    const first = await request(app).get("/api/v1/catalog").query({ page: 1, limit: 100 });
    expect(first.headers.etag).toBeTruthy();
    const etag = String(first.headers.etag);
    const unchanged = await request(app).get("/api/v1/catalog").query({ page: 1, limit: 100 }).set("If-None-Match", etag);
    expect(unchanged.status).toBe(304);
    expect(unchanged.text).toBe("");
    expect(unchanged.headers["cache-control"]).toContain("must-revalidate");
    expect(service.publicCatalog).toHaveBeenCalledTimes(2);
    // Stock can change independently of a model edit: validate the whole public
    // representation, rather than trusting a version-only conditional response.
    service.publicCatalog.mockResolvedValue({ version: 1, models: [], stock: { '["M","Black","L"]': 1 } });
    const changed = await request(app).get("/api/v1/catalog").query({ page: 1, limit: 100 }).set("If-None-Match", etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(first.headers.etag);
    service.publicCatalog.mockResolvedValue(Object.assign({ version: 1, models: [], stock: {} }, { pagination: { page: 2, limit: 100, total: 0 } }));
    const otherPage = await request(app).get("/api/v1/catalog").query({ page: 2, limit: 100 }).set("If-None-Match", etag);
    expect(otherPage.status).toBe(200);
  });
  it("rejects invalid public paging before issuing a catalogue read", async () => {
    for (const query of [{ limit: 201 }, { page: 0 }, { sort: "sql" }, { q: "q".repeat(161) }]) {
      const { app, service } = application();
      const response = await request(app).get("/api/v1/catalog").query(query);
      expect(response.status).toBe(422);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(service.publicCatalog).not.toHaveBeenCalled();
    }
  });
  it("forwards admin paging and rejects unsupported admin filters", async () => {
    const { app, service } = application();
    const response = await request(app).get("/api/v1/admin/catalog-state").query({ page: 3, limit: 20 }).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(service.adminState).toHaveBeenCalledWith({ page: { page: 3, limit: 20 } });
    service.adminState.mockClear();
    expect((await request(app).get("/api/v1/admin/catalog-state").query({ sort: "name" }).set("Cookie", cookie)).status).toBe(422);
    expect(service.adminState).not.toHaveBeenCalled();
  });
  it("requires a valid session, Staff permissions and satisfied MFA before a patch", async () => {
    for (const options of [{ permissions: ["catalog.read"] }, { mfaSatisfied: false }, { accountType: "customer" as const }]) {
      const { app, service } = application(options);
      expect((await request(app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(body)).status).toBe(403);
      expect(service.replaceState).not.toHaveBeenCalled();
    }
    const { app, service } = application();
    expect((await request(app).patch("/api/v1/admin/catalog-state").send(body)).status).toBe(401);
    expect(service.replaceState).not.toHaveBeenCalled();
  });
  it("requires CSRF and bounds the changed-record payload before writing", async () => {
    const { app, service } = application();
    expect((await request(app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).send(body)).status).toBe(403);
    for (const patch of [{ models: [], items: [] }, { models: Array.from({ length: 501 }, () => ({})) }, { recordVersions: { models: {}, items: { "I-1": -1 } } }]) {
      expect((await request(app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ ...body, ...patch })).status).toBe(422);
    }
    expect(service.replaceState).not.toHaveBeenCalled();
  });
  it("writes only the supplied rows through the versioned service", async () => {
    const { app, service } = application();
    expect((await request(app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(body)).status).toBe(200);
    expect(service.replaceState).toHaveBeenCalledWith(1, [], body.items, expect.any(String), expect.any(String), body.recordVersions, false);
  });
});
