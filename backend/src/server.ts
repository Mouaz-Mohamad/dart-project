import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabasePool, pingDatabase } from "./database/pool.js";
import { IdentityService } from "./modules/identity/identity.service.js";

const config = loadConfig();
const logger = createLogger(config);
const database = createDatabasePool(config);
const startedAt = new Date();
const identityService = new IdentityService(database, config);

database.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

const app = createApp(config, {
  logger,
  databasePing: () => pingDatabase(database),
  startedAt,
  version: "0.2.0",
  identityService,
});

const server = createServer(app);
server.listen(config.port, () => {
  logger.info({ port: config.port }, "Dart backend listening");
});

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  const forceTimer = setTimeout(() => {
    logger.fatal("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  await closeServer(server);
  await database.end();
  clearTimeout(forceTimer);
  logger.info("Graceful shutdown completed");
  process.exit(exitCode);
}

function closeServer(target: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (error) => {
  logger.fatal({ err: error }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});
