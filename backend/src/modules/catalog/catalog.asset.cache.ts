// DART CODE GUIDE | backend/src/modules/catalog/catalog.asset.cache.ts
// Cache-safe versioned URLs for mutable catalogue image records.

export const CATALOG_ASSET_IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const CATALOG_ASSET_REDIRECT_CACHE = "public, max-age=300, must-revalidate";

export function catalogAssetVersion(value: unknown): string {
  if (Array.isArray(value)) return catalogAssetVersion(value[0]);
  return typeof value === "string" ? value.trim() : "";
}

export function catalogAssetUrl(assetId: string, sha256: string): string {
  return `/api/v1/catalog/assets/${encodeURIComponent(assetId)}?v=${encodeURIComponent(sha256)}`;
}

export function catalogAssetVersionMatches(value: unknown, sha256: string): boolean {
  const version = catalogAssetVersion(value);
  return Boolean(version) && version === sha256;
}
