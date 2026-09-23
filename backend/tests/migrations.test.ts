// DART CODE GUIDE | backend/tests/migrations.test.ts
// الغرض: اختبار آلي للـBackend يحمي ترتيب migrations وتوافق أسماء الترقيم القديمة.
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

  it("treats a matching legacy filename as the same already-applied migration", () => {
    const renamed: MigrationFile[] = [
      {
        name: "0014_customer_preferences.sql",
        checksum: "same-sql",
        sql: "CREATE TABLE customer_preferences(id int)",
      },
    ];
    expect(
      selectMigrationsToApply(renamed, [
        { name: "0013_customer_preferences.sql", checksum: "same-sql" },
      ]),
    ).toEqual([]);
  });

  it("rejects a legacy filename whose stored checksum no longer matches", () => {
    const renamed: MigrationFile[] = [
      {
        name: "0022_guest_cart_ownership.sql",
        checksum: "current-checksum",
        sql: "ALTER TABLE cart_reservations ADD COLUMN guest_key text",
      },
    ];
    expect(() =>
      selectMigrationsToApply(renamed, [
        { name: "0016_guest_cart_ownership.sql", checksum: "legacy-changed" },
      ]),
    ).toThrow("Applied migration checksum changed: 0016_guest_cart_ownership.sql");
  });
});

// Production compatibility note: renamed migrations retain their original SQL blobs/checksums.
