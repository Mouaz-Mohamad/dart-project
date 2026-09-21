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
  staffInviteOtpTtlHours: 48,
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
    read: vi.fn().mockResolvedValue({
      domain: "contacts",
      version: 2,
      data: [{ id: "contact-1", message: "Private customer message" }],
    }),
    versions: vi.fn().mockResolvedValue({ contacts: 2 }),
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
});
