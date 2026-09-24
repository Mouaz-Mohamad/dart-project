// DART CODE GUIDE | tests/product-waiting-browser.js
// Browser regression for Buy/Waiting replacement across unavailable size/color combinations.
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
  modelId: "DT-WAIT-1",
  name: "Waiting Regression Tee",
  category: "T-Shirts",
  description: "Waiting browser regression model.",
  selling: 600,
  discount: 0,
  active: true,
  isArchived: false,
  isDeleted: false,
  lowStockLimit: 2,
  createdAt: "2026-09-24T00:00:00.000Z",
  colorOptions: [
    { name: "Burgundy", active: true, images: [{ id: "burgundy", name: "burgundy.svg", url: image }] },
    { name: "Blue", active: true, images: [{ id: "blue", name: "blue.svg", url: image }] },
  ],
  sizeOptions: [{ name: "M", active: true }, { name: "L", active: true }],
  sizeChart: { unit: "cm", rows: [{ size: "M" }, { size: "L" }] },
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
        stock: { '["DT-WAIT-1","Burgundy","M"]': 2 },
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

async function expectAction(page, expected) {
  await page.waitForFunction((mode) => {
    const buy = document.getElementById("modalBuyBtn");
    const waiting = document.getElementById("modalWaitBtn");
    if (!buy || !waiting) return false;
    return mode === "buy"
      ? !buy.hidden && waiting.hidden && !buy.disabled
      : buy.hidden && !waiting.hidden;
  }, expected);
  const buy = page.locator("#modalBuyBtn");
  const waiting = page.locator("#modalWaitBtn");
  if (expected === "buy") {
    assert.equal(await buy.isVisible(), true);
    assert.equal(await waiting.isVisible(), false);
  } else {
    assert.equal(await buy.isVisible(), false);
    assert.equal(await waiting.isVisible(), true);
    assert.equal(await waiting.evaluate((node) => node.style.background), "rgb(37, 99, 235)");
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${origin}/products.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.DartProductButtonState));
    await page.waitForSelector('.product-card[data-id="DT-WAIT-1"]');
    await page.locator('.product-card[data-id="DT-WAIT-1"]').first().click();
    await page.waitForFunction(() => document.getElementById("SectionModel")?.style.display === "flex");

    // Available size + available color => Buy only.
    await page.locator('#SectionModel .color-btn[data-color="Burgundy"]').click();
    await page.locator('#SectionModel .size-btn[data-size="M"]').click();
    await expectAction(page, "buy");

    // M is available elsewhere, but Blue is unavailable: preserve M intent and show Waiting.
    await page.locator('#SectionModel .color-btn[data-color="Blue"]').click();
    await expectAction(page, "waiting");

    // Available color + unavailable size => Waiting.
    await page.locator('#SectionModel .color-btn[data-color="Burgundy"]').click();
    await page.locator('#SectionModel .size-btn[data-size="L"]').click();
    await expectAction(page, "waiting");

    // Both selected option dimensions unavailable => Waiting remains visible.
    await page.locator('#SectionModel .color-btn[data-color="Blue"]').click();
    await expectAction(page, "waiting");

    console.log("PASS product modal Buy/Waiting browser variant matrix");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
