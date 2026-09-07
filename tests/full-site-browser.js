/* BEGIN Full-site smoke test — navigation, shared sections, controls and local requests. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.statusCode = 403;
    response.end();
    return;
  }
  try {
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const failures = [];
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );

  async function open(relativeUrl) {
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      failures.push(`${relativeUrl}: ${error.message}`),
    );
    page.on("response", (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        failures.push(`${relativeUrl}: ${response.status()} ${response.url()}`);
    });
    const response = await page.goto(`${origin}/${relativeUrl}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response.status(), 200, `${relativeUrl} must load`);
    return page;
  }

  const sharedPages = [
    "index.html",
    "products.html",
    "about.html",
    "Contact%20us.html",
    "cart-checkout.html",
    "policies.html",
  ];
  for (const relativeUrl of sharedPages) {
    const page = await open(relativeUrl);
    await page.waitForSelector("#header-container .hedar-nav");
    await page.waitForSelector("#footer .footer-continear");
    assert.equal(await page.locator("#header-container .hedar-nav").count(), 1);
    assert.equal(await page.locator("#footer .footer-continear").count(), 1);
    await page.close();
  }

  const home = await open("index.html");
  await home.waitForSelector("#header-container .icon-menu");
  await home.locator("#header-container .icon-menu").click();
  assert.equal(await home.locator("#header-container .side-menu").evaluate((node) => node.classList.contains("active")), true);
  await home.locator("main").click({ position: { x: 2, y: 2 } });
  assert.equal(await home.locator("#header-container .side-menu").evaluate((node) => node.classList.contains("active")), false);
  await home.close();

  const products = await open("products.html");
  const filterButton = products.locator("#toggleProductFilters");
  await filterButton.click();
  assert.equal(await filterButton.getAttribute("aria-expanded"), "true");
  assert.equal(await products.locator("#productFiltersPanel").isVisible(), true);
  await filterButton.click();
  assert.equal(await filterButton.getAttribute("aria-expanded"), "false");
  await products.close();

  const account = await open("Sign%20Up%20modern.html");
  await account.locator(".register-btn").click();
  assert.equal(await account.locator(".container").evaluate((node) => node.classList.contains("active")), true);
  await account.locator(".login-btn").click();
  assert.equal(await account.locator(".container").evaluate((node) => node.classList.contains("active")), false);
  await account.close();

  const profile = await open("profile.html");
  await profile.waitForURL(/Sign%20Up%20modern\.html\?next=profile$/);
  await profile.close();

  const rep = await open("rep.html");
  await rep.locator("#repRegisterTab").click();
  assert.equal(await rep.locator("#repRegisterForm").isVisible(), true);
  await rep.locator("#repLoginTab").click();
  assert.equal(await rep.locator("#repLoginForm").isVisible(), true);
  await rep.close();

  const receipt = await open("pdf.html");
  await receipt.waitForFunction(() => document.querySelectorAll("#receipt-items tr").length === 3);
  assert.equal((await receipt.locator("#grand-total").textContent()).trim(), "2250");
  await receipt.close();

  const tracking = await open("track.html");
  assert.equal(await tracking.locator("#trackingMapShell").count(), 1);
  await tracking.close();

  const dashboard = await open("Eye/Dart%20Eye.html");
  assert.equal(await dashboard.locator(".dashboard-section.active-section").getAttribute("id"), "brand");
  assert.equal(await dashboard.locator("link[rel='manifest']").count(), 1);
  const dashboardTargets = await dashboard.locator("a[data-target]").evaluateAll((links) =>
    [...new Set(links.map((link) => link.dataset.target))],
  );
  for (const target of dashboardTargets) {
    const controls = dashboard.locator(`a[data-target="${target}"]`);
    let activated = false;
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (await control.isVisible()) {
        await control.click();
        activated = true;
        break;
      }
    }
    if (!activated) await controls.last().evaluate((node) => node.click());
    assert.equal(
      await dashboard.locator(`#${target}`).evaluate((node) => node.classList.contains("active-section")),
      true,
      `dashboard navigation must activate ${target}`,
    );
  }
  await dashboard.close();

  for (const endpoint of ["manifest.json", "sw.js", "sitemap.xml", "robots.txt"]) {
    const response = await context.request.get(`${origin}/${endpoint}`);
    assert.equal(response.status(), 200, `${endpoint} must load from the root`);
  }

  assert.deepEqual(failures, []);
  console.log("PASS full-site pages, shared sections, menu, filters, auth switches, receipt, tracking, dashboard navigation and root files");
  await context.close();
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
/* END Full-site smoke test. */
