/* BEGIN V8 acceptance — contact inbox, return workflow, tracking activation and client analytics. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const server = http.createServer((request, response) => {
  const filename = path.join(
    root,
    decodeURIComponent(new URL(request.url, "http://test").pathname),
  );
  if (!filename.startsWith(root + path.sep)) {
    response.statusCode = 403;
    response.end();
    return;
  }
  try {
    response.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[path.extname(filename)] || "application/octet-stream",
    );
    response.end(fs.readFileSync(filename));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath))
    throw new Error("Install Chromium or set CHROMIUM_EXECUTABLE.");
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );

  const dashboard = await context.newPage();
  await dashboard.goto(origin + "/Eye/Dart%20Eye.html");
  const contact = await context.newPage();
  await contact.goto(origin + "/Contact%20us.html");
  await contact.waitForSelector("#contactForm");
  await contact
    .locator('#contactForm [name="full_name"]')
    .fill("Contact Customer");
  await contact.locator('#contactForm [name="phone1"]').fill("01012345678");
  await contact
    .locator('#contactForm [name="email"]')
    .fill("contact@example.com");
  await contact
    .locator('#contactForm [name="message"]')
    .fill("I need help with my order.");
  await contact.locator('#contactForm button[type="submit"]').click();
  await dashboard.waitForFunction(
    () => JSON.parse(localStorage.getItem("dart_reviews") || "[]").length === 1,
  );
  await dashboard.locator('[data-target="review"]').first().click();
  const contactRow = dashboard.locator("#review-container .model-row");
  await contactRow.waitFor();
  assert.match(await contactRow.textContent(), /Contact Us/);
  assert.match(await contactRow.textContent(), /I need help with my order/);
  assert.equal(await contactRow.locator(".review-toggle-btn").count(), 0);
  for (const index of [4, 5, 6])
    assert.equal(
      (await contactRow.locator(".text-item").nth(index).textContent()).trim(),
      "-",
    );

  await dashboard.evaluate(() => {
    reviewsData.push({
      id: "REV-TEST",
      source: "Review",
      recordType: "review",
      clientName: "Review Customer",
      clientId: "DA-R",
      status: "Pending",
      rating: 5,
      title: "Great",
      review: "Excellent service",
      phone1: "01000000000",
      phone2: "-",
      email: "review@example.com",
      createdAt: new Date().toISOString(),
    });
    dartSaveAll();
    dartRefreshAll();
  });
  const sourceFilter = dashboard.locator('#review [data-filter-key="source"]');
  await sourceFilter.selectOption("contact us");
  assert.equal(
    await dashboard.locator("#review-container .model-row").count(),
    1,
  );
  assert.match(
    await dashboard.locator("#review-container").textContent(),
    /Contact Customer/,
  );
  await sourceFilter.selectOption("review");
  assert.equal(
    await dashboard.locator("#review-container .model-row").count(),
    1,
  );
  assert.match(
    await dashboard.locator("#review-container").textContent(),
    /Review Customer/,
  );

  await dashboard.evaluate(() => {
    itemsData = [
      { id: "ITEM-G", itemCode: "ITEM-G", modelId: "M-1", status: "Sold" },
      { id: "ITEM-D", itemCode: "ITEM-D", modelId: "M-1", status: "Sold" },
      { id: "ITEM-R", itemCode: "ITEM-R", modelId: "M-1", status: "Sold" },
    ];
    returnsData = [
      {
        id: "RET-G",
        returnId: "R-1",
        itemCode: "ITEM-G",
        modelId: "M-1",
        status: "Pending Request",
        createdAt: "2026-09-07T12:00:00Z",
      },
      {
        id: "RET-D",
        returnId: "R-2",
        itemCode: "ITEM-D",
        modelId: "M-1",
        status: "Pending Request",
        createdAt: "2026-09-06T12:00:00Z",
      },
      {
        id: "RET-R",
        returnId: "R-3",
        itemCode: "ITEM-R",
        modelId: "M-1",
        status: "Pending Request",
        createdAt: "2026-09-05T12:00:00Z",
      },
    ];
    dartSaveAll();
    dartRefreshAll();
  });
  await dashboard.locator('[data-target="returns"]').first().click();
  const goodRow = dashboard.locator(
    '#returns-container .model-row[data-id="RET-G"]',
  );
  await goodRow.locator(".return-accept-btn").click();
  assert.equal(await goodRow.locator(".return-good-btn").count(), 1);
  await goodRow.locator(".return-good-btn").click();
  assert.equal(
    await dashboard.evaluate(
      () => itemsData.find((item) => item.id === "ITEM-G").status,
    ),
    "In stock",
  );
  const damagedRow = dashboard.locator(
    '#returns-container .model-row[data-id="RET-D"]',
  );
  await damagedRow.locator(".return-accept-btn").click();
  await damagedRow.locator(".return-bad-btn").click();
  assert.equal(
    await dashboard.evaluate(
      () => itemsData.find((item) => item.id === "ITEM-D").status,
    ),
    "Damaged",
  );
  assert.equal(await dashboard.evaluate(() => damageData.length), 1);
  const rejectedRow = dashboard.locator(
    '#returns-container .model-row[data-id="RET-R"]',
  );
  await rejectedRow.locator(".return-reject-btn").click();
  assert.equal(
    await dashboard.evaluate(
      () => returnsData.find((record) => record.id === "RET-R").status,
    ),
    "Rejected",
  );
  assert.equal(
    await dashboard.evaluate(
      () => itemsData.find((item) => item.id === "ITEM-R").status,
    ),
    "Sold",
  );

  const analytics = await dashboard.evaluate(() => {
    const now = new Date();
    const date = (offset, day = 10) =>
      new Date(
        now.getFullYear(),
        now.getMonth() + offset,
        day,
        12,
      ).toISOString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const birthday = `${2000}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    customersData = [
      {
        id: "C-A",
        clientId: "DA-A",
        clientName: "Alice",
        birthday,
        phone1: "01011111111",
        registeredAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "C-B",
        clientId: "DA-B",
        clientName: "Bob",
        birthday: "1995-01-01",
        phone1: "01022222222",
        registeredAt: "2025-01-01T00:00:00Z",
      },
    ];
    const order = (id, clientId, when, amount, refunded = 0) => ({
      id,
      orderId: id,
      clientId,
      status: "Delivered",
      deliveredAt: when,
      createdAt: when,
      finalAmount: amount,
      amountRefunded: refunded,
      items: [id + "-ITEM"],
    });
    ordersData = [
      order("A-NOW-1", "DA-A", date(0, 2), 500, 100),
      order("A-NOW-2", "DA-A", date(0, 3), 500),
      order("B-NOW-1", "DA-B", date(0, 4), 2000),
      order("A-LAST-1", "DA-A", date(-1, 2), 400),
      order("A-LAST-2", "DA-A", date(-1, 3), 400),
      order("A-PREV-1", "DA-A", date(-2, 2), 300),
    ];
    dartSaveAll();
    dartRefreshAll();
    renderTopClients();
    renderBirthdayWidget();
    return {
      expectedAge: dartClientAge(birthday),
      currentYear: String(now.getFullYear()),
    };
  });
  await dashboard.locator('[data-target="brand"]').first().click();
  assert.equal(
    await dashboard.locator("#topClientsMonthFilter").inputValue(),
    "current",
  );
  assert.equal(
    await dashboard.locator("#topClientsYearFilter").inputValue(),
    "none",
  );
  const firstTopClient = dashboard
    .locator("#top-clients-feed .bday-item")
    .first();
  assert.match(await firstTopClient.textContent(), /Alice/);
  assert.match(await firstTopClient.textContent(), /2 Order/);
  assert.match(await firstTopClient.textContent(), /900 EGP/);
  assert.match(
    await firstTopClient.textContent(),
    new RegExp(`${analytics.expectedAge} years`),
  );
  await dashboard
    .locator("#topClientsYearFilter")
    .selectOption(analytics.currentYear);
  assert.equal(
    await dashboard.locator("#topClientsMonthFilter").inputValue(),
    "none",
  );
  assert.match(
    await dashboard
      .locator("#top-clients-feed .bday-item")
      .first()
      .textContent(),
    /Alice/,
  );
  await dashboard.locator("#topClientsYearFilter").selectOption("none");
  assert.equal(
    await dashboard.locator("#topClientsMonthFilter").inputValue(),
    "current",
  );
  assert.match(
    await dashboard.locator("#birthday-feed").textContent(),
    new RegExp(`${analytics.expectedAge} years`),
  );

  await dashboard.locator('[data-target="customers"]').first().click();
  const alice = dashboard.locator(
    '#customers-container .model-row[data-id="C-A"]',
  );
  assert.equal(
    (await alice.locator(".text-item").last().textContent()).trim(),
    String(analytics.expectedAge),
  );
  await alice.locator('[data-client-profile="1"]').click();
  assert.match(
    await dashboard.locator(".dart-purchase-trend").textContent(),
    /Orders ↑ 100%/,
  );

  await dashboard.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("dart_orders") || "[]");
    rows.push({
      id: "TRACK",
      orderId: "K-TRACK",
      clientId: "DA-A",
      status: "New",
      latitude: "30.0444",
      longitude: "31.2357",
      createdAt: new Date().toISOString(),
      priceSnapshot: [],
    });
    localStorage.setItem("dart_orders", JSON.stringify(rows));
  });
  const tracking = await context.newPage();
  await tracking.addInitScript(() => {
    window.__mapStats = { maps: 0, removed: 0, markers: [] };
    const mapObject = {
      setView() {
        return this;
      },
      remove() {
        window.__mapStats.removed += 1;
      },
      removeLayer() {},
      fitBounds() {},
      invalidateSize() {},
    };
    window.L = {
      map() {
        window.__mapStats.maps += 1;
        return mapObject;
      },
      tileLayer() {
        return { addTo() {} };
      },
      divIcon(options) {
        return options;
      },
      marker(coordinates) {
        window.__mapStats.markers.push(coordinates);
        return {
          addTo() {
            return this;
          },
          bindPopup() {
            return this;
          },
          setLatLng() {},
        };
      },
      polyline() {
        return {
          addTo() {
            return this;
          },
          setLatLngs() {},
        };
      },
    };
  });
  await tracking.goto(origin + "/track.html?order=K-TRACK");
  assert.deepEqual(await tracking.evaluate(() => window.__mapStats), {
    maps: 1,
    removed: 0,
    markers: [[30.0444, 31.2357]],
  });
  assert.equal(
    await tracking.locator("#trackingMapDisabled").isVisible(),
    true,
  );
  assert.equal(
    await tracking
      .locator("#trackingMapDisabled")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgba(0, 0, 0, 0.2)",
  );
  await tracking.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("dart_orders"));
    const order = rows.find((row) => row.id === "TRACK");
    Object.assign(order, {
      representativeId: "REP-1",
      representativeName: "Ahmed",
      courierLocation: {
        lat: 30.05,
        lng: 31.24,
        updatedAt: new Date().toISOString(),
      },
    });
    localStorage.setItem("dart_orders", JSON.stringify(rows));
    DartTracking.render();
  });
  assert.equal(
    await tracking.locator("#trackingMapDisabled").isVisible(),
    true,
  );
  assert.equal(
    await tracking.evaluate(() => window.__mapStats.markers.length),
    1,
  );
  await tracking.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("dart_orders"));
    const order = rows.find((row) => row.id === "TRACK");
    order.status = "Representative On The Way";
    order.deliveryStartedAt = new Date().toISOString();
    localStorage.setItem("dart_orders", JSON.stringify(rows));
    DartTracking.render();
  });
  assert.equal(await tracking.locator("#trackingMapDisabled").isHidden(), true);
  assert.equal(
    await tracking.evaluate(() => window.__mapStats.markers.length),
    2,
  );

  console.log(
    "PASS V8 features: contact inbox/filter, return decision/inspection, client periods/age/trend, and Start Delivery tracking map.",
  );
  await context.close();
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
/* END V8 acceptance. */
