// DART CODE GUIDE | backend/src/server.ts
// الغرض: تشغيل HTTP server وإدارة الإغلاق الآمن واتصال PostgreSQL.
import "./instrument.js";
import * as Sentry from "@sentry/node";
import type { Server } from "node:http";
import { resolve } from "node:path";
import app, { runtime } from "./app.js";
import { assertProductionOutboxCronSecret } from "./config/env.js";
import { shouldStartHttpListener } from "./config/runtime.js";
import { runMigrations } from "./database/migrate.js";

assertProductionOutboxCronSecret(process.env);

// Vercel build environments are not guaranteed to have database network access.
// Run the idempotent, checksum-protected migration set when the serverless runtime
// starts instead. PostgreSQL advisory locking makes concurrent cold starts safe.
if (runtime && process.env.VERCEL === "1") {
  const applied = await runMigrations(
    runtime.database,
    resolve(process.cwd(), "migrations"),
  );
  runtime.logger.info(
    { applied },
    applied.length ? "Runtime migrations applied" : "Runtime database schema is up to date",
  );
}

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
  try {
    await Sentry.flush(2_000);
  } catch (error) {
    runtime?.logger.warn({ err: error }, "Sentry flush failed during shutdown");
  }
  if (runtime) await runtime.database.end();
  clearTimeout(forceTimer);
  runtime?.logger.info("Graceful shutdown completed");
  process.exit(exitCode);
}

function closeServer(target: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    target.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

if (server) {
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    Sentry.captureException(error);
    runtime?.logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (error) => {
    Sentry.captureException(error);
    runtime?.logger.fatal({ err: error }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
}

export default app;
