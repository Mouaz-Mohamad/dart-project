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


const setFixture = {
  setId: "SET-DW-101",
  name: "Cairo Campus Set",
  category: "Sets",
  description: "Set storefront stability fixture",
  images: ["/Photos/products/1.jpg"],
  active: true,
  isArchived: false,
  pieceCount: 1,
  components: [{
    modelId: "DW-101",
    name: "Cairo Wide Leg Jeans",
    quantity: 1,
    sizes: [{ name: "M", active: true }],
    colors: [{ name: "Black", active: true }],
  }],
  pricing: {
    componentsSellingTotalMinor: 80000,
    basePriceMinor: 70000,
    discountPercent: 0,
    finalMinor: 70000,
    savingVsSeparateMinor: 10000,
  },
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://test");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/sets-runtime-fixture.html") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div id="productsContainer">
        <div id="productTemplate" class="product-card" style="display:none">
          <img class="product-img" alt=""><span class="product-category"></span><span class="product-code"></span>
          <span class="product-title"></span><span class="product-price"></span>
          <span data-product-price="old"></span><span data-product-price="discount"></span><button class="cart-btn">Buy</button>
        </div>
      </div>
      <div id="cartItemsContainer">
        <div id="cartItemTemplate" class="cart-product-card"></div>
        <div class="cart-product-card" data-test-base-cart-card></div>
      </div>
      <script src="/Js/dart-state.js"></script>
      <script>
        const fixtureModel = ${JSON.stringify(model)};
        let cartData = [];
        window.setFixtureCart = (value) => { cartData = value; window.DartState.write("dart_cart", value, { source: "sets-browser-regression" }); };
        window.fixtureCartLength = () => cartData.length;
        window.DartCatalog = {
          model: (id) => String(id) === "DW-101" ? fixtureModel : null,
          available: () => 3,
          cover: () => "/Photos/products/1.jpg",
          price: () => 720,
        };
        window.DartPlatform = { cartReservationId: "CART-FIXTURE", currentUser: () => null };
      </script>
      <script src="/Js/dart-sets.js"></script>
    </body></html>`);
    return;
  }

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
    if (pathname === "/api/v1/sets") {
      response.end(JSON.stringify({ sets: [setFixture] }));
      return;
    }
    if (pathname === "/api/v1/sets/settings") {
      response.end(JSON.stringify({ settings: { birthdayPercent: 10, dartCardPercent: 10, version: 1 } }));
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

  const setCard = page.locator('#productsContainer [data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]');
  await setCard.waitFor({ state: "visible" });
  assert.match(await setCard.textContent(), /Cairo Campus Set/);

  await setCard.locator('.product-title').click();
  await page.locator('#dartSetModal:not([hidden])').waitFor({ state: "visible" });
  assert.equal(await page.locator('#dartSetModal [data-set-title]').textContent(), "Cairo Campus Set");
  await page.locator('#dartSetModal [data-set-close]').click();
  await page.waitForFunction(() => document.getElementById("dartSetModal")?.hidden === true);

  await setCard.focus();
  await page.keyboard.press('Space');
  await page.locator('#dartSetModal:not([hidden])').waitFor({ state: "visible" });
  await page.locator('#dartSetModal [data-set-close]').click();

  await page.route('**/api/v1/sets/settings', (route) => route.abort('failed'));
  const settingsFailureFallback = await page.evaluate(async () => {
    const sets = await window.DartSets.loadCatalog(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      setCount: sets.length,
      renderedSets: document.querySelectorAll('[data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]').length,
      settings: window.DartSets.settings(),
    };
  });
  assert.deepEqual(settingsFailureFallback, {
    setCount: 1,
    renderedSets: 1,
    settings: { birthdayPercent: 10, dartCardPercent: 10, version: 1 },
  }, "Set catalogue must remain visible when Set settings temporarily fail");
  await page.unroute('**/api/v1/sets/settings');

  await page.waitForTimeout(150);
  const stableRender = await page.evaluate(async () => {
    const container = document.getElementById("productsContainer");
    let childListMutations = 0;
    const observer = new MutationObserver((records) => {
      childListMutations += records.filter((record) => record.type === "childList").length;
    });
    observer.observe(container, { childList: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    observer.disconnect();
    return {
      childListMutations,
      modelCards: container.querySelectorAll('.product-card[data-id="DW-101"]').length,
      setCards: container.querySelectorAll('[data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]').length,
    };
  });
  assert.deepEqual(stableRender, { childListMutations: 0, modelCards: 1, setCards: 1 }, "Models and Sets must settle without a self-triggering render loop");

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

  await page.goto(`${origin}/sets-runtime-fixture.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]').waitFor({ state: "visible" });
  const stableCart = await page.evaluate(async () => {
    const container = document.getElementById("cartItemsContainer");
    const group = {
      setId: "SET-DW-101",
      unitIndex: 1,
      selections: [{ modelId: "DW-101", modelName: "Cairo Wide Leg Jeans", color: "Black", size: "M" }],
    };
    window.DartSets.writeDrafts([group]);
    window.setFixtureCart([{
      id: "DW-101", title: "Cairo Wide Leg Jeans", price: 720, color: "Black", size: "M", quantity: 1,
      setId: "SET-DW-101", dartSetKey: "SET-DW-101:1", dartSetUnitIndex: 1,
    }]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    let childListMutations = 0;
    const observer = new MutationObserver((records) => {
      childListMutations += records.filter((record) => record.type === "childList").length;
    });
    observer.observe(container, { childList: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    observer.disconnect();
    const grouped = {
      childListMutations,
      setCards: container.querySelectorAll('[data-dart-set-cart-card="1"][data-dart-set-key="SET-DW-101:1"]').length,
      baseDisplay: container.querySelector('[data-test-base-cart-card]').style.display,
      cartLines: window.fixtureCartLength(),
    };
    window.setFixtureCart([]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    grouped.afterClear = {
      setCards: container.querySelectorAll('[data-dart-set-cart-card="1"]').length,
      baseDisplay: container.querySelector('[data-test-base-cart-card]').style.display,
    };
    return grouped;
  });
  assert.deepEqual(stableCart, {
    childListMutations: 0, setCards: 1, baseDisplay: "none", cartLines: 1,
    afterClear: { setCards: 0, baseDisplay: "flex" },
  }, "Set cart decoration must be keyed, stable, and remove stale grouped cards when cart lines disappear");

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