// DART CODE GUIDE | backend/src/modules/sets/set.routes.ts
// HTTP contracts for public Sets and permissioned Dart Eye Set management.
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
import type { SetService } from "./set.service.js";

const setIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const componentSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(20).default(1),
});
const setWriteBaseSchema = z.object({
  setId: setIdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).default(""),
  basePriceMinor: z.number().int().min(0).max(1_000_000_000),
  discountPercent: z.number().min(0).max(100).default(0),
  images: z.array(z.string().trim().min(1).max(1200)).max(30).default([]),
  components: z.array(componentSchema).min(1).max(100),
});

function validateSetPieceCount(
  value: { components: Array<{ quantity: number }> },
  context: z.RefinementCtx,
): void {
  const pieceCount = value.components.reduce((sum, component) => sum + component.quantity, 0);
  if (pieceCount > 100) {
    context.addIssue({
      code: "custom",
      path: ["components"],
      message: "A Set can contain at most 100 physical pieces",
    });
  }
}

const setWriteSchema = setWriteBaseSchema.superRefine(validateSetPieceCount);

const setUpdateSchema = setWriteBaseSchema
  .omit({ setId: true })
  .extend({ expectedVersion: z.number().int().positive() })
  .superRefine(validateSetPieceCount);

export function createSetRouter(
  sets: SetService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get("/sets", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await sets.publicSets());
  });

  router.get("/sets/settings", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ settings: await sets.discountSettings() });
  });

  router.get("/sets/:setId", async (request, response) => {
    const setId = setIdSchema.parse(request.params.setId);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await sets.publicSet(setId));
  });

  router.get(
    "/admin/sets",
    signedIn,
    requireAccountType("staff"),
    requirePermission("sets.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await sets.adminSets());
    },
  );

  router.post(
    "/admin/sets",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("sets.manage"),
    async (request, response) => {
      const body = setWriteSchema.parse(request.body);
      const result = await sets.createSet(request.auth!.userId, body, String(request.id));
      response.status(201).json(result);
    },
  );

  router.put(
    "/admin/sets/:setId",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("sets.manage"),
    async (request, response) => {
      const setId = setIdSchema.parse(request.params.setId);
      const body = setUpdateSchema.parse(request.body);
      const { expectedVersion, ...input } = body;
      response.status(200).json(
        await sets.updateSet(
          request.auth!.userId,
          setId,
          expectedVersion,
          input,
          String(request.id),
        ),
      );
    },
  );

  router.post(
    "/admin/sets/:setId/state",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("sets.manage"),
    async (request, response) => {
      const setId = setIdSchema.parse(request.params.setId);
      const body = z.object({
        action: z.enum(["archive", "restore"]),
        expectedVersion: z.number().int().positive(),
      }).parse(request.body);
      response.status(200).json(
        await sets.setState(
          request.auth!.userId,
          setId,
          body.action,
          body.expectedVersion,
          String(request.id),
        ),
      );
    },
  );

  router.get(
    "/admin/sets/settings",
    signedIn,
    requireAccountType("staff"),
    requirePermission("sets.read"),
    async (_request, response) => {
      response.status(200).json({ settings: await sets.discountSettings() });
    },
  );

  router.put(
    "/admin/sets/settings",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("sets.manage"),
    async (request, response) => {
      const body = z.object({
        expectedVersion: z.number().int().positive(),
        birthdayPercent: z.number().min(0).max(100),
        dartCardPercent: z.number().min(0).max(100),
      }).parse(request.body);
      response.status(200).json({
        settings: await sets.updateDiscountSettings(
          request.auth!.userId,
          body.expectedVersion,
          body.birthdayPercent,
          body.dartCardPercent,
          String(request.id),
        ),
      });
    },
  );

  return router;
}
