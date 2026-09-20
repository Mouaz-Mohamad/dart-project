import { describe, expect, it } from "vitest";
import { AppError } from "../src/http/app-error.js";
import { validateCatalogReplacement } from "../src/modules/catalog/catalog.service.js";

const model = (overrides: Record<string, unknown> = {}) => ({
  modelId: "M-1",
  cost: 400,
  selling: 600,
  discount: 0,
  lowStockLimit: 5,
  colorOptions: [{ name: "Burgundy", active: true }],
  sizeOptions: [{ name: "L", active: true }],
  ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  itemCode: "PIC-1",
  modelId: "M-1",
  color: "Burgundy",
  size: "L",
  ...overrides,
});

function expectCode(run: () => void, code: string): void {
  try {
    run();
    throw new Error("Expected catalog validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("catalog replacement integrity", () => {
  it("accepts one valid model and physical item", () => {
    expect(() => validateCatalogReplacement([model()], [item()])).not.toThrow();
  });

  it("rejects duplicate model ids", () => {
    expectCode(() => validateCatalogReplacement([model(), model()], []), "MODEL_ID_DUPLICATE");
  });

  it("rejects duplicate physical item ids", () => {
    expectCode(
      () => validateCatalogReplacement([model()], [item(), item({ itemCode: "PIC-2" })]),
      "ITEM_ID_DUPLICATE",
    );
  });

  it("rejects item codes duplicated with different casing", () => {
    expectCode(
      () => validateCatalogReplacement([model()], [item(), item({ id: "item-2", itemCode: "pic-1" })]),
      "ITEM_CODE_DUPLICATE",
    );
  });

  it("rejects non-finite, negative and out-of-range numeric fields", () => {
    for (const invalid of [
      model({ cost: -1 }),
      model({ selling: "not-a-number" }),
      model({ discount: 101 }),
      model({ lowStockLimit: 1.5 }),
    ]) {
      expectCode(() => validateCatalogReplacement([invalid], []), "CATALOG_NUMBER_INVALID");
    }
  });

  it("rejects a physical item outside its model variants", () => {
    expectCode(
      () => validateCatalogReplacement([model()], [item({ color: "Black" })]),
      "ITEM_VARIANT_INVALID",
    );
  });
});
