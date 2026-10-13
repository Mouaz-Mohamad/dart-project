// DART CODE GUIDE | tests/navigation-browser.cjs
// Real document/history regression against the staged production output; no request interception.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');
const requests = [];
let cartExists = true;
const model = { id: 'model-navigation', modelId: 'DW-NAV', name: 'Navigation Jeans', category: 'Jeans',
  selling: 800, discount: 0, active: true, sizeOptions: [{ name: 'M', active: true }],
  colorOptions: [{ name: 'Black', active: true, images: [{ url: '/Photos/Logos/01_Dart_original_transparent_240.webp' }] }] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://test');
  requests.push({ path: url.pathname, method: req.method, purpose: req.headers['sec-purpose'] || '',
    context: req.headers.cookie?.includes('navigation-low-data=1') ? 'low-data' : 'main' });
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    let payload = {};
    if (url.pathname === '/api/v1/catalog') payload = { version: 1, models: [model], stock: { '["DW-NAV","Black","M"]': 3 } };
    if (url.pathname === '/api/v1/site-settings') payload = { version: 1, settings: {} };
    if (url.pathname === '/api/v1/sets') payload = { sets: [] };
    if (url.pathname === '/api/v1/reviews') payload = { reviews: [] };
    if (url.pathname === '/api/v1/news') payload = { news: [], total: 0, items: [] };
    if (url.pathname.startsWith('/api/v1/cart/reservation/')) payload = { cart: cartExists ? {
      reservationId: url.pathname.split('/').at(-1), expiresAt: new Date(Date.now() + 900000).toISOString(),
      lines: [{ modelId: 'DW-NAV', color: 'Black', size: 'M', quantity: 1 }],
    } : null };
    if (url.pathname === '/api/v1/me') { res.statusCode = 401; payload = { error: { code: 'UNAUTHENTICATED', message: 'No session' } }; }
    res.end(JSON.stringify(payload)); return;
  }
  const route = url.pathname === '/' ? '/index.html' : url.pathname === '/products' ? '/products.html' : url.pathname;
  const file = path.resolve(root, '.' + decodeURIComponent(route));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  res.setHeader('Cache-Control', path.extname(file) === '.html' ? 'public, no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000');
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    // External fonts/maps do not participate in the document/history contract.
    content = content.toString().replace(/<(?:script|link)\b[^>]*(?:src|href)=["']https:\/\/[^>]*>(?:<\/script>)?/g, '');
  }
  res.end(content);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), ignoreDefaultArgs: ['--disable-back-forward-cache'], args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    await context.addInitScript(() => {
      window.__documentToken = crypto.randomUUID();
      window.__restored = false;
      window.addEventListener('pageshow', (event) => { window.__restored = event.persisted; });
      document.addEventListener('dart:critical-ready', () => { window.__criticalReady = true; });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    let restoreReasons = [];
    cdp.on('Page.backForwardCacheNotUsed', (event) => { restoreReasons = event.notRestoredExplanations.map(row => row.reason); });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#header-container .side-menu').count(), 1, 'header is present in the initial document');
    assert.equal(await page.locator('#footer .footer-continear').count(), 1, 'footer is present in the initial document');
    await page.waitForFunction(() => window.__criticalReady && window.DartState.read('dart_cart', []).length === 1);
    const homeToken = await page.evaluate(() => window.__documentToken);
    await page.waitForFunction(() => document.querySelector('#why [data-dart-section-loaded]') || document.getElementById('why')?.dataset.dartSectionLoaded === '1');
    assert.equal(requests.filter((req) => /\/sections\/(Nav-Bar|footer)\.html/.test(req.path)).length, 0, 'no extra shell HTTP requests');
    assert.ok(requests.some((req) => req.path === '/api/v1/reviews'), 'reviews prepare without scrolling');
    assert.ok(requests.some((req) => req.path === '/about.html'), 'other public documents preload automatically');
    const beforeVisit = requests.filter((req) => req.path === '/api/v1/analytics/events').length;
    await page.click('[data-go-products]');
    await page.waitForURL(/products(?:\.html)?$/);
    await page.waitForFunction(() => !!window.DartNavigation && !!document.querySelector('.product-card[data-id="DW-NAV"]'));
    const productsToken = await page.evaluate(() => window.__documentToken);
    await page.click('#toggleProductFilters');
    await page.fill('#productSearchInput', 'Navigation');
    await page.selectOption('#productSortSelect', 'price-high');
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.evaluate(() => document.querySelector('.side-menu a[href="/index.html"]').click());
    await page.waitForURL(origin + '/');
    const nativeRestore = await page.evaluate(() => window.__documentToken) === homeToken;
    const unsupportedLocalShell = process.env.DART_TEST_HEADLESS_SHELL === '1' && restoreReasons.includes('BackForwardCacheDisabledForDelegate');
    assert.ok(nativeRestore || unsupportedLocalShell, 'Home must restore its document in full Chromium');
    if (nativeRestore) assert.equal(await page.evaluate(() => window.__restored), true);
    cartExists = false;
    await page.evaluate(() => window.DartNavigation.go('/products.html'));
    await page.waitForURL(/products(?:\.html)?$/);
    if (nativeRestore) {
      assert.equal(await page.evaluate(() => window.__documentToken), productsToken, 'Products reuses its original document');
      assert.equal(await page.inputValue('#productSearchInput'), 'Navigation');
      assert.equal(await page.inputValue('#productSortSelect'), 'price-high');
      assert.equal(await page.locator('#productFiltersPanel').isVisible(), true);
    }
    await page.waitForFunction(() => window.DartState.read('dart_cart', []).length === 0);
    if (nativeRestore) assert.ok(requests.filter((req) => req.path === '/api/v1/analytics/events').length <= beforeVisit + 1, 'restoration and prerendering do not invent visits');
    await page.goBack(); await page.waitForURL(origin + '/');
    await page.goForward(); await page.waitForURL(/products(?:\.html)?$/);
    if (nativeRestore) assert.equal(await page.evaluate(() => window.__documentToken), productsToken);
    assert.deepEqual(errors, []);

    // Low-data connections keep normal navigation while skipping speculative requests.
    const lowData = await browser.newContext();
    await lowData.addCookies([{ name: 'navigation-low-data', value: '1', url: origin }]);
    await lowData.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }));
    const low = await lowData.newPage(); const marker = requests.length;
    await low.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await low.waitForFunction(() => window.DartNavigation);
    await low.waitForTimeout(250);
    assert.equal(requests.slice(marker).filter((req) => req.context === 'low-data' && req.path === '/about.html').length, 0);
    await low.evaluate(() => window.DartNavigation.go('/products.html'));
    await low.waitForURL(/products\.html$/);
    if (unsupportedLocalShell) console.log('SKIP native document/filter retention locally: headless-shell delegate disables BFCache. Full Chromium CI requires it.');
    console.log(nativeRestore
      ? 'PASS staged navigation: immediate shell, background content, native document/filter restoration, Back/Forward, fresh cart and save-data fallback'
      : 'PASS staged navigation: immediate shell, background content, fallback traversal, fresh cart and save-data fallback');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
