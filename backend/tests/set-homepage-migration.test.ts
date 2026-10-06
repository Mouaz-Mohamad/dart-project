import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { applySetHomepageMigration, SET_HOMEPAGE_MIGRATION } from "../src/database/set-homepage-migration.js";

const sql = "ALTER TABLE catalog_sets ADD COLUMN short_description TEXT;";
const checksum = createHash("sha256").update(sql).digest("hex");
function fixture(recorded?: string, previous = "0056_set_lifecycle_integrity.sql", failDdl = false) {
  const query = vi.fn(async (statement: string) => {
    if (statement.startsWith("SELECT checksum")) return { rows: recorded ? [{ checksum: recorded }] : [] };
    if (statement.startsWith("SELECT name")) return { rows: [{ name: previous }] };
    if (statement === sql && failDdl) throw new Error("DDL failed");
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}
describe("explicit operational Set homepage migration", () => {
  it("normal boot never opens a migration connection", async () => {
    const f = fixture();
    expect(await applySetHomepageMigration(f.pool, sql, undefined)).toBe(false);
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("only accepts the approved migration identifier", async () => {
    const f = fixture();
    await expect(applySetHomepageMigration(f.pool, sql, "other_migration")).rejects.toThrow("Unsupported");
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("locks, applies and records the exact checksum in one transaction", async () => {
    const f = fixture();
    expect(await applySetHomepageMigration(f.pool, sql, SET_HOMEPAGE_MIGRATION)).toBe(true);
    const statements = f.query.mock.calls.map(call => call[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("pg_advisory_xact_lock");
    expect(f.query).toHaveBeenCalledWith("INSERT INTO dart_schema_migrations(name,checksum) VALUES ($1,$2)", [`${SET_HOMEPAGE_MIGRATION}.sql`, checksum]);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("another cold start skips DDL after verifying the same migration", async () => {
    const f = fixture(checksum);
    expect(await applySetHomepageMigration(f.pool, sql, SET_HOMEPAGE_MIGRATION)).toBe(false);
    expect(f.query).not.toHaveBeenCalledWith(sql);
    expect(f.query).toHaveBeenCalledWith("SELECT short_description,show_on_homepage,homepage_order FROM catalog_sets LIMIT 0");
  });
  it.each([
    { recorded: "changed", previous: "0056_set_lifecycle_integrity.sql", fail: false },
    { recorded: undefined, previous: "0054_sets_foundation.sql", fail: false },
    { recorded: undefined, previous: "0056_set_lifecycle_integrity.sql", fail: true },
  ])("rolls back checksum, ordering or DDL failures", async ({ recorded, previous, fail }) => {
    const f = fixture(recorded, previous, fail);
    await expect(applySetHomepageMigration(f.pool, sql, SET_HOMEPAGE_MIGRATION)).rejects.toThrow();
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
