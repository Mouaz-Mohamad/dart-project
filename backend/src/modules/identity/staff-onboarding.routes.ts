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
    const result = await service.startStaffOnboarding(body.email, {
      requestId: String(request.id),
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.get("user-agent")
        ? { userAgent: request.get("user-agent")! }
        : {}),
    });
    if (result.deliveryQueued) {
      const eventKey = `staff-onboarding-code:${result.challengeId}`;
      try {
        const delivery = await outbox.processBatch(1, eventKey);
        if (delivery.published !== 1) {
          logger?.warn({ eventKey }, "Staff onboarding email is queued for retry");
          throw new AppError(
            503,
            "EMAIL_DELIVERY_UNAVAILABLE",
            "Dart could not send the verification email. Please try again shortly.",
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        logger?.warn(
          {
            eventKey,
            errorName: error instanceof Error ? error.name : "Error",
          },
          "Staff onboarding email dispatch failed and remains queued",
        );
        throw new AppError(
          503,
          "EMAIL_DELIVERY_UNAVAILABLE",
          "Dart could not send the verification email. Please try again shortly.",
        );
      }
    }
    response.status(202).json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
      message: "If this email is invited, a verification code has been sent.",
    });
  }

  router.post("/admin/auth/onboarding/start", limiter(), startOrResend);
  router.post("/admin/auth/onboarding/resend", limiter(), startOrResend);

  router.post("/admin/auth/onboarding/verify", limiter(), async (request, response) => {
    const body = z.object({
      challengeId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    }).parse(request.body);
    const result = await service.verifyStaffOnboarding(body.challengeId, body.code, {
      requestId: String(request.id),
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.get("user-agent")
        ? { userAgent: request.get("user-agent")! }
        : {}),
    });
    response.status(200).json({
      setupToken: result.setupToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  router.post("/admin/auth/onboarding/complete", limiter(), async (request, response) => {
    const body = z.object({
      challengeId: z.uuid(),
      setupToken: z.string().min(20).max(500),
      credential: z.string().min(12).max(200),
      confirmation: z.string().min(12).max(200),
    }).refine((value) => value.credential === value.confirmation, {
      path: ["confirmation"],
      message: "Credentials do not match",
    }).parse(request.body);

    const session = await service.completeStaffOnboarding(
      body.challengeId,
      body.setupToken,
      body.credential,
      {
        requestId: String(request.id),
        ...(request.ip ? { ipAddress: request.ip } : {}),
        ...(request.get("user-agent")
          ? { userAgent: request.get("user-agent")! }
          : {}),
      },
    );
    setCookies(response, config, session);
    response.status(201).json({
      user: await service.profile(session.account),
      permissions: session.account.permissions,
      csrfToken: session.csrfToken,
      mfaSetupRequired:
        session.account.mfaRequired && !session.account.mfaSatisfied,
    });
  });

  return router;
}
