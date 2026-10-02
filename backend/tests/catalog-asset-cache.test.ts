// DART CODE GUIDE | backend/tests/catalog-asset-cache.test.ts
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  CATALOG_ASSET_IMMUTABLE_CACHE,
  CATALOG_ASSET_REDIRECT_CACHE,
  catalogAssetUrl,
  catalogAssetVersion,
  catalogAssetVersionMatches,
} from "../src/modules/catalog/catalog.asset.cache.js";
import { CatalogAssetService } from "../src/modules/catalog/catalog.asset.service.js";

describe("catalog asset cache versioning", () => {
  it("builds a URL keyed by the exact content hash", () => {
    expect(catalogAssetUrl("asset_12345678", "abc123")).toBe(
      "/api/v1/catalog/assets/asset_12345678?v=abc123",
    );
  });

  it("only treats the exact content hash as immutable", () => {
    expect(catalogAssetVersionMatches("abc123", "abc123")).toBe(true);
    expect(catalogAssetVersionMatches("old", "abc123")).toBe(false);
    expect(catalogAssetVersionMatches(undefined, "abc123")).toBe(false);
    expect(catalogAssetVersion(["abc123"])).toBe("abc123");
    expect(CATALOG_ASSET_IMMUTABLE_CACHE).toContain("max-age=31536000");
    expect(CATALOG_ASSET_IMMUTABLE_CACHE).toContain("immutable");
    expect(CATALOG_ASSET_REDIRECT_CACHE).toContain("must-revalidate");
  });

  it("returns the versioned URL immediately after an upload", async () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP", "ascii"),
      Buffer.from([0, 0, 0, 0]),
    ]);
    const digest = createHash("sha256").update(webp).digest("hex");
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CatalogAssetService({ query } as unknown as Pool);

    const result = await service.put({
      assetId: "asset_12345678",
      originalName: "shirt.webp",
      contentType: "image/webp",
      base64: webp.toString("base64"),
      actorId: "00000000-0000-0000-0000-000000000001",
    });

    expect(result).toEqual({
      id: "asset_12345678",
      urlPath: catalogAssetUrl("asset_12345678", digest),
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
