import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
it("returns authenticity without disclosing the purchaser or querying customer records", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ item_code: "H001-1", model_id: "H001", model_name: "Hoodie", color: "White", size: "XL", owner_name: "Private Purchaser" }] });
  const result = await new CatalogService({ query } as unknown as Pool).serial("H001-1");
  expect(result).toMatchObject({ itemCode: "H001-1", ownerName: "Dart Customer" });
  expect(JSON.stringify(result)).not.toContain("Private Purchaser");
  expect(query.mock.calls[0]![0]).not.toMatch(/customers|owner_name/);
});
