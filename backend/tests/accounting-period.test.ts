// DART CODE GUIDE | backend/tests/accounting-period.test.ts
// Guards the legal go-live boundary from accidental 18-Nov or UTC date regressions.
import { describe, expect, it } from "vitest";
import { OFFICIAL_ACCOUNTING_START, OFFICIAL_ACCOUNTING_ZONE, officialCreatedAt } from "../src/modules/finance/accounting-period.js";

describe("Dart official 8 November 2026 accounting period", () => {
  it("uses 8 Nov inclusive, not 18 Nov", () => {
    expect(OFFICIAL_ACCOUNTING_START).toBe("2026-11-08");
    expect(OFFICIAL_ACCOUNTING_ZONE).toBe("Africa/Cairo");
    expect(officialCreatedAt("2026-11-07")).toBe(false);
    expect(officialCreatedAt("2026-11-08")).toBe(true);
    expect(officialCreatedAt("2026-11-18")).toBe(true);
    expect(officialCreatedAt("2026-10-20")).toBe(false);
  });
  it("evaluates boundary according to Cairo local midnight", () => {
    expect(officialCreatedAt("2026-11-07T21:59:59Z")).toBe(false);
    expect(officialCreatedAt("2026-11-07T22:00:00Z")).toBe(true);
    expect(officialCreatedAt("2026-11-08T01:10:00+02:00")).toBe(true);
    expect(officialCreatedAt("not a date")).toBe(false);
    expect(officialCreatedAt(null)).toBe(false);
  });
});
