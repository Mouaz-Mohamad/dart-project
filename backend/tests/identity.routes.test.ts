// DART CODE GUIDE | backend/tests/identity.routes.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import pino from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import type { AppConfig } from "../src/config/env.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount, IssuedSession } from "../src/modules/identity/identity.types.js";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";

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
  authPepper: "route-test-auth-pepper-with-at-least-32-characters",
  sessionCookieName: "dart_session",
  sessionCookieSameSite: "strict",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 3),
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

const sessionId = "123e4567-e89b-12d3-a456-426614174000";
const familyId = "123e4567-e89b-12d3-a456-426614174001";
const secret = "a".repeat(43);
const csrf = "csrf-route-test-token";
const representativeImage = `data:image/webp;base64,${"A".repeat(120)}`;

function account(overrides: Partial<AuthenticatedAccount> = {}): AuthenticatedAccount {
  return {
    userId: "123e4567-e89b-12d3-a456-426614174002",
    accountType: "customer",
    status: "active",
    email: "customer@example.com",
    emailVerified: true,
    mustChangePassword: false,
    sessionId,
    sessionFamilyId: familyId,
    csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
    mfaRequired: false,
    mfaSatisfied: true,
    permissions: ["profile.read_own", "sessions.read_own", "sessions.revoke_own"],
    ...overrides,
  };
}

function issued(auth = account()): IssuedSession {
  return {
    account: auth,
    sessionToken: `${sessionId}.${secret}`,
    csrfToken: csrf,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

function profile(auth = account()) {
  return {
    id: auth.userId,
    accountType: auth.accountType,
    code: auth.accountType === "customer" ? "DR-1" : "ST-1",
    name: "Test Account",
    email: auth.email,
    phones: ["01012345678"],
    status: auth.status,
    emailVerified: auth.emailVerified,
    mustChangePassword: auth.mustChangePassword,
    birthday: null,
  };
}

function fakeService(auth = account()) {
  return {
    registerCustomer: vi.fn().mockResolvedValue({
      userId: auth.userId,
      challengeId: "123e4567-e89b-12d3-a456-426614174003",
      expiresAt: new Date(Date.now() + 600_000),
    }),
    registerRepresentative: vi.fn().mockResolvedValue({
      userId: "123e4567-e89b-12d3-a456-426614174008",
      representativeCode: "REP-1",
      status: "pending_approval",
    }),
    login: vi.fn().mockResolvedValue(issued(auth)),
    startStaffEmailAccess: vi.fn().mockResolvedValue({
      challengeId: "123e4567-e89b-12d3-a456-426614174004",
      expiresAt: new Date(Date.now() + 600_000),
      deliveryQueued: true,
    }),
    verifyStaffEmailAccess: vi.fn().mockResolvedValue(issued(auth)),
    profile: vi.fn().mockResolvedValue(profile(auth)),
    authenticate: vi.fn().mockResolvedValue(auth),
    logout: vi.fn().mockResolvedValue(undefined),
    decideRepresentative: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityService;
}

function app(service: IdentityService, outboxService?: OutboxService) {
  return createApp(config, {
    databasePing: async () => undefined,
    identityService: service,
    ...(outboxService ? { outboxService } : {}),
    logger: pino({ level: "silent" }),
    startedAt: new Date("2026-09-20T00:00:00.000Z"),
    version: "test",
  });
}

describe("identity HTTP boundaries", () => {
  it("does not expose retired Google, Staff password or Staff TOTP routes", async () => {
    const application = app(fakeService());

    const responses = [
      await request(application).get("/api/v1/admin/auth/google/config"),
      await request(application)
        .post("/api/v1/admin/auth/google/exchange")
        .send({ accessToken: "x".repeat(40) }),
      await request(application)
        .post("/api/v1/admin/auth/login")
        .send({
          identifier: "owner@example.com",
          password: "StrongPassword123",
        }),
      await request(application).post("/api/v1/admin/auth/mfa/setup").send({}),
      await request(application)
        .post("/api/v1/admin/auth/mfa/confirm")
        .send({ token: "123456" }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    }
  });

  it("does not treat a public Supabase key as a Dart dashboard session", async () => {
    const response = await request(app(fakeService()))
      .get("/api/v1/admin/staff")
      .set("apikey", "sb_publishable_public_test")
      .set("Authorization", "Bearer public-supabase-token");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("does not claim a Staff email code was sent when SMTP is disabled", async () => {
    const service = fakeService();
    const outbox = {
      configured: vi.fn().mockReturnValue(false),
    } as unknown as OutboxService;
    const response = await request(app(service, outbox))
      .post("/api/v1/admin/auth/email/start")
      .send({ email: "owner@example.com" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
    expect(service.startStaffEmailAccess).not.toHaveBeenCalled();
  });

  it("keeps the Staff email request generic when immediate SMTP delivery fails", async () => {
    const service = fakeService();
    const outbox = {
      configured: vi.fn().mockReturnValue(true),
      processBatch: vi.fn().mockResolvedValue({
        configured: true,
        claimed: 1,
        published: 0,
        failed: 1,
      }),
    } as unknown as OutboxService;
    const response = await request(app(service, outbox))
      .post("/api/v1/admin/auth/email/start")
      .send({ email: "owner@example.com" });
    expect(response.status).toBe(202);
    expect(response.body.message).toBe(
      "If this email is allowed, a verification code has been sent.",
    );
    expect(outbox.processBatch).toHaveBeenCalledWith(
      1,
      "staff-email-access-code:123e4567-e89b-12d3-a456-426614174004",
    );
  });

  it("sets a secure Dart session after a valid Staff email code", async () => {
    const staff = account({
      accountType: "staff",
      email: "owner@example.com",
      permissions: ["staff.read", "staff.manage"],
      mfaRequired: false,
      mfaSatisfied: true,
    });
    const service = fakeService(staff);
    const response = await request(app(service))
      .post("/api/v1/admin/auth/email/verify")
      .send({
        challengeId: "123e4567-e89b-12d3-a456-426614174004",
        code: "123456",
      });
    expect(response.status).toBe(200);
    expect(service.verifyStaffEmailAccess).toHaveBeenCalled();
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((value) => value.startsWith("dart_session=") && value.includes("HttpOnly"))).toBe(true);
    expect(cookies.some((value) => value.startsWith("dart_csrf=") && !value.includes("HttpOnly"))).toBe(true);
  });

  it("queues registration verification without creating a browser credential", async () => {
    const service = fakeService();
    const response = await request(app(service)).post("/api/v1/auth/register").send({
      name: "Test Customer",
      email: "customer@example.com",
      phone1: "01012345678",
      phone2: "",
      password: "abcd1234",
    });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("verification_required");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(service.registerCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ phone2: undefined, password: "abcd1234" }),
      expect.any(Object),
    );
  });

  it("sets an HttpOnly session cookie and a separate CSRF cookie after login", async () => {
    const response = await request(app(fakeService())).post("/api/v1/auth/login").send({
      identifier: "customer@example.com",
      password: "StrongPassword123",
    });
    expect(response.status).toBe(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((value) => value.startsWith("dart_session=") && value.includes("HttpOnly"))).toBe(true);
    expect(cookies.some((value) => value.startsWith("dart_csrf=") && !value.includes("HttpOnly"))).toBe(true);
  });

  it("supports secure cross-site cookies for separate Vercel frontend and API projects", async () => {
    const productionConfig: AppConfig = {
      ...config,
      nodeEnv: "production",
      sessionCookieSameSite: "none",
    };
    const application = createApp(productionConfig, {
      databasePing: async () => undefined,
      identityService: fakeService(),
      logger: pino({ level: "silent" }),
      startedAt: new Date("2026-09-20T00:00:00.000Z"),
      version: "test",
    });
    const response = await request(application).post("/api/v1/auth/login").send({
      identifier: "customer@example.com",
      password: "StrongPassword123",
    });
    expect(response.status).toBe(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies.every((value) => value.includes("SameSite=None"))).toBe(true);
    expect(cookies.every((value) => value.includes("Secure"))).toBe(true);
  });

  it("rejects an authenticated mutation without the matching CSRF token", async () => {
    const service = fakeService();
    const response = await request(app(service))
      .post("/api/v1/auth/logout")
      .set("Cookie", `dart_session=${sessionId}.${secret}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_INVALID");
  });

  it("allows logout with the owned session and matching CSRF token", async () => {
    const service = fakeService();
    const response = await request(app(service))
      .post("/api/v1/auth/logout")
      .set("Cookie", `dart_session=${sessionId}.${secret}`)
      .set("X-CSRF-Token", csrf);
    expect(response.status).toBe(204);
  });

  it("blocks protected staff actions until MFA is satisfied", async () => {
    const staff = account({
      accountType: "staff",
      mfaRequired: true,
      mfaSatisfied: false,
      permissions: ["representatives.approve"],
    });
    const response = await request(app(fakeService(staff)))
      .post("/api/v1/admin/representatives/123e4567-e89b-12d3-a456-426614174009/approve")
      .set("Cookie", `dart_session=${sessionId}.${secret}`)
      .set("X-CSRF-Token", csrf);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("MFA_REQUIRED");
  });

  it("accepts representative applications with private verification documents", async () => {
    const service = fakeService();
    const response = await request(app(service)).post("/api/v1/representatives/register").send({
      name: "Test Representative",
      email: "rep@example.com",
      phone1: "01012345678",
      nationalId: "29901011234567",
      address: "10 Test Street, Cairo, Egypt",
      password: "StrongPassword123",
      idFrontImage: representativeImage,
      idBackImage: representativeImage,
      faceImage: representativeImage,
    });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      representativeCode: "REP-1",
      status: "pending_approval",
    });
  });
});
