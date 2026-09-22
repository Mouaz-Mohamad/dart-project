// DART CODE GUIDE | backend/tests/migration-naming.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration naming policy", () => {
  it("allows historical duplicate prefixes but forbids new duplicate prefixes from 0023 onward", () => {
    const names = readdirSync(resolve(process.cwd(), "migrations"))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name));
    const counts = new Map<string, number>();
    for (const name of names) {
      const prefix = name.slice(0, 4);
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
    const invalid = [...counts.entries()]
      .filter(([prefix, count]) => Number(prefix) >= 23 && count > 1);
    expect(invalid).toEqual([]);
  });
});
