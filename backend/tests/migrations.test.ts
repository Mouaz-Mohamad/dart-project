// DART CODE GUIDE | backend/tests/migrations.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { describe, expect, it } from "vitest";
import {
  selectMigrationsToApply,
  type MigrationFile,
} from "../src/database/migrate.js";

const files: MigrationFile[] = [
  { name: "0001_first.sql", checksum: "one", sql: "SELECT 1" },
  { name: "0002_second.sql", checksum: "two", sql: "SELECT 2" },
];

describe("migration ordering", () => {
  it("returns pending migrations in their canonical order", () => {
    expect(selectMigrationsToApply(files, [])).toEqual(files);
  });

  it("allows only the next pending migration to run individually", () => {
    expect(selectMigrationsToApply(files, [], "0001_first")).toEqual([files[0]]);
    expect(() => selectMigrationsToApply(files, [], "0002_second")).toThrow(
      "Cannot apply migrations out of order",
    );
  });

  it("rejects changes to an already applied migration", () => {
    expect(() =>
      selectMigrationsToApply(files, [{ name: "0001_first.sql", checksum: "changed" }]),
    ).toThrow("Applied migration checksum changed");
  });
});

// Production compatibility note: 0018 is intentionally tolerant of duplicate legacy domain rows.
