// DART CODE GUIDE | backend/src/modules/waiting/waiting.routes.ts
// الغرض: HTTP API لنظام Waiting للعملاء والموظفين مع صلاحيات دقيقة لكل Action.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
  requireActionPermission,
  requireMfa,
  requirePermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { WaitingService } from "./waiting.service.js";

const entryIdSchema = z.string().uuid();
const joinSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  size: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(120),
});

const adminActionSchema = z.object({
  action: z.enum([
    "cancel",
    "release",
    "extend",
    "resend",
    "edit_request",
    "offer_alternative",
    "move_top",
    "reset_priority",
    "reassign",
  ]),
  reason: z.string().trim().max(500).optional(),
  hours: z.number().int().min(1).max(72).optional(),
  color: z.string().trim().min(1).max(120).optional(),
  size: z.string().trim().min(1).max(120).optional(),
  targetWaitlistId: z.string().uuid().optional(),
  cancelPrevious: z.boolean().optional(),
});

const adminActionPermissions = {
  cancel: ["waiting.cancel"],
  release: ["waiting.release"],
  extend: ["waiting.extend"],
  resend: ["waiting.resend"],
  edit_request: ["waiting.edit"],
  offer_alternative: ["waiting.offer_alternative"],
  move_top: ["waiting.priority_override"],
  reset_priority: ["waiting.priority_override"],
  reassign: ["waiting.reassign"],
} as const;

export function createWaitingRouter(
  waiting: WaitingService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
  outbox?: OutboxService,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get(
    "/me/waiting",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await waiting.mine(request.auth!.userId),
      );
    },
  );

  router.post(
    "/me/waiting",
    rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = joinSchema.parse(request.body);
      const entry = await waiting.join(
        request.auth!.userId,
        body,
        String(request.id),
      );
      await outbox?.processBatch(10).catch(() => undefined);
      response.status(201).json({ entry });
    },
  );

  router.delete(
    "/me/waiting/:entryId",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const entryId = entryIdSchema.parse(request.params.entryId);
      response.status(200).json({
        entry: await waiting.cancelMine(
          request.auth!.userId,
          entryId,
          String(request.id),
        ),
      });
    },
  );

  router.post(
    "/me/waiting/:entryId/confirm",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const entryId = entryIdSchema.parse(request.params.entryId);
      response.status(200).json({
        entry: await waiting.confirmMine(
          request.auth!.userId,
          entryId,
          String(request.id),
        ),
      });
    },
  );

  router.post(
    "/me/waiting/:entryId/decline-alternative",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const entryId = entryIdSchema.parse(request.params.entryId);
      response.status(200).json({
        entry: await waiting.declineAlternative(
          request.auth!.userId,
          entryId,
          String(request.id),
        ),
      });
    },
  );

  router.get(
    "/admin/waiting/version",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("waiting.view"),
    async (_request, response) => {
      response.status(200).json({
        version: await waiting.version(),
      });
    },
  );

  router.get(
    "/admin/waiting",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("waiting.view"),
    async (request, response) => {
      const query = z.object({
        search: z.string().trim().max(160).optional(),
        modelId: z.string().trim().max(120).optional(),
        color: z.string().trim().max(120).optional(),
        size: z.string().trim().max(120).optional(),
        status: z.enum([
          "waiting",
          "reserved",
          "confirmed",
          "converted",
          "expired",
          "cancelled",
        ]).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).max(100000).optional(),
      }).parse(request.query);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await waiting.adminList(query),
      );
    },
  );

  router.get(
    "/admin/waiting/:entryId/audit",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("waiting.audit_read"),
    async (request, response) => {
      const entryId = entryIdSchema.parse(request.params.entryId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({
        audit: await waiting.adminAudit(entryId),
      });
    },
  );

  router.post(
    "/admin/waiting/reconcile",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("waiting.reassign"),
    async (request, response) => {
      const result = await waiting.reconcile(
        request.auth!.userId,
        String(request.id),
      );
      await outbox?.processBatch(20).catch(() => undefined);
      response.status(200).json(result);
    },
  );

  router.post(
    "/admin/waiting/:entryId/action",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireActionPermission(
      "action",
      adminActionPermissions,
    ),
    async (request, response) => {
      const entryId = entryIdSchema.parse(request.params.entryId);
      const body = adminActionSchema.parse(request.body);
      const entry = await waiting.adminAction(
        entryId,
        body,
        request.auth!.userId,
        String(request.id),
      );
      await outbox?.processBatch(10).catch(() => undefined);
      response.status(200).json({ entry });
    },
  );

  return router;
}