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
import type { AdminOrdersService } from "./admin-orders.service.js";

const stateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  orders: z.array(z.record(z.string(), z.unknown())).max(5000),
});

export function createAdminOrdersRouter(
  orders: AdminOrdersService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get(
    "/admin/orders-state",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("orders.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await orders.state());
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
      const body = stateSchema.parse(request.body);
      response.status(200).json(
        await orders.replace(
          body.expectedVersion,
          body.orders,
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  return router;
}
