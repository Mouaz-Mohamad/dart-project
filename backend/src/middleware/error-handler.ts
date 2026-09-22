// DART CODE GUIDE | backend/src/middleware/error-handler.ts
// الغرض: Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes.
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../http/app-error.js";

function requestIdFrom(response: Parameters<ErrorRequestHandler>[2]): string {
  const value = response.getHeader("x-request-id");
  return typeof value === "string" || typeof value === "number" ? String(value) : "unknown";
}

function errorProperty(error: unknown, property: string): unknown {
  return typeof error === "object" && error !== null && property in error
    ? (error as Record<string, unknown>)[property]
    : undefined;
}

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
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

  request.log.error({ err: error }, "Unhandled request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  });
};
