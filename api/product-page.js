// DART CODE GUIDE | api/product-page.js
// الغرض: Server-render product deep-link SEO metadata from the authoritative public catalog while preserving the existing products UI.
"use strict";

const PUBLIC_ORIGIN = "https://dart-project-psi.vercel.app";
const CATALOG_URL = process.env.DART_CATALOG_URL || "https://dart-api-dusky.vercel.app/api/v1/catalog";
const SOCIAL_URLS = Object.freeze([
  "https://www.instagram.com/dart.official.eg/",
  "https://www.tiktok.com/@dart.official.eg",
  "https://www.youtube.com/@dart-official-eg",
  "https://www.facebook.com/share/1BM4sZGPVv/",
]);

function seoSlugPart(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function productPathForModel(model) {
  const title = seoSlugPart(model?.name) || "product";
  const code = seoSlugPart(model?.modelId) || "item";
  return `/products/${title}--${code}`;
}

function resolveModel(catalog, rawSlug) {
  const slug = String(rawSlug || "").trim().replace(/^\/+|\/+$/g, "");
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const marker = slug.lastIndexOf("--");
  const stableCode = marker >= 0 ? slug.slice(marker + 2) : "";
  if (stableCode) {
    const byCode = models.find((model) => seoSlugPart(model?.modelId) === stableCode);
    if (byCode) return byCode;
  }
  return models.find((model) => productPathForModel(model).slice("/products/".length) === slug) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function activeOptions(value) {
  return (Array.isArray(value) ? value : []).filter((option) => option && option.active !== false && String(option.name || "").trim());
}

function firstImage(model) {
  for (const color of activeOptions(model?.colorOptions)) {
    const image = (Array.isArray(color.images) ? color.images : []).find((entry) => String(entry?.url || "").trim());
    if (image) return String(image.url).trim();
  }
  return `${PUBLIC_ORIGIN}/Photos/1080px.png`;
}

function stockQuantity(catalog, modelId, color, size) {
  const stock = catalog?.stock && typeof catalog.stock === "object" ? catalog.stock : {};
  return Math.max(0, Number(stock[JSON.stringify([modelId, color, size])]) || 0);
}

function priceForModel(model) {
  const selling = Math.max(0, Number(model?.selling) || 0);
  const discount = Math.min(100, Math.max(0, Number(model?.discount) || 0));
  return Math.round(selling * (1 - discount / 100) * 100) / 100;
}

function productDescription(model) {
  const name = String(model?.name || "Dart product").trim();
  const category = String(model?.category || "ملابس رجالي").trim();
  const price = priceForModel(model);
  return `تسوق ${name} من Dart for you (دارت) في مصر. ${category} بسعر ${price.toFixed(2)} EGP مع الألوان والمقاسات المتاحة والمخزون المحدث.`;
}

function buildProductGraph(catalog, model) {
  const url = `${PUBLIC_ORIGIN}${productPathForModel(model)}`;
  const colors = activeOptions(model?.colorOptions);
  const sizes = activeOptions(model?.sizeOptions);
  const price = priceForModel(model).toFixed(2);
  const variants = [];
  for (const color of colors) {
    const image = (Array.isArray(color.images) ? color.images : []).find((entry) => String(entry?.url || "").trim())?.url || firstImage(model);
    for (const size of sizes) {
      const quantity = stockQuantity(catalog, model.modelId, color.name, size.name);
      variants.push({
        "@type": "Product",
        "@id": `${url}#${encodeURIComponent(String(color.name))}-${encodeURIComponent(String(size.name))}`,
        name: `${model.name} - ${color.name} - ${size.name}`,
        sku: `${model.modelId}-${color.name}-${size.name}`,
        color: String(color.name),
        size: String(size.name),
        image: String(image),
        brand: { "@id": `${PUBLIC_ORIGIN}/#brand` },
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: "EGP",
          price,
          availability: quantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      });
    }
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${PUBLIC_ORIGIN}/#organization`,
        name: "Dart | for you",
        alternateName: ["Dart for you", "Dart Wear", "دارت"],
        url: `${PUBLIC_ORIGIN}/`,
        logo: `${PUBLIC_ORIGIN}/Photos/1080px.png`,
        sameAs: SOCIAL_URLS,
      },
      {
        "@type": "Brand",
        "@id": `${PUBLIC_ORIGIN}/#brand`,
        name: "Dart | for you",
        alternateName: ["Dart for you", "Dart Wear", "دارت"],
        sameAs: SOCIAL_URLS,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Dart for you", item: `${PUBLIC_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Products", item: `${PUBLIC_ORIGIN}/products` },
          { "@type": "ListItem", position: 3, name: String(model.name), item: url },
        ],
      },
      {
        "@type": "ProductGroup",
        "@id": `${url}#product`,
        productGroupID: String(model.modelId),
        name: String(model.name),
        description: productDescription(model),
        url,
        image: firstImage(model),
        brand: { "@id": `${PUBLIC_ORIGIN}/#brand` },
        variesBy: ["https://schema.org/color", "https://schema.org/size"],
        hasVariant: variants,
      },
    ],
  };
}

function replaceMeta(html, expression, replacement) {
  return expression.test(html) ? html.replace(expression, replacement) : html;
}

function renderProductPage(template, catalog, model) {
  const canonical = `${PUBLIC_ORIGIN}${productPathForModel(model)}`;
  const title = `${String(model.name).trim()} | Dart for you (دارت)`;
  const description = productDescription(model);
  const image = firstImage(model);
  const graph = buildProductGraph(catalog, model);
  let html = String(template || "");
  html = replaceMeta(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = replaceMeta(html, /<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="description" content="${escapeHtml(description)}">`);
  html = replaceMeta(html, /<meta\s+name="robots"\s+content="[^"]*"\s*\/?\s*>/i, '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">');
  html = replaceMeta(html, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?\s*>/i, `<link rel="canonical" href="${escapeHtml(canonical)}">`);
  html = replaceMeta(html, /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:title" content="${escapeHtml(title)}">`);
  html = replaceMeta(html, /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:description" content="${escapeHtml(description)}">`);
  html = replaceMeta(html, /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:image" content="${escapeHtml(image)}">`);
  html = replaceMeta(html, /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:image:secure_url" content="${escapeHtml(image)}">`);
  html = html.replace(/\s*<meta\s+property="og:image:(?:type|width|height)"[^>]*>/gi, "");
  html = replaceMeta(html, /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:image:alt" content="${escapeHtml(`${model.name} - Dart for you`)}">`);
  html = replaceMeta(html, /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:url" content="${escapeHtml(canonical)}">`);
  html = replaceMeta(html, /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?\s*>/i, '<meta property="og:type" content="product">');
  html = replaceMeta(html, /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:title" content="${escapeHtml(title)}">`);
  html = replaceMeta(html, /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:description" content="${escapeHtml(description)}">`);
  html = replaceMeta(html, /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:image" content="${escapeHtml(image)}">`);
  html = replaceMeta(html, /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:image:alt" content="${escapeHtml(`${model.name} - Dart for you`)}">`);
  html = replaceMeta(html, /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i, `<script type="application/ld+json">${safeJson(graph)}</script>`);
  return html;
}

function renderNotFoundPage(template) {
  let html = String(template || "");
  html = replaceMeta(html, /<title>[\s\S]*?<\/title>/i, "<title>Product not found | Dart for you</title>");
  html = replaceMeta(html, /<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/i, '<meta name="description" content="المنتج المطلوب غير متاح حاليًا على Dart for you.">');
  html = replaceMeta(html, /<meta\s+name="robots"\s+content="[^"]*"\s*\/?\s*>/i, '<meta name="robots" content="noindex, follow">');
  return html;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "text/html,application/json;q=0.9" }, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Upstream ${response.status} for ${url}`);
  return response.text();
}

async function handler(request, response) {
  try {
    const rawSlug = Array.isArray(request.query?.slug) ? request.query.slug[0] : request.query?.slug;
    const [template, catalogText] = await Promise.all([
      fetchText(`${PUBLIC_ORIGIN}/products`),
      fetchText(CATALOG_URL),
    ]);
    const catalog = JSON.parse(catalogText);
    const model = resolveModel(catalog, rawSlug);
    if (!model) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      return response.status(404).send(renderNotFoundPage(template));
    }
    const canonicalPath = productPathForModel(model);
    const requestedSlug = String(rawSlug || "").replace(/^\/+|\/+$/g, "");
    if (requestedSlug !== canonicalPath.slice("/products/".length)) {
      response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
      return response.redirect(308, `${PUBLIC_ORIGIN}${canonicalPath}`);
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=900");
    return response.status(200).send(renderProductPage(template, catalog, model));
  } catch (error) {
    console.error("Dart product SSR failed", error instanceof Error ? error.message : error);
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).send("Product page is temporarily unavailable.");
  }
}

module.exports = handler;
module.exports._test = {
  SOCIAL_URLS,
  seoSlugPart,
  productPathForModel,
  resolveModel,
  firstImage,
  stockQuantity,
  priceForModel,
  buildProductGraph,
  renderProductPage,
  renderNotFoundPage,
};
