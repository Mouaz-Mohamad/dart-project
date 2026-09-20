import express from "express";
import { createApp } from "./application.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabasePool, pingDatabase } from "./database/pool.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { CatalogAssetService } from "./modules/catalog/catalog.asset.service.js";
import { CommerceService } from "./modules/commerce/commerce.service.js";
import { SiteSettingsService } from "./modules/settings/site-settings.service.js";

// Vercel discovers Express entrypoints from direct imports in this file.
void express;

export const config = loadConfig();
export const logger = createLogger(config);
export const database = createDatabasePool(config);
export const identityService = new IdentityService(database, config);
export const catalogService = new CatalogService(database);
export const catalogAssetService = new CatalogAssetService(database);
export const commerceService = new CommerceService(database);
export const siteSettingsService = new SiteSettingsService(database);

database.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

const app = createApp(config, {
  logger,
  databasePing: () => pingDatabase(database),
  startedAt: new Date(),
  version: "0.2.1",
  identityService,
  catalogService,
  catalogAssetService,
  commerceService,
  siteSettingsService,
});

export default app;
