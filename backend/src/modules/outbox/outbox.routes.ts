// DART CODE GUIDE | backend/src/modules/outbox/outbox.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/env.js";
import type { OutboxService } from "./outbox.service.js";

function safeTokenEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOutboxRouter(
  outbox: OutboxService,
  config: Pick<AppConfig, "outboxCronSecret">,
): Router {
  const router = Router();

  async function process(request: Request, response: Response) {
    const expected = config.outboxCronSecret;
    const authorization = String(request.get("authorization") || "");
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!expected || expected.length < 32 || !safeTokenEquals(token, expected)) {
      response.status(401).json({
        error: {
          code: "OUTBOX_UNAUTHORIZED",
          message: "Unauthorized outbox processor request",
        },
      });
      return;
    }
    response.status(200).json(await outbox.processBatch());
  }

  router.get("/internal/outbox/process", process);
  router.post("/internal/outbox/process", process);

  return router;
}
