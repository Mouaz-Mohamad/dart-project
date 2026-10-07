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
    images: ["/Photos/products/5.jpg", { src: "/Photos/products/6.jpg" }],
    sizeOptions: [{ name: "M", active: true }], colorOptions: [
      { name: "Black", active: true, images: [{ url: "/Photos/products/1.jpg" }, { url: "/Photos/products/7.jpg" }] },
      { name: "White", active: false, images: [{ url: "/Photos/products/9.jpg" }] },
    ] },
  { id: "pants", modelId: "PANTS-202", name: "Campus Pants", category: "Pants", selling: 600, active: true,
    images: [{ url: "/Photos/products/10.jpg" }],
    sizeOptions: [{ name: "M", active: true }], colorOptions: [
      { name: "Stone", active: true, images: [{ url: "/Photos/products/2.jpg" }, { url: "/Photos/products/11.webp" }] },
      { name: "Olive", active: true, images: [{ url: "/Photos/products/14.webp" }] },
    ] },
];
const components = models.map(model => ({ modelId: model.modelId, name: model.name, quantity: 1, sizes: model.sizeOptions, colors: model.colorOptions }));
function fixture(id, order, photo) {
  return { setId: id, name: `Campus Look ${order}`, description: "Full details stay inside the Set dialog.", shortDescription: "Your everyday look, ready together.",
    images: Array.isArray(photo) ? photo : [photo], showOnHomepage: true, homepageOrder: order, active: true, pieceCount: 2, components,
    pricing: { componentsSellingTotalMinor: 130000, basePriceMinor: 110000, discountPercent: 10, finalMinor: 99000 } };
}
const first = fixture("SET-FIRST", 1, ["/Photos/products/3.jpg", "/Photos/products/4.jpg"]);
const second = fixture("SET-SECOND", 2, "/Photos/products/12.webp");
const expectedGallery = ["3.jpg", "4.jpg", "5.jpg", "6.jpg", "1.jpg", "7.jpg", "9.jpg", "10.jpg", "2.jpg", "11.webp", "14.webp"].map(name => `/Photos/products/${name}`);
let mode = "featured";
let catalogDelay = 400;
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
    await page.waitForFunction(count => document.querySelectorAll('.home-set-card:first-child .home-set-piece img').length === count, expectedGallery.length);
    const gallery = await cards.first().locator(".home-set-piece img").evaluateAll(images => images.map(image => new URL(image.src).pathname));
    assert.deepEqual(gallery, expectedGallery, "All Set photos lead, followed by every model photo and all color photos in component order, even after late hydration");
    catalogDelay = 0;
    assert.equal(await page.evaluate(() => document.getElementById("dartHomeSets").nextElementSibling.classList.contains("products-section")), true);

    async function geometry() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.evaluate(() => {
        const track = document.querySelector(".home-sets-track").getBoundingClientRect();
        const card = document.querySelector(".home-set-card").getBoundingClientRect();
        const piece = document.querySelector(".home-set-piece").getBoundingClientRect();
        const copy = document.querySelector(".home-set-copy").getBoundingClientRect();
        const cover = document.querySelector(".home-set-cover").getBoundingClientRect();
        const title = document.querySelector("[data-home-set-title]").getBoundingClientRect();
        const descriptionNode = document.querySelector("[data-home-set-description]");
        const description = descriptionNode.getBoundingClientRect();
        const descriptionVisible = getComputedStyle(descriptionNode).display !== "none";
        const prices = document.querySelector(".home-set-prices").getBoundingClientRect();
        const shop = document.querySelector(".home-set-shop").getBoundingClientRect();
        const strip = document.querySelector(".home-set-pieces").getBoundingClientRect();
        const pieces = [...document.querySelectorAll('.home-set-card:first-child .home-set-piece')].slice(0, 2).map(node => node.getBoundingClientRect());
        return { width: track.width, card: card.width, height: card.height, pieceWidth: piece.width, pieceHeight: piece.height,
          copyWidth: copy.width, copyHeight: copy.height, copyLeft: copy.left - card.left, copyBottom: card.bottom - copy.bottom,
          coverHeight: cover.height, overlap: cover.bottom - copy.top, shadow: getComputedStyle(document.querySelector(".home-set-copy")).boxShadow,
          stripTop: strip.top - card.top, stripRight: card.right - strip.right, stripDirection: getComputedStyle(document.querySelector(".home-set-pieces")).flexDirection,
          stripClearance: copy.top - strip.bottom, pieceColumn: pieces[0].left === pieces[1].left && pieces[1].top > pieces[0].top,
          descriptionLines: descriptionVisible ? Number(getComputedStyle(descriptionNode).getPropertyValue("--home-set-description-lines")) : 0,
          titleTop: title.top - copy.top, titleClearance: prices.top - title.bottom,
          descriptionClearance: descriptionVisible ? prices.top - description.bottom : 0,
          priceButtonClearance: shop.top - prices.bottom, shopBottom: card.bottom - shop.bottom,
          cover: getComputedStyle(document.querySelector(".home-set-cover")).objectFit, overflow: document.documentElement.scrollWidth > innerWidth };
      });
    }
    const mobile = await geometry();
    assert.ok(Math.abs(mobile.card / mobile.width - .9) < .001, "90% card leaves the next Set visible");
    assert.equal(mobile.height, 665);
    assert.equal(mobile.pieceWidth, 70); assert.equal(mobile.pieceHeight, 70); assert.equal(mobile.cover, "contain");
    assert.ok(Math.abs(mobile.card / mobile.coverHeight - .75) < .001, "The full cover frame stays 3:4");
    assert.ok(Math.abs(mobile.copyHeight - (665 - mobile.coverHeight + 5)) < .1, "Copy fills exactly the remaining card height");
    assert.equal(mobile.copyWidth, mobile.card); assert.equal(mobile.overlap, 5);
    assert.notEqual(mobile.shadow, "none");
    assert.equal(mobile.copyLeft, 0); assert.equal(mobile.copyBottom, 0);
    assert.equal(mobile.stripTop, 12); assert.equal(mobile.stripRight, 12);
    assert.equal(mobile.stripDirection, "column"); assert.equal(mobile.pieceColumn, true);
    assert.ok(mobile.stripClearance >= 11.9, "Photos end above the copy overlap");
    await page.setViewportSize({ width: 1440, height: 960 });
    const desktop = await geometry();
    assert.equal(desktop.card, mobile.card, "Desktop uses the same compact portrait size as a 430px phone");
    assert.equal(desktop.height, 665);

    // Long copy must sacrifice complete description lines, never the name/prices/button.
    const originalName = first.name, originalDescription = first.shortDescription;
    first.name = "Campus Layered Outfit with a Coordinated Shirt and Comfortable Everyday Pants";
    first.shortDescription = "A complete everyday outfit with coordinated pieces, comfortable details and several colors. Wear it together for a ready look, or style each piece separately throughout the week.";
    await page.evaluate(() => window.DartSets.loadCatalog(true));
    const descriptionLines = new Map();
    for (const width of [320, 360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      const layout = await geometry();
      assert.equal(layout.height, 665);
      assert.equal(layout.overflow, false, "All tested screens keep content inside the viewport");
      assert.ok(Math.abs(layout.copyHeight - (665 - layout.coverHeight + 5)) < .1);
      assert.equal(layout.overlap, 5);
      assert.ok(layout.stripClearance >= 11.9);
      assert.ok(layout.titleTop >= 0 && layout.titleClearance >= 0, "Name remains visible above prices");
      assert.ok(layout.descriptionClearance >= 0, "Description does not cover prices");
      assert.ok(layout.priceButtonClearance >= 7.9, "Both prices remain above the fixed purchase button");
      assert.equal(layout.shopBottom, 12);
      assert.ok(layout.descriptionLines >= 0 && layout.descriptionLines <= 3);
      descriptionLines.set(width, layout.descriptionLines);
    }
    assert.ok(descriptionLines.get(360) > descriptionLines.get(430), "A taller remaining panel shows more full description lines");
    first.name = originalName; first.shortDescription = originalDescription;
    await page.evaluate(() => window.DartSets.loadCatalog(true));
    await page.setViewportSize({ width: 360, height: 800 });
    await geometry();

    // The photo strip scrolls independently of the outer Set carousel.
    const strip = cards.first().locator(".home-set-pieces");
    await strip.scrollIntoViewIfNeeded();
    const stripBox = await strip.boundingBox();
    const setScroll = await page.locator(".home-sets-track").evaluate(node => node.scrollLeft);
    await page.mouse.move(stripBox.x + 35, stripBox.y + stripBox.height - 24);
    await page.mouse.down();
    await page.mouse.move(stripBox.x + 35, stripBox.y + 12, { steps: 10 });
    await page.mouse.up();
    assert.ok(await strip.evaluate(node => node.scrollTop > 50), "Vertical mouse drag reaches more photos");
    assert.equal(await page.locator(".home-sets-track").evaluate(node => node.scrollLeft), setScroll);
    assert.equal(await page.locator("#dartSetImagePreview").evaluate(node => node.open), false, "Dragging a thumbnail does not enlarge it");
    await strip.evaluate(node => { node.scrollTop = 0; });
    const stripTouch = await context.newCDPSession(page);
    await stripTouch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: stripBox.x + 35, y: stripBox.y + stripBox.height - 24 }] });
    for (let step = 1; step <= 8; step++) await stripTouch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: stripBox.x + 35, y: stripBox.y + stripBox.height - 24 - step * 24 }] });
    await stripTouch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.querySelector(".home-set-pieces").scrollTop > 30);
    assert.equal(await page.locator(".home-sets-track").evaluate(node => node.scrollLeft), setScroll, "Touch swipe stays inside the photo strip");
    await stripTouch.detach();
    await strip.focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("[data-home-sets-counter]").textContent(), "1 / 2");

    await page.locator("[data-home-sets-next]").click();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
    await page.locator("[data-home-sets-track]").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
    const track = await page.locator(".home-sets-track").boundingBox();
    const coverWidth = await cards.first().evaluate(node => node.getBoundingClientRect().width);
    await page.mouse.move(track.x + coverWidth - 112, track.y + 190);
    await page.mouse.down();
    await page.mouse.move(track.x + 12, track.y + 190, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
    await page.locator("[data-home-sets-prev]").click();
    await page.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
    await page.locator(".home-sets-track").scrollIntoViewIfNeeded();
    const touchBox = await page.locator(".home-sets-track").boundingBox();
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchBox.x + coverWidth - 112, y: touchBox.y + 190 }] });
    for (let step = 1; step <= 8; step++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchBox.x + coverWidth - 112 - step * (coverWidth - 128) / 8, y: touchBox.y + 190 }] });
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

    // A copied spotlight needs its presenter on Products as well as the homepage.
    const products = await context.newPage();
    products.setDefaultTimeout(10000);
    products.on("pageerror", error => failures.push(error.message));
    for (const pathname of ["/products", "/products.html"]) {
      await products.goto(`${origin}${pathname}`);
      const spotlight = products.locator(".home-set-card");
      await spotlight.first().waitFor();
      await products.waitForFunction(count => document.querySelectorAll('.home-set-card:first-child .home-set-piece img').length === count, expectedGallery.length);
      assert.equal(await spotlight.count(), 2, "Products renders the same selected Sets as the homepage");
      assert.equal(await products.locator("[data-home-sets-state]").isVisible(), false, "Products stops showing Loading Sets after hydration");
      assert.equal(await spotlight.first().locator("[data-home-set-title]").textContent(), first.name);
      assert.equal(await spotlight.first().locator("[data-home-set-price]").textContent(), "990 EGP");
      assert.equal(await spotlight.first().evaluate(card => card.getBoundingClientRect().height), 665);
      assert.deepEqual(await spotlight.first().locator(".home-set-piece img").evaluateAll(images => images.map(image => new URL(image.src).pathname)), expectedGallery);
      await products.locator("[data-home-sets-next]").click();
      await products.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "2 / 2");
      await products.locator("[data-home-sets-prev]").click();
      await products.waitForFunction(() => document.querySelector("[data-home-sets-counter]").textContent === "1 / 2");
      await spotlight.first().locator(".home-set-piece").first().click();
      await products.waitForFunction(() => document.getElementById("dartSetImagePreview").open);
      assert.equal(await products.locator("#dartSetModal").evaluate(modal => modal.hidden), true);
      await products.goBack();
      await products.waitForFunction(() => !document.getElementById("dartSetImagePreview").open);
      assert.equal(new URL(products.url()).pathname, pathname);
      await spotlight.first().locator("[data-home-set-shop]").click();
      await products.locator("#dartSetModal").waitFor({ state: "visible" });
      assert.equal(await products.locator("#dartSetModalTitle").textContent(), first.name);
      await products.goBack();
      await products.waitForFunction(() => document.getElementById("dartSetModal").hidden);
      assert.equal(new URL(products.url()).pathname, pathname, "Back restores the actual Products entry route");
    }
    mode = "single"; await products.reload();
    await products.locator(".home-set-card").waitFor();
    assert.equal(await products.locator("[data-home-sets-controls]").isVisible(), false);
    mode = "empty"; await products.reload();
    await products.waitForFunction(() => document.getElementById("dartHomeSets").hidden);
    mode = "error"; await products.reload();
    await products.locator("[data-home-sets-retry]").waitFor();
    assert.equal(await products.locator("[data-home-sets-status]").textContent(), "Sets are temporarily unavailable.");
    mode = "featured"; await products.locator("[data-home-sets-retry]").click();
    await products.locator(".home-set-card").first().waitFor();
    assert.equal(await products.locator(".home-set-card").count(), 2);
    await products.close();

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
    console.log("PASS Home and Products Set spotlight hydration, 665px card/3:4 image, photo order/gestures, controls, preview/Set Back, loading/error/empty states and normal Product routes");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
