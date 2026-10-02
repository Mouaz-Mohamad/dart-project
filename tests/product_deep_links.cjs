const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Js/dart-product-links.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const dialog = fs.readFileSync(path.join(root, 'Js/dart-dialog.js'), 'utf8');

const listeners = new Map();
const documentMock = {
  readyState: 'loading',
  addEventListener(type, handler) { listeners.set(type, handler); },
};
const locationMock = { pathname: '/products', origin: 'https://dart.example', href: 'https://dart.example/products' };
const windowMock = { location: locationMock, setTimeout, clearTimeout };
const sandbox = {
  window: windowMock,
  document: documentMock,
  location: locationMock,
  history: { state: null },
  URL,
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
vm.runInNewContext(source, sandbox, { filename: 'dart-product-links.js' });
const links = windowMock.DartProductLinks;
assert(links, 'DartProductLinks API should be installed before DOM initialization');

const original = { id: 'DW-101', code: 'DW-101', title: 'Cairo Wide Leg Jeans' };
assert.strictEqual(links.slugFor(original), 'cairo-wide-leg-jeans--dw-101');
assert.strictEqual(links.pathFor(original), '/products/cairo-wide-leg-jeans--dw-101');
assert.strictEqual(links.slugFromPath('/products/cairo-wide-leg-jeans--dw-101'), 'cairo-wide-leg-jeans--dw-101');
assert.strictEqual(links.slugFromPath('/products.html'), '');

const renamed = { ...original, title: 'Cairo Relaxed Wide Leg Jeans' };
assert.strictEqual(
  links.resolveSlug('cairo-wide-leg-jeans--dw-101', [renamed]),
  renamed,
  'Old title slugs should keep resolving by stable model code suffix',
);

const rewriteSources = (vercel.rewrites || []).map((entry) => entry.source);
assert(rewriteSources.includes('/products'), 'Vercel must rewrite /products to the product collection');
assert(rewriteSources.includes('/products/:slug'), 'Vercel must rewrite model deep links to products.html');
assert(rewriteSources.includes('/product-sitemap.xml'), 'Vercel must expose the server-authoritative product sitemap');
const legacyProductsRedirect = (vercel.redirects || []).find((entry) => entry.source === '/products.html');
assert(legacyProductsRedirect?.destination === '/products' && legacyProductsRedirect.permanent === true,
  'Legacy products.html must permanently redirect to the canonical /products URL');
assert(dialog.includes('/Js/dart-product-links.js'), 'Products route must load the deep-link helper');
assert(source.includes('history.replaceState'), 'Modal route changes must use History API without navigation');
assert(!/location\.(?:reload|assign|replace)\s*\(/.test(source), 'Valid product routing must not trigger a page navigation');
assert(source.includes('application/ld+json'), 'Model route must expose product structured data');
assert(source.includes('ProductGroup'), 'Variant models must expose ProductGroup structured data');
assert(source.includes('BreadcrumbList'), 'Product routes must expose breadcrumb structured data');
assert(source.includes('Dart Wear'), 'SEO discovery must preserve Dart Wear as an alternative brand name');
assert(source.includes('لبس رجالي') && source.includes('لبس شبابي'), 'Collection discovery metadata must cover natural Arabic menswear queries');
assert(source.includes('imageNode.alt'), 'Rendered product images must receive descriptive alt text');

const schema = links.productStructuredData({
  ...original,
  category: 'Jeans',
  price: 799,
  sizeOptions: [{ name: 'M', active: true }, { name: 'L', active: true }],
  colorOptions: [{ name: 'Black', active: true }],
  stock: { M: { Black: 2 }, L: { Black: 0 } },
  gallery: [{ color: 'Black', src: '/Photos/products/black.webp' }],
}, 'https://dart.example/products/cairo-wide-leg-jeans--dw-101', 'Wide leg jeans', 'https://dart.example/Photos/products/black.webp');
const graph = JSON.parse(JSON.stringify(schema))['@graph'];
const group = graph.find((node) => node['@type'] === 'ProductGroup');
assert(group, 'Variant product schema must contain a ProductGroup');
assert.deepStrictEqual(group.variesBy, ['https://schema.org/color', 'https://schema.org/size']);
assert.strictEqual(group.hasVariant.length, 2);
assert.strictEqual(group.hasVariant[0].offers.availability, 'https://schema.org/InStock');
assert.strictEqual(group.hasVariant[1].offers.availability, 'https://schema.org/OutOfStock');

console.log('PASS product deep links: stable URLs, canonical redirect, discovery metadata, ProductGroup variants, sitemap and no-reload routing');
