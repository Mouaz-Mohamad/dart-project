"use strict";
// The published cover is asserted separately from open-store business-flow fixtures.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { chromium } = require("playwright");
const { openStorefrontFixture } = require("./helpers/storefront-fixture.cjs");
const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "index.html"), "utf8");
const open = openStorefrontFixture("index.html", raw);
assert.doesNotMatch(open, /id="dart-coming-soon-(?:cover|style)"/);
assert.match(open, /id="productsContainer"/);
assert.match(open, /src="Js\/dart-platform.home.min.js"/);
assert.equal(openStorefrontFixture("profile.html", raw), raw);
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, pathname === "/" ? "index.html" : "." + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const type = path.extname(file);
    res.setHeader("Content-Type", ({ ".html": "text/html", ".css": "text/css", ".png": "image/png", ".webp": "image/webp" })[type] || "application/octet-stream");
    // Keep actual cover/styles/branding. Runtime API flows run in their own suites.
    const content = fs.readFileSync(file);
    res.end(type === ".html" ? content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") : content);
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + "/");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator("#dart-coming-soon-cover").isVisible(), true);
      assert.equal(await page.locator("body > .mother").isVisible(), false);
      assert.equal(await page.locator("#dart-coming-soon-cover img").evaluate(node => node.complete && node.naturalWidth > 0), true);
      assert.match(await page.locator("#dart-coming-soon-cover").textContent(), /COMING[\s\S]*SOON/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    console.log("PASS Coming Soon: original published cover, hidden storefront, real logo and four viewport widths; open-store fixture preserves runtime");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
