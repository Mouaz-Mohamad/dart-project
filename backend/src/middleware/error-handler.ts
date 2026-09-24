// DART CODE GUIDE | backend/src/middleware/error-handler.ts
// الغرض: Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes.
import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../http/app-error.js";
import type { OperationalAlertService } from "../modules/monitoring/operational-alert.service.js";

function requestIdFrom(response: Parameters<ErrorRequestHandler>[2]): string {
  const value = response.getHeader("x-request-id");
  return typeof value === "string" || typeof value === "number" ? String(value) : "unknown";
}

function errorProperty(error: unknown, property: string): unknown {
  return typeof error === "object" && error !== null && property in error
    ? (error as Record<string, unknown>)[property]
    : undefined;
}

function compactUnhandledError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: message.slice(0, 500),
    errorCode: errorProperty(error, "code") ?? null,
    constraint: errorProperty(error, "constraint") ?? null,
    table: errorProperty(error, "table") ?? null,
    column: errorProperty(error, "column") ?? null,
    routine: errorProperty(error, "routine") ?? null,
  };
}

export function createErrorHandler(
  operationalAlerts?: Pick<OperationalAlertService, "report">,
): ErrorRequestHandler {
  return (error, request, response, _next) => {
    const requestId = requestIdFrom(response);

    if (errorProperty(error, "type") === "entity.parse.failed") {
      response.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "The request body contains invalid JSON",
          requestId,
        },
      });
      return;
    }

    if (errorProperty(error, "type") === "entity.too.large") {
      response.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "The request body is too large",
          requestId,
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          requestId,
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    const compactError = compactUnhandledError(error);
    // Keep a short Vercel-visible diagnostic line that cannot be drowned out by
    // the request logger's bound headers/cookies. Never include request bodies,
    // cookies, authorization values, or PostgreSQL detail/hint fields here.
    console.error(JSON.stringify({
      event: "unhandled_request_error_compact",
      requestId,
      method: request.method,
      path: request.path,
      ...compactError,
    }));
    request.log.error({ err: error }, "Unhandled request error");
    Sentry.withScope((scope) => {
      scope.setTag("request_id", requestId);
      scope.setContext("http", {
        method: request.method,
        path: request.path,
      });
      Sentry.captureException(error);
    });
    if (operationalAlerts) {
      void operationalAlerts
        .report(error, {
          source: "request",
          requestId,
          method: request.method,
          path: request.path,
        })
        .catch((alertError) => {
          request.log.warn({ err: alertError }, "Operational monitoring alert delivery failed");
        });
    }

    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    });
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler();
