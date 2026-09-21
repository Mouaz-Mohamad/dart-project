import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../scripts/database-backup.mjs", import.meta.url),
  "utf8",
);

describe("database backup operations", () => {
  it("creates custom-format dumps without placing DATABASE_URL in process arguments", () => {
    expect(script).toContain('"pg_dump"');
    expect(script).toContain('"--format=custom"');
    expect(script).toContain('"--no-owner"');
    expect(script).toContain('"--no-privileges"');
    expect(script).toContain("postgresEnvironment(process.env.DATABASE_URL)");
    expect(script).toContain("PGPASSWORD");
    expect(script).not.toMatch(/spawn\([^\n]+DATABASE_URL/);
    expect(script).toContain("shell: false");
  });

  it("verifies every created archive with pg_restore before reporting success", () => {
    expect(script).toContain('"pg_restore"');
    expect(script).toContain('["--list", target]');
    expect(script).toContain("return verifyBackup(target)");
  });

  it("does not implement an unattended destructive restore command", () => {
    expect(script).not.toContain('"--clean"');
    expect(script).not.toContain('"--create"');
    expect(script).not.toContain("DROP DATABASE");
  });
});
