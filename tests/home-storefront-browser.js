// DART CODE GUIDE | tests/home-storefront-browser.js
// Browser regression for homepage catalogue rendering, modal deep-link navigation and history.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const model = {
  id: "model-dw-101",
  modelId: "DW-101",
  name: "Cairo Wide Leg Jeans",
  category: "Jeans",
  description: "Dart browser fixture",
  selling: 800,
  discount: 10,
  createdAt: "2026-10-02T00:00:00.000Z",
  active: true,
  sizeOptions: [{ name: "M", active: true }],
  colorOptions: [
    {
      name: "Black",
      active: true,
      images: [{ id: "fixture-image", name: "fixture.jpg", url: "/Photos/products/1.jpg" }],
    },
  ],
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://test");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (pathname === "/api/v1/catalog") {
      response.end(JSON.stringify({
        version: 1,
        models: [model],
        stock: { '["DW-101","Black","M"]': 3 },
      }));
      return;
    }
    if (pathname === "/api/v1/site-settings") {
      response.end(JSON.stringify({ version: 1, settings: {} }));
      return;
    }
    if (pathname === "/api/v1/reviews") {
      response.end(JSON.stringify({ reviews: [] }));
      return;
    }
    if (pathname === "/api/v1/me") {
      response.end(JSON.stringify({ user: null, permissions: [], session: null }));
      return;
    }
    response.end("{}");
    return;
  }

  let relative;
  if (pathname === "/" || pathname === "/index.html") relative = "index.html";
  else if (/^\/products\/[^/]+$/.test(pathname)) relative = "products.html";
  else relative = pathname.replace(/^\//, "");

  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.statusCode = 403;
    response.end();
    return;
  }
  try {
    response.setHeader("Content-Type", contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream");
    response.end(fs.readFileSync(filename));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error("Install Chromium or set CHROMIUM_EXECUTABLE.");

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );

  const page = await context.newPage();
  const localFailures = [];
  page.on("pageerror", (error) => localFailures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 400 || !response.url().startsWith(origin)) return;
    const url = new URL(response.url());
    localFailures.push(`HTTP ${response.status()} ${url.pathname}${url.search}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) return;
    const source = String(message.location()?.url || "");
    if (source.startsWith(origin)) localFailures.push(`console: ${message.text()}`);
  });

  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded" });
  const card = page.locator('#productsContainer .product-card[data-id="DW-101"]').first();
  await card.waitFor({ state: "visible" });
  assert.match(await card.textContent(), /Cairo Wide Leg Jeans/);

  const navEntriesBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await card.click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("SectionModel")).display !== "none");
  await page.waitForURL(/\/products\/cairo-wide-leg-jeans--dw-101$/);
  const navEntriesAfter = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  assert.equal(navEntriesAfter, navEntriesBefore, "opening a model must not reload the document");

  assert.equal(await page.locator('#SectionModel .model-product-title').textContent(), "Cairo Wide Leg Jeans");
  assert.equal(await page.locator('#SectionModel .color-btn[data-color="Black"]').count(), 1);
  assert.equal(await page.locator('#SectionModel .size-btn[data-size="M"]').count(), 1);

  await page.goBack();
  await page.waitForURL(/\/index\.html$/);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("SectionModel")).display === "none");

  await page.goForward();
  await page.waitForURL(/\/products\/cairo-wide-leg-jeans--dw-101$/);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("SectionModel")).display !== "none");

  assert.deepEqual(localFailures, []);
  console.log("PASS home storefront browser: API catalogue -> card -> modal -> deep link -> back/forward without reload");
  await context.close();
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});