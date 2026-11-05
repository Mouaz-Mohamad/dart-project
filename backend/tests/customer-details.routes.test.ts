import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { PromotionService } from "../src/modules/promotions/promotion.service.js";
import { createPromotionRouter } from "../src/modules/promotions/promotion.routes.js";
import { hashCsrfToken } from "../src/security/session-token.js";

const config = { sessionCookieName: "dart_session", authPepper: "customer-test-pepper-at-least-32-characters" };
const cookie = `dart_session_staff=123e4567-e89b-12d3-a456-426614174100.${"a".repeat(43)}`;
function fixture(permissions: string[], mfaSatisfied = true) {
  const service = { customerDetails: vi.fn().mockResolvedValue({ rows: [], nextOffset: null }), saveCustomerDiscount: vi.fn().mockResolvedValue({ version: 1 }) };
  const account = { userId: "123e4567-e89b-12d3-a456-426614174101", accountType: "staff", permissions,
    mfaRequired: true, mfaSatisfied, csrfTokenHash: hashCsrfToken("csrf", config.authPepper) } as AuthenticatedAccount;
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const app = express(); app.use(express.json(), cookieParser());
  app.use(createPromotionRouter(service as unknown as PromotionService, identity, config));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode || 400).json({ code: error.code || "INVALID_INPUT" });
  });
  return { app, service };
}

describe("customer history HTTP authorization", () => {
  for (const [section, permission] of Object.entries({ orders: "orders.read", reviews: "reviews.read", waiting: "waiting.read", returns: "returns.read", discounts: "promotions.read" })) {
    it(`requires customers.read and ${permission} for ${section}`, async () => {
      for (const grants of [["customers.read"], [permission], ["dashboard_state.read"]]) {
        const { app, service } = fixture(grants);
        expect((await request(app).get(`/admin/customers/DR-1/details/${section}`).set("Cookie", cookie)).status).toBe(403);
        expect(service.customerDetails).not.toHaveBeenCalled();
      }
      const { app, service } = fixture(["customers.read", permission]);
      expect((await request(app).get(`/admin/customers/DR-1/details/${section}?offset=50`).set("Cookie", cookie)).status).toBe(200);
      expect(service.customerDetails).toHaveBeenCalledWith("DR-1", section, 50, expect.any(String), ["customers.read", permission]);
    });
  }
  it("denies missing MFA, CSRF, missing permission and client-invented discount fields", async () => {
    const body = { id: "123e4567-e89b-42d3-a456-426614174105", discount: { name: "Test gift", kind: "amount", value: 10000, startsOn: "2026-10-01", endsOn: "2026-11-30", pieceLimit: 3 } };
    const { app, service } = fixture(["customers.read", "promotions.manage"]);
    expect((await request(app).post("/admin/customers/DR-1/manual-discounts").set("Cookie", cookie).send(body)).status).toBe(403);
    expect((await request(app).post("/admin/customers/DR-1/manual-discounts").set("Cookie", cookie).set("X-CSRF-Token", "csrf").send({ ...body, owner: true })).status).toBe(400);
    expect(service.saveCustomerDiscount).not.toHaveBeenCalled();
    const mfa = fixture(["customers.read", "promotions.manage"], false);
    expect((await request(mfa.app).post("/admin/customers/DR-1/manual-discounts").set("Cookie", cookie).set("X-CSRF-Token", "csrf").send(body)).status).toBe(403);
    expect((await request(app).post("/admin/customers/DR-1/manual-discounts").set("Cookie", cookie).set("X-CSRF-Token", "csrf").send(body)).status).toBe(201);
    expect(service.saveCustomerDiscount).toHaveBeenCalledTimes(1);
  });
});
