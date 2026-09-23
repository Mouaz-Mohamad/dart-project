// DART CODE GUIDE | backend/src/modules/loyalty/dart-card-draw.routes.ts
// الغرض: Routes لإدارة/تشغيل Dart Card monthly draw مع endpoint داخلي صالح لأي scheduler خادمي.
import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
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
import type { DartCardDrawService } from "./dart-card-draw.service.js";

const period = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);

function tokenEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left,right);
}

export function createDartCardDrawRouter(
  draws: DartCardDrawService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper" | "outboxCronSecret">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get(
    "/admin/dart-card/draws/:period/preview",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dart_card_draws.read"),
    async (request,response) => {
      response.setHeader("Cache-Control","no-store");
      response.status(200).json(await draws.preview(period.parse(request.params.period)));
    },
  );

  router.post(
    "/admin/dart-card/draws/:period/run",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dart_card_draws.manage"),
    async (request,response) => {
      response.status(200).json(
        await draws.run(
          period.parse(request.params.period),
          request.auth!.userId,
          String(request.id),
          "staff",
        ),
      );
    },
  );

  router.get(
    "/admin/dart-card/draws",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("dart_card_draws.read"),
    async (request,response) => {
      const limit = z.coerce.number().int().min(1).max(120).default(24).parse(request.query.limit);
      response.setHeader("Cache-Control","no-store");
      response.status(200).json({ draws: await draws.history(limit) });
    },
  );

  async function runDue(request: Request, response: Response) {
    const expected = config.outboxCronSecret;
    const authorization = String(request.get("authorization") || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!expected || expected.length < 32 || !tokenEquals(token,expected)) {
      response.status(401).json({
        error: { code: "DART_CARD_DRAW_UNAUTHORIZED", message: "Unauthorized monthly draw request" },
      });
      return;
    }
    response.status(200).json(await draws.runDue(null,String(request.id),"system"));
  }

  router.get("/internal/dart-card/monthly-draw", runDue);
  router.post("/internal/dart-card/monthly-draw", runDue);

  return router;
}
