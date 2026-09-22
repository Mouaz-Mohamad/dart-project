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
import type { IdentityService } from "./identity.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";

export function createStaffManagementRouter(
  service: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper" | "staffLegacyAuthEnabled">,
  outbox?: OutboxService,
): Router {
  const router = Router();
  const signedIn = authenticate(service, config);
  const csrf = csrfProtection(config);

  router.get(
    "/admin/staff",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.read"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await service.staffDirectory(request.auth!));
    },
  );

  router.post(
    "/admin/staff/allowlist",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        email: z.email().max(254),
        role: z.enum(["owner", "staff"]).default("staff"),
        permissionKeys: z.array(z.string().trim().min(3).max(120)).max(300).default([]),
      }).parse(request.body);
      response.status(201).json(
        await service.createStaffEmailAccess(
          request.auth!,
          body,
          {
            requestId: String(request.id),
            ...(request.ip ? { ipAddress: request.ip } : {}),
            ...(request.get("user-agent")
              ? { userAgent: request.get("user-agent")! }
              : {}),
          },
        ),
      );
    },
  );

  router.delete(
    "/admin/staff/allowlist/:id",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        reason: z.string().trim().max(500).default(""),
      }).parse(request.body || {});
      await service.removeStaffEmailAccess(
        request.auth!,
        z.uuid().parse(request.params.id),
        body.reason,
        {
          requestId: String(request.id),
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(request.get("user-agent")
            ? { userAgent: request.get("user-agent")! }
            : {}),
        },
      );
      response.status(204).end();
    },
  );

  router.patch(
    "/admin/staff/:id/access",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        active: z.boolean(),
        reason: z.string().trim().max(500).default(""),
      }).refine(
        (value) => value.active || value.reason.length >= 3,
        {
          path: ["reason"],
          message: "A disable reason is required",
        },
      ).parse(request.body);
      await service.setStaffAccessStatus(
        request.auth!,
        z.uuid().parse(request.params.id),
        body.active,
        body.reason,
        {
          requestId: String(request.id),
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(request.get("user-agent")
            ? { userAgent: request.get("user-agent")! }
            : {}),
        },
      );
      response.status(204).end();
    },
  );

  router.post(
    "/admin/staff/:id/sessions/revoke",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      await service.revokeStaffSessions(
        request.auth!,
        z.uuid().parse(request.params.id),
        {
          requestId: String(request.id),
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(request.get("user-agent")
            ? { userAgent: request.get("user-agent")! }
            : {}),
        },
      );
      response.status(204).end();
    },
  );

  router.post(
    "/admin/staff/:id/google/relink",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        email: z.email().max(254),
        reason: z.string().trim().min(8).max(500),
      }).parse(request.body);
      await service.relinkStaffGoogleIdentity(
        request.auth!,
        z.uuid().parse(request.params.id),
        body.email,
        body.reason,
        {
          requestId: String(request.id),
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(request.get("user-agent")
            ? { userAgent: request.get("user-agent")! }
            : {}),
        },
      );
      response.status(204).end();
    },
  );

  router.post(
    "/admin/staff/invitations",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      if (config.staffLegacyAuthEnabled === false) {
        response.status(410).json({
          error: {
            code: "STAFF_LEGACY_AUTH_DISABLED",
            message: "This Staff invitation method has been retired.",
            requestId: String(request.id),
          },
        });
        return;
      }
      const body = z.object({
        email: z.email().max(254),
        phone: z.string().trim().max(25).optional().default(""),
        displayName: z.string().trim().min(3).max(120),
        permissionKeys: z.array(z.string().trim().min(3).max(120)).max(300).default([]),
        mfaRequired: z.boolean().default(false),
      }).parse(request.body);
      const invitation = await service.createStaffInvitation(
        request.auth!,
        body,
        {
          requestId: String(request.id),
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(request.get("user-agent")
            ? { userAgent: request.get("user-agent")! }
            : {}),
        },
      );
      const delivery = await outbox
        ?.processBatch(1, `staff-onboarding-code:${invitation.challengeId}`)
        .catch(() => undefined);
      response.status(201).json({
        ...invitation,
        emailDelivery: delivery
          ? {
              configured: outbox?.configured("email") === true,
              published: delivery.published,
              failed: delivery.failed,
            }
          : { configured: false, published: 0, failed: 0 },
      });
    },
  );

  router.get(
    "/admin/delivery-events",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({
        events: outbox ? await outbox.recentEvents(50) : [],
      });
    },
  );

  router.put(
    "/admin/staff/:id/permissions",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        permissionKeys: z.array(z.string().trim().min(3).max(120)).max(300),
      }).parse(request.body);
      response.status(200).json({
        permissions: await service.setStaffPermissions(
          request.auth!,
          z.uuid().parse(request.params.id),
          body.permissionKeys,
          {
            requestId: String(request.id),
            ...(request.ip ? { ipAddress: request.ip } : {}),
            ...(request.get("user-agent")
              ? { userAgent: request.get("user-agent")! }
              : {}),
          },
        ),
      });
    },
  );

  return router;
}
