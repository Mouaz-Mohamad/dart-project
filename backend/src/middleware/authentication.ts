import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig } from "../config/env.js";
import { AppError } from "../http/app-error.js";
import type { IdentityService } from "../modules/identity/identity.service.js";
import type { AccountType } from "../modules/identity/identity.types.js";
import { safeEqual } from "../security/crypto.js";
import { hashCsrfToken, parseSessionToken } from "../security/session-token.js";

export function authenticate(
  service: IdentityService,
  config: Pick<AppConfig, "sessionCookieName">,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      const parsed = parseSessionToken(request.cookies?.[config.sessionCookieName] as string | undefined);
      if (!parsed) throw new AppError(401, "AUTH_REQUIRED", "Sign in to continue");
      const account = await service.authenticate(parsed.id, parsed.secret);
      if (!account) throw new AppError(401, "SESSION_INVALID", "The session is invalid or expired");
      request.auth = account;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAccountType(...allowed: AccountType[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !allowed.includes(request.auth.accountType)) {
      next(new AppError(403, "FORBIDDEN", "You do not have access to this resource"));
      return;
    }
    next();
  };
}

export function requireMfa(request: Request, _response: Response, next: NextFunction): void {
  if (!request.auth?.mfaRequired || request.auth.mfaSatisfied) {
    next();
    return;
  }
  next(new AppError(403, "MFA_REQUIRED", "Complete two-factor authentication to continue"));
}

function hasAnyPermission(
  granted: readonly string[] | undefined,
  required: readonly string[],
): boolean {
  if (!granted?.length || !required.length) return false;
  const available = new Set(granted);
  return required.some((permission) => available.has(permission));
}

export function requirePermission(permission: string): RequestHandler {
  return requireAnyPermission(permission);
}

export function requireAnyPermission(...permissions: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!hasAnyPermission(request.auth?.permissions, permissions)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission for this action"));
      return;
    }
    next();
  };
}

export function requireActionPermission(
  bodyField: string,
  permissionMap: Readonly<Record<string, readonly string[]>>,
): RequestHandler {
  return (request, _response, next) => {
    const body = request.body as Record<string, unknown> | undefined;
    const action = String(body?.[bodyField] ?? "");
    const required = permissionMap[action];
    if (!required) {
      next();
      return;
    }
    if (!hasAnyPermission(request.auth?.permissions, required)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission for this action"));
      return;
    }
    next();
  };
}

export function csrfProtection(
  config: Pick<AppConfig, "authPepper">,
): RequestHandler {
  return (request, _response, next) => {
    const token = request.header("x-csrf-token");
    if (!request.auth || !token) {
      next(new AppError(403, "CSRF_INVALID", "The request security token is missing or invalid"));
      return;
    }
    const candidate = hashCsrfToken(token, config.authPepper);
    if (!safeEqual(candidate, request.auth.csrfTokenHash)) {
      next(new AppError(403, "CSRF_INVALID", "The request security token is missing or invalid"));
      return;
    }
    next();
  };
}
