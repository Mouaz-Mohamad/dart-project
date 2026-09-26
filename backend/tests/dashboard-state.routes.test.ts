// DART CODE GUIDE | backend/tests/dashboard-state.routes.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readFileSync } from "node:fs";
import pino from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import type { AppConfig } from "../src/config/env.js";
import type { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: "postgresql://unused",
  databaseSsl: false,
  databasePoolMax: 1,
  corsOrigins: ["http://localhost:4173"],
  trustProxyHops: 0,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
  logLevel: "silent",
  allowDevelopmentSeed: false,
  authPepper: "dashboard-route-test-pepper-with-at-least-32-characters",
  sessionCookieName: "dart_session",
  sessionCookieSameSite: "strict",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 6),
  emailProvider: "disabled",
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: null,
  smtpPass: null,
  emailFrom: null,
  outboxCronSecret: null,
  outboxBatchSize: 20,
};

const sessionId = "123e4567-e89b-12d3-a456-426614174100";
const sessionToken = `${sessionId}.${"b".repeat(43)}`;

function staffAccount(permissions: string[]): AuthenticatedAccount {
  return {
    userId: "123e4567-e89b-12d3-a456-426614174101",
    accountType: "staff",
    status: "active",
    email: "staff@example.com",
    emailVerified: true,
    mustChangePassword: false,
    sessionId,
    sessionFamilyId: "123e4567-e89b-12d3-a456-426614174102",
    csrfTokenHash: "unused-for-get",
    mfaRequired: true,
    mfaSatisfied: true,
    permissions,
  };
}

function application(permissions: string[]) {
  const identity = {
    authenticate: vi.fn().mockResolvedValue(staffAccount(permissions)),
  } as unknown as IdentityService;

  const state = {
    read: vi.fn(async (domain: string) => ({
      domain,
      version: 2,
      data: [{ id: `${domain}-1` }],
    })),
    readMany: vi.fn(async (domains: string[]) => domains.map((domain) => ({ domain, version: 2, data: [] }))),
    versions: vi.fn().mockResolvedValue({ contacts: 2, finance_expenses: 4, customers: 7 }),
    publicReviews: vi.fn().mockResolvedValue([]),
    audit: vi.fn().mockResolvedValue([]),
  } as unknown as DashboardStateService;

  return {
    app: createApp(config, {
      databasePing: async () => undefined,
      identityService: identity,
      dashboardStateService: state,
      logger: pino({ level: "silent" }),
      startedAt: new Date("2026-09-21T00:00:00.000Z"),
      version: "test",
    }),
    state,
  };
}

describe("dashboard domain permissions", () => {
  it("blocks contact PII when staff only has the generic dashboard read permission", async () => {
    const { app, state } = application(["dashboard_state.read"]);

    const response = await request(app)
      .get("/api/v1/admin/domain-state/contacts")
      .set("Cookie", `dart_session=${sessionToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(state.read).not.toHaveBeenCalled();
  });

  it("allows contact PII only with the specific contacts.read permission", async () => {
    const { app, state } = application([
      "dashboard_state.read",
      "contacts.read",
    ]);

    const response = await request(app)
      .get("/api/v1/admin/domain-state/contacts")
      .set("Cookie", `dart_session=${sessionToken}`);

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe("contacts");
    expect(state.read).toHaveBeenCalledWith("contacts");
  });

  it("lets a Finance cost viewer read only the Finance domains granted by that permission", async () => {
    const { app, state } = application(["finance.view_cost"]);

    const allowed = await request(app)
      .get("/api/v1/admin/domain-state/finance_expenses")
      .set("Cookie", `dart_session=${sessionToken}`);
    expect(allowed.status).toBe(200);
    expect(state.read).toHaveBeenCalledWith("finance_expenses");

    const denied = await request(app)
      .get("/api/v1/admin/domain-state/customers")
      .set("Cookie", `dart_session=${sessionToken}`);
    expect(denied.status).toBe(403);
  });

  it("filters version polling to domains readable by a granular Finance account", async () => {
    const { app } = application(["finance.view_cost"]);
    const response = await request(app)
      .get("/api/v1/admin/domain-state-versions")
      .set("Cookie", `dart_session=${sessionToken}`);

    expect(response.status).toBe(200);
    expect(response.body.versions).toHaveProperty("finance_expenses", 4);
    expect(response.body.versions).not.toHaveProperty("customers");
  });
});


it("keeps granular Finance domain permissions explicit in the route policy", () => {
  const source = readFileSync(
    new URL("../src/modules/dashboard/dashboard-state.routes.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain('"finance.manage_expenses"');
  expect(source).toContain('"finance.manage_budgets"');
  expect(source).toContain('"finance.manage_invoices"');
  expect(source).toContain('"finance.manage_settlements"');
  expect(source).toContain('"finance.view_cashflow"');
  expect(source).toContain('"finance.view_marketing"');
  expect(source).toContain("FINANCE_DOMAIN_READ_GATE_PERMISSIONS");
  expect(source).toContain("FINANCE_DOMAIN_WRITE_GATE_PERMISSIONS");
  expect(source).toContain("readableDomains(request.auth!.permissions)");
});
