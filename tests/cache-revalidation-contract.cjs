// DART CODE GUIDE | tests/cache-revalidation-contract.cjs
// Prevent stale Service Worker/static-cache behavior from returning after deployments.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

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

assert.match(ui, /const dartFragmentMemory = new Map\(\)/);
assert.match(ui, /key\.startsWith\('dart_fragment_'\)/);
assert.match(ui, /container\.dataset\.dartStatic/);
assert.doesNotMatch(ui, /localStorage\.setItem\(fragmentCacheKey/,
  'Static fragments must not survive releases in unversioned browser storage');
assert.doesNotMatch(ui, /cache:\s*'force-cache'/,
  'Storefront fragment/navigation warming must revalidate rather than force stale browser cache');
assert.doesNotMatch(homeUi, /cache:\s*["']force-cache["']/,
  'Homepage fragment loading must not force stale browser cache');

assert.doesNotMatch(ui, /serviceWorker\.register\s*\(/,
  'Storefront runtime must not register a Service Worker after Cache Lifecycle V2 retirement');
assert.doesNotMatch(homeUi, /serviceWorker\.register\s*\(/,
  'Homepage runtime must not register a Service Worker after Cache Lifecycle V2 retirement');
for (const entry of fs.readdirSync(path.join(root, 'Js'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'dart-customer-notifications.js') continue;
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

for (const source of ['/', '/(.*).html', '/products', '/sets/:setId']) {
  assert.match(cacheControlFor(source), /no-cache.*must-revalidate/,
    'Public HTML must revalidate on a new request while permitting native document restoration');
}
assert.match(cacheControlFor('/Eye/(.*)'), /no-store/);
assert.match(cacheControlFor('/(cart-checkout|profile|Sign Up modern|track|rep|pdf).html'), /no-store/);
assert.match(staging, /inlineSharedShell\(\)/);
assert.match(cacheControlFor('/manifest.json'), /no-store/,
  'PWA manifest must refresh instead of pinning stale launch metadata');
assert.equal(manifest.start_url, '/',
  'PWA start_url must use the canonical root path');

assert.match(cacheControlFor('/sw.js'), /no-store/,
  '/sw.js must bypass browser/CDN caches during retirement');
assert.match(cacheControlFor('/Js/dart-cache-recovery.js'), /no-store/,
  'Cache recovery script must bypass browser/CDN caches during migration');

const staticSource = '/(CSS|Js|Photos|Icons)/(.*)';
const versionedRule = config.headers.find(entry => entry.source === staticSource && entry.has);
assert.deepEqual(versionedRule?.has, [{ type: 'query', key: 'v', value: '[a-f0-9]{16}' }]);
assert.match(versionedRule.headers[0].value, /max-age=31536000, immutable/);
const plainRule = config.headers.find(entry => entry.source === staticSource && !entry.has);
assert.match(plainRule.headers[0].value, /max-age=0, must-revalidate/);
for (const protectedPath of ['/Photos/me.png', '/Photos/me.webp', '/Js/dart-cache-recovery.js'])
  assert(config.headers.findIndex(entry => entry.source === protectedPath) > config.headers.indexOf(versionedRule),
    'Founder fallbacks and cache recovery retain their explicit no-store override');

// Validate actual delivery bytes: a stale hash after an image/style edit must fail.
if (fs.existsSync(path.join(root, 'public/index.html'))) {
  const staged = path.join(root, 'public');
  let images = 0, backgrounds = 0;
  const verify = (file, assetUrl, hash) => {
    const asset = assetUrl.startsWith('/') ? path.join(staged, decodeURIComponent(assetUrl)) :
      path.resolve(path.dirname(file), decodeURIComponent(assetUrl));
    assert(asset.startsWith(staged + path.sep));
    assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex').slice(0, 16),
      `${file}: URL must change when ${assetUrl} changes`);
  };
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (entry.name.endsWith('.html')) {
        const html = fs.readFileSync(file, 'utf8');
        for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+\.(?:png|jpe?g|webp|avif|gif|svg|ico))\?v=([a-f0-9]{16})/gi)) {
          if (/^(?:https?:)?\/\//i.test(match[1])) continue;
          verify(file, match[1], match[2]); images++;
        }
      } else if (entry.name.endsWith('.css')) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(["']?([^"'()]+\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?))\?v=([a-f0-9]{16})/gi)) {
          if (/^(?:https?:)?\/\//i.test(match[1])) continue;
          verify(file, match[1], match[2]); backgrounds++;
        }
      }
    }
  }
  walk(staged);
  assert(images > 0 && backgrounds > 0, 'HTML and CSS media must both be content-versioned');
  const html = fs.readFileSync(path.join(staged, 'index.html'), 'utf8');
  const preload = html.match(/rel="preload" as="image" href="([^"]+)"/)[1];
  assert(html.includes(`src="${preload}"`), 'Hero preload and displayed image must use the same cache key');
}

console.log('PASS public HTML revalidation, private no-store, static shell and content-versioned delivery');
