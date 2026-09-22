// DART CODE GUIDE | backend/tests/migration-naming.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertMigrationNamingPolicy } from "../src/database/migrate.js";

describe("migration naming policy", () => {
  it("allows only the known historical duplicate prefixes", () => {
    const names = readdirSync(resolve(process.cwd(), "migrations"))
      .filter((name) => name.endsWith(".sql"));

    expect(() => assertMigrationNamingPolicy(names)).not.toThrow();
  });

  it("rejects a new duplicate prefix even when the number is below the current latest migration", () => {
    expect(() =>
      assertMigrationNamingPolicy([
        "0016_guest_cart_ownership.sql",
        "0016_new_accidental_duplicate.sql",
      ]),
    ).toThrow("Duplicate migration sequence prefixes are not allowed: 0016");
  });

  it("rejects duplicate prefixes for future migrations", () => {
    expect(() =>
      assertMigrationNamingPolicy([
        "0030_first.sql",
        "0030_second.sql",
      ]),
    ).toThrow("Duplicate migration sequence prefixes are not allowed: 0030");
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
