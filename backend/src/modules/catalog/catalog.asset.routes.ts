// DART CODE GUIDE | backend/src/modules/catalog/catalog.asset.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
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
import type { CatalogAssetService } from "./catalog.asset.service.js";

const assetIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{8,120}$/);

const uploadSchema = z.object({
  assetId: assetIdSchema,
  originalName: z.string().trim().max(255).default(""),
  contentType: z.enum(["image/jpeg","image/png","image/webp"]),
  base64: z
    .string()
    .min(4)
    .max(5_600_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export function createCatalogAssetRouter(
  assets: CatalogAssetService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "ASSET_UPLOAD_RATE_LIMITED",
        message: "Too many catalogue image uploads; try again later",
      },
    },
  });

  router.get("/catalog/assets/:assetId", async (request, response) => {
    const assetId = assetIdSchema.parse(request.params.assetId);
    const asset = await assets.get(assetId);
    if (!asset) {
      response.status(404).json({ error: { code: "ASSET_NOT_FOUND", message: "Image not found" } });
      return;
    }
    const etag = `"${asset.sha256}"`;
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    if (request.headers["if-none-match"] === etag) {
      response.status(304).end();
      return;
    }
    response.status(200).send(asset.content);
  });

  router.put(
    "/admin/catalog/assets",
    uploadLimiter,
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("catalog.assets_manage"),
    async (request, response) => {
      const body = uploadSchema.parse(request.body);
      const result = await assets.put({ ...body, actorId: request.auth!.userId });
      response.status(200).json(result);
    },
  );

  return router;
}
