// DART CODE GUIDE | backend/tests/sql-parameter-contiguity.test.ts
// الغرض: يمنع SQL placeholders غير المتصلة مثل استخدام $2/$3 بدون $1، لأنها تفشل في PostgreSQL بـ 42P18.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("commerce SQL parameter numbering", () => {
  it("keeps every client.query template placeholder sequence contiguous from $1", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/modules/commerce/commerce.service.ts"),
      "utf8",
    );
    const queryPattern = /client\.query(?:<[^>]+>)?\(\s*`([\s\S]*?)`\s*,/g;
    const failures: Array<{ line: number; placeholders: number[] }> = [];

    for (const match of source.matchAll(queryPattern)) {
      const query = match[1] || "";
      const placeholders = [
        ...new Set([...query.matchAll(/\$(\d+)/g)].map((entry) => Number(entry[1]))),
      ].sort((a, b) => a - b);
      if (!placeholders.length) continue;
      const expected = Array.from({ length: placeholders.at(-1) || 0 }, (_, index) => index + 1);
      if (placeholders.join(",") !== expected.join(",")) {
        failures.push({
          line: source.slice(0, match.index).split("\n").length,
          placeholders,
        });
      }
    }

    expect(failures).toEqual([]);
  });
});
