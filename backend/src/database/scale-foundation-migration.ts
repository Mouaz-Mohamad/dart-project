import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const SCALE_FOUNDATION_MIGRATION = "0060_scale_foundation";
// Explicit operator-controlled, additive release migration; no arbitrary SQL input.
export async function applyScaleFoundationMigration(pool: Pool, sql: string, requested?: string): Promise<boolean> {
  if (!requested) return false;
  if (requested !== SCALE_FOUNDATION_MIGRATION) throw new Error("Unsupported scale migration request");
  const name = `${SCALE_FOUNDATION_MIGRATION}.sql`, checksum = createHash("sha256").update(sql).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["dart_backend_schema_migrations"]);
    const existing = await client.query<{ checksum: string }>("SELECT checksum FROM dart_schema_migrations WHERE name=$1", [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error("Scale migration checksum mismatch");
      await client.query("SELECT scope,key_hash,hits,expires_at FROM api_rate_limits LIMIT 0");
      await client.query("COMMIT"); return false;
    }
    const previous = await client.query<{ name: string }>("SELECT name FROM dart_schema_migrations ORDER BY name DESC LIMIT 1");
    if (previous.rows[0]?.name !== "0059_news_foundation.sql") throw new Error("Apply preceding Dart migrations first");
    await client.query(sql);
    await client.query("INSERT INTO dart_schema_migrations(name,checksum) VALUES ($1,$2)", [name, checksum]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
