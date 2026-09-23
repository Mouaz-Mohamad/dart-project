// DART CODE GUIDE | backend/tests/migrations.test.ts
// الغرض: اختبار آلي للـBackend يحمي ترتيب migrations وتوافق أسماء الترقيم القديمة.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  selectMigrationsToApply,
  type MigrationFile,
} from "../src/database/migrate.js";

const files: MigrationFile[] = [
  { name: "0001_first.sql", checksum: "one", sql: "SELECT 1" },
  { name: "0002_second.sql", checksum: "two", sql: "SELECT 2" },
];

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

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

  it("accepts an applied migration when only the standard code-guide header was added", () => {
    const historicalSql = "CREATE TABLE example(id integer);\n";
    const documentedSql =
      "-- DART CODE GUIDE | backend/migrations/0001_example.sql\n" +
      "-- الغرض: توثيق فقط.\n" +
      historicalSql;
    const documented: MigrationFile[] = [
      {
        name: "0001_example.sql",
        checksum: checksum(documentedSql),
        sql: documentedSql,
      },
    ];

    expect(
      selectMigrationsToApply(documented, [
        { name: "0001_example.sql", checksum: checksum(historicalSql) },
      ]),
    ).toEqual([]);
  });

  it("still rejects a real SQL change even when the code-guide header is present", () => {
    const historicalSql = "SELECT 1;\n";
    const changedSql =
      "-- DART CODE GUIDE | backend/migrations/0001_example.sql\n" +
      "-- الغرض: توثيق فقط.\n" +
      "SELECT 2;\n";
    const changed: MigrationFile[] = [
      {
        name: "0001_example.sql",
        checksum: checksum(changedSql),
        sql: changedSql,
      },
    ];

    expect(() =>
      selectMigrationsToApply(changed, [
        { name: "0001_example.sql", checksum: checksum(historicalSql) },
      ]),
    ).toThrow("Applied migration checksum changed: 0001_example.sql");
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
