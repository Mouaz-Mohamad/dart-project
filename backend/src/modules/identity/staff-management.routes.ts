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

export function createStaffManagementRouter(
  service: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
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
        displayName: z.string().trim().min(3).max(120),
        permissionKeys: z.array(z.string().trim().min(3).max(120)).max(300).default([]),
        mfaRequired: z.boolean().default(true),
      }).parse(request.body);
      response.status(201).json(
        await service.createStaffInvitation(
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
