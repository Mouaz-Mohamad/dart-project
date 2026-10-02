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
assert(dialog.includes('/Js/dart-product-links.js'), 'Products route must load the deep-link helper');
assert(source.includes('history.replaceState'), 'Modal route changes must use History API without navigation');
assert(!/location\.(?:reload|assign|replace)\s*\(/.test(source), 'Valid product routing must not trigger a page navigation');
assert(source.includes('application/ld+json'), 'Model route must expose Product structured data');
assert(source.includes('alternateName: BRAND_ALT_NAME'), 'Product schema must preserve Dart Wear as alternative brand name');

console.log('PASS product deep links: slugs, stable resolution, rewrites, no-reload routing, SEO schema');
