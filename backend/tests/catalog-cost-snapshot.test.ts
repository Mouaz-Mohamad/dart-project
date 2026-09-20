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
