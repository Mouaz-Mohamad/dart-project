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
import {
  DASHBOARD_DOMAINS,
  type DashboardDomain,
  type DashboardStateService,
} from "./dashboard-state.service.js";

const domainSchema = z.enum(DASHBOARD_DOMAINS);
const writeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  data: z.array(z.unknown()).max(20000),
});

export function createDashboardStateRouter(
  state: DashboardStateService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get(
    "/admin/audit",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.read"),
    async (request, response) => {
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(1500).optional(),
        entityType: z.string().trim().min(1).max(120).optional(),
        entityId: z.string().trim().min(1).max(200).optional(),
      }).parse(request.query);
      const auditInput: {
        limit?: number;
        entityType?: string;
        entityId?: string;
      } = {};
      if (query.limit !== undefined) auditInput.limit = query.limit;
      if (query.entityType !== undefined) auditInput.entityType = query.entityType;
      if (query.entityId !== undefined) auditInput.entityId = query.entityId;
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ audit: await state.audit(auditInput) });
    },
  );

  router.get("/reviews", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ reviews: await state.publicReviews() });
  });

  router.get(
    "/admin/domain-state/:domain",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.read"),
    async (request, response) => {
      const domain = domainSchema.parse(request.params.domain) as DashboardDomain;
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await state.read(domain));
    },
  );

  router.put(
    "/admin/domain-state/:domain",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.manage"),
    async (request, response) => {
      const domain = domainSchema.parse(request.params.domain) as DashboardDomain;
      const body = writeSchema.parse(request.body);
      response.status(200).json(
        await state.write(domain, body.expectedVersion, body.data, request.auth!.userId, String(request.id)),
      );
    },
  );

  return router;
}
