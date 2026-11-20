import pino from "pino";
import request from "supertest";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createApp, isPublicReadRateLimitPath } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import type { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { registerSharedRateLimits } from "../src/security/shared-rate-limit.js";

describe("public read limits without database amplification", () => {
  it("limits the exception to exact anonymous GET/HEAD paths", () => {
    for (const path of ["/api/v1/catalog", "/api/v1/catalog/version", "/api/v1/site-settings", "/api/v1/sets", "/api/v1/sets/settings", "/api/v1/reviews"]) {
      expect(isPublicReadRateLimitPath("GET", path)).toBe(true);
      expect(isPublicReadRateLimitPath("HEAD", path)).toBe(true);
      expect(isPublicReadRateLimitPath("POST", path)).toBe(false);
      expect(isPublicReadRateLimitPath("PATCH", path)).toBe(false);
    }
    for (const path of ["/api/v1/admin/catalog-state", "/api/v1/auth/login", "/api/v1/guest/orders", "/api/v1/cart/reservation", "/api/v1/catalog/assets/image", "/api/v1/catalog/malicious"]) {
      expect(isPublicReadRateLimitPath("GET", path)).toBe(false);
    }
  });
  it("uses local limits for public reads while protected mutations still hit PostgreSQL", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused/test", RATE_LIMIT_MAX: "2", RATE_LIMIT_STORE: "postgres", LOG_LEVEL: "silent" });
    const dbQuery = vi.fn().mockResolvedValue({ rows: [{ hits: "1", expires_at: new Date(Date.now() + 60_000) }] });
    registerSharedRateLimits(config, { query: dbQuery } as unknown as Pool, config.authPepper);
    const catalog = { version: vi.fn().mockResolvedValue(1), publicCatalog: vi.fn().mockResolvedValue({ version: 1, models: [], stock: {} }) };
    const app = createApp(config, { catalogService: catalog as unknown as CatalogService, logger: pino({ level: "silent" }), startedAt: new Date(), version: "test" });
    expect((await request(app).get("/api/v1/catalog/version")).status).toBe(200);
    expect((await request(app).get("/api/v1/catalog")).status).toBe(200);
    const denied = await request(app).get("/api/v1/catalog/version");
    expect(denied.status).toBe(429);
    expect(denied.body.error.code).toBe("RATE_LIMITED");
    expect(dbQuery).not.toHaveBeenCalled();
    await request(app).post("/api/v1/unknown").send({});
    expect(dbQuery).toHaveBeenCalledTimes(1);
  });
});
