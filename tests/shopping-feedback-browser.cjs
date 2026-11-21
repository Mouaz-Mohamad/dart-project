// Real layout checks against the shared navbar, real CSS and shipped feedback loader.
// All progress/cart inputs are isolated fixtures; this server never contacts production.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const header = fs.readFileSync(path.join(root, "sections/Nav-Bar.html"), "utf8");
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/CSS/main.css"><link rel="stylesheet" href="/CSS/base.css"><link rel="stylesheet" href="/CSS/responsive.css">
  <link data-dart-shopping-bar rel="prefetch" href="/Js/dart-shopping-bar.js" as="script">
  <script src="/Js/dart-navigation.min.js" defer></script></head><body class="dja-flexdir"><div class="mother"><header id="header-container">${header}</header>
  <main style="height:5000px;padding:20px"><button id="preview-add">Add preview product</button><button id="preview-offer">Eligible reward</button><button id="preview-more">Complete reward</button><p>Isolated shopping feedback fixture</p></main>
  </div>
  <script>
    let fixtureCart=location.pathname.startsWith('/cart-checkout')?[{id:'preview-model',quantity:2}]:[], fixtureOffer=false;
    window.fixtureQuoteCalls=0;
    window.DartState={read:()=>fixtureCart};
    window.DartSiteSettings={get:()=>({shoppingBar:{enabled:true,durationSeconds:6}})};
    window.DartPlatform={currentUser:()=>null,quoteCart:async()=>{window.fixtureQuoteCalls++;return{currency:'EGP',totalMinor:48490,shippingMinor:fixtureCart[0]?.quantity===3?0:10000,incentives:fixtureOffer?[{id:'preview',type:'freeShipping',title:'كمّل اختياراتك واستفيد',message:fixtureCart[0]?.quantity===3?'استفدت بالتوصيل المجاني':'فاضلك 1 قطعة وتستفيد بتوصيل مجاني على طلبك',target:3,current:fixtureCart[0]?.quantity,remaining:3-fixtureCart[0]?.quantity}]:[]};}};
    document.getElementById('preview-add').onclick=()=>{fixtureCart=[{id:'preview-model',quantity:2}];window.DartShoppingBarReady('هودي Dart');};
    document.getElementById('preview-offer').onclick=()=>{fixtureOffer=true;window.DartShoppingBar.refresh();};
    document.getElementById('preview-more').onclick=()=>{fixtureCart=[{id:'preview-model',quantity:3}];window.dispatchEvent(new CustomEvent('dart:data-changed',{detail:{key:'dart_cart'}}));};
    document.addEventListener('DOMContentLoaded',()=>document.dispatchEvent(new Event('dart:critical-ready')));
  </script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://fixture").pathname);
  if (pathname === "/" || /^\/cart-checkout(?:\.html)?$/.test(pathname)) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixture); return; }
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  const ext = path.extname(file);
  res.setHeader("Content-Type", ({ ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp" })[ext] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox"] });
  try {
    for (const width of [320, 370, 480, 767, 768, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.locator("#preview-add").click();
      const bar = page.locator("#cartBanner"); await bar.waitFor({ state: "visible" });
      assert.equal(await page.locator(".mother").evaluate(el => getComputedStyle(el).overflow), "clip", "the production shell clips without trapping sticky positioning");
      assert.equal(await bar.locator('.cart-banner-price').innerText(), '385 ج.م');
      assert.equal(await bar.locator('.cart-banner-count').innerText(), '2');
      assert.match(await bar.innerText(), /عرض السلة/);
      assert(!await bar.locator('.cart-banner-offer').isVisible());
      assert.equal(await bar.locator("a").getAttribute("href"), "/cart-checkout.html");
      const compact = await bar.boundingBox();
      assert(compact.height <= 44.5, 'the one-row glass bar stays at most 44px high');
      assert.equal(await bar.locator('.cart-banner-price-label').count(), 0);
      assert(!(await bar.innerText()).includes('إجمالي القطع'));
      const checkFixed = async () => {
        const bounds = await bar.boundingBox();
        const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
        assert(Math.abs(bounds.x - 7) < 1 && Math.abs(viewportWidth - bounds.x - bounds.width - 7) < 1, 'exact 7px side insets within the viewport, excluding scrollbar chrome');
        assert(Math.abs(900 - bounds.y - bounds.height - 7) < 1, 'exact 7px bottom inset');
        assert.equal(await bar.evaluate(el => getComputedStyle(el).position), 'fixed');
        assert.equal(await bar.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0.82)');
        assert.equal(await bar.evaluate(el => getComputedStyle(el).backdropFilter), 'blur(4px)');
        assert.equal(await bar.evaluate(el => getComputedStyle(el).color), 'rgb(171, 1, 43)');
        assert.equal(await bar.locator('.cart-banner-count').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(171, 1, 43)');
        assert.equal(await bar.locator('.cart-banner-count').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
        assert(await page.evaluate(height => parseFloat(getComputedStyle(document.body).paddingBottom) >= height + 7, bounds.height), 'page content clears the fixed bar');
      };
      await checkFixed();
      await page.locator('#preview-offer').click();
      await bar.getByRole('progressbar').waitFor({ state: 'visible' });
      assert.equal(await bar.locator('.cart-banner-offer-title').innerText(), 'توصيل مجاني');
      assert.match(await bar.locator('.cart-banner-detail').innerText(), /فاضلك 1/);
      assert.equal(await bar.getByRole('progressbar').getAttribute('aria-valuenow'), '2');
      await page.waitForFunction(() => {
        const track = document.querySelector('.cart-banner-progress').getBoundingClientRect();
        const fill = document.querySelector('.cart-banner-progress-fill').getBoundingClientRect();
        return Math.abs(fill.width / track.width - 2 / 3) < .01;
      });
      assert((await bar.boundingBox()).height > compact.height + 30, 'eligible rewards expand the compact bar');
      assert.equal(await bar.locator('.cart-banner-progress-fill').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
      await checkFixed();
      await page.locator('#preview-more').click();
      await page.waitForFunction(() => document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '3');
      await page.waitForFunction(() => {
        const track = document.querySelector('.cart-banner-progress').getBoundingClientRect();
        const fill = document.querySelector('.cart-banner-progress-fill').getBoundingClientRect();
        return Math.abs(fill.width / track.width - 1) < .01;
      });
      assert.equal(await bar.locator('.cart-banner-count').innerText(), '3');
      assert.equal(await bar.locator('.cart-banner-price').innerText(), '485 ج.م');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page-level overflow");
      await page.mouse.move(width / 2, 350); await page.mouse.wheel(0, 1000);
      await page.waitForFunction(() => document.getElementById("header-container").classList.contains("dart-nav-hidden"));
      await page.waitForFunction(() => document.getElementById("header-container").getBoundingClientRect().bottom <= 1);
      await page.mouse.wheel(0, -15);
      await page.waitForFunction(() => !document.getElementById("header-container").classList.contains("dart-nav-hidden"));
      await page.waitForFunction(() => Math.abs(document.getElementById("header-container").getBoundingClientRect().top) < 1);
      assert(await page.evaluate(() => scrollY > 500), "navigation returns while the page is still scrolled");
      await checkFixed();
      await bar.getByRole("button", { name: "إغلاق إشعار السلة" }).click(); assert(!await bar.isVisible());
      await page.route('**/cart-checkout.html', route => route.fulfill({contentType:'text/html',body:'<h1>Isolated cart destination</h1>'}));
      await page.locator('#preview-add').click(); await bar.locator('a').click();
      assert.equal(new URL(page.url()).pathname, '/cart-checkout.html', 'clicking the strip opens the cart');
      assert.deepEqual(errors, []); await page.close();
    }
    for (const destination of ['/cart-checkout.html?step=cart', '/cart-checkout?step=checkout#payment']) {
      const page = await browser.newPage({viewport:{width:370,height:900}});
      await page.goto(origin + destination, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => Boolean(window.DartShoppingBar));
      await page.locator('#preview-add').click(); await page.locator('#preview-offer').click();
      assert.equal(await page.locator('#cartBanner').count(), 0, 'cart and checkout never create the bar');
      assert.equal(await page.evaluate(() => window.fixtureQuoteCalls), 0, 'hidden checkout bar adds no pricing requests');
      assert.equal(await page.locator('#header-container').getAttribute('data-dart-scroll-header'), '1', 'checkout keeps the scroll navbar');
      assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom)), 0, 'checkout has no bar spacing');
      await page.close();
    }
    console.log("PASS shopping layout at 320/370/480/767/768/1366: 44px glass bar, 7px insets, burgundy text/white count, integer amount, reward progress, checkout suppression, cart navigation and scroll header");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
