// Read-only experiment routes; never mounted by application.ts.
import { Router } from "express";
import type { AppConfig } from "../../src/config/env.js";
import type { CommerceService } from "../../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../../src/modules/identity/identity.service.js";
import { authenticate, requireAccountType, requireMfa, requirePermission } from "../../src/middleware/authentication.js";
export function pilotRouter(identity: IdentityService, commerce: CommerceService,
  config: Pick<AppConfig, "sessionCookieName">) {
  const router = Router();
  router.use(authenticate(identity, config), requireAccountType("staff"), requireMfa, requirePermission("orders.read"));
  router.use((_request, response, next) => { response.set("Cache-Control", "private, no-store"); next(); });
  router.get("/snapshot", async (_request, response) => response.json(await commerce.adminOrders()));
  router.get("/version", async (_request, response) => response.json({ version: await commerce.adminOrdersVersion() }));
  return router;
}
