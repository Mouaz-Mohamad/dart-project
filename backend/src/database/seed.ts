// DART CODE GUIDE | backend/src/database/seed.ts
// الغرض: طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { runMigrations } from "./migrate.js";
import { createDatabasePool } from "./pool.js";
import { developmentSeeders } from "./seeds/development.js";

export function assertDevelopmentSeedAllowed(
  nodeEnv: string,
  allowDevelopmentSeed: boolean,
): void {
  if (nodeEnv === "production") throw new Error("Development seed is forbidden in production");
  if (!allowDevelopmentSeed) {
    throw new Error("Set ALLOW_DEVELOPMENT_SEED=true to run synthetic development data");
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertDevelopmentSeedAllowed(config.nodeEnv, config.allowDevelopmentSeed);
  const logger = createLogger(config);
  const pool = createDatabasePool(config);

  try {
    await runMigrations(pool, resolve(process.cwd(), "migrations"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const seeder of developmentSeeders) await seeder.run(client);
      await client.query("COMMIT");
      logger.info(
        { seeders: developmentSeeders.map((seeder) => seeder.name) },
        "Development seed completed",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Seed failed"}\n`);
    process.exitCode = 1;
  });
}
