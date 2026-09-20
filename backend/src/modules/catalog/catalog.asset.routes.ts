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
import type { CatalogAssetService } from "./catalog.asset.service.js";

const uploadSchema = z.object({
  assetId: z.string().trim().min(1).max(120),
  originalName: z.string().max(255).default(""),
  contentType: z.enum(["image/jpeg","image/png","image/webp"]),
  base64: z.string().min(1),
});

export function createCatalogAssetRouter(
  assets: CatalogAssetService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get("/catalog/assets/:assetId", async (request, response) => {
    const asset = await assets.get(String(request.params.assetId));
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
