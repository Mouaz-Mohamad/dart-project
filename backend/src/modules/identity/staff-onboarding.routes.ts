// DART CODE GUIDE | backend/src/modules/identity/staff-onboarding.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import type { IdentityService } from "./identity.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";

function limiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return domain ? `${local.slice(0, 1) || "*"}***@${domain}` : "***";
}

async function recentStaffEmailFailure(
  outbox: OutboxService,
  email: string,
): Promise<Record<string, unknown> | null> {
  try {
    const recipient = maskEmail(email);
    const events = await outbox.recentEvents(20);
    return (
      events.find(
        (event) =>
          String(event.eventType || "") === "STAFF_EMAIL_ACCESS_CODE_REQUESTED" &&
          String(event.recipient || "") === recipient &&
          String(event.status || "") === "failed",
      ) || null
    );
  } catch {
    return null;
  }
}

function setCookies(
  response: Response,
  config: Pick<AppConfig, "nodeEnv" | "sessionCookieName" | "sessionCookieSameSite">,
  session: { sessionToken: string; csrfToken: string; expiresAt: Date },
): void {
  const secure =
    config.nodeEnv === "production" || config.sessionCookieSameSite === "none";
  response.cookie(config.sessionCookieName, session.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: config.sessionCookieSameSite,
    path: "/api/v1",
    expires: session.expiresAt,
  });
  response.cookie("dart_csrf", session.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: config.sessionCookieSameSite,
    path: "/",
    expires: session.expiresAt,
  });
}

export function createStaffOnboardingRouter(
  service: IdentityService,
  config: Pick<
    AppConfig,
    "nodeEnv" | "sessionCookieName" | "sessionCookieSameSite"
  >,
  outbox?: OutboxService,
  logger?: Logger,
): Router {
  const router = Router();

  async function startOrResend(request: Request, response: Response) {
    const body = z.object({ email: z.email().max(254) }).parse(request.body);
    if (!outbox?.configured("email")) {
      throw new AppError(
        503,
        "EMAIL_DELIVERY_UNAVAILABLE",
        "Dart email delivery is temporarily unavailable. Please try again shortly.",
      );
    }
    const result = await service.startStaffEmailAccess(body.email, {
      requestId: String(request.id),
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.get("user-agent")
        ? { userAgent: request.get("user-agent")! }
        : {}),
    });

    if (result.deliveryQueued) {
      const eventKey = `staff-email-access-code:${result.challengeId}`;
      try {
        const delivery = await outbox.processBatch(1, eventKey);
        if (delivery.published !== 1) {
          const failedEvent = await recentStaffEmailFailure(outbox, body.email);
          logger?.warn(
            {
              eventKey,
              claimed: delivery.claimed,
              published: delivery.published,
              failed: delivery.failed,
              lastError: failedEvent?.lastError || null,
            },
            "Staff access email was not delivered immediately and remains queued",
          );
        }
      } catch (error) {
        const failedEvent = await recentStaffEmailFailure(outbox, body.email);
        logger?.warn(
          {
            eventKey,
            errorName: error instanceof Error ? error.name : "Error",
            lastError: failedEvent?.lastError || null,
          },
          "Staff access email dispatch failed and remains queued",
        );
      }
    }

    response.status(202).json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
      message: "If this email is allowed, a verification code has been sent.",
    });
  }

  router.post("/admin/auth/email/start", limiter(), startOrResend);
  router.post("/admin/auth/email/resend", limiter(), startOrResend);

  router.post("/admin/auth/email/verify", limiter(), async (request, response) => {
    const body = z.object({
      challengeId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    }).parse(request.body);
    const session = await service.verifyStaffEmailAccess(
      body.challengeId,
      body.code,
      {
        requestId: String(request.id),
        ...(request.ip ? { ipAddress: request.ip } : {}),
        ...(request.get("user-agent")
          ? { userAgent: request.get("user-agent")! }
          : {}),
      },
    );
    setCookies(response, config, session);
    response.status(200).json({
      user: await service.profile(session.account),
      permissions: session.account.permissions,
      csrfToken: session.csrfToken,
    });
  });

  return router;
}
