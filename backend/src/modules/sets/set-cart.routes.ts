// DART CODE GUIDE | backend/src/modules/sets/set-cart.routes.ts
// HTTP bridge for attaching Set identities to the existing atomic physical cart reservation.
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
} from "../../middleware/authentication.js";
import { GUEST_CART_COOKIE, hashGuestCartToken } from "../../security/guest-cart-owner.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { SetCartService } from "./set-cart.service.js";

const reservationId = z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);
const selectionSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(120),
  size: z.string().trim().min(1).max(120),
});
const groupSchema = z.object({
  setId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  unitIndex: z.number().int().min(1).max(20),
  selections: z.array(selectionSchema).min(1).max(100),
});
const attachSchema = z.object({
  reservationId,
  groups: z.array(groupSchema).max(20),
}).superRefine((value, context) => {
  const total = value.groups.reduce((sum, group) => sum + group.selections.length, 0);
  if (total > 100) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: "Set groups can reference at most 100 physical pieces per cart",
    });
  }
  const keys = value.groups.map((group) => `${group.setId}:${group.unitIndex}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: "Each Set unit in a cart must have a unique setId/unitIndex pair",
    });
  }
});

function guestCartOwnerHash(
  request: Request,
  response: Response,
  config: Pick<AppConfig, "authPepper" | "nodeEnv">,
  createIfMissing: boolean,
): string | null {
  let token =
    typeof request.cookies?.[GUEST_CART_COOKIE] === "string"
      ? String(request.cookies[GUEST_CART_COOKIE])
      : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    if (!createIfMissing) return null;
    token = randomUUID();
    response.cookie(GUEST_CART_COOKIE, token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      path: "/api/v1",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  return hashGuestCartToken(token, config.authPepper);
}

export function createSetCartRouter(
  setCart: SetCartService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper" | "nodeEnv">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);
  const guestWriteLimit = rateLimit({
    windowMs: 600_000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const guestReadLimit = rateLimit({
    windowMs: 600_000,
    limit: 80,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.put(
    "/me/cart/set-groups",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = attachSchema.parse(request.body);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await setCart.attachGroups(
          body.reservationId,
          body.groups,
          request.auth!.userId,
          guestCartOwnerHash(request, response, config, false) ?? undefined,
        ),
      );
    },
  );

  router.get(
    "/me/cart/set-groups",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      const id = reservationId.parse(request.query.reservationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await setCart.groupsForReservation(
          id,
          request.auth!.userId,
          guestCartOwnerHash(request, response, config, false) ?? undefined,
        ),
      );
    },
  );

  router.put("/cart/set-groups", guestWriteLimit, async (request, response) => {
    const body = attachSchema.parse(request.body);
    const ownerHash = guestCartOwnerHash(request, response, config, true);
    if (!ownerHash) throw new Error("Unable to establish guest cart ownership");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(
      await setCart.attachGroups(body.reservationId, body.groups, undefined, ownerHash),
    );
  });

  router.get(
    "/cart/set-groups/:reservationId",
    guestReadLimit,
    async (request, response) => {
      const id = reservationId.parse(request.params.reservationId);
      const ownerHash = guestCartOwnerHash(request, response, config, true);
      if (!ownerHash) {
        response.status(200).json({ reservationId: id, groups: [] });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await setCart.groupsForReservation(id, undefined, ownerHash),
      );
    },
  );

  return router;
}
