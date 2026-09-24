// DART CODE GUIDE | tests/product-waiting-browser.js
// Browser regression for the single Buy/Waiting action across real production-style unavailable size/color combinations.
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};
const settings = {
  waiting: { enabled: true, reservationHours: 4 },
  announcements: [],
  modelCards: {},
  typing: { scenes: [] },
};
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='400'%3E%3Crect width='300' height='400' fill='%23AB012B'/%3E%3C/svg%3E";
const model = {
  modelId: "Mouaz",
  name: "Hadi cotton shirt",
  category: "hoodies",
  description: "Production-shaped Waiting regression model.",
  selling: 600,
  discount: 0,
  active: true,
  isArchived: false,
  isDeleted: false,
  lowStockLimit: 5,
  createdAt: "2026-09-22T10:26:46.043Z",
  colorOptions: [
    { name: "Begi", active: true, images: [{ id: "begi", name: "begi.svg", url: image }] },
    { name: "Red", active: true, images: [{ id: "red", name: "red.svg", url: image }] },
  ],
  sizeOptions: [{ name: "M", active: true }, { name: "Xl", active: true }],
  sizeChart: { unit: "cm", rows: [{ size: "M" }, { size: "Xl" }] },
};

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://test");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/v1/site-settings") return json(res, 200, { version: 1, settings });
    if (pathname === "/api/v1/catalog") {
      return json(res, 200, {
        version: 1,
        models: [model],
        stock: { '["Mouaz","Begi","Xl"]': 1 },
      });
    }
    if (pathname === "/api/v1/catalog/version") return json(res, 200, { version: 1 });
    if (pathname === "/api/v1/reviews") return json(res, 200, { reviews: [] });
    if (pathname === "/api/v1/auth/social/providers") return json(res, 200, { providers: { google: false, facebook: false } });
    if (pathname === "/api/v1/me") return json(res, 200, { user: null, session: null, permissions: [] });
    return json(res, 200, {});
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    res.setHeader("Content-Type", types[path.extname(filename).toLowerCase()] || "application/octet-stream");
    res.end(fs.readFileSync(filename));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});

async function expectPrimaryAction(page, expected) {
  await page.waitForFunction((mode) => {
    const primary = document.getElementById("modalBuyBtn");
    const legacyWaiting = document.getElementById("modalWaitBtn");
    if (!primary || !legacyWaiting) return false;
    return !primary.hidden && legacyWaiting.hidden && primary.dataset.dartAction === mode;
  }, expected);
  const primary = page.locator("#modalBuyBtn");
  const legacyWaiting = page.locator("#modalWaitBtn");
  assert.equal(await primary.isVisible(), true);
  assert.equal(await legacyWaiting.isVisible(), false);
  if (expected === "buy") {
    assert.equal(await primary.isEnabled(), true);
    assert.equal((await primary.textContent()).trim(), "Buy");
  } else {
    assert.equal((await primary.textContent()).trim(), "Waiting");
    assert.equal(await primary.getAttribute("data-dart-action"), "waiting");
  }
}

async function expectFallbackWaiting(page) {
  await page.waitForFunction(() => {
    const buy = document.getElementById("modalBuyBtn");
    const waiting = document.getElementById("modalWaitBtn");
    return Boolean(buy && waiting && buy.hidden && !waiting.hidden);
  });
  assert.equal(await page.locator("#modalBuyBtn").isVisible(), false);
  assert.equal(await page.locator("#modalWaitBtn").isVisible(), true);
}

async function openModel(page) {
  await page.waitForSelector('.product-card[data-id="Mouaz"]');
  await page.locator('.product-card[data-id="Mouaz"]').first().click();
  await page.waitForFunction(() => document.getElementById("SectionModel")?.style.display === "flex");
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/products.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.DartProductButtonState));
    await openModel(page);

    await page.locator('#SectionModel .color-btn[data-color="Begi"]').click();
    await page.locator('#SectionModel .size-btn[data-size="Xl"]').click();
    await expectPrimaryAction(page, "buy");

    await page.locator('#SectionModel .color-btn[data-color="Red"]').click();
    await expectPrimaryAction(page, "waiting");
    assert.equal(await page.locator('#SectionModel .size-btn[data-size="Xl"]').getAttribute("aria-pressed"), "true");

    await page.locator('#SectionModel .color-btn[data-color="Begi"]').click();
    await page.locator('#SectionModel .size-btn[data-size="M"]').click();
    await expectPrimaryAction(page, "waiting");

    await page.locator('#SectionModel .color-btn[data-color="Red"]').click();
    await expectPrimaryAction(page, "waiting");
    assert.equal(await page.locator('#SectionModel .size-btn[data-size="M"]').getAttribute("aria-pressed"), "true");

    await page.evaluate(() => window.DartStorefront.refresh());
    await expectPrimaryAction(page, "waiting");
    await page.close();

    const fallbackPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await fallbackPage.route("**/Js/dart-product-button-state.js*", (route) => route.abort());
    await fallbackPage.goto(`${origin}/products.html`, { waitUntil: "domcontentloaded" });
    await openModel(fallbackPage);
    await fallbackPage.locator('#SectionModel .color-btn[data-color="Begi"]').click();
    await fallbackPage.locator('#SectionModel .size-btn[data-size="M"]').click();
    await expectFallbackWaiting(fallbackPage);
    await fallbackPage.locator('#SectionModel .color-btn[data-color="Red"]').click();
    await expectFallbackWaiting(fallbackPage);
    await fallbackPage.close();

    console.log("PASS production-shaped single Buy/Waiting action + controller fallback");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
