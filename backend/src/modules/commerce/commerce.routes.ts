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
import type { CommerceService } from "./commerce.service.js";

const reservationId = z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);

const cartLineSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(120),
  size: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
});

const reserveSchema = z.object({
  reservationId,
  lines: z.array(cartLineSchema).max(20),
}).superRefine((value, context) => {
  const total = value.lines.reduce((sum, line) => sum + line.quantity, 0);
  if (total > 20) {
    context.addIssue({
      code: "custom",
      path: ["lines"],
      message: "A cart can reserve at most 20 physical items",
    });
  }
});

const adminOrderStateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  orders: z.array(z.record(z.string(), z.unknown())).max(10000),
});

const checkoutSchema = z.object({
  reservationId,
  contact: z.object({
    name: z.string().trim().min(2).max(160),
    phone1: z.string().trim().min(7).max(40),
    phone2: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(320),
  }),
  address: z.object({
    country: z.string().trim().min(2).max(120),
    governorate: z.enum(["Cairo", "Giza"]),
    area: z.string().trim().min(1).max(160),
    street: z.string().trim().min(1).max(200),
    building: z.string().trim().min(1).max(120),
    floor: z.string().trim().min(1).max(80),
    latitude: z.string().trim().min(1).max(80),
    longitude: z.string().trim().min(1).max(80),
    fullAddress: z.string().trim().max(600).optional(),
    addressSource: z.string().trim().max(80).optional(),
  }),
  deliveryNotes: z.string().trim().max(1000).optional(),
});

export function createCommerceRouter(
  commerce: CommerceService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.put("/cart/reservation", async (request, response) => {
    const body = reserveSchema.parse(request.body);
    const result = await commerce.reserveCart(body.reservationId, body.lines);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(result);
  });

  router.delete("/cart/reservation/:reservationId", async (request, response) => {
    const id = reservationId.parse(request.params.reservationId);
    await commerce.releaseCart(id);
    response.status(204).end();
  });

  router.get(
    "/admin/orders-state",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("orders.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.adminOrders());
    },
  );

  router.put(
    "/admin/orders-state",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("orders.manage"),
    async (request, response) => {
      const body = adminOrderStateSchema.parse(request.body);
      response.status(200).json(
        await commerce.replaceAdminOrders(
          body.expectedVersion,
          body.orders,
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  router.get(
    "/me/commerce",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.customerSnapshot(request.auth!.userId));
    },
  );

  router.get(
    "/representatives/work",
    signedIn,
    requireAccountType("representative"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.representativeWork(request.auth!.userId));
    },
  );

  router.put(
    "/representatives/location",
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const body = z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyMeters: z.number().min(0).max(5000).nullable().optional(),
      }).parse(request.body);
      response.status(200).json(
        await commerce.updateRepresentativeLocation(
          request.auth!.userId,
          body.latitude,
          body.longitude,
          body.accuracyMeters ?? null,
        ),
      );
    },
  );

  router.post(
    "/representatives/orders/:orderCode/action",
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const orderCode = z.string().trim().min(2).max(120).parse(request.params.orderCode);
      const body = z.object({
        action: z.enum(["start", "cancel", "delivered"]),
      }).parse(request.body);
      response.status(200).json({
        order: await commerce.representativeOrderAction(
          request.auth!.userId,
          orderCode,
          body.action,
        ),
      });
    },
  );

  router.post(
    "/representatives/returns/:returnRef/action",
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const returnRef = z.string().trim().min(2).max(120).parse(request.params.returnRef);
      const body = z.object({
        action: z.enum(["start", "cancel", "complete"]),
      }).parse(request.body);
      response.status(200).json({
        return: await commerce.representativeReturnAction(
          request.auth!.userId,
          returnRef,
          body.action,
        ),
      });
    },
  );

  router.post(
    "/orders",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = checkoutSchema.parse(request.body);
      const result = await commerce.checkout(
        request.auth!.userId,
        body,
        String(request.id),
      );
      response.status(201).json({ order: result });
    },
  );

  return router;
}
