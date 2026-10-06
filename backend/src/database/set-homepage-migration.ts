// Explicit, one-release migration using the API's own database connection.
// Normal builds and runtime boots never migrate unless the operator enables this exact migration.
import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const SET_HOMEPAGE_MIGRATION = "0057_set_homepage_presentation";

export async function applySetHomepageMigration(
  pool: Pool,
  sql: string,
  requested: string | undefined,
): Promise<boolean> {
  if (!requested) return false;
  if (requested !== SET_HOMEPAGE_MIGRATION) throw new Error("Unsupported Set migration request");
  const name = `${SET_HOMEPAGE_MIGRATION}.sql`;
  const checksum = createHash("sha256").update(sql).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["dart_backend_schema_migrations"]);
    const recorded = await client.query<{ checksum: string }>(
      "SELECT checksum FROM dart_schema_migrations WHERE name=$1", [name],
    );
    if (recorded.rows[0]) {
      if (recorded.rows[0].checksum !== checksum) throw new Error("Set migration checksum mismatch");
      await client.query("SELECT short_description,show_on_homepage,homepage_order FROM catalog_sets LIMIT 0");
      await client.query("COMMIT");
      return false;
    }
    const previous = await client.query<{ name: string }>(
      "SELECT name FROM dart_schema_migrations ORDER BY name DESC LIMIT 1",
    );
    if (previous.rows[0]?.name !== "0056_set_lifecycle_integrity.sql") {
      throw new Error("Apply preceding Dart migrations before the Set homepage migration");
    }
    await client.query(sql);
    await client.query("INSERT INTO dart_schema_migrations(name,checksum) VALUES ($1,$2)", [name, checksum]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
