// DART CODE GUIDE | backend/src/modules/finance/finance.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  requireAccountType,
  requireMfa,
  requirePermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { FinanceService } from "./finance.service.js";

const querySchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((value) => value.start <= value.end, {
    message: "start must be on or before end",
    path: ["end"],
  });

export function createFinanceRouter(
  finance: FinanceService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);

  router.get(
    "/admin/finance/summary",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("finance.read"),
    async (request, response) => {
      const query = querySchema.parse(request.query);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({
        start: query.start,
        end: query.end,
        summary: await finance.summary(query.start, query.end),
      });
    },
  );

  return router;
}
