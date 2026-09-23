// DART CODE GUIDE | backend/tests/migration-naming.test.ts
// الغرض: اختبار آلي يضمن أن migrations مرقمة بأرقام فريدة ومتتالية بلا استثناءات تاريخية.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertMigrationNamingPolicy } from "../src/database/migrate.js";

describe("migration naming policy", () => {
  it("keeps the real migration directory unique and consecutive from 0001 through 0044", () => {
    const names = readdirSync(resolve(process.cwd(), "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    expect(names).toHaveLength(44);
    expect(names.map((name) => name.slice(0, 4))).toEqual(
      Array.from({ length: 44 }, (_, index) => String(index + 1).padStart(4, "0")),
    );
    expect(() => assertMigrationNamingPolicy(names)).not.toThrow();
  });

  it("rejects duplicate prefixes including the former 0013-0015 legacy range", () => {
    expect(() =>
      assertMigrationNamingPolicy([
        "0013_first.sql",
        "0013_second.sql",
      ]),
    ).toThrow("Duplicate migration sequence prefixes are not allowed: 0013");
  });

  it("rejects gaps in a migration sequence", () => {
    expect(() =>
      assertMigrationNamingPolicy([
        "0020_first.sql",
        "0022_third.sql",
      ]),
    ).toThrow("Migration sequence must be consecutive: expected 0021, found 0022");
  });

  it("rejects malformed SQL migration filenames and sequence 0000", () => {
    expect(() => assertMigrationNamingPolicy(["30_bad.sql"])).toThrow(
      "Invalid migration filename",
    );
    expect(() => assertMigrationNamingPolicy(["0000_zero.sql"])).toThrow(
      "Invalid migration sequence prefix: 0000",
    );
  });
});
