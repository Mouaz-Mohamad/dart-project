// DART CODE GUIDE | tests/cache-revalidation-contract.cjs
// Prevent stale Service Worker/static-cache behavior from returning after deployments.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'Js', 'dart-ui.js'), 'utf8');
const homeUi = fs.readFileSync(path.join(root, 'Js', 'dart-ui.home.min.js'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'Js', 'dart-cache-recovery.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'scripts', 'stage-vercel-public.cjs'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

assert.match(sw, /DART_CACHE_PREFIX = 'dart-static-'/);
assert.match(sw, /caches\.keys\(\)/);
assert.match(sw, /self\.registration\.unregister\(\)/);
assert.doesNotMatch(sw, /addEventListener\(['"]fetch['"]/,
  'Retirement Service Worker must not intercept storefront requests');
assert.doesNotMatch(sw, /caches\.match\(/,
  'Retirement Service Worker must never serve cached responses');

assert.match(recovery, /navigator\.serviceWorker\.getRegistrations\(\)/);
assert.match(recovery, /registration\.unregister\(\)/);
assert.match(recovery, /key\.startsWith\("dart-static-"\)/);
assert.match(recovery, /6500/,
  'Recovery must run again after deferred legacy registration can fire');

assert.match(ui, /dart_fragment_v3:/);
assert.match(ui, /html !== cached/);
assert.doesNotMatch(ui, /cache:\s*'force-cache'/,
  'Storefront fragment/navigation warming must revalidate rather than force stale browser cache');
assert.doesNotMatch(homeUi, /cache:\s*["']force-cache["']/,
  'Homepage fragment loading must not force stale browser cache');

assert.match(staging, /dart-cache-recovery\.js\?v=/,
  'Production staging must content-version the cache recovery asset');
const config = JSON.parse(vercel);
const swHeaders = config.headers.find((entry) => entry.source === '/sw.js')?.headers || [];
const recoveryHeaders = config.headers.find((entry) => entry.source === '/Js/dart-cache-recovery.js')?.headers || [];
assert.ok(swHeaders.some((header) => header.key === 'Cache-Control' && /no-store/.test(header.value)),
  '/sw.js must bypass browser/CDN caches during retirement');
assert.ok(recoveryHeaders.some((header) => header.key === 'Cache-Control' && /no-store/.test(header.value)),
  'Cache recovery script must bypass browser/CDN caches during migration');

console.log('PASS Cache Lifecycle V2: legacy workers/caches retire and online pages stay fresh');
