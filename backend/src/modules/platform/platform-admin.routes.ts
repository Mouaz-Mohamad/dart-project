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
import type { PlatformAdminService } from "./platform-admin.service.js";

const resetSchema = z.object({
  confirmation: z.literal("DELETE DART"),
  understandPermanentDeletion: z.literal(true),
});

export function createPlatformAdminRouter(
  platform: PlatformAdminService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.post(
    "/admin/platform/reset-business-data",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("platform.reset"),
    async (request, response) => {
      resetSchema.parse(request.body);
      response.status(200).json(
        await platform.resetBusinessData(
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  return router;
}
