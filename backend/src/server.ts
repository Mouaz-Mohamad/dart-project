import type { Server } from "node:http";
import app, { config, database, logger } from "./app.js";
import { shouldStartHttpListener } from "./config/runtime.js";

let server: Server | undefined;

if (shouldStartHttpListener()) {
  server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "Dart backend listening");
  });
}

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

  if (server) await closeServer(server);
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

if (server) {
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
}

export default app;
