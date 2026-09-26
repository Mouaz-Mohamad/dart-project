// DART CODE GUIDE | backend/src/modules/analytics/traffic-analytics.routes.ts
// الغرض: HTTP routes لتسجيل أحداث الزوار وعرض Analytics المصرح بها للداشبورد.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  requireAccountType,
  requireMfa,
  requirePermission,
} from "../../middleware/authentication.js";
import { GUEST_CART_COOKIE, hashGuestCartToken } from "../../security/guest-cart-owner.js";
import { parseSessionToken } from "../../security/session-token.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { TrafficAnalyticsService } from "./traffic-analytics.service.js";

const eventSchema = z
  .object({
    eventType: z.enum(["visit", "add_to_cart"]),
    eventId: z.uuid().optional(),
    visitorId: z.uuid(),
    sessionId: z.uuid(),
    path: z.string().trim().max(500).optional(),
    modelId: z.string().trim().min(1).max(160).optional(),
    color: z.string().trim().max(120).optional(),
    size: z.string().trim().max(80).optional(),
    quantity: z.number().int().min(1).max(100).optional(),
    reservationId: z.string().trim().min(1).max(180).optional(),
  })
  .superRefine((value, context) => {
    if (value.eventType === "add_to_cart" && (!value.eventId || !value.reservationId || !value.modelId || !value.quantity)) {
      context.addIssue({ code: "custom", message: "add_to_cart requires eventId, reservationId, modelId and quantity" });
    }
  });

const reportSchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
    group: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]).default("daily"),
  })
  .refine((value) => value.start <= value.end, {
    message: "start must be on or before end",
    path: ["end"],
  });

export function createTrafficAnalyticsRouter(
  analytics: TrafficAnalyticsService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const analyticsEventLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many analytics events" } },
  });

  async function optionalCustomerId(cookieValue: string | undefined): Promise<string | null> {
    const token = parseSessionToken(cookieValue);
    if (!token) return null;
    const account = await identity.authenticate(token.id, token.secret).catch(() => null);
    return account?.accountType === "customer" ? account.userId : null;
  }

  router.post("/analytics/events", analyticsEventLimiter, async (request, response) => {
    const input = eventSchema.parse(request.body);
    const customerUserId = await optionalCustomerId(request.cookies?.[config.sessionCookieName]);
    const guestOwnerHash = hashGuestCartToken(request.cookies?.[GUEST_CART_COOKIE], config.authPepper);
    await analytics.recordEvent(input, customerUserId, guestOwnerHash);
    response.status(202).json({ accepted: true });
  });

  router.get(
    "/admin/analytics/traffic",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("analytics.read"),
    async (request, response) => {
      const query = reportSchema.parse(request.query);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await analytics.report(query.start, query.end, query.group));
    },
  );

  return router;
}
