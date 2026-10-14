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

export function createDatabasePool(
  config: Pick<AppConfig, "databaseUrl" | "databaseSsl" | "databasePoolMax">,
): Pool {
  const pool = new Pool({
    connectionString: connectionStringForPool(config.databaseUrl, config.databaseSsl),
    max: config.databasePoolMax,
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
