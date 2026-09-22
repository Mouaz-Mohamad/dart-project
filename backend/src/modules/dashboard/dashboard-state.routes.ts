// DART CODE GUIDE | backend/src/modules/dashboard/dashboard-state.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
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

const SENSITIVE_DOMAIN_PERMISSIONS: Partial<
  Record<DashboardDomain, { read: string; write: string }>
> = {
  customers: { read: "customers.read", write: "customers.manage" },
  returns: { read: "returns.read", write: "returns.manage" },
  representatives: {
    read: "representatives.manage",
    write: "representatives.manage",
  },
  damage: { read: "damage.manage", write: "damage.manage" },
  reviews: { read: "reviews.read", write: "reviews.manage" },
  contacts: { read: "contacts.read", write: "contacts.manage" },
  cards: { read: "loyalty.read", write: "loyalty.manage" },
  birthday_rewards: { read: "loyalty.read", write: "loyalty.manage" },
  birthday_messages: { read: "messaging.read", write: "messaging.manage" },
  message_queue: { read: "messaging.read", write: "messaging.manage" },
  notifications: {
    read: "notifications.read",
    write: "notifications.manage",
  },
  promotions: { read: "promotions.read", write: "promotions.manage" },
  finance_expenses: { read: "finance.read", write: "finance.manage" },
  finance_budgets: { read: "finance.read", write: "finance.manage" },
  finance_invoices: { read: "finance.read", write: "finance.manage" },
  finance_goals: { read: "finance.read", write: "finance.manage" },
  finance_marketing: { read: "finance.read", write: "finance.manage" },
  finance_settlements: { read: "finance.read", write: "finance.manage" },
  finance_audit: { read: "finance.read", write: "finance.manage" },
  draw_audit: { read: "loyalty.read", write: "loyalty.manage" },
};

function requireSensitiveDomainPermission(
  domain: DashboardDomain,
  mode: "read" | "write",
  permissions: string[],
): void {
  const permission = SENSITIVE_DOMAIN_PERMISSIONS[domain]?.[mode];
  if (permission && !permissions.includes(permission)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to access this dashboard domain",
    );
  }
}
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
    "/admin/domain-state-versions",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ versions: await state.versions() });
    },
  );

  router.get(
    "/admin/domain-state",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.read"),
    async (request, response) => {
      const readable = DASHBOARD_DOMAINS.filter((domain) => {
        const permission = SENSITIVE_DOMAIN_PERMISSIONS[domain]?.read;
        return !permission || request.auth!.permissions.includes(permission);
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ domains: await state.readMany(readable) });
    },
  );

  router.get(
    "/admin/domain-state/:domain",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dashboard_state.read"),
    async (request, response) => {
      const domain = domainSchema.parse(request.params.domain) as DashboardDomain;
      requireSensitiveDomainPermission(
        domain,
        "read",
        request.auth!.permissions,
      );
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
      requireSensitiveDomainPermission(
        domain,
        "write",
        request.auth!.permissions,
      );
      const body = writeSchema.parse(request.body);
      response.status(200).json(
        await state.write(domain, body.expectedVersion, body.data, request.auth!.userId, String(request.id)),
      );
    },
  );

  return router;
}
