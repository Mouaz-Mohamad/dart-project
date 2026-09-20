import { createApp } from "./application.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabasePool, pingDatabase } from "./database/pool.js";
import { IdentityService } from "./modules/identity/identity.service.js";

export const config = loadConfig();
export const logger = createLogger(config);
export const database = createDatabasePool(config);

database.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

const app = createApp(config, {
  logger,
  databasePing: () => pingDatabase(database),
  startedAt: new Date(),
  version: "0.2.1",
  identityService: new IdentityService(database, config),
});

export default app;
