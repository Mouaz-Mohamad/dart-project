// DART CODE GUIDE | backend/src/app.ts
// الغرض: إنشاء Runtime وربط الخدمات وقاعدة البيانات بالتطبيق، مع fallback آمن عند سوء الإعداد.
import express, { type Express } from "express";
import pino from "pino";
import { readFile } from "node:fs/promises";
import { createApp } from "./application.js";
import {
  EnvironmentConfigError,
  loadConfig,
  type AppConfig,
} from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabasePool, pingDatabase } from "./database/pool.js";
import { applySetHomepageMigration, SET_HOMEPAGE_MIGRATION } from "./database/set-homepage-migration.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import {
  loadSocialAuthConfig,
  SocialAuthConfigError,
  SocialAuthService,
} from "./modules/identity/social-auth.service.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { CatalogAssetService } from "./modules/catalog/catalog.asset.service.js";
import { CommerceService } from "./modules/commerce/commerce.service.js";
import { SiteSettingsService } from "./modules/settings/site-settings.service.js";
import { DashboardStateService } from "./modules/dashboard/dashboard-state.service.js";
import { CustomerInteractionService } from "./modules/commerce/customer-interaction.service.js";
import { PlatformAdminService } from "./modules/platform/platform-admin.service.js";
import { FinanceService } from "./modules/finance/finance.service.js";
import { TrafficAnalyticsService } from "./modules/analytics/traffic-analytics.service.js";
import { OperationalAlertService } from "./modules/monitoring/operational-alert.service.js";
import { OutboxService } from "./modules/outbox/outbox.service.js";
import { WaitingService } from "./modules/waiting/waiting.service.js";
import { PromotionService } from "./modules/promotions/promotion.service.js";
import { DartCardDrawService } from "./modules/loyalty/dart-card-draw.service.js";
import { SetService } from "./modules/sets/set.service.js";
import { NewsService } from "./modules/news/news.service.js";
import { SetCartService } from "./modules/sets/set-cart.service.js";
import { createEmailProvider } from "./modules/outbox/email-provider.js";

export interface DartRuntime {
  app: Express;
  config: AppConfig;
  database: ReturnType<typeof createDatabasePool>;
  logger: ReturnType<typeof createLogger>;
  operationalAlerts: OperationalAlertService;
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
  const emailProvider = createEmailProvider(config);
  const operationalAlerts = new OperationalAlertService(
    emailProvider,
    config.monitoringAlertEmail,
    config.monitoringAlertCooldownMs ?? 300_000,
  );
  const identityService = new IdentityService(database, config);
  const socialAuthService = new SocialAuthService(
    database,
    identityService,
    loadSocialAuthConfig(source, {
      port: config.port,
      corsOrigins: config.corsOrigins,
      authPepper: config.authPepper,
    }),
  );
  const catalogService = new CatalogService(database);
  const catalogAssetService = new CatalogAssetService(database);
  const commerceService = new CommerceService(database);
  const promotionService = new PromotionService(database);
  const dartCardDrawService = new DartCardDrawService(database);
  const setService = new SetService(database);
  const newsService = new NewsService(database);
  const setCartService = new SetCartService(database);
  const siteSettingsService = new SiteSettingsService(database);
  const dashboardStateService = new DashboardStateService(database);
  const customerInteractionService = new CustomerInteractionService(database);
  const platformAdminService = new PlatformAdminService(database);
  const financeService = new FinanceService(database);
  const trafficAnalyticsService = new TrafficAnalyticsService(database);
  const outboxService = new OutboxService(
    database,
    config,
    emailProvider,
  );
  const waitingService = new WaitingService(database);

  database.on("error", (error) => {
    logger.error({ err: error }, "Unexpected PostgreSQL pool error");
    void operationalAlerts
      .report(error, { source: "database" })
      .catch((alertError) => {
        logger.warn({ err: alertError }, "Operational monitoring alert delivery failed");
      });
  });

  const app = createApp(config, {
    logger,
    databasePing: () => pingDatabase(database),
    startedAt: new Date(),
    version: "0.6.2",
    identityService,
    socialAuthService,
    catalogService,
    catalogAssetService,
    commerceService,
    promotionService,
    dartCardDrawService,
    setService,
    newsService,
    setCartService,
    siteSettingsService,
    dashboardStateService,
    customerInteractionService,
    platformAdminService,
    financeService,
    trafficAnalyticsService,
    outboxService,
    waitingService,
    operationalAlerts,
  });
  return { app, config, database, logger, operationalAlerts };
}

export let runtime: DartRuntime | null = null;
try {
  runtime = createRuntimeApplication();
} catch (error) {
  if (
    !(error instanceof EnvironmentConfigError) &&
    !(error instanceof SocialAuthConfigError)
  ) {
    throw error;
  }
  pino({ level: "error" }).error(
    { invalidFields: error.fields },
    "Dart backend environment is invalid",
  );
}

// An explicit operational release flag is used when the API database differs from Auth.
// The migration is fixed, checksummed and locked; no request/client can enable it.
if (runtime && process.env.DART_APPLY_SET_HOMEPAGE_MIGRATION) {
  const sql = await readFile(new URL(`../migrations/${SET_HOMEPAGE_MIGRATION}.sql`, import.meta.url), "utf8");
  const applied = await applySetHomepageMigration(runtime.database, sql, process.env.DART_APPLY_SET_HOMEPAGE_MIGRATION);
  runtime.logger.info({ migration: SET_HOMEPAGE_MIGRATION, applied }, "Explicit Set homepage migration verified");
}

const app = runtime?.app ?? createMisconfiguredApplication();
export default app;
