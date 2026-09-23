// DART CODE GUIDE | backend/src/modules/promotions/promotion.routes.ts
// الغرض: HTTP contract لمحرك Promotions مع preflight خادمي قبل Commerce checkout.
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
  requireMfa,
  requirePermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import { promotionCampaignInputSchema, type PromotionService } from "./promotion.service.js";

const recordId = z.string().trim().min(8).max(160);
const reservationId = z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);

export function createPromotionRouter(
  promotions: PromotionService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  // Mounted before CommerceRouter. It only performs authoritative eligibility preflight,
  // then forwards the request so the existing checkout transaction remains the writer.
  router.post(
    "/orders",
    signedIn,
    requireAccountType("customer"),
    async (request: Request, _response: Response, next: NextFunction) => {
      const body = z.object({
        reservationId,
        promotionCode: z.string().trim().min(1).max(60).optional(),
      }).passthrough().parse(request.body);
      const resolved = await promotions.resolveForCheckout(
        request.auth!.userId,
        body.reservationId,
        body.promotionCode,
      );
      if (resolved.code) {
        request.body = { ...request.body, promotionCode: resolved.code };
      } else if (request.body && typeof request.body === "object") {
        delete (request.body as Record<string, unknown>).promotionCode;
      }
      next();
    },
  );

  router.get(
    "/me/promotions/validate-v2",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      const code = z.string().trim().min(1).max(60).parse(request.query.code);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await promotions.validateCode(request.auth!.userId, code));
    },
  );

  router.get(
    "/admin/promotions",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("promotions.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ promotions: await promotions.list() });
    },
  );

  router.post(
    "/admin/promotions",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("promotions.manage"),
    async (request, response) => {
      const body = promotionCampaignInputSchema.parse(request.body);
      response.status(201).json({
        promotion: await promotions.create(body, request.auth!.userId, String(request.id)),
      });
    },
  );

  router.put(
    "/admin/promotions/:id",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("promotions.manage"),
    async (request, response) => {
      const body = z.object({
        expectedVersion: z.number().int().positive(),
        promotion: promotionCampaignInputSchema,
      }).strict().parse(request.body);
      response.status(200).json({
        promotion: await promotions.update(
          recordId.parse(request.params.id),
          body.expectedVersion,
          body.promotion,
          request.auth!.userId,
          String(request.id),
        ),
      });
    },
  );

  router.get(
    "/admin/promotions/:id/analytics",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("promotions.read"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await promotions.analytics(recordId.parse(request.params.id)));
    },
  );

  return router;
}
