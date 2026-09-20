import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
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
  lines: z.array(cartLineSchema).max(50),
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
