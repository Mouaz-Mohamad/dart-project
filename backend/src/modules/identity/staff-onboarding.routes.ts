import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import type { IdentityService } from "./identity.service.js";

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
): Router {
  const router = Router();

  router.post("/admin/auth/onboarding/start", limiter(), async (request, response) => {
    const body = z.object({ email: z.email().max(254) }).parse(request.body);
    const result = await service.startStaffOnboarding(body.email, {
      requestId: String(request.id),
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.get("user-agent")
        ? { userAgent: request.get("user-agent")! }
        : {}),
    });
    response.status(202).json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
      message: "If this email is invited, a verification code has been sent.",
    });
  });

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
