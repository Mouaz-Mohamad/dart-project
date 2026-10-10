// DART CODE GUIDE | backend/tests/order-command.routes.test.ts
// الغرض: منع الكتابة العامة للأسعار والحالة، وإثبات صلاحيات أوامر الطلبات الفعلية.
import pino from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import type { AppConfig } from "../src/config/env.js";
import type { CommerceService } from "../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
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
    csrfTokenHash: hashCsrfToken("staff-csrf-token", config.authPepper),
    mfaRequired: true,
    mfaSatisfied: true,
    permissions,
  };
}

function application(permissions: string[]) {
  const commerce = { adminOrderWorkflowAction: vi.fn().mockResolvedValue({ version: 3, orders: [] }),
    adminBulkOrderWorkflowAction: vi.fn().mockResolvedValue({ version: 3, orders: [], result: {} }),
  } as unknown as CommerceService;
  const identity = { authenticate: vi.fn().mockResolvedValue(staffAccount(permissions)) } as unknown as IdentityService;
  return { commerce, app: createApp(config, { commerceService: commerce, identityService: identity,
    databasePing: async () => undefined, logger: pino({ level: "silent" }), startedAt: new Date(), version: "test" }) };
}
function post(app: ReturnType<typeof application>["app"], path: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/admin/orders/${path}`).set("Cookie", `dart_session=${sessionToken}`)
    .set("X-CSRF-Token", "staff-csrf-token").send(body);
}

describe("order command boundary", () => {
  it("validates the optional compact response contract without changing command authorization", async () => {
    const { app, commerce } = application(["orders.manage"]);
    const body = { expectedStatus: "New", target: "Accepted" };
    expect((await post(app, "K-1/workflow?responseMode=delta&baseVersion=2", body)).status).toBe(200);
    expect(commerce.adminOrderWorkflowAction).toHaveBeenLastCalledWith(expect.any(String), "K-1", body,
      expect.any(String), true, { responseMode: "delta", baseVersion: 2 });
    for (const query of ["responseMode=unknown", "responseMode=delta&baseVersion=-1",
      "responseMode=delta&baseVersion=1.5", "responseMode=delta&baseVersion=9007199254740992"]) {
      expect((await post(app, `K-1/workflow?${query}`, body)).status).toBe(422);
    }
    expect(commerce.adminOrderWorkflowAction).toHaveBeenCalledTimes(1);
    const denied = application(["orders.read"]);
    expect((await post(denied.app, "K-1/workflow?responseMode=delta&baseVersion=2", body)).status).toBe(403);
    expect(denied.commerce.adminOrderWorkflowAction).not.toHaveBeenCalled();
  });
  it("rejects arbitrary price/status/item replacement even for an order manager", async () => {
    const { app, commerce } = application(["orders.manage"]);
    const response = await request(app).put("/api/v1/admin/orders-state")
      .set("Cookie", `dart_session=${sessionToken}`).set("X-CSRF-Token", "staff-csrf-token")
      .send({ expectedVersion: 2, orders: [{ orderId: "K-1", status: "Delivered", finalAmount: 0, items: [] }] });
    expect(response.status).toBe(405);
    expect(response.body.error.code).toBe("ORDER_COMMAND_REQUIRED");
    expect(response.headers.allow).toBe("GET");
    expect(commerce.adminOrderWorkflowAction).not.toHaveBeenCalled();
  });
  it("requires a current status and rejects money fields on workflow commands", async () => {
    const { app, commerce } = application(["orders.manage"]);
    expect((await post(app, "K-1/workflow", { target: "Accepted" })).status).toBe(422);
    expect((await post(app, "K-1/workflow", { expectedStatus: "New", target: "Accepted", finalAmount: 0 })).status).toBe(422);
    expect(commerce.adminOrderWorkflowAction).not.toHaveBeenCalled();
  });
  it("denies commands to read-only staff and bulk commands without bulk permission", async () => {
    const reader = application(["orders.read"]);
    expect((await post(reader.app, "K-1/workflow", { expectedStatus: "New", target: "Accepted" })).status).toBe(403);
    expect(reader.commerce.adminOrderWorkflowAction).not.toHaveBeenCalled();
    const manager = application(["orders.manage"]);
    expect((await post(manager.app, "bulk-workflow", { orderRefs: ["K-1"], expectedStatus: "New", target: "Accepted" })).status).toBe(403);
    expect(manager.commerce.adminBulkOrderWorkflowAction).not.toHaveBeenCalled();
  });
  it("passes validated single and bulk transitions to the same authoritative workflow", async () => {
    const { app, commerce } = application(["orders.bulk_manage"]);
    expect((await post(app, "K-1/workflow", { expectedStatus: "New", target: "Accepted" })).status).toBe(200);
    expect((await post(app, "bulk-workflow", { orderRefs: ["K-1"], expectedStatus: "New", target: "Accepted" })).status).toBe(200);
    expect(commerce.adminOrderWorkflowAction).toHaveBeenCalledWith(expect.any(String), "K-1", { expectedStatus: "New", target: "Accepted" }, expect.any(String), true, undefined);
    expect(commerce.adminBulkOrderWorkflowAction).toHaveBeenCalledTimes(1);
  });
});
