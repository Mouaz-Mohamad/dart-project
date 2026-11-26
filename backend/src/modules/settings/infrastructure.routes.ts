import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { authenticate, csrfProtection, requireAccountType, requireMfa, requirePermission } from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { InfrastructureService } from "./infrastructure.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import { infrastructureSchema } from "./infrastructure-policy.js";

export function createInfrastructureRouter(service: InfrastructureService, identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">, outbox?: OutboxService) {
  const router = Router();
  router.use("/admin/infrastructure", authenticate(identity, config), requireAccountType("staff"), requireMfa,
    requirePermission("settings.manage"), (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/admin/infrastructure", async (_request, response) => { response.json(await service.get()); });
  router.put("/admin/infrastructure", csrfProtection(config), async (request, response) => {
    const body = z.object({ expectedRevision: z.number().int().nonnegative(), settings: infrastructureSchema }).strict().parse(request.body);
    response.json(await service.save(body.expectedRevision, body.settings, request.auth!.userId, String(request.id)));
  });
  router.get("/admin/infrastructure/usage/:kind", async (request, response) => {
    const kind = z.enum(["database", "hosting"]).parse(request.params.kind);
    response.json(await service.usage(kind));
  });
  if (outbox) router.post("/admin/infrastructure/process", csrfProtection(config), async (request, response) => {
    await service.auditManual(request.auth!.userId, String(request.id));
    // User-initiated dispatch intentionally bypasses quiet hours; existing outbox deduplication remains authoritative.
    response.json({ ...await outbox.processBatch(5), health: await outbox.health() });
  });
  return router;
}
