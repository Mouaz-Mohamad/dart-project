import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";

export function createDatabasePool(
  config: Pick<AppConfig, "databaseUrl" | "databaseSsl" | "databasePoolMax">,
): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    application_name: "dart-backend",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
