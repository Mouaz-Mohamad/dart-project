// DART CODE GUIDE | backend/src/modules/promotions/promotion.routes.ts
// الغرض: HTTP contract لمحرك Promotions مع تحقق داخل معاملة Commerce checkout.
import { Router } from "express";
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
import { CUSTOMER_DETAIL_PERMISSIONS } from "./customer-details.service.js";
import { manualDiscountSchema } from "./customer-manual-discount.js";

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

  for (const [section, permission] of Object.entries(CUSTOMER_DETAIL_PERMISSIONS)) {
    router.get(`/admin/customers/:clientRef/details/${section}`, signedIn, requireAccountType("staff"), requireMfa,
      requirePermission("customers.read"), requirePermission(permission), async (request, response) => {
        const offset = z.coerce.number().int().min(0).max(1_000_000).default(0).parse(request.query.offset);
        response.setHeader("Cache-Control", "no-store");
        response.json(await promotions.customerDetails(z.string().trim().min(1).max(160).parse(request.params.clientRef),
          section as keyof typeof CUSTOMER_DETAIL_PERMISSIONS, offset, request.auth!.userId, request.auth!.permissions));
      });
  }
  router.post("/admin/customers/:clientRef/manual-discounts", signedIn, csrf, requireAccountType("staff"), requireMfa,
    requirePermission("customers.read"), requirePermission("promotions.manage"), async (request, response) => {
      const body = z.object({ id: z.uuid(), discount: manualDiscountSchema }).strict().parse(request.body);
      response.status(201).json(await promotions.saveCustomerDiscount(z.string().trim().min(1).max(160).parse(request.params.clientRef),
        request.auth!.userId, String(request.id), body.id, body.discount));
    });
  router.put("/admin/customers/:clientRef/manual-discounts/:id", signedIn, csrf, requireAccountType("staff"), requireMfa,
    requirePermission("customers.read"), requirePermission("promotions.manage"), async (request, response) => {
      const body = z.object({ expectedVersion: z.number().int().positive(), discount: manualDiscountSchema.nullable() }).strict().parse(request.body);
      response.json(await promotions.saveCustomerDiscount(z.string().trim().min(1).max(160).parse(request.params.clientRef),
        request.auth!.userId, String(request.id), z.uuid().parse(request.params.id), body.discount, body.expectedVersion));
    });

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
    "/me/promotions/resolve",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      const targetReservation = reservationId.parse(request.query.reservationId);
      const code = z.string().trim().min(1).max(60).optional().parse(request.query.code);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await promotions.resolveForCheckout(request.auth!.userId, targetReservation, code),
      );
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
