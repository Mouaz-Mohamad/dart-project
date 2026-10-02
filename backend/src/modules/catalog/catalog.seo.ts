// DART CODE GUIDE | backend/src/modules/catalog/catalog.seo.ts
// الغرض: بناء خرائط منتجات SEO من الكتالوج العام الخادمي بدون الثقة في أي بيانات مرسلة من المتصفح.

const DEFAULT_STOREFRONT_ORIGIN = "https://dart-project-psi.vercel.app";

export interface SeoCatalogModel {
  modelId?: unknown;
  name?: unknown;
  updatedAt?: unknown;
}

export interface SeoCatalogPayload {
  models?: SeoCatalogModel[];
}

export function seoSlugPart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

export function productPathForModel(model: SeoCatalogModel): string {
  const title = seoSlugPart(model.name) || "product";
  const code = seoSlugPart(model.modelId) || "item";
  return `/products/${title}--${code}`;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizedOrigin(value: string): string {
  const fallback = DEFAULT_STOREFRONT_ORIGIN;
  try {
    const parsed = new URL(String(value || fallback));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    return parsed.origin;
  } catch {
    return fallback;
  }
}

function isoLastModified(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function buildProductSitemap(
  catalog: SeoCatalogPayload,
  storefrontOrigin = DEFAULT_STOREFRONT_ORIGIN,
): string {
  const origin = normalizedOrigin(storefrontOrigin);
  const seen = new Set<string>();
  const rows = (Array.isArray(catalog.models) ? catalog.models : [])
    .map((model) => {
      const modelId = String(model?.modelId ?? "").trim();
      const name = String(model?.name ?? "").trim();
      if (!modelId || !name) return null;
      const path = productPathForModel(model);
      if (seen.has(path)) return null;
      seen.add(path);
      const loc = encodeURI(`${origin}${path}`);
      const lastmod = isoLastModified(model.updatedAt);
      return `  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ""}<changefreq>daily</changefreq><priority>0.8</priority></url>`;
    })
    .filter((row): row is string => Boolean(row));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    '',
  ].join("\n");
}
