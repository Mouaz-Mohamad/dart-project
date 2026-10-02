// DART CODE GUIDE | tests/cache-revalidation-contract.cjs
// الغرض: منع رجوع أي static/site cache إلى stale-first بعد تحديث الملفات.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'Js', 'dart-ui.js'), 'utf8');

assert.match(sw, /dart-static-v27-revalidate-all/);
assert.match(sw, /new Request\(request, \{ cache: 'no-cache' \}\)/);
assert.match(sw, /const response = await fetch\(refreshRequest\)/);
assert.match(sw, /const cached = await caches\.match\(request\)/);
assert.doesNotMatch(
  sw,
  /caches\.match\(request\)[\s\S]{0,250}if \(cached\) return cached;[\s\S]{0,250}return fetch\(request\)/,
  'Service Worker must never serve a cached public asset before trying the network',
);

assert.match(ui, /dart_fragment_v3:/);
assert.match(ui, /html !== cached/);
assert.match(ui, /updateViaCache: 'none'/);
assert.doesNotMatch(
  ui,
  /cache:\s*'force-cache'/,
  'Storefront fragment/navigation warming must revalidate rather than force stale browser cache',
);

console.log('PASS cache revalidation policy: online freshness first, offline cache fallback');
