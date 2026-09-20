import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
  requireMfa,
  requirePermission,
} from "../../middleware/authentication.js";
import type { AccountType, RequestMetadata } from "./identity.types.js";
import type { IdentityService } from "./identity.service.js";

const password = z.string().min(12).max(200);
const email = z.email().max(254);
const egyptianPhone = z.string().min(10).max(25);
const uuid = z.uuid();

const registerCustomerSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email,
  phone1: egyptianPhone,
  phone2: egyptianPhone.optional(),
  birthday: z.iso.date().optional(),
  password,
});

const registerRepresentativeSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email,
  phone1: egyptianPhone,
  phone2: egyptianPhone.optional(),
  nationalId: z.string().regex(/^\d{14}$/),
  password,
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

function metadata(request: Request): RequestMetadata {
  const forwarded = request.ip;
  const userAgent = request.get("user-agent");
  return {
    requestId: String(request.id),
    ...(forwarded ? { ipAddress: forwarded } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function authLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        error: {
          code: "AUTH_RATE_LIMITED",
          message: "Too many authentication attempts; try again later",
          requestId: String(response.getHeader("x-request-id") ?? "unknown"),
        },
      });
    },
  });
}

function setSessionCookies(
  response: Response,
  config: Pick<AppConfig, "nodeEnv" | "sessionCookieName">,
  session: { sessionToken: string; csrfToken: string; expiresAt: Date },
): void {
  const secure = config.nodeEnv === "production";
  response.cookie(config.sessionCookieName, session.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/v1",
    expires: session.expiresAt,
  });
  response.cookie("dart_csrf", session.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "strict",
    path: "/",
    expires: session.expiresAt,
  });
}

function clearSessionCookies(
  response: Response,
  config: Pick<AppConfig, "nodeEnv" | "sessionCookieName">,
): void {
  const options = {
    secure: config.nodeEnv === "production",
    sameSite: "strict" as const,
  };
  response.clearCookie(config.sessionCookieName, { ...options, httpOnly: true, path: "/api/v1" });
  response.clearCookie("dart_csrf", { ...options, httpOnly: false, path: "/" });
}

export function createIdentityRouter(
  service: IdentityService,
  config: Pick<AppConfig, "nodeEnv" | "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(service, config);
  const csrf = csrfProtection(config);

  router.post("/auth/register", authLimiter(), async (request, response) => {
    const result = await service.registerCustomer(registerCustomerSchema.parse(request.body), metadata(request));
    response.status(202).json({
      status: "verification_required",
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  router.post("/auth/verify-email", authLimiter(), async (request, response) => {
    const body = z.object({ challengeId: uuid, code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const session = await service.verifyCustomerEmail(body.challengeId, body.code, metadata(request));
    setSessionCookies(response, config, session);
    response.status(200).json({ user: await service.profile(session.account), csrfToken: session.csrfToken });
  });

  router.post("/auth/resend-verification", authLimiter(), async (request, response) => {
    const body = z.object({ challengeId: uuid }).parse(request.body);
    const result = await service.resendCustomerVerification(body.challengeId, metadata(request));
    response.status(202).json({
      status: "verification_required",
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  router.post("/auth/login", authLimiter(), async (request, response) => {
    const body = loginSchema.parse(request.body);
    const session = await service.login("customer", body.identifier, body.password, metadata(request));
    setSessionCookies(response, config, session);
    response.status(200).json({ user: await service.profile(session.account), csrfToken: session.csrfToken });
  });

  router.post("/admin/auth/login", authLimiter(), async (request, response) => {
    const body = loginSchema.parse(request.body);
    const session = await service.login("staff", body.identifier, body.password, metadata(request), body.totp);
    setSessionCookies(response, config, session);
    response.status(200).json({
      user: await service.profile(session.account),
      csrfToken: session.csrfToken,
      mfaSetupRequired: session.account.mfaRequired && !session.account.mfaSatisfied,
    });
  });

  router.post("/representatives/register", authLimiter(), async (request, _response) => {
    registerRepresentativeSchema.parse(request.body);
    throw new AppError(
      503,
      "REPRESENTATIVE_DOCUMENT_STORAGE_NOT_CONFIGURED",
      "Secure representative document upload is not configured; the application was not saved",
    );
  });

  router.post("/representatives/login", authLimiter(), async (request, response) => {
    const body = loginSchema.parse(request.body);
    const session = await service.login("representative", body.identifier, body.password, metadata(request));
    setSessionCookies(response, config, session);
    response.status(200).json({ user: await service.profile(session.account), csrfToken: session.csrfToken });
  });

  router.post("/auth/forgot-password", authLimiter(), async (request, response) => {
    const body = z
      .object({
        identifier: z.string().trim().min(3).max(254),
        accountType: z.enum(["customer", "representative"]).default("customer"),
      })
      .parse(request.body);
    await service.requestPasswordReset(body.accountType, body.identifier, metadata(request));
    response.status(202).json({ message: "If the account exists, the request has been recorded" });
  });

  router.get("/me", signedIn, async (request, response) => {
    response.status(200).json({
      user: await service.profile(request.auth!),
      session: {
        mfaRequired: request.auth!.mfaRequired,
        mfaSatisfied: request.auth!.mfaSatisfied,
      },
    });
  });
  router.patch("/me", signedIn, csrf, requireAccountType("customer"), async (request, response) => {
    const body = z
      .object({
        name: z.string().trim().min(3).max(120),
        email,
        phone1: egyptianPhone,
        phone2: egyptianPhone.optional(),
        birthday: z.iso.date().optional(),
      })
      .parse(request.body);
    const result = await service.updateCustomerProfile(request.auth!, body, metadata(request));
    response.status(200).json({
      user: result.profile,
      ...(result.verification
        ? {
            verification: {
              challengeId: result.verification.challengeId,
              expiresAt: result.verification.expiresAt.toISOString(),
            },
          }
        : {}),
    });
  });
  router.get("/representatives/me", signedIn, requireAccountType("representative"), async (request, response) => {
    response.status(200).json({ user: await service.profile(request.auth!) });
  });

  router.post("/auth/refresh", signedIn, csrf, async (request, response) => {
    const session = await service.rotateSession(request.auth!, metadata(request));
    setSessionCookies(response, config, session);
    response.status(200).json({ csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() });
  });

  router.post("/auth/logout", signedIn, csrf, async (request, response) => {
    await service.logout(request.auth!, false, metadata(request));
    clearSessionCookies(response, config);
    response.status(204).end();
  });
  router.post("/auth/logout-all", signedIn, csrf, async (request, response) => {
    await service.logout(request.auth!, true, metadata(request));
    clearSessionCookies(response, config);
    response.status(204).end();
  });
  router.post("/auth/change-temporary-password", signedIn, csrf, async (request, response) => {
    const body = z
      .object({ password, confirmation: password })
      .refine((value) => value.password === value.confirmation, {
        path: ["confirmation"],
        message: "Passwords do not match",
      })
      .parse(request.body);
    const session = await service.replaceTemporaryPassword(request.auth!, body.password, metadata(request));
    setSessionCookies(response, config, session);
    response.status(200).json({ user: await service.profile(session.account), csrfToken: session.csrfToken });
  });

  router.get("/auth/sessions", signedIn, requirePermission("sessions.read_own"), async (request, response) => {
    response.status(200).json({ sessions: await service.listSessions(request.auth!) });
  });
  router.delete(
    "/auth/sessions/:sessionId",
    signedIn,
    csrf,
    requirePermission("sessions.revoke_own"),
    async (request, response) => {
      const sessionId = uuid.parse(request.params.sessionId);
      await service.revokeOwnSession(request.auth!, sessionId, metadata(request));
      response.status(204).end();
    },
  );

  router.post("/admin/auth/mfa/setup", signedIn, csrf, requireAccountType("staff"), async (request, response) => {
    response.status(200).json(await service.setupMfa(request.auth!));
  });
  router.post("/admin/auth/mfa/confirm", signedIn, csrf, requireAccountType("staff"), async (request, response) => {
    const body = z.object({ token: z.string().regex(/^\d{6}$/) }).parse(request.body);
    await service.confirmMfa(request.auth!, body.token, metadata(request));
    response.status(204).end();
  });

  router.post(
    "/admin/representatives/:id/approve",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("representatives.approve"),
    async (request, response) => {
      await service.decideRepresentative(request.auth!, uuid.parse(request.params.id), true, undefined, metadata(request));
      response.status(204).end();
    },
  );
  router.post(
    "/admin/representatives/:id/reject",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("representatives.approve"),
    async (request, response) => {
      const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);
      await service.decideRepresentative(request.auth!, uuid.parse(request.params.id), false, body.reason, metadata(request));
      response.status(204).end();
    },
  );
  router.post(
    "/admin/password-reset-requests/:id/temporary-password",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("staff.sessions_revoke"),
    async (request, response) => {
      const body = z.object({ temporaryPassword: password }).parse(request.body);
      await service.setTemporaryPassword(
        request.auth!,
        uuid.parse(request.params.id),
        body.temporaryPassword,
        metadata(request),
      );
      response.status(204).end();
    },
  );

  return router;
}

export function accountTypeFromPath(path: string): AccountType {
  if (path.startsWith("/admin")) return "staff";
  if (path.startsWith("/representatives")) return "representative";
  return "customer";
}
