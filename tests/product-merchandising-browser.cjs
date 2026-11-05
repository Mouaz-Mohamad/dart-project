const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { openStorefrontFixture } = require('./helpers/storefront-fixture.cjs');
const root = path.resolve(__dirname, '..');
const models = ['A', 'B', 'C', 'D'].map((id) => ({ modelId: id, name: `Model ${id}`, category: 'Shirts',
  selling: 600, discount: 0, active: true, isArchived: id === 'D',
  relatedModelIds: id === 'A' ? ['A', 'B', 'B', 'C', 'D'] : [],
  sizeOptions: [{ name: 'M', active: true }], colorOptions: [{ name: 'Black', active: true,
    images: [{ id: `image-${id}`, url: '/Photos/products/1.jpg' }] }] }));
const offer = { id: 'OFFER-TEST', code: 'Q-TEST', minQuantity: 3, minOrderMinor: 0, discountKind: 'percent',
  discountPercent: 10, productScope: { mode: 'all', values: [] }, marketingText: 'كمّل اللوك <script>bad()</script>' };
let failOffers = false;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://test'), pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    let data = {};
    if (pathname === '/api/v1/catalog') data = { version: 1, models, stock: { '["A","Black","M"]': 4, '["B","Black","M"]': 3 } };
    if (pathname === '/api/v1/catalog/version') data = { version: 1 };
    if (pathname.endsWith('/promotions/quantity-offers')) {
      if (failOffers) { res.statusCode = 503; return res.end('{}'); }
      data = { offers: [offer] };
    }
    if (pathname === '/api/v1/site-settings') data = { version: 1, settings: { modelCards: {}, announcements: [], typing: { scenes: [] } } };
    if (pathname === '/api/v1/cart/reservation' || pathname.startsWith('/api/v1/cart/reservation/')) data = { cart: {
      reservationId: pathname === '/api/v1/cart/reservation' ? 'CART-MERCHANDISING-LEGACY' : pathname.split('/').at(-1), expiresAt: new Date(Date.now()+15*60*1000).toISOString(),
      lines: [{ modelId:'A',color:'Black',size:'M',quantity:2 },{ modelId:'B',color:'Black',size:'M',quantity:1 }],
    } };
    if (pathname === '/api/v1/me') data = { user: null, permissions: [], session: null };
    if (pathname === '/api/v1/reviews') data = { reviews: [] };
    if (pathname === '/api/v1/auth/social/providers') data = { providers: { google: false, facebook: false } };
    return res.end(JSON.stringify(data));
  }
  const file = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try { res.setHeader('Content-Type', `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`); res.end(openStorefrontFixture(file, fs.readFileSync(file))); }
  catch { res.statusCode = 404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const width of [370, 768, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const failures = [];
      page.on('pageerror', e => failures.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/products.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.DartCatalog?.model('A') && window.DartStorefront?.open);
      await page.evaluate(() => window.DartStorefront.open(window.DartCatalog.products().find(p => p.id === 'A')));
      await page.locator('[data-related-model="B"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#productRelatedList button').count(), 1, 'self, duplicate, sold-out and archived designs excluded');
      assert.equal(await page.locator('#productRelatedModels').evaluate(el => el.closest('#SectionModel') !== null), true);
      assert.equal(await page.locator('#productQuantityOffer script').count(), 0, 'marketing text must remain literal');
      assert.match(await page.locator('#productQuantityOffer').textContent(), /3 موديلات مختلفة/);
      assert.match(await page.locator('#productQuantityOffer').textContent(), /الإرجاع/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.DART_MERCH_SCREENSHOTS) {
        await page.locator('#productRelatedModels').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.DART_MERCH_SCREENSHOTS}-${width}.png` });
      }
      await page.locator('[data-related-model="B"]').click();
      assert.equal(await page.locator('#dartProductModalTitle').textContent(), 'Model B');
      assert.equal(await page.locator('#productRelatedModels').isVisible(), false, 'empty suggestions hidden');
      await page.evaluate(() => {
        if (!document.getElementById('cartItemsContainer')) { const host = document.createElement('div'); host.id = 'cartItemsContainer'; document.body.appendChild(host); }
        cartData = [{ id: 'A', quantity: 3 }, { id: 'B', quantity: 1, dartSetKey: 'SET-TEST:1' }];
        window.DartStorefront.renderOffers();
      });
      assert.match(await page.locator('#cartQuantityOffer').textContent(), /فاضلك 2 موديل مختلف/, 'repeated pieces count once; Sets excluded');
      await page.evaluate(() => { cartData.push({ id: 'B', quantity: 2 }); window.DartStorefront.renderOffers(); });
      assert.match(await page.locator('#cartQuantityOffer').textContent(), /فاضلك 1 موديل مختلف/);
      await page.evaluate(() => {
        window.DartPlatform.currentCartQuote = () => ({ lines: [{ modelId: 'A', baseMinor: 60000, finalMinor: 54000, discountSource: 'Campaign', discountReference: 'Q-TEST' }] });
        window.DartStorefront.renderOffers();
      });
      assert.match(await page.locator('#cartQuantityOffer').textContent(), /وفّرت 60 جنيه/);
      failOffers = true;
      await page.evaluate(() => window.dispatchEvent(new Event('dart:customer-session-changed')));
      await page.waitForFunction(() => document.getElementById('cartQuantityOffer').hidden);
      assert.equal(await page.locator('#productQuantityOffer').isVisible(), false, 'failed refresh removes stale offer');
      failOffers = false;
      assert.deepEqual(failures, []);
      await page.close();
    }
    const cartPage=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];cartPage.on('pageerror',error=>errors.push(error.message));
    await cartPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await cartPage.goto(`${origin}/cart-checkout.html`,{waitUntil:'domcontentloaded'});
    await cartPage.locator('#cartQuantityOffer:not([hidden])').waitFor({state:'visible'});
    assert.match(await cartPage.locator('#cartQuantityOffer').textContent(),/فاضلك 1 موديل مختلف/,'standalone cart rehydrates its reservation and loads the offer module');
    assert.deepEqual(errors,[]);
    await cartPage.close();
    console.log('PASS related-model modal navigation, stock/identity filters, safe text, distinct-model cart progress, exact quoted savings, standalone server-backed cart and stale/error states at 370/768/1366px');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exit(1); });
