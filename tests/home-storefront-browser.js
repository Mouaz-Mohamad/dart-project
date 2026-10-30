const { openStorefrontFixture } = require("./helpers/storefront-fixture.cjs");
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
      images: [{ id: "fixture-image", name: "fixture.jpg", url: "https://dart-project-psi.vercel.app/api/v1/catalog/assets/fixture-image?v=fixture-version" }],
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
  if (pathname === "/api/v1/catalog/assets/fixture-image") {
    response.setHeader("Content-Type", "image/jpeg");
    response.end(fs.readFileSync(path.join(root, "Photos/products/1.jpg")));
    return;
  }

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
        <div class="cart-product-card" data-test-base-cart-card="standalone"></div>
        <div class="cart-product-card" data-test-base-cart-card="set"></div>
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
    if (pathname.startsWith("/api/v1/cart/reservation/")) {
      const reservationId = pathname.split("/").pop();
      response.end(JSON.stringify({
        cart: {
          reservationId,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          lines: [
            { modelId: "DW-101", color: "Black", size: "M", quantity: 1 },
            {
              modelId: "DW-101", color: "Black", size: "M", quantity: 1,
              setGroupId: "GROUP-HYDRATED-1", setId: "SET-DW-101", setUnitIndex: 1,
              setCartComponentId: "CART-COMPONENT-HYDRATED-1",
              setComponentId: "COMPONENT-HYDRATED-1", setComponentUnitIndex: 1,
            },
          ],
        },
      }));
      return;
    }
    if (pathname.startsWith("/api/v1/cart/set-groups/")) {
      const reservationId = pathname.split("/").pop();
      response.end(JSON.stringify({
        reservationId,
        groups: [{
          id: "GROUP-HYDRATED-1", setId: "SET-DW-101", unitIndex: 1, setName: "Cairo Campus Set",
          image: "/Photos/products/1.jpg", pieceCount: 1, componentsTotalMinor: 80000, basePriceMinor: 70000,
          discountSource: "None", discountPercent: 0, discountReference: "", finalMinor: 70000,
          components: [{
            modelId: "DW-101", modelName: "Cairo Wide Leg Jeans", color: "Black", size: "M",
            cartComponentId: "CART-COMPONENT-HYDRATED-1", componentId: "COMPONENT-HYDRATED-1",
            componentUnitIndex: 1, allocatedBaseMinor: 70000, allocatedFinalMinor: 70000,
          }],
        }],
      }));
      return;
    }
    if (pathname === "/api/v1/reviews") {
      response.end(JSON.stringify({ reviews: [
        { id: "review-long", name: "Long Review Customer", rating: 4, date: "2026-10-30",
          title: "A very detailed and thoughtful title about the excellent quality, great look, fit, delivery and overall Dart shopping experience",
          comment: "The material felt great and the delivery was excellent. ".repeat(18) },
        { id: "review-short", name: "Short Review Customer", rating: 5, date: "2026-10-29",
          title: "Great fit", comment: "Loved it." },
      ] }));
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
    response.end(openStorefrontFixture(filename, fs.readFileSync(filename)));
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
  assert.equal(await page.title(), "Dart | دارت للملابس الرجالي والشبابي في مصر",
    "the dynamic discovery helper must preserve the approved home title");
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://www.dartofficial.com/");
  // The homepage must preserve entire reviews in the dialog while keeping
  // cards balanced, and radio stars must submit the exact chosen rating.
  await page.locator(".reviews-section").scrollIntoViewIfNeeded();
  const longReview = page.locator('#reviewsContainer .review-card:not(#reviewTemplate)').filter({ hasText: "Long Review Customer" });
  const shortReview = page.locator('#reviewsContainer .review-card:not(#reviewTemplate)').filter({ hasText: "Short Review Customer" });
  await longReview.waitFor({ state: "visible" });
  await shortReview.waitFor({ state: "attached" });
  await longReview.locator("[data-review-read-more]").waitFor({ state: "visible" });
  assert.equal(await shortReview.locator("[data-review-read-more]").isVisible(), true, "all reviews should be openable, including short ones");
  assert.equal(await longReview.evaluate(row => getComputedStyle(row.querySelector(".review-title")).webkitLineClamp), "2");
  assert.equal(await longReview.evaluate(row => getComputedStyle(row.querySelector(".review-text")).webkitLineClamp), "4");
  const cardHeights = await page.locator('#reviewsContainer .review-card:not(#reviewTemplate)').evaluateAll(
    (rows) => rows.map(row => Math.round(row.getBoundingClientRect().height)),
  );
  assert.equal(new Set(cardHeights).size, 1, "review cards must have the same height");
  await longReview.locator("[data-review-read-more]").click();
  await page.locator("#dartReviewDialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#dart-review-full-title").textContent(), /overall Dart shopping experience/);
  assert.match(await page.locator("#dart-review-full-text").textContent(), /material felt great/);
  await page.locator("[data-review-dialog-close]").click();
  assert.equal(await page.locator("#dartReviewDialog").evaluate(dialog => dialog.open), false);
  await page.locator("#reviewForm input[name=rating]").first().waitFor({ state: "attached" });
  const ratings = await page.evaluate(() => {
    const form = document.querySelector("#reviewForm");
    const choices = [...form.querySelectorAll(".dart-rating-choice")];
    const radios = [...form.querySelectorAll('input[name="rating"]')];
    const initial = new FormData(form).get("rating");
    const styles = () => ({
      stars: choices.map(label => getComputedStyle(label.querySelector(".dart-star-shape")).fill),
      boxes: choices.map(label => getComputedStyle(label).backgroundColor),
    });
    const initialColors = styles();
    const results = [];
    for (const rating of [1, 2, 3, 4, 5]) {
      choices[rating - 1].click();
      results.push({ requested: rating, saved: new FormData(form).get("rating"),
        selected: styles().stars.filter(color => color === "rgb(231, 185, 81)").length });
    }
    const centered = getComputedStyle(form.querySelector(".dart-review-rating-picker")).justifyContent;
    const direction = getComputedStyle(form.querySelector(".dart-review-rating-picker")).direction;
    form.reset();
    return { count: choices.length, initial, initialColors, results, afterReset: new FormData(form).get("rating"), centered, direction };
  });
  assert.equal(ratings.count, 5);
  assert.equal(ratings.initial, null);
  assert.deepEqual(ratings.results, [1, 2, 3, 4, 5].map(n => ({
    requested: n, saved: String(n), selected: n,
  })), "clicking star 5 must light exactly five stars and submit 5");
  assert.equal(ratings.afterReset, null);
  assert.equal(ratings.centered, "center");
  assert.equal(ratings.direction, "ltr");
  assert(ratings.initialColors.stars.every(color => color === "rgb(224, 227, 232)"), "empty stars must appear gray");
  assert.equal(await longReview.locator(".stars").evaluate(el => getComputedStyle(el).justifyContent), "center");
  // The unauthenticated browser fixture keeps the review form hidden by
  // design; exercise native label selection in DOM without bypassing eligibility.
  const fifth = await page.locator("#reviewForm").evaluate((form) => {
    form.querySelectorAll(".dart-rating-choice")[4].click();
    return {
      rating: new FormData(form).get("rating"),
      selected: [...form.querySelectorAll(".dart-star-shape")]
        .filter(node => getComputedStyle(node).fill === "rgb(231, 185, 81)").length,
    };
  });
  assert.deepEqual(fifth, { rating: "5", selected: 5 },
    "tapping the rightmost star must select exactly five");
  await page.locator("#reviewForm").evaluate(form => form.reset());
  await shortReview.locator("[data-review-read-more]").click();
  await page.locator("#dartReviewDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#dart-review-full-title").textContent(), "Great fit");
  assert.equal(await page.locator("#dart-review-full-text").textContent(), "Loved it.");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#dartReviewDialog").evaluate(dialog => dialog.open), false);


  const productImage = card.locator("img").first();
  await productImage.evaluate(image => image.decode());
  assert.equal(await productImage.getAttribute("src"), `${origin}/api/v1/catalog/assets/fixture-image?v=fixture-version`,
    "saved Vercel image URLs must load through the current storefront origin");
  assert(await productImage.evaluate(image => image.naturalWidth > 0));

  const setCard = page.locator('#productsContainer [data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]');
  await setCard.waitFor({ state: "visible" });
  assert.match(await setCard.textContent(), /Cairo Campus Set/);

  await page.waitForFunction(() => (window.DartState?.read?.("dart_cart", []) || []).length === 2);
  const hydratedCartIdentity = await page.evaluate(() =>
    (window.DartState.read("dart_cart", []) || []).map((line) => ({
      title: line.title,
      setGroupId: line.setGroupId || "",
      dartSetKey: line.dartSetKey || "",
      dartSetCartComponentId: line.dartSetCartComponentId || "",
    })),
  );
  assert.deepEqual(hydratedCartIdentity, [
    { title: "Cairo Wide Leg Jeans", setGroupId: "", dartSetKey: "", dartSetCartComponentId: "" },
    {
      title: "Cairo Wide Leg Jeans",
      setGroupId: "GROUP-HYDRATED-1",
      dartSetKey: "SET-DW-101:1",
      dartSetCartComponentId: "CART-COMPONENT-HYDRATED-1",
    },
  ], "Cart hydration must preserve explicit server Set identity for an otherwise identical variant");

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
  assert.equal(await page.title(), "Dart | دارت للملابس الرجالي والشبابي في مصر",
    "closing a product must restore the current branding");

  await page.goForward();
  await page.waitForURL(/\/products\/cairo-wide-leg-jeans--dw-101$/);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("SectionModel")).display !== "none");

  await page.goto(`${origin}/sets-runtime-fixture.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-dart-set-card="1"][data-dart-set-id="SET-DW-101"]').waitFor({ state: "visible" });
  const stableCart = await page.evaluate(async () => {
    const container = document.getElementById("cartItemsContainer");
    const group = {
      id: "GROUP-FIXTURE-1",
      setId: "SET-DW-101",
      unitIndex: 1,
      selections: [{
        modelId: "DW-101", modelName: "Cairo Wide Leg Jeans", color: "Black", size: "M",
        cartComponentId: "CART-COMPONENT-1", componentId: "COMPONENT-1", componentUnitIndex: 1,
      }],
    };
    window.DartSets.writeDrafts([group]);
    window.setFixtureCart([
      { id: "DW-101", title: "Standalone Jeans", price: 720, color: "Black", size: "M", quantity: 1 },
      {
        id: "DW-101", title: "Set Jeans", price: 720, color: "Black", size: "M", quantity: 1,
        setGroupId: "GROUP-FIXTURE-1", setId: "SET-DW-101", setUnitIndex: 1,
        dartSetCartComponentId: "CART-COMPONENT-1", dartSetComponentId: "COMPONENT-1",
        dartSetComponentUnitIndex: 1,
      },
    ]);
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
      baseDisplays: [...container.querySelectorAll('[data-test-base-cart-card]')].map((node) => node.style.display),
      cartLines: window.fixtureCartLength(),
      lineIdentity: (window.DartState.read("dart_cart", []) || []).map((line) => ({
        title: line.title, setGroupId: line.setGroupId || "", dartSetKey: line.dartSetKey || "",
      })),
    };
    window.setFixtureCart([]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    grouped.afterClear = {
      setCards: container.querySelectorAll('[data-dart-set-cart-card="1"]').length,
      baseDisplays: [...container.querySelectorAll('[data-test-base-cart-card]')].map((node) => node.style.display),
    };
    return grouped;
  });
  assert.deepEqual(stableCart, {
    childListMutations: 0,
    setCards: 1,
    baseDisplays: ["flex", "none"],
    cartLines: 2,
    lineIdentity: [
      { title: "Standalone Jeans", setGroupId: "", dartSetKey: "" },
      { title: "Set Jeans", setGroupId: "GROUP-FIXTURE-1", dartSetKey: "SET-DW-101:1" },
    ],
    afterClear: { setCards: 0, baseDisplays: ["flex", "flex"] },
  }, "Set cart decoration must use explicit server identity and never absorb an identical standalone variant");

  // All active public review locations must share the same full-review UI,
  // not only the homepage's smaller JavaScript runtime.
  for (const filename of ["products.html", "profile.html"]) {
    const publicPage = await context.newPage();
    await publicPage.goto(`${origin}/${filename}`, { waitUntil: "domcontentloaded" });
    const long = publicPage.locator('#reviewsContainer .review-card:not(#reviewTemplate)')
      .filter({ hasText: "Long Review Customer" });
    await long.waitFor({ state: "attached" });
    const more = long.locator("[data-review-read-more]");
    assert.equal(await more.count(), 1, `${filename}: every review needs a Read More button`);
    assert.equal(await more.getAttribute("hidden"), null, `${filename}: button must never be hidden`);
    const style = await long.evaluate((card) => {
      const button = card.querySelector("[data-review-read-more]");
      return {
        display: getComputedStyle(button).display,
        rating: card.querySelector(".stars").getAttribute("aria-label"),
        filled: card.querySelectorAll(".dart-rating-choice.is-filled").length,
        backdrop: getComputedStyle(card.querySelector(".dart-rating-choice")).backgroundImage,
      };
    });
    assert.notEqual(style.display, "none", `${filename}: Read More must be displayed`);
    assert.equal(style.rating, "4 out of 5 stars");
    assert.equal(style.filled, 4);
    const feedbackStarPath = fs.readFileSync(path.join(root, "sections/form-feedback.html"), "utf8")
      .match(/class="dart-star-shape" d="([^"]+)"/)?.[1];
    assert(feedbackStarPath, "feedback form must define the shared star SVG");
    assert.equal(await long.locator(".dart-star-shape").first().getAttribute("d"),
      feedbackStarPath, `${filename}: displayed stars must reuse the feedback SVG design`);
    await more.evaluate((element) => element.click());
    await publicPage.waitForFunction(() => document.getElementById("dartReviewDialog")?.open === true);
    assert.match(await publicPage.locator("#dart-review-full-title").textContent(), /overall Dart shopping experience/);
    await publicPage.locator("[data-review-dialog-close]").evaluate(element => element.click());
    assert.equal(await publicPage.locator("#dartReviewDialog").evaluate(dialog => dialog.open), false);
    await publicPage.close();
  }

  assert.deepEqual(localFailures, []);
  console.log("PASS home/products/profile review cards, shared feedback stars and full-review dialog");
  await context.close();
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
