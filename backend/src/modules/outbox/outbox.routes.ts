// DART CODE GUIDE | backend/src/modules/outbox/outbox.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/env.js";
import type { OutboxService } from "./outbox.service.js";
import type { MaintenanceResult } from "./maintenance.js";

function safeTokenEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOutboxRouter(
  outbox: OutboxService,
  config: Pick<AppConfig, "outboxCronSecret" | "vercelCronSecret">,
  maintenance?: () => Promise<void | MaintenanceResult>,
): Router {
  const router = Router();

  async function process(request: Request, response: Response) {
    const authorization = String(request.get("authorization") || "");
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    // GitHub's legacy worker and Vercel's native cron use independent server-only tokens.
    // Neither allows anonymous access; both retain the same durable idempotent processor.
    const validSecrets = [config.outboxCronSecret,config.vercelCronSecret]
      .filter((secret): secret is string => typeof secret === "string" && secret.length >= 32);
    if (!validSecrets.some((expected) => safeTokenEquals(token, expected))) {
      response.status(401).json({
        error: {
          code: "OUTBOX_UNAUTHORIZED",
          message: "Unauthorized outbox processor request",
        },
      });
      return;
    }
    const query = z.object({ limit: z.coerce.number().int().min(1).max(10).default(request.method === "GET" ? 10 : 5) }).parse(request.query);
    let maintenanceResult: MaintenanceResult = { ok: true, failedJobs: [] };
    try {
      maintenanceResult = await maintenance?.() || maintenanceResult;
    } catch {
      // Report a bounded, non-sensitive failure while still draining the outbox.
      maintenanceResult = { ok: false, failedJobs: ["maintenance"] };
    }
    const result = await outbox.processBatch(query.limit);
    response.status(200).json({ ...result, maintenance: maintenanceResult, health: await outbox.health() });
  }

  router.post("/internal/outbox/process", process);
  // Vercel Cron invokes GET; authentication is identical to the internal POST route.
  router.get("/internal/outbox/process", process);

  return router;
}
