import express, { type Express } from "express";
import pino from "pino";
import { createApp } from "./application.js";
import {
  EnvironmentConfigError,
  loadConfig,
  type AppConfig,
} from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabasePool, pingDatabase } from "./database/pool.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { CatalogAssetService } from "./modules/catalog/catalog.asset.service.js";
import { CommerceService } from "./modules/commerce/commerce.service.js";
import { SiteSettingsService } from "./modules/settings/site-settings.service.js";
import { DashboardStateService } from "./modules/dashboard/dashboard-state.service.js";
import { CustomerInteractionService } from "./modules/commerce/customer-interaction.service.js";
import { PlatformAdminService } from "./modules/platform/platform-admin.service.js";
import { FinanceService } from "./modules/finance/finance.service.js";
import { OutboxService } from "./modules/outbox/outbox.service.js";
import { createEmailProvider } from "./modules/outbox/email-provider.js";

export interface DartRuntime {
  app: Express;
  config: AppConfig;
  database: ReturnType<typeof createDatabasePool>;
  logger: ReturnType<typeof createLogger>;
}

export function createMisconfiguredApplication(): Express {
  const fallback = express();
  fallback.disable("x-powered-by");
  fallback.get("/api/v1/health/live", (_request, response) => {
    response.status(503).json({ status: "misconfigured" });
  });
  fallback.use("/api/v1", (_request, response) => {
    response.status(503).json({
      error: {
        code: "SERVICE_MISCONFIGURED",
        message: "Dart API is temporarily unavailable",
      },
    });
  });
  return fallback;
}

export function createRuntimeApplication(
  source: NodeJS.ProcessEnv = process.env,
): DartRuntime {
  const config = loadConfig(source);
  const logger = createLogger(config);
  const database = createDatabasePool(config);
  const identityService = new IdentityService(database, config);
  const catalogService = new CatalogService(database);
  const catalogAssetService = new CatalogAssetService(database);
  const commerceService = new CommerceService(database);
  const siteSettingsService = new SiteSettingsService(database);
  const dashboardStateService = new DashboardStateService(database);
  const customerInteractionService = new CustomerInteractionService(database);
  const platformAdminService = new PlatformAdminService(database);
  const financeService = new FinanceService(database);
  const outboxService = new OutboxService(
    database,
    config,
    createEmailProvider(config),
  );

  database.on("error", (error) => {
    logger.error({ err: error }, "Unexpected PostgreSQL pool error");
  });

  const app = createApp(config, {
    logger,
    databasePing: () => pingDatabase(database),
    startedAt: new Date(),
    version: "0.4.0",
    identityService,
    catalogService,
    catalogAssetService,
    commerceService,
    siteSettingsService,
    dashboardStateService,
    customerInteractionService,
    platformAdminService,
    financeService,
    outboxService,
  });
  return { app, config, database, logger };
}

export let runtime: DartRuntime | null = null;
try {
  runtime = createRuntimeApplication();
} catch (error) {
  if (!(error instanceof EnvironmentConfigError)) throw error;
  pino({ level: "error" }).error(
    { invalidFields: error.fields },
    "Dart backend environment is invalid",
  );
}

const app = runtime?.app ?? createMisconfiguredApplication();
export default app;
