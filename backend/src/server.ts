import type { Server } from "node:http";
import app, { runtime } from "./app.js";
import { shouldStartHttpListener } from "./config/runtime.js";

let server: Server | undefined;

if (shouldStartHttpListener()) {
  const configuredPort = Number(process.env.PORT || 4000);
  const port = runtime?.config.port || (Number.isInteger(configuredPort) ? configuredPort : 4000);
  server = app.listen(port, () => {
    if (runtime) runtime.logger.info({ port }, "Dart backend listening");
  });
}

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime?.logger.info({ signal }, "Graceful shutdown started");

  const forceTimer = setTimeout(() => {
    runtime?.logger.fatal("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  if (server) await closeServer(server);
  if (runtime) await runtime.database.end();
  clearTimeout(forceTimer);
  runtime?.logger.info("Graceful shutdown completed");
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
    runtime?.logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (error) => {
    runtime?.logger.fatal({ err: error }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
}

export default app;
