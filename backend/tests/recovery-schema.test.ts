import { resolve } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { readMigrationFiles } from "../src/database/migrate.js";
import { verifiedRecoveryMigrationNames } from "../scripts/recovery-schema.js";

describe("read-only recovery schema acceptance", () => {
  const directory = resolve("migrations");
  async function fixture() {
    const files = await readMigrationFiles(directory);
    const rows = files.map(({ name, checksum }) => ({ name, checksum }));
    const query = vi.fn(async () => ({ rows }));
    return { rows, query, pool: { query } as unknown as Pool };
  }
  it("accepts the current schema through a SELECT-only operation", async () => {
    const f = await fixture(); expect(await verifiedRecoveryMigrationNames(f.pool, directory)).toHaveLength(f.rows.length);
    expect(f.query).toHaveBeenCalledExactlyOnceWith("SELECT name,checksum FROM dart_schema_migrations ORDER BY name");
  });
  it("accepts supported historical filenames only with their original valid checksum", async () => {
    const f = await fixture(), row = f.rows.find((row) => row.name === "0014_customer_preferences.sql")!;
    row.name = "0013_customer_preferences.sql";
    expect(await verifiedRecoveryMigrationNames(f.pool, directory)).toContain(row.name);
    row.checksum = "a".repeat(64);
    await expect(verifiedRecoveryMigrationNames(f.pool, directory)).rejects.toThrow("checksum changed");
  });
  it("rejects a missing migration without attempting to apply it", async () => {
    const f = await fixture(); f.rows.pop();
    await expect(verifiedRecoveryMigrationNames(f.pool, directory)).rejects.toThrow("unapplied migrations");
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("rejects unexpected or duplicate-alias history instead of ignoring it", async () => {
    const f = await fixture(); f.rows.push({ name: "9999_unknown.sql", checksum: "a".repeat(64) });
    await expect(verifiedRecoveryMigrationNames(f.pool, directory)).rejects.toThrow("unexpected migration history");
  });
});
