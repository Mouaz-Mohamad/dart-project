// DART CODE GUIDE | tests/navigation-browser.cjs
// Real document/history regression against the staged production output; no request interception.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');
const csp = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'))
  .headers.flatMap(rule => rule.headers).find(header => header.key.toLowerCase() === 'content-security-policy').value;
const requests = [];
let cartExists = true;
const snapshots = [];
let scenarioPhase = 0, resolveScenario, rejectScenario;
const scenarioFinished = new Promise((resolve, reject) => { resolveScenario = resolve; rejectScenario = reject; });
const model = { id: 'model-navigation', modelId: 'DW-NAV', name: 'Navigation Jeans', category: 'Jeans',
  selling: 800, discount: 0, active: true, sizeOptions: [{ name: 'M', active: true }],
  colorOptions: [{ name: 'Black', active: true, images: [{ url: '/Photos/Logos/01_Dart_original_transparent_240.webp' }] }] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://test');
  requests.push({ path: url.pathname, method: req.method, purpose: req.headers['sec-purpose'] || '',
    context: req.headers.cookie?.includes('navigation-low-data=1') ? 'low-data' : 'main' });
  if (url.pathname === '/__dart_test/navigation') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') { res.end(JSON.stringify({ phase: scenarioPhase })); return; }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const snapshot = JSON.parse(body);
        if (snapshot.error) throw new Error(snapshot.error);
        assert.equal(snapshot.phase, scenarioPhase, 'the native scenario advances in order');
        snapshots.push(snapshot); scenarioPhase += 1;
        if (snapshot.phase === 2) cartExists = false;
        res.end('{}');
        if (snapshot.phase === 5) resolveScenario(snapshots);
      } catch (error) { res.statusCode = 500; res.end('{}'); rejectScenario(error); }
    });
    return;
  }
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
    res.setHeader('Content-Security-Policy', csp);
    // External fonts/maps do not participate in the document/history contract.
    content = content.toString().replace(/<(?:script|link)\b[^>]*(?:src|href)=["']https:\/\/[^>]*>(?:<\/script>)?/g, '');
  }
  res.end(content);
});

// Playwright does not support keeping Page synchronized through BFCache restores:
// https://github.com/microsoft/playwright/blob/main/docs/src/navigations.md#backforward-cache-bfcache
// Drive this scenario in the real documents and report observations to the fixture server.
// No request interception, SPA replacement, or browser cache emulation is used.
function nativeScenario(origin) {
  window.__documentToken = crypto.randomUUID();
  window.__restored = false;
  const errors = [];
  let lastPhase = -1;
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  document.addEventListener('securitypolicyviolation', (event) => errors.push(`CSP ${event.effectiveDirective}: ${event.blockedURI}`));
  document.addEventListener('dart:critical-ready', () => { window.__criticalReady = true; });
  const wait = async (condition) => {
    const deadline = Date.now() + 10000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Native scenario timed out: ' + location.pathname + ', phase ' + lastPhase);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const cart = () => window.DartState?.read('dart_cart', []) || [];
  const report = async (phase) => {
    const panel = document.getElementById('productFiltersPanel');
    const snapshot = { phase, url: location.href, token: window.__documentToken, restored: window.__restored,
      headerCount: document.querySelectorAll('#header-container .side-menu').length,
      footerCount: document.querySelectorAll('#footer .footer-continear').length,
      search: document.getElementById('productSearchInput')?.value,
      sort: document.getElementById('productSortSelect')?.value,
      filtersVisible: !!panel && panel.getBoundingClientRect().height > 0,
      scrollY: window.scrollY,
      cartLength: cart().length, errors: [...errors] };
    const response = await fetch(origin + '/__dart_test/navigation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error('Native scenario report rejected');
  };
  async function run() {
    if (document.prerendering || document.visibilityState !== 'visible') return;
    try {
      const { phase } = await (await fetch(origin + '/__dart_test/navigation', { cache: 'no-store' })).json();
      if (phase === lastPhase || phase > 5) return;
      lastPhase = phase;
      if (phase === 0) {
        await wait(() => window.__criticalReady && cart().length === 1 && document.getElementById('why')?.dataset.dartSectionLoaded === '1');
        await report(phase);
        document.querySelector('[data-go-products]').click();
      } else if (phase === 1) {
        await wait(() => window.DartNavigation && document.querySelector('.product-card[data-id="DW-NAV"]'));
        document.getElementById('toggleProductFilters').click();
        const search = document.getElementById('productSearchInput');
        search.value = 'Navigation'; search.dispatchEvent(new Event('input', { bubbles: true }));
        const sort = document.getElementById('productSortSelect');
        sort.value = 'price-high'; sort.dispatchEvent(new Event('change', { bubbles: true }));
        window.scrollTo({ top: 400, left: 0, behavior: 'instant' });
        await wait(() => Math.abs(window.scrollY - 400) <= 1);
        await wait(() => document.getElementById('productFiltersPanel').getBoundingClientRect().height > 0);
        await report(phase);
        document.querySelector('.side-menu a[href="/index.html"]').click();
      } else if (phase === 2) {
        await wait(() => window.DartNavigation && window.__criticalReady && cart().length === 1);
        await report(phase);
        window.DartNavigation.go('/products.html');
      } else if (phase === 3) {
        await wait(() => window.DartNavigation && document.querySelector('.product-card[data-id="DW-NAV"]') && cart().length === 0);
        await report(phase);
        window.history.back();
      } else if (phase === 4) {
        await wait(() => window.DartNavigation && window.__criticalReady);
        await report(phase);
        window.history.forward();
      } else if (phase === 5) {
        await wait(() => window.DartNavigation && document.querySelector('.product-card[data-id="DW-NAV"]') && cart().length === 0);
        await report(phase);
      }
    } catch (error) {
      await fetch(origin + '/__dart_test/navigation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.stack || String(error) }) });
    }
  }
  window.addEventListener('pageshow', (event) => { window.__restored = event.persisted; void run(); });
  document.addEventListener('prerenderingchange', () => { void run(); });
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), ignoreDefaultArgs: ['--disable-back-forward-cache'], args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    await context.addInitScript({ content: `(${nativeScenario.toString()})(${JSON.stringify(origin)});` });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const restoreReasons = new Set();
    cdp.on('Page.backForwardCacheNotUsed', (event) => {
      event.notRestoredExplanations.forEach(row => restoreReasons.add(row.reason));
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    let timeout;
    const observed = await Promise.race([scenarioFinished, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Native navigation scenario did not finish; completed phases: ' + snapshots.map(row => row.phase).join(','))), 35000);
    })]).finally(() => clearTimeout(timeout));
    const [home, products, homeReturn, productsReturn, back, forward] = observed;
    for (const row of observed) {
      assert.equal(row.headerCount, 1, 'each document contains one header');
      assert.equal(row.footerCount, 1, 'each document contains one footer');
      assert.deepEqual(row.errors, [], 'no page exceptions through native restoration');
    }
    assert.equal(requests.filter((req) => /\/sections\/(Nav-Bar|footer)\.html/.test(req.path)).length, 0, 'no extra shell HTTP requests');
    assert.ok(requests.some((req) => req.path === '/api/v1/reviews'), 'reviews prepare without scrolling');
    assert.ok(requests.some((req) => req.path === '/about.html'), 'other public documents preload automatically');
    const nativeRestore = homeReturn.token === home.token;
    // The local headless-shell delegate has no BFCache support. Never skip native
    // assertions for a full Chromium binary, including the required GitHub CI run.
    const unsupportedLocalShell = process.env.DART_TEST_HEADLESS_SHELL === '1' &&
      path.basename(process.env.CHROMIUM_EXECUTABLE || '') === 'headless_shell';
    assert.ok(nativeRestore || unsupportedLocalShell,
      'Home must restore its document in full Chromium; reasons: ' + [...restoreReasons].join(','));
    if (nativeRestore) {
      assert.equal(homeReturn.restored, true);
      for (const row of [productsReturn, forward]) {
        assert.equal(row.token, products.token, 'Products reuses its original document');
        assert.equal(row.restored, true);
        assert.equal(row.search, 'Navigation');
        assert.equal(row.sort, 'price-high');
        assert.equal(row.filtersVisible, true);
        assert.ok(Math.abs(row.scrollY - products.scrollY) <= 1, 'Products retains its scroll position');
      }
      assert.equal(back.token, home.token, 'Back restores the original Home document');
      assert.equal(back.restored, true);
      assert.ok(requests.filter((req) => req.path === '/api/v1/analytics/events').length <= 2, 'restoration and prerendering do not invent visits');
    }
    assert.equal(homeReturn.url, origin + '/'); assert.equal(back.url, origin + '/');
    assert.match(productsReturn.url, /\/products(?:\.html)?$/); assert.match(forward.url, /\/products(?:\.html)?$/);
    assert.equal(productsReturn.cartLength, 0); assert.equal(forward.cartLength, 0);
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
    await low.waitForURL(/products\.html$/, { waitUntil: 'commit' });

    // The two approved JSON hashes must not authorize unrelated inline code.
    const probe = await context.newPage();
    await probe.goto(origin + '/about.html', { waitUntil: 'domcontentloaded' });
    await probe.evaluate(() => {
      window.__inlineProbeRan = false;
      window.__inlineProbeBlocked = false;
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.blockedURI === 'inline' && event.effectiveDirective.startsWith('script-src'))
          window.__inlineProbeBlocked = true;
      });
      const script = document.createElement('script');
      script.textContent = 'window.__inlineProbeRan = true;';
      document.head.appendChild(script);
    });
    await probe.waitForFunction(() => window.__inlineProbeBlocked);
    assert.equal(await probe.evaluate(() => window.__inlineProbeRan), false, 'Unapproved inline JavaScript remains blocked by production CSP');
    await probe.close();
    if (unsupportedLocalShell) console.log('SKIP native document/filter retention locally: headless-shell delegate disables BFCache. Full Chromium CI requires it.');
    console.log(nativeRestore
      ? 'PASS staged navigation: immediate shell, background content, native document/filter restoration, Back/Forward, fresh cart and save-data fallback'
      : 'PASS staged navigation: immediate shell, background content, fallback traversal, fresh cart and save-data fallback');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
