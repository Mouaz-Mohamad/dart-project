// DART CODE GUIDE | backend/src/modules/identity/social-auth.routes.ts
// الغرض: HTTP routes لتسجيل عميل Dart عبر Google/Facebook بدون كشف أي OAuth secret للمتصفح.
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import type { RequestMetadata } from "./identity.types.js";
import type { IdentityService } from "./identity.service.js";
import {
  type SocialAuthService,
  type SocialProvider,
} from "./social-auth.service.js";

const providerSchema = z.enum(["google", "facebook"]);
const destinationSchema = z.enum(["profile", "checkout"]).default("profile");
const completionSchema = z
  .object({
    token: z.string().min(40).max(500),
    password: z.string().min(6).max(200),
    confirmation: z.string().min(6).max(200),
    birthday: z.iso.date(),
    name: z.string().trim().min(3).max(120).optional(),
    phone1: z.string().trim().min(10).max(25).optional(),
    phone2: z.string().trim().min(10).max(25).optional(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match",
  });

function metadata(request: Request): RequestMetadata {
  const ipAddress = request.ip;
  const userAgent = request.get("user-agent");
  return {
    requestId: String(request.id),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function authLimiter(limit = 20) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
}

function setSessionCookies(
  response: Response,
  config: Pick<
    AppConfig,
    "nodeEnv" | "sessionCookieName" | "sessionCookieSameSite"
  >,
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

function providerFromRequest(request: Request): SocialProvider {
  return providerSchema.parse(request.params.provider);
}

export function createSocialAuthRouter(
  service: SocialAuthService,
  identity: IdentityService,
  config: Pick<
    AppConfig,
    "nodeEnv" | "sessionCookieName" | "sessionCookieSameSite"
  >,
): Router {
  const router = Router();

  router.get("/auth/social/providers", (_request, response) => {
    response.status(200).json({ providers: service.providers() });
  });

  router.get(
    "/auth/social/:provider/start",
    authLimiter(),
    async (request, response) => {
      const provider = providerFromRequest(request);
      const destination = destinationSchema.parse(request.query.next);
      const authorizationUrl = await service.start(provider, destination);
      response.setHeader("Referrer-Policy", "no-referrer");
      response.redirect(303, authorizationUrl);
    },
  );

  router.get(
    "/auth/social/:provider/callback",
    authLimiter(),
    async (request, response) => {
      const provider = providerFromRequest(request);
      response.setHeader("Referrer-Policy", "no-referrer");
      const state = String(request.query.state || "");
      if (request.query.error) {
        response.redirect(
          303,
          await service.cancelProviderCallback(provider, state),
        );
        return;
      }
      try {
        const destination = await service.completeProviderCallback(
          provider,
          String(request.query.code || ""),
          state,
        );
        response.redirect(303, destination);
      } catch (error) {
        const safeCode =
          error && typeof error === "object" && "code" in error
            ? String(error.code || "SOCIAL_AUTH_FAILED")
            : "SOCIAL_AUTH_FAILED";
        response.redirect(303, service.failureRedirect(provider, safeCode));
      }
    },
  );

  router.post(
    "/auth/social/challenge",
    authLimiter(30),
    async (request, response) => {
      const body = z.object({ token: z.string().min(40).max(500) }).parse(request.body);
      response.status(200).json(await service.challenge(body.token));
    },
  );

  router.post(
    "/auth/social/complete",
    authLimiter(),
    async (request, response) => {
      const body = completionSchema.parse(request.body);
      const session = await service.complete(body, metadata(request));
      setSessionCookies(response, config, session);
      response.status(200).json({
        user: await identity.profile(session.account),
        csrfToken: session.csrfToken,
      });
    },
  );

  return router;
}
