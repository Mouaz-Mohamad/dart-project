import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";

function connectionStringForPool(databaseUrl: string, databaseSsl: boolean): string {
  if (!databaseSsl) return databaseUrl;
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("uselibpqcompat");
  return parsed.toString();
}

export function createDatabasePool(
  config: Pick<AppConfig, "databaseUrl" | "databaseSsl" | "databasePoolMax">,
): Pool {
  return new Pool({
    connectionString: connectionStringForPool(config.databaseUrl, config.databaseSsl),
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
