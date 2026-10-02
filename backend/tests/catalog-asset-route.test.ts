// DART CODE GUIDE | backend/tests/catalog-asset-route.test.ts
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { CatalogAssetService } from "../src/modules/catalog/catalog.asset.service.js";
import { createCatalogAssetRouter } from "../src/modules/catalog/catalog.asset.routes.js";
import {
  CATALOG_ASSET_IMMUTABLE_CACHE,
  CATALOG_ASSET_REDIRECT_CACHE,
} from "../src/modules/catalog/catalog.asset.cache.js";

function makeApp(asset: {
  content: Buffer;
  contentType: string;
  originalName: string;
  sha256: string;
} | null) {
  const assets = {
    get: vi.fn().mockResolvedValue(asset),
    put: vi.fn(),
  } as unknown as CatalogAssetService;
  const identity = {} as IdentityService;
  const app = express();
  app.use(
    "/api/v1",
    createCatalogAssetRouter(assets, identity, {
      sessionCookieName: "dart_session",
      authPepper: "test-auth-pepper-test-auth-pepper",
    }),
  );
  return { app, assets };
}

const assetId = "asset_12345678";
const sha256 = "abc123deadbeef";
const content = Buffer.from("catalog-image-bytes");
const fixture = {
  content,
  contentType: "image/webp",
  originalName: "shirt.webp",
  sha256,
};

describe("catalog asset HTTP caching", () => {
  it("redirects an unversioned asset URL to the exact content hash", async () => {
    const { app } = makeApp(fixture);
    const response = await request(app).get(`/api/v1/catalog/assets/${assetId}`);

    expect(response.status).toBe(307);
    expect(response.headers.location).toBe(`/api/v1/catalog/assets/${assetId}?v=${sha256}`);
    expect(response.headers["cache-control"]).toBe(CATALOG_ASSET_REDIRECT_CACHE);
  });

  it("serves the matching immutable asset with content type and ETag", async () => {
    const { app } = makeApp(fixture);
    const response = await request(app).get(`/api/v1/catalog/assets/${assetId}?v=${sha256}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe(CATALOG_ASSET_IMMUTABLE_CACHE);
    expect(response.headers.etag).toBe(`"${sha256}"`);
    expect(response.headers["content-type"]).toContain("image/webp");
    expect(Buffer.from(response.body)).toEqual(content);
  });

  it("returns 304 when If-None-Match matches the immutable asset", async () => {
    const { app } = makeApp(fixture);
    const response = await request(app)
      .get(`/api/v1/catalog/assets/${assetId}?v=${sha256}`)
      .set("If-None-Match", `"${sha256}"`);

    expect(response.status).toBe(304);
    expect(response.headers.etag).toBe(`"${sha256}"`);
    expect(response.headers["cache-control"]).toBe(CATALOG_ASSET_IMMUTABLE_CACHE);
  });

  it("returns 404 for a missing catalogue asset", async () => {
    const { app } = makeApp(null);
    const response = await request(app).get(`/api/v1/catalog/assets/${assetId}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "ASSET_NOT_FOUND", message: "Image not found" },
    });
  });
});
