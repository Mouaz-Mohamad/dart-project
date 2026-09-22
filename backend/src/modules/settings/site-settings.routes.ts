// DART CODE GUIDE | backend/src/modules/settings/site-settings.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
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
import type { SiteSettingsService } from "./site-settings.service.js";

const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
});

export function createSiteSettingsRouter(
  settings: SiteSettingsService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get("/site-settings", async (request, response) => {
    const payload = await settings.get();
    const etag = `"dart-site-settings-v${payload.version}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    if (request.get("if-none-match") === etag) {
      response.status(304).end();
      return;
    }
    response.status(200).json(payload);
  });

  router.get(
    "/admin/site-settings",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("settings.manage"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await settings.get(true));
    },
  );

  router.put(
    "/admin/site-settings",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("settings.manage"),
    async (request, response) => {
      const body = updateSchema.parse(request.body);
      response.status(200).json(
        await settings.update(
          body.expectedVersion,
          body.settings,
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  return router;
}
