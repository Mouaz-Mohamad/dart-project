import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "../../config/env.js";
import { authenticate, csrfProtection, requireAccountType, requireAnyPermission, requireMfa, requirePermission } from "../../middleware/authentication.js";
import type { CatalogAssetService } from "../catalog/catalog.asset.service.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { NewsService } from "./news.service.js";
import { newsAssetSchema, newsCreateSchema, newsIdSchema, newsListSchema, newsStateSchema, newsUpdateSchema } from "./news.schema.js";

export function createNewsRouter(news: NewsService, assets: CatalogAssetService, identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">): Router {
  const router = Router();
  const read = [authenticate(identity, config), requireAccountType("staff"), requireAnyPermission("news.read", "news.manage")];
  const write = [authenticate(identity, config), csrfProtection(config), requireAccountType("staff"), requireMfa, requirePermission("news.manage")];
  router.get("/news", async (req, res) => {
    const { limit, offset } = newsListSchema.pick({ limit: true, offset: true }).parse(req.query);
    res.json(await news.list({ q: "", status: "published", archive: "active", limit, offset }));
  });
  router.get("/news/:id", async (req, res) => { res.json(await news.get(newsIdSchema.parse(req.params.id))); });
  router.get("/admin/news", ...read, async (req, res) => { res.json(await news.list(newsListSchema.parse(req.query), true)); });
  router.post("/admin/news", ...write, async (req, res) => {
    const { newsId, ...body } = newsCreateSchema.parse(req.body);
    res.status(201).json(await news.save(req.auth!.userId, newsId, body, null, String(req.id)));
  });
  router.put("/admin/news/assets", ...write, rateLimit({ windowMs: 15 * 60_000, limit: 30,
    standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => {
    const body = newsAssetSchema.parse(req.body);
    res.json(await assets.put({ ...body, actorId: req.auth!.userId }));
  });
  router.get("/admin/news/:id", ...read, async (req, res) => { res.json(await news.get(newsIdSchema.parse(req.params.id), true)); });
  router.put("/admin/news/:id", ...write, async (req, res) => {
    const { expectedVersion, ...body } = newsUpdateSchema.parse(req.body);
    res.json(await news.save(req.auth!.userId, newsIdSchema.parse(req.params.id), body, expectedVersion, String(req.id)));
  });
  router.post("/admin/news/:id/state", ...write, async (req, res) => {
    const body = newsStateSchema.parse(req.body);
    res.json(await news.state(req.auth!.userId, newsIdSchema.parse(req.params.id), body.action, body.expectedVersion, String(req.id)));
  });
  return router;
}
