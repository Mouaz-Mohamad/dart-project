// DART CODE GUIDE | backend/tests/finance-report.routes.test.ts
// Finance report HTTP tests: real authentication/permission middleware with synthetic services.
import pino from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import type { AppConfig } from "../src/config/env.js";
import type { FinanceRange, FinanceService, FinanceSummary } from "../src/modules/finance/finance.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";

const config = {
  nodeEnv: "test", port: 4000, databaseUrl: "postgresql://unused", databaseSsl: false,
  databasePoolMax: 1, corsOrigins: ["http://localhost:4173"], trustProxyHops: 0,
  rateLimitWindowMs: 60000, rateLimitMax: 100, logLevel: "silent", allowDevelopmentSeed: false,
  authPepper: "finance-report-fixture-pepper-at-least-32-characters",
  sessionCookieName: "dart_session", sessionCookieSameSite: "strict", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 5), emailProvider: "disabled",
  smtpHost: null, smtpPort: 587, smtpSecure: false, smtpUser: null, smtpPass: null,
  emailFrom: null, outboxCronSecret: null, outboxBatchSize: 20,
} as AppConfig;
const cookie = `dart_session=123e4567-e89b-12d3-a456-426614174100.${"a".repeat(43)}`;
const query = { start: "2026-10-01", end: "2026-10-31", previousStart: "2026-09-01", previousEnd: "2026-09-30" };

function application(permissions: string[], options: { accountType?: "staff" | "customer"; mfaSatisfied?: boolean } = {}) {
  const account = {
    userId: "123e4567-e89b-12d3-a456-426614174101", accountType: options.accountType ?? "staff",
    status: "active", email: "fixture@example.invalid", emailVerified: true, mustChangePassword: false,
    sessionId: "123e4567-e89b-12d3-a456-426614174100",
    sessionFamilyId: "123e4567-e89b-12d3-a456-426614174102", csrfTokenHash: "unused",
    mfaRequired: true, mfaSatisfied: options.mfaSatisfied ?? true, permissions,
  } as AuthenticatedAccount;
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const summaries = vi.fn(async (ranges: FinanceRange[]) => ranges.map(() => ({
    netRevenue: 900, operatingExpenses: 40, brandTotalCost: 400, netProfit: 500,
    brandNetProfit: 500, cashIn: 900, physicalItemCost: 360, marketing: { spend: 20 },
  } as FinanceSummary)));
  const brandDetails = vi.fn().mockResolvedValue({ rows: [], totals: { amountMinor: 0 } });
  const finance = { summaries, summary: vi.fn(), brandDetails } as unknown as FinanceService;
  return { summaries, brandDetails, app: createApp(config, { identityService: identity, financeService: finance,
    logger: pino({ level: "silent" }), databasePing: async () => undefined, startedAt: new Date(), version: "fixture" }) };
}

describe("combined finance report", () => {
  it("authorizes Brand metrics independently and requires both contributors before opening profit", async () => {
    for (const fixture of [
      { permissions: ["finance.view_revenue"], metric: "sales", status: 200 },
      { permissions: ["finance.view_revenue"], metric: "cost", status: 403 },
      { permissions: ["finance.view_profit"], metric: "profit", status: 403 },
      { permissions: ["finance.view_profit", "finance.view_cost", "finance.view_revenue"], metric: "profit", status: 200 },
      { permissions: ["catalog.read"], metric: "stockCost", status: 403 },
      { permissions: ["catalog.read"], metric: "stockSelling", status: 200 },
      { permissions: ["finance.view_inventory_value"], metric: "damage", status: 200 },
      { permissions: [], metric: "models", status: 403 },
    ]) {
      const { app, brandDetails } = application(fixture.permissions);
      const response = await request(app).get(`/api/v1/admin/finance/brand-details/${fixture.metric}`)
        .query({ start: query.start, end: query.end }).set("Cookie", cookie);
      expect(response.status).toBe(fixture.status);
      expect(brandDetails.mock.calls).toHaveLength(fixture.status === 200 ? 1 : 0);
      if (fixture.status === 200) expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("validates Brand pagination, date bounds, sessions, MFA and Waiting visibility", async () => {
    const fixture = application(["finance.read", "waiting.view"]);
    const path = "/api/v1/admin/finance/brand-details/models";
    await request(fixture.app).get(path).query({ start: query.start, end: query.end, page: 2, limit: 50 }).set("Cookie", cookie).expect(200);
    expect(fixture.brandDetails).toHaveBeenCalledWith("models", query.start, query.end, 2, 50, { costs: true, waiting: true, sales: true });
    for (const patch of [{ page: 0 }, { limit: 101 }, { start: "bad" }, { end: "2020-01-01" }]) {
      await request(fixture.app).get(path).query({ start: query.start, end: query.end, ...patch }).set("Cookie", cookie).expect(422);
    }
    await request(fixture.app).get(path).query(query).expect(401);
    for (const options of [{ mfaSatisfied: false }, { accountType: "customer" as const }]) {
      const forbidden = application(["finance.read"], options);
      await request(forbidden.app).get(path).query(query).set("Cookie", cookie).expect(403);
      expect(forbidden.brandDetails).not.toHaveBeenCalled();
    }
  });

  it("returns all requested periods from one service call while exposing only allowed cost fields", async () => {
    const { app, summaries } = application(["finance.view_cost"]);
    const response = await request(app).get("/api/v1/admin/finance/report").query(query).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.allowedSections).toEqual(["cost"]);
    expect(summaries).toHaveBeenCalledOnce();
    expect(response.body.periods.length).toBeGreaterThan(2);
    expect(response.body.periods.length).toBeLessThanOrEqual(14);
    for (const period of response.body.periods) {
      expect(period.summary.operatingExpenses).toBe(40);
      expect(period.summary).not.toHaveProperty("netRevenue");
      expect(period.summary).not.toHaveProperty("netProfit");
      expect(period.summary).not.toHaveProperty("cashIn");
      expect(period.summary).not.toHaveProperty("marketing");
    }
  });

  it("preserves legacy complete-view permissions and supports a report without chart buckets", async () => {
    const { app, summaries } = application(["finance.read"]);
    const response = await request(app).get("/api/v1/admin/finance/report").query({ ...query, buckets: 0 }).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.allowedSections).toHaveLength(6);
    expect(response.body.periods).toHaveLength(2);
    expect(response.body.periods[0].summary).toMatchObject({ netRevenue: 900, netProfit: 500, brandTotalCost: 400 });
    expect(summaries).toHaveBeenCalledWith([
      { start: query.start, end: query.end }, { start: query.previousStart, end: query.previousEnd },
    ]);
  });

  it("unions multiple granular views without including any other section", async () => {
    const { app } = application(["finance.view_cost", "finance.view_profit"]);
    const response = await request(app).get("/api/v1/admin/finance/report").query(query).set("Cookie", cookie);
    expect(response.body.allowedSections).toEqual(["cost", "profit"]);
    expect(response.body.periods[0].summary).toMatchObject({ operatingExpenses: 40, netProfit: 500 });
    expect(response.body.periods[0].summary).not.toHaveProperty("netRevenue");
    expect(response.body.periods[0].summary).not.toHaveProperty("physicalItemCost");
  });

  it("denies missing sessions, unrelated permissions, customer accounts and unsatisfied MFA before reading finance", async () => {
    for (const options of [
      { permissions: ["dashboard_state.read"] },
      { permissions: ["finance.read"], accountType: "customer" as const },
      { permissions: ["finance.read"], mfaSatisfied: false },
    ]) {
      const { app, summaries } = application(options.permissions, options);
      const response = await request(app).get("/api/v1/admin/finance/report").query(query).set("Cookie", cookie);
      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty("periods");
      expect(summaries).not.toHaveBeenCalled();
    }
    const { app, summaries } = application(["finance.read"]);
    expect((await request(app).get("/api/v1/admin/finance/report").query(query)).status).toBe(401);
    expect(summaries).not.toHaveBeenCalled();
  });

  it("rejects malformed, reversed, oversized and unbounded report inputs without issuing a database read", async () => {
    for (const patch of [{ end: "not-a-date" }, { buckets: 13 }, { previousEnd: "2026-08-01" },
      { start: "2026-11-01" }, { start: "2000-01-01" },
      { previousStart: "2000-01-01", previousEnd: "2000-01-02" }]) {
      const { app, summaries } = application(["finance.read"]);
      const response = await request(app).get("/api/v1/admin/finance/report").query({ ...query, ...patch }).set("Cookie", cookie);
      expect(response.status).toBe(422);
      expect(summaries).not.toHaveBeenCalled();
    }
  });
});
