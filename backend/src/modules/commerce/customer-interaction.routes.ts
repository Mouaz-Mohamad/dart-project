import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { CustomerInteractionService } from "./customer-interaction.service.js";

const contactLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const contactSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  phone1: z.string().trim().min(7).max(40),
  phone2: z.string().trim().max(40).optional(),
  message: z.string().trim().min(2).max(3000),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(160),
  review: z.string().trim().min(2).max(3000),
});

const returnSchema = z.object({
  itemCode: z.string().trim().min(1).max(160),
  requestType: z.enum(["Refund", "Exchange"]),
  reason: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(1500).optional(),
  requestedColor: z.string().trim().max(120).optional(),
  requestedSize: z.string().trim().max(120).optional(),
  address: z.object({
    country: z.string().trim().min(2).max(120),
    governorate: z.enum(["Cairo", "Giza"]),
    area: z.string().trim().min(1).max(160),
    street: z.string().trim().min(1).max(200),
    building: z.string().trim().min(1).max(120),
    floor: z.string().trim().min(1).max(80),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    fullAddress: z.string().trim().max(600).optional(),
    addressSource: z.string().trim().max(80).optional(),
  }),
});

export function createCustomerInteractionRouter(
  interactions: CustomerInteractionService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.post("/contact", contactLimiter, async (request, response) => {
    const body = contactSchema.parse(request.body);
    response.status(201).json(await interactions.submitContact(body, String(request.id)));
  });

  router.post(
    "/reviews",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = reviewSchema.parse(request.body);
      response.status(201).json(
        await interactions.submitReview(request.auth!.userId, body, String(request.id)),
      );
    },
  );

  router.post(
    "/returns",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = returnSchema.parse(request.body);
      response.status(201).json(
        await interactions.submitReturn(request.auth!.userId, body, String(request.id)),
      );
    },
  );

  return router;
}
