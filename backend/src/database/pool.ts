// DART CODE GUIDE | backend/src/database/pool.ts
// الغرض: طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات.
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";

function connectionStringForPool(databaseUrl: string, databaseSsl: boolean): string {
  if (!databaseSsl) return databaseUrl;
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("uselibpqcompat");
  return parsed.toString();
}

// One serverless instance can be multiplied hundreds of times during traffic bursts.
// Limit each Vercel instance to two local sockets; Neon PgBouncer should multiplex them.
// Do not silently change connection limits in local development or migration tooling.
export function effectiveDatabasePoolMax(configuredMax: number, isVercel = Boolean(process.env.VERCEL)): number {
  return isVercel ? Math.min(2, configuredMax) : configuredMax;
}

export function createDatabasePool(
  config: Pick<AppConfig, "databaseUrl" | "databaseSsl" | "databasePoolMax">,
): Pool {
  const pool = new Pool({
    connectionString: connectionStringForPool(config.databaseUrl, config.databaseSsl),
    max: effectiveDatabasePoolMax(config.databasePoolMax),
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    application_name: "dart-backend",
    idleTimeoutMillis: 5_000,
    maxLifetimeSeconds: 300,
    connectionTimeoutMillis: 5_000,
  });
  if (process.env.VERCEL) attachDatabasePool(pool);
  return pool;
}

export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
