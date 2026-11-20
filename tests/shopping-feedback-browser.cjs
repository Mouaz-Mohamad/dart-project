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
  <script src="/Js/dart-navigation.min.js" defer></script></head><body><div id="header-container">${header}</div>
  <main style="height:5000px;padding:20px"><button id="preview-add">Add preview product</button><p>Isolated shopping feedback fixture</p></main>
  <script>
    let fixtureCart=[];
    window.DartState={read:()=>fixtureCart};
    window.DartSiteSettings={get:()=>({shoppingBar:{enabled:true,durationSeconds:6}})};
    window.DartPlatform={currentUser:()=>null,quoteCart:async()=>({incentives:[{id:'preview',title:'كمّل اختياراتك واستفيد',message:'فاضلك 1 موديل مختلف وتستفيد بتوصيل مجاني',target:3,current:2,remaining:1}]})};
    document.getElementById('preview-add').onclick=()=>{fixtureCart=[{id:'preview-model',quantity:2}];window.DartShoppingBarReady('هودي Dart');};
    document.addEventListener('DOMContentLoaded',()=>document.dispatchEvent(new Event('dart:critical-ready')));
  </script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://fixture").pathname);
  if (pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixture); return; }
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
    for (const width of [370, 480, 767, 768, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.locator("#preview-add").click();
      const bar = page.locator("#cartBanner"); await bar.waitFor({ state: "visible" });
      assert.match(await bar.innerText(), /هودي Dart/); assert.match(await bar.innerText(), /فاضلك 1/);
      assert.equal(await bar.locator("a").getAttribute("href"), "/cart-checkout.html");
      assert.equal(await bar.locator("progress").evaluate(el => el.value), 2);
      const bounds = await bar.boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page-level overflow");
      await page.mouse.move(width / 2, 350); await page.mouse.wheel(0, 1000);
      await page.waitForFunction(() => document.getElementById("header-container").classList.contains("dart-nav-hidden"));
      await page.waitForFunction(() => document.getElementById("header-container").getBoundingClientRect().bottom <= 1);
      await page.mouse.wheel(0, -15);
      await page.waitForFunction(() => !document.getElementById("header-container").classList.contains("dart-nav-hidden"));
      await page.waitForFunction(() => Math.abs(document.getElementById("header-container").getBoundingClientRect().top) < 1);
      assert(await page.evaluate(() => scrollY > 500), "navigation returns while the page is still scrolled");
      await bar.getByRole("button", { name: "إغلاق إشعار السلة" }).click(); assert(!await bar.isVisible());
      assert.deepEqual(errors, []); await page.close();
    }
    console.log("PASS shopping layout at 370/480/767/768/1366: actual sticky positioning, upward reveal mid-page, cart CTA, progress, dismissal and overflow");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
