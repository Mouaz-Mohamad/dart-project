import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { PromotionService } from "../src/modules/promotions/promotion.service.js";
import { createPromotionRouter } from "../src/modules/promotions/promotion.routes.js";
import { hashCsrfToken } from "../src/security/session-token.js";

const config = { sessionCookieName: "dart_session", authPepper: "quantity-test-pepper-at-least-32-characters" };
const cookie = `dart_session=123e4567-e89b-12d3-a456-426614174100.${"a".repeat(43)}`;
const staffCookie = cookie.replace("dart_session=", "dart_session_staff=");
function fixture(type: "staff" | "customer" = "customer", permissions: string[] = [], mfaSatisfied = true) {
  const service = { quantityOffers: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ version: 1 }) };
  const account = { userId: "123e4567-e89b-12d3-a456-426614174101", accountType: type, permissions,
    mfaRequired: type === "staff", mfaSatisfied, csrfTokenHash: hashCsrfToken("csrf", config.authPepper) } as AuthenticatedAccount;
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const app = express(); app.use(express.json(), cookieParser());
  app.use(createPromotionRouter(service as unknown as PromotionService, identity, config));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode || 422).json({ code: error.code || "INVALID_INPUT" });
  });
  return { app, service };
}

describe("quantity offer HTTP authority", () => {
  it("serves only the public projection to guests and derives account identity from the session", async () => {
    const { app, service } = fixture();
    const publicReply = await request(app).get("/promotions/quantity-offers?customerUserId=someone-else");
    expect(publicReply.status).toBe(200); expect(publicReply.headers["cache-control"]).toBe("no-store");
    expect(service.quantityOffers).toHaveBeenLastCalledWith();
    expect((await request(app).get("/me/promotions/quantity-offers")).status).toBe(401);
    expect((await request(app).get("/me/promotions/quantity-offers?customerUserId=someone-else").set("Cookie", cookie)).status).toBe(200);
    expect(service.quantityOffers).toHaveBeenLastCalledWith("123e4567-e89b-12d3-a456-426614174101");
    const staff = fixture("staff", ["promotions.read"]);
    expect((await request(staff.app).get("/me/promotions/quantity-offers").set("Cookie", cookie)).status).toBe(403);
  });
  it("requires central promotion permission, MFA, CSRF and a valid quantity offer before a write", async () => {
    const body = { name: "Quantity", code: "Q-HTTP", discountPercent: 10, automatic: true, distinctModels: true, minQuantity: 3 };
    for (const [permissions, mfa] of [[[], true], [["promotions.manage"], false]] as [string[], boolean][]) {
      const f = fixture("staff", permissions, mfa);
      expect((await request(f.app).post("/admin/promotions").set("Cookie", staffCookie).set("X-CSRF-Token", "csrf").send(body)).status).toBe(403);
      expect(f.service.create).not.toHaveBeenCalled();
    }
    const f = fixture("staff", ["promotions.manage"]);
    expect((await request(f.app).post("/admin/promotions").set("Cookie", staffCookie).send(body)).status).toBe(403);
    expect((await request(f.app).post("/admin/promotions").set("Cookie", staffCookie).set("X-CSRF-Token", "csrf").send({ ...body, minQuantity: 1 })).status).toBe(422);
    expect((await request(f.app).post("/admin/promotions").set("Cookie", staffCookie).set("X-CSRF-Token", "csrf").send(body)).status).toBe(201);
    expect(f.service.create).toHaveBeenCalledTimes(1);
  });
});
