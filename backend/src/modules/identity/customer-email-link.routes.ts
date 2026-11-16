// A verified email alone cannot unlock a historical phone-only customer account.
import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { authenticate, csrfProtection, requireAccountType, requireMfa, requirePermission } from "../../middleware/authentication.js";
import { sharedRateLimitStore } from "../../security/shared-rate-limit.js";
import { dispatchOutbox } from "../outbox/outbox.dispatch.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { IdentityService } from "./identity.service.js";
import type { CustomerEmailLinkService } from "./customer-email-link.service.js";

const contact = z.object({
  phone: z.string().trim().min(10).max(25),
  email: z.email().max(254),
});
const challenge = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
function meta(request: Request) {
  return {
    requestId: String(request.id),
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.get("user-agent") ? { userAgent: request.get("user-agent")! } : {}),
  };
}

export function createCustomerEmailLinkRouter(
  service: CustomerEmailLinkService,
  identity: IdentityService,
  config: AppConfig,
  outbox?: OutboxService,
): Router {
  const router = Router();
  const rate = rateLimit({
    store: sharedRateLimitStore(config, "customer-email-link"),
    windowMs: 15 * 60_000, limit: 10,
    standardHeaders: "draft-8", legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        error: { code: "AUTH_RATE_LIMITED", message: "Too many attempts. Try later." },
      });
    },
  });
  router.post("/auth/email-link/start", rate, async (request, response) => {
    const body = contact.parse(request.body);
    if (!outbox?.configured("email")) {
      return response.status(503).json({
        error: { code: "EMAIL_UNAVAILABLE", message: "Email verification is temporarily unavailable." },
      });
    }
    const result = await service.start(body.phone, body.email);
    if (result.sent) await dispatchOutbox(outbox, 1, "customer-email-link:" + result.challengeId);
    return response.status(202).json({
      challengeId: result.challengeId, expiresAt: result.expiresAt,
      email: result.email,
      message: "If eligible, a code was sent to the email you entered.",
    });
  });
  router.post("/auth/email-link/verify", rate, async (request, response) => {
    const body = challenge.parse(request.body);
    const result = await service.verify(body.challengeId, body.code);
    return response.status(202).json({
      ...result,
      message: "Email verified. An Owner must confirm the phone ownership before this account can be used.",
    });
  });
  const signedIn = authenticate(identity, config);
  const ownerAccess = [
    signedIn, requireAccountType("staff"), requireMfa,
    requirePermission("staff.manage"),
  ];
  router.get("/admin/customer-email-links", ...ownerAccess, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    return response.json(await service.pending(request.auth!));
  });
  router.post("/admin/customer-email-links/:id/review",
    signedIn, csrfProtection(config), requireAccountType("staff"), requireMfa,
    requirePermission("staff.manage"), async (request, response) => {
      const body = z.object({
        approve: z.boolean(),
        reason: z.string().trim().min(10).max(600),
        confirmedPhoneOwner: z.boolean().default(false),
      }).parse(request.body);
      const result = await service.review(request.auth!,
        z.uuid().parse(request.params.id), body.approve,
        body.reason, body.confirmedPhoneOwner, meta(request));
      return response.status(200).json(result);
    },
  );
  return router;
}
