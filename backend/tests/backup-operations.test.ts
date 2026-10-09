// DART CODE GUIDE | backend/tests/backup-operations.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../scripts/database-backup.mjs", import.meta.url),
  "utf8",
);

describe("database backup operations", () => {
  it("rejects restoring to the same database using a different role or pooled Neon alias", async () => {
    const { assertRecoveryDatabaseSafety, sameDatabase } = await import(
      new URL("../scripts/database-backup.mjs", import.meta.url).href
    );
    const production = "postgresql://owner:secret@ep-live.example.neon.tech/dart_recovery";
    const alias = "postgresql://other:password@ep-live-pooler.example.neon.tech:5432/dart_recovery";
    expect(sameDatabase(production, alias)).toBe(true);
    expect(() => assertRecoveryDatabaseSafety(production, alias)).toThrow("production database");
    expect(() => assertRecoveryDatabaseSafety(production, "postgresql://owner:secret@ep-drill.example.neon.tech/dart_recovery"))
      .not.toThrow();
    expect(() => assertRecoveryDatabaseSafety(production, "postgresql://owner:secret@ep-drill.example.neon.tech/neondb"))
      .toThrow("Recovery database name");
  });
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

  it("supports a non-destructive isolated restore drill", () => {
    expect(script).toContain("restoreBackupForVerification");
    expect(script).toContain("DART_RECOVERY_DATABASE_URL");
    expect(script).toContain('"--single-transaction"');
    expect(script).toContain('"--exit-on-error"');
    expect(script).toContain("Refusing to restore into the production database");
  });

  it("does not implement an unattended destructive restore command", () => {
    expect(script).not.toContain('"--clean"');
    expect(script).not.toContain('"--create"');
    expect(script).not.toContain("DROP DATABASE");
    expect(script).not.toContain("DROP SCHEMA");
  });
});
