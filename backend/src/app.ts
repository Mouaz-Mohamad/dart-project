import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import * as helmetModule from "helmet";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { AppError } from "./http/app-error.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestContext } from "./middleware/request-context.js";
import {
  createHealthRouter,
  type HealthDependencies,
} from "./modules/health/health.routes.js";
import { createIdentityRouter } from "./modules/identity/identity.routes.js";
import type { IdentityService } from "./modules/identity/identity.service.js";

export interface AppDependencies extends HealthDependencies {
  logger: Logger;
  identityService?: IdentityService;
}

export function createApp(config: AppConfig, dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);

  app.use(requestContext(dependencies.logger));
  app.use(helmetModule.default());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed"));
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMax,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler(_request, response) {
        const value = response.getHeader("x-request-id");
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            requestId:
              typeof value === "string" || typeof value === "number" ? String(value) : "unknown",
          },
        });
      },
    }),
  );
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use(cookieParser());

  app.use("/api/v1/health", createHealthRouter(dependencies));
  if (dependencies.identityService) {
    app.use("/api/v1", createIdentityRouter(dependencies.identityService, config));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
