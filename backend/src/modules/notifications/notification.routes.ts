// DART CODE GUIDE | backend/src/modules/notifications/notification.routes.ts
// Authenticated customer scope, CSRF and bounded request validation.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
} from "../../middleware/authentication.js";
import { sharedRateLimitStore } from "../../security/shared-rate-limit.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { CustomerNotificationService } from "./notification.service.js";
import { pushSubscriptionSchema } from "./push-validation.js";

export function createCustomerNotificationRouter(
  service: CustomerNotificationService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config),
    customer = requireAccountType("customer"),
    csrf = csrfProtection(config);
  const mutate = rateLimit({
    store: sharedRateLimitStore(config, "customer-notifications"),
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.get("/me/notifications", signedIn, customer, async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(25),
        cursor: z.string().max(300).optional(),
      })
      .strict()
      .parse(req.query);
    res.json(await service.list(req.auth!.userId, query.limit, query.cursor));
  });
  router.post(
    "/me/notifications/read",
    signedIn,
    customer,
    csrf,
    mutate,
    async (req, res) => {
      const body = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
        .strict()
        .parse(req.body);
      res.json(await service.markRead(req.auth!.userId, body.ids));
    },
  );
  router.get("/me/push/config", signedIn, customer, (_req, res) => {
    res.json(service.pushConfig());
  });
  router.get("/me/push/subscriptions", signedIn, customer, async (req, res) => {
    res.json(
      await service.subscriptions(req.auth!.userId, req.auth!.sessionId),
    );
  });
  router.post(
    "/me/push/subscriptions",
    signedIn,
    customer,
    csrf,
    mutate,
    async (req, res) => {
      const body = z
        .object({
          subscription: pushSubscriptionSchema,
          publicKey: z.string().max(100),
        })
        .strict()
        .parse(req.body);
      res.json(
        await service.subscribe(
          req.auth!.userId,
          req.auth!.sessionId,
          body.subscription,
          body.publicKey,
          String(req.id),
        ),
      );
    },
  );
  router.delete(
    "/me/push/subscriptions/:id",
    signedIn,
    customer,
    csrf,
    mutate,
    async (req, res) => {
      await service.unsubscribe(
        req.auth!.userId,
        z.string().uuid().parse(req.params.id),
        String(req.id),
      );
      res.status(204).end();
    },
  );
  return router;
}
