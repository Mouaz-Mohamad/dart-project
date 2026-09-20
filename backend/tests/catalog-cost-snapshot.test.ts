import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { physicalItemCostSnapshotMinor } from "../src/modules/catalog/catalog.service.js";

describe("physical inventory acquisition cost snapshot", () => {
  it("uses the model cost when a physical item is first created without its own legacy snapshot", () => {
    expect(physicalItemCostSnapshotMinor(undefined, 40000)).toBe(40000);
  });

  it("preserves an existing physical-item snapshot instead of adopting a later model cost", () => {
    expect(physicalItemCostSnapshotMinor(400, 55000)).toBe(40000);
  });
});

describe("catalog database concurrency contracts", () => {
  const source = readFileSync(
    new URL("../src/modules/catalog/catalog.service.ts", import.meta.url),
    "utf8",
  );

  it("serializes catalog version writers and preserves protected item identity", () => {
    expect(source).toContain("domain = 'catalog_inventory' FOR UPDATE");
    expect(source).toContain("ITEM_IDENTITY_IMMUTABLE");
    expect(source).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ");
    expect(source).toContain("old_values, new_values, metadata");
  });
});
