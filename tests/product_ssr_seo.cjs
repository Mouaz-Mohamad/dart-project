// DART CODE GUIDE | tests/product_ssr_seo.cjs
// الغرض: يثبت أن روابط المنتجات العميقة تحصل على Canonical/Metadata/ProductGroup من السيرفر قبل JavaScript.
"use strict";
const assert = require("assert");
const renderer = require("../api/product-page.js")._test;

const template = `<!doctype html><html><head>
<title>Collection</title>
<meta name="description" content="collection">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://dart-project-psi.vercel.app/products">
<meta property="og:title" content="Collection"><meta property="og:description" content="collection">
<meta property="og:image" content="logo.png"><meta property="og:image:secure_url" content="logo.png">
<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="logo"><meta property="og:url" content="/products"><meta property="og:type" content="website">
<meta name="twitter:title" content="Collection"><meta name="twitter:description" content="collection"><meta name="twitter:image" content="logo.png"><meta name="twitter:image:alt" content="logo">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage"}</script>
</head><body></body></html>`;
const model = {
  modelId: "DW-101",
  name: "Cairo Wide Leg Jeans",
  category: "Pants",
  selling: 800,
  discount: 25,
  colorOptions: [{ name: "Black", active: true, images: [{ url: "https://cdn.example/black.jpg" }] }],
  sizeOptions: [{ name: "M", active: true }, { name: "L", active: true }],
};
const catalog = {
  models: [model],
  stock: {
    [JSON.stringify(["DW-101", "Black", "M"])]: 2,
    [JSON.stringify(["DW-101", "Black", "L"])]: 0,
  },
};
const path = renderer.productPathForModel(model);
assert.equal(path, "/products/cairo-wide-leg-jeans--dw-101");
assert.strictEqual(renderer.resolveModel(catalog, "old-title--dw-101"), model, "stable model code must resolve old title slugs");
const html = renderer.renderProductPage(template, catalog, model);
assert(html.includes(`rel="canonical" href="https://dart-project-psi.vercel.app${path}"`));
assert(html.includes("Cairo Wide Leg Jeans | Dart for you (دارت)"));
assert(html.includes('property="og:type" content="product"'));
assert(!html.includes('og:image:width'), "product response must not publish false static image dimensions");
const jsonld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
assert(jsonld, "product JSON-LD must exist in initial HTML");
const graph = JSON.parse(jsonld)["@graph"];
const productGroup = graph.find((node) => node["@type"] === "ProductGroup");
const breadcrumb = graph.find((node) => node["@type"] === "BreadcrumbList");
const organization = graph.find((node) => node["@type"] === "Organization");
assert(productGroup && breadcrumb && organization);
assert.equal(productGroup.hasVariant.length, 2);
assert.equal(productGroup.hasVariant[0].offers.price, "600.00");
assert.equal(productGroup.hasVariant[0].offers.availability, "https://schema.org/InStock");
assert.equal(productGroup.hasVariant[1].offers.availability, "https://schema.org/OutOfStock");
for (const url of renderer.SOCIAL_URLS) assert(organization.sameAs.includes(url));
const notFound = renderer.renderNotFoundPage(template);
assert(notFound.includes('content="noindex, follow"'));
console.log("PASS product SSR canonical, social metadata, ProductGroup variants, availability and 404 noindex");
