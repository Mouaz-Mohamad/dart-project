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
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

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

assert.doesNotMatch(ui, /serviceWorker\.register\s*\(/,
  'Storefront runtime must not register a Service Worker after Cache Lifecycle V2 retirement');
assert.doesNotMatch(homeUi, /serviceWorker\.register\s*\(/,
  'Homepage runtime must not register a Service Worker after Cache Lifecycle V2 retirement');
for (const entry of fs.readdirSync(path.join(root, 'Js'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const source = fs.readFileSync(path.join(root, 'Js', entry.name), 'utf8');
  assert.doesNotMatch(source, /serviceWorker\.register\s*\(/,
    `Storefront JS must not re-register retired Service Workers: ${entry.name}`);
}

assert.match(staging, /VERSIONABLE_ASSET_RE/);
assert.match(staging, /function versionHtmlAssets\(\)/);
assert.match(staging, /contentVersion\(localAsset\)/,
  'Production staging must content-version local CSS/JS references');
assert.match(staging, /versionHtmlAssets\(\)/,
  'Production staging must apply CSS/JS versioning to staged HTML');

const config = JSON.parse(vercel);
function cacheControlFor(source) {
  const headers = config.headers.find((entry) => entry.source === source)?.headers || [];
  return headers.find((header) => header.key === 'Cache-Control')?.value || '';
}

assert.match(cacheControlFor('/'), /no-store/,
  'Homepage navigation must never reuse stale HTML from browser/disk cache');
assert.match(cacheControlFor('/(.*).html'), /no-store/,
  'Static HTML documents must always be fetched fresh');
assert.match(cacheControlFor('/products'), /no-store/,
  'Rewritten products HTML route must always be fetched fresh');
assert.match(cacheControlFor('/manifest.json'), /no-store/,
  'PWA manifest must refresh instead of pinning stale launch metadata');
assert.equal(manifest.start_url, '/',
  'PWA start_url must use the canonical root path');

assert.match(cacheControlFor('/sw.js'), /no-store/,
  '/sw.js must bypass browser/CDN caches during retirement');
assert.match(cacheControlFor('/Js/dart-cache-recovery.js'), /no-store/,
  'Cache recovery script must bypass browser/CDN caches during migration');

console.log('PASS Fresh Delivery V3: HTML stays fresh while local CSS/JS receive content versions');
