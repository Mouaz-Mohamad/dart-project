import { dispatchOutbox } from "../outbox/outbox.dispatch.js";
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
import { buildProductSitemap } from "./catalog.seo.js";
import type { CatalogService } from "./catalog.service.js";

const stateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  models: z.array(z.record(z.string(), z.unknown())),
  items: z.array(z.record(z.string(), z.unknown())),
});

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  q: z.string().trim().max(160).optional(),
  category: z.string().trim().max(120).optional(),
  sort: z.enum(["newest", "price-low", "price-high", "name"]).optional(),
});
const adminPageSchema = pageSchema.pick({ page:true, limit:true, q:true }).strict();
const patchSchema = stateSchema.extend({
  models: z.array(z.record(z.string(), z.unknown())).max(500),
  items: z.array(z.record(z.string(), z.unknown())).max(1000),
  recordVersions: z.object({
    models: z.record(z.string(), z.number().int().nonnegative()),
    items: z.record(z.string(), z.number().int().nonnegative()),
  }),
}).refine((body) => body.models.length+body.items.length>0, "At least one record change is required");

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

  router.get("/catalog", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await catalog.publicCatalog(
      ["page", "limit", "q", "category", "sort"].some((key) => key in request.query) ? pageSchema.parse(request.query) : undefined,
    ));
  });

  router.get("/catalog/sitemap.xml", async (_request, response) => {
    const catalogState = await catalog.publicCatalog();
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    response.status(200).send(buildProductSitemap(catalogState));
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
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await catalog.adminState(
        ["page", "limit", "q", "category", "sort"].some((key) => key in request.query) ? { page: adminPageSchema.parse(request.query) } : undefined,
      ));
    },
  );

  router.patch(
    "/admin/catalog-state",
    signedIn, csrf, requireAccountType("staff"), requireMfa,
    requireAnyPermission("catalog.manage", "catalog.edit"),
    async (request, response) => {
      const body = patchSchema.parse(request.body);
      const result = await catalog.replaceState(
        body.expectedVersion, body.models, body.items, request.auth!.userId,
        String(request.id), body.recordVersions,
      );
      await dispatchOutbox(outbox, 10);
      response.status(200).json(result);
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
      await dispatchOutbox(outbox, 20);
      response.status(200).json(result);
    },
  );

  return router;
}
