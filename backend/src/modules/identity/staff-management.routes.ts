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
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
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
    "/admin/staff/invitations",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.manage"),
    async (request, response) => {
      const body = z.object({
        email: z.email().max(254),
        phone: z.string().min(10).max(25),
        displayName: z.string().trim().min(3).max(120),
        permissionKeys: z.array(z.string().trim().min(3).max(120)).max(300).default([]),
        mfaRequired: z.boolean().default(true),
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
        ?.processBatch(1, `staff-invited:${invitation.invitationId}`)
        .catch(() => undefined);
      response.status(201).json({
        ...invitation,
        whatsappDelivery: delivery
          ? {
              configured: delivery.configured,
              published: delivery.published,
              failed: delivery.failed,
            }
          : { configured: false, published: 0, failed: 0 },
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
