// DART CODE GUIDE | backend/src/modules/catalog/catalog.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
  requireMfa,
  requireAnyPermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { CatalogService } from "./catalog.service.js";

const stateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  models: z.array(z.record(z.string(), z.unknown())),
  items: z.array(z.record(z.string(), z.unknown())),
});

export function createCatalogRouter(
  catalog: CatalogService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
  outbox?: OutboxService,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get("/serial/:itemCode", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const item = await catalog.serial(String(request.params.itemCode || ""));
    response.status(200).json({ found: Boolean(item), item });
  });

  router.get("/catalog/version", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ version: await catalog.version() });
  });

  router.get("/catalog", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await catalog.publicCatalog());
  });

  router.post(
    "/admin/damage/:damageRef/action",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("damage.manage", "damage.resolve"),
    async (request, response) => {
      const damageRef = z.string().trim().min(1).max(160).parse(request.params.damageRef);
      const body = z.object({
        status: z.enum(["Repaired", "Destroyed"]),
      }).parse(request.body);
      response.status(200).json(
        await catalog.damageAction(
          damageRef,
          body.status,
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  router.get(
    "/admin/catalog-state",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("catalog.manage", "catalog.read"),
    async (_request, response) => {
      response.status(200).json(await catalog.adminState());
    },
  );

  router.put(
    "/admin/catalog-state",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("catalog.manage", "catalog.edit"),
    async (request, response) => {
      const body = stateSchema.parse(request.body);
      const result = await catalog.replaceState(
        body.expectedVersion,
        body.models,
        body.items,
        request.auth!.userId,
        String(request.id),
      );
      await outbox?.processBatch(20).catch(() => undefined);
      response.status(200).json(result);
    },
  );

  return router;
}
