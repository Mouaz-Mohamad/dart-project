// Real homepage / Sets runtime: presentation, gestures, image-only preview and states.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const models = [
  { id: "shirt", modelId: "SHIRT-101", name: "Campus Shirt", category: "Shirts", selling: 700, active: true,
    sizeOptions: [{ name: "M", active: true }], colorOptions: [{ name: "Black", active: true, images: [{ url: "/Photos/products/1.jpg" }] }] },
  { id: "pants", modelId: "PANTS-202", name: "Campus Pants", category: "Pants", selling: 600, active: true,
    sizeOptions: [{ name: "M", active: true }], colorOptions: [{ name: "Stone", active: true, images: [{ url: "/Photos/products/2.jpg" }] }] },
];
const components = models.map(model => ({ modelId: model.modelId, name: model.name, quantity: 1, sizes: model.sizeOptions, colors: model.colorOptions }));
function fixture(id, order, photo) {
  return { setId: id, name: `Campus Look ${order}`, description: "Full details stay inside the Set dialog.", shortDescription: "Your everyday look, ready together.",
    images: [photo], showOnHomepage: true, homepageOrder: order, active: true, pieceCount: 2, components,
    pricing: { componentsSellingTotalMinor: 130000, basePriceMinor: 110000, discountPercent: 10, finalMinor: 99000 } };
}
const first = fixture("SET-FIRST", 1, "/Photos/products/1.jpg");
const second = fixture("SET-SECOND", 2, "/Photos/products/2.jpg");
let mode = "featured";
let catalogDelay = 0;
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/v1/catalog") return setTimeout(() => json(response, 200, { version: 1, models, stock: { '["SHIRT-101","Black","M"]': 5, '["PANTS-202","Stone","M"]': 5 } }), catalogDelay);
    if (pathname === "/api/v1/catalog/version") return json(response, 200, { version: 1 });
    if (pathname === "/api/v1/sets") {
      if (mode === "error") return json(response, 503, { error: { message: "Internal database information must never appear in the UI." } });
      return json(response, 200, { sets: mode === "empty" ? [] : mode === "single" ? [first] : [second, { ...first, setId: "SET-HIDDEN", showOnHomepage: false }, first, { ...first, setId: "SET-ARCHIVED", isArchived: true }] });
    }
    if (pathname === "/api/v1/sets/settings") return json(response, 200, { settings: { birthdayPercent: 10, dartCardPercent: 10, version: 1 } });
    if (pathname.startsWith("/api/v1/sets/")) {
      const id = pathname.split("/").pop();
      if (id === "SET-LATE") return setTimeout(() => json(response, 200, { set: { ...first, setId: id } }), 250);
      const set = [first, second].find(row => row.setId === id);
      return set ? json(response, 200, { set }) : json(response, 404, { error: { message: "Set not found" } });
    }
    if (pathname === "/api/v1/site-settings") return json(response, 200, { version: 1, settings: {} });
    if (pathname === "/api/v1/reviews") return json(response, 200, { reviews: [] });
    if (pathname === "/api/v1/leaderboard") return json(response, 200, { rows: [] });
    return json(response, 200, {});
  }
  const file = path.resolve(root, pathname === "/" ? "index.html" : pathname === "/products" || /^\/(?:sets|products)\/[^/]+$/.test(pathname) ? "products.html" : pathname.replace(/^\//, ""));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try { const content = fs.readFileSync(file); response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); response.end(content); }
  catch { response.writeHead(404); response.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, reducedMotion: "reduce" });
    await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(origin);
    await page.locator(".home-set-card").first().waitFor({ timeout: 10000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ status: document.querySelector("[data-home-sets-status]")?.textContent, client: Boolean(window.DartSets), catalog: window.DartSets?.catalog(), storefront: Boolean(window.DartSetsStorefront) })));
      console.error(failures);
      throw error;
    });
    const cards = page.locator(".home-set-card");
    assert.equal(await cards.count(), 2, "Only selected, active Sets appear");
    assert.equal(await cards.first().getAttribute("data-set-id"), "SET-FIRST", "Dashboard order wins over API array order");
    assert.equal((await cards.first().locator("[data-home-set-description]").textContent()).trim(), first.shortDescription);
    assert.equal(await cards.first().locator("[data-home-set-old-price]").textContent(), "1,300 EGP");
    assert.equal(await cards.first().locator("[data-home-set-price]").textContent(), "990 EGP");
    assert.equal(await cards.first().locator(".home-set-piece img").first().getAttribute("src"), "/Photos/products/1.jpg");
    assert.equal(await page.evaluate(() => document.getElementById("dartHomeSets").nextElementSibling.classList.contains("products-section")), true);

    async function geometry() {
      return page.evaluate(() => {
        const track = document.querySelector(".home-sets-track").getBoundingClientRect();
        const card = document.querySelector(".home-set-card").getBoundingClientRect();
        const piece = document.querySelector(".home-set-piece").getBoundingClientRect();
        return { width: track.width, card: card.width, height: card.height, pieceWidth: piece.width, pieceHeight: piece.height, cover: getComputedStyle(document.querySelector(".home-set-cover")).objectFit, overflow: document.documentElement.scrollWidth > innerWidth };
      });
    }
    const mobile = await geometry();
    assert.ok(Math.abs(mobile.card / mobile.width - .9) < .001, "90% card leaves the next Set visible");
    assert.ok(Math.abs(mobile.card / mobile.height - .75) < .001);
    assert.equal(mobile.pieceWidth, 70); assert.equal(mobile.pieceHeight, 70); assert.equal(mobile.cover, "cover");
    await page.setViewportSize({ width: 1440, height: 960 });
    const desktop = await geometry();
    assert.equal(desktop.card, mobile.card, "Desktop uses the same compact portrait size as a 430px phone");
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal((await geometry()).overflow, false, "Narrow phones must keep content within the viewport");

    await page.locator("[data-home-sets-next]").click();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
    await page.locator("[data-home-sets-track]").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
    const track = await page.locator(".home-sets-track").boundingBox();
    await page.mouse.move(track.x + track.width - 90, track.y + 190);
    await page.mouse.down();
    await page.mouse.move(track.x + 12, track.y + 190, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
    await page.locator("[data-home-sets-prev]").click();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
    await page.locator(".home-sets-track").scrollIntoViewIfNeeded();
    const touchBox = await page.locator(".home-sets-track").boundingBox();
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchBox.x + touchBox.width - 80, y: touchBox.y + 190 }] });
    for (let step = 1; step <= 8; step++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchBox.x + touchBox.width - 80 - step * 27, y: touchBox.y + 190 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
    await page.locator("[data-home-sets-prev]").click();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
    await touch.detach();

    await cards.first().locator(".home-set-piece").first().click();
    assert.equal(await page.locator("#dartSetImagePreview").evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator("#dartSetModal").evaluate(modal => modal.hidden), true, "Enlarge only; Set dialog stays closed");
    assert.equal(await page.locator("#SectionModel").isVisible(), false, "No ordinary Product modal is opened");
    assert.equal(new URL(page.url()).pathname, "/");
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
    assert.equal(new URL(page.url()).pathname, "/", "Back from a homepage preview stays on the website");
    await page.goForward();
    await page.waitForFunction(() => document.getElementById("dartSetImagePreview").open);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
    await cards.first().locator("[data-home-set-shop]").click();
    await page.locator("#dartSetModal").waitFor({ state: "visible" });
    assert.equal(await page.locator("#dartSetModalTitle").textContent(), first.name);
    assert.equal(new URL(page.url()).pathname, "/sets/SET-FIRST");
    const entries = await page.evaluate(() => history.length);
    await page.evaluate(() => window.DartSetsStorefront.open(window.DartSets.setById("SET-FIRST")));
    assert.equal(await page.evaluate(() => history.length), entries, "Reopening the same Set adds no duplicate history entry");
    await page.locator("#dartSetModal [data-set-piece-image]").first().click();
    await page.waitForFunction(() => document.getElementById("dartSetImagePreview").open);
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
    assert.equal(await page.locator("#dartSetModal").isVisible(), true, "First Back closes only the image");
    await page.goBack();
    await page.waitForFunction(() => document.getElementById("dartSetModal").hidden);
    assert.equal(new URL(page.url()).pathname, "/", "Second Back restores the homepage");
    await page.goForward();
    await page.waitForFunction(() => !document.getElementById("dartSetModal").hidden);
    await page.goForward();
    await page.waitForFunction(() => document.getElementById("dartSetImagePreview").open);
    await page.locator("[data-set-image-close]").click();
    await page.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
    await page.evaluate(() => { const close = document.querySelector("#dartSetModal [data-set-close]"); close.click(); close.click(); });
    await page.waitForFunction(() => document.getElementById("dartSetModal").hidden);
    assert.equal(new URL(page.url()).pathname, "/", "Repeated Close clicks consume just one Back step");
    await page.setViewportSize({ width: 430, height: 932 });
    await page.locator("#dartHomeSets").scrollIntoViewIfNeeded();
    if (process.env.DART_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.DART_SCREENSHOT_DIR, { recursive: true });
      await page.locator("#dartHomeSets").screenshot({ path: path.join(process.env.DART_SCREENSHOT_DIR, "sets-mobile.png") });
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator("#dartHomeSets").screenshot({ path: path.join(process.env.DART_SCREENSHOT_DIR, "sets-desktop.png") });
    }

    mode = "single"; await page.reload();
    await page.locator(".home-set-card").waitFor();
    assert.equal(await page.locator("[data-home-sets-controls]").isVisible(), false);
    mode = "empty"; await page.reload();
    await page.waitForFunction(() => document.getElementById("dartHomeSets").hidden);
    mode = "error"; await page.reload();
    await page.locator("[data-home-sets-retry]").waitFor();
    assert.equal(await page.locator("[data-home-sets-status]").textContent(), "Sets are temporarily unavailable.");
    mode = "featured"; await page.locator("[data-home-sets-retry]").click();
    await page.locator(".home-set-card").first().waitFor();
    assert.equal(await cards.count(), 2);
    let failAsset = true;
    await context.route("**/Js/dart-sets.js*", route => {
      if (failAsset) return route.abort();
      return route.continue();
    });
    await page.reload();
    await page.locator("[data-home-sets-retry]").waitFor();
    failAsset = false;
    await page.locator("[data-home-sets-retry]").click();
    await page.locator(".home-set-card").first().waitFor();
    assert.equal(await cards.count(), 2, "Retry also recovers a failed lazy-loaded script");
    await context.unroute("**/Js/dart-sets.js*");

    const direct = await context.newPage();
    direct.setDefaultTimeout(10000);
    direct.on("pageerror", error => failures.push(error.message));
    catalogDelay = 400;
    await direct.goto(`${origin}/sets/SET-FIRST`);
    await direct.locator("#dartSetModal").waitFor({ state: "visible" });
    await direct.waitForFunction(() => !document.querySelector("#dartSetModal [data-set-add]").disabled);
    assert.equal(new URL(await direct.locator("#dartSetModal [data-set-piece-image] img").first().getAttribute("src"), origin).pathname, "/Photos/products/1.jpg", "Late model hydration refreshes component images and availability without reopening the Set");
    catalogDelay = 0;
    const directEntries = await direct.evaluate(() => history.length);
    await direct.reload();
    await direct.locator("#dartSetModal").waitFor({ state: "visible" });
    assert.equal(await direct.evaluate(() => history.length), directEntries, "Refreshing a shared Set link adds no extra Back entry");
    await direct.locator("#dartSetModal .dart-set-gallery-preview").first().click();
    await direct.waitForFunction(() => document.getElementById("dartSetImagePreview").open);
    await direct.reload();
    await direct.waitForFunction(() => document.getElementById("dartSetImagePreview").open && !document.getElementById("dartSetModal").hidden);
    await direct.goBack();
    await direct.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
    assert.equal(await direct.locator("#dartSetModal").isVisible(), true);
    await direct.goBack();
    await direct.waitForFunction(() => document.getElementById("dartSetModal").hidden);
    assert.equal(new URL(direct.url()).pathname, "/products", "Back from a fresh shared link stays on the product listing");

    // Normal Product routing still works after Set / image traversal.
    await direct.locator('.product-card[data-id="SHIRT-101"]').first().click();
    await direct.waitForFunction(() => location.pathname.startsWith("/products/") && document.getElementById("SectionModel")?.style.display === "flex");
    await direct.goBack();
    await direct.waitForFunction(() => document.getElementById("SectionModel")?.style.display === "none");
    assert.equal(new URL(direct.url()).pathname, "/products");

    await direct.goto(`${origin}/sets/SET-NOT-FOUND`);
    await direct.locator("[data-set-route-retry]").waitFor();
    assert.match(await direct.locator("[data-set-route-message]").textContent(), /unavailable/);
    await direct.goBack();
    assert.equal(new URL(direct.url()).pathname, "/products");
    const lateRequest = direct.waitForRequest(request => request.url().endsWith("/api/v1/sets/SET-LATE"));
    const lateResponse = direct.waitForResponse(response => response.url().endsWith("/api/v1/sets/SET-LATE"));
    await direct.goto(`${origin}/sets/SET-LATE`);
    await lateRequest;
    await direct.goBack();
    await lateResponse;
    await direct.waitForFunction(() => document.getElementById("dartSetModal").hidden);
    assert.equal(new URL(direct.url()).pathname, "/products", "A late detail response must not reopen a Set after Back");
    assert.deepEqual(failures, [], "No new JS failures in the real homepage runtime");
    console.log("PASS homepage Sets layout/data/states, mouse/touch/arrows, nested image/Set Back and Forward, shared-link refresh, late-response cancellation and Product route regression");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
