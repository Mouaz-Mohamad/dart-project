"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "localhost") return route.abort();
      const file = decodeURIComponent(url.pathname).slice(1) || "cart-checkout.html";
      if (file.includes("..") || !fs.existsSync(path.join(root, file)))
        return route.fulfill({ status: 404, body: "" });
      const type = file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
      let body = fs.readFileSync(path.join(root, file));
      if (file.endsWith(".html"))
        body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      return route.fulfill({ contentType: type, body });
    });
    await page.goto("http://localhost/cart-checkout.html");
    await page.evaluate(() => {
      document.getElementById("checkoutView").style.display = "block";
      document.getElementById("cartView").style.display = "none";
      window.DartShippingAvailability = {
        ready: true,
        isAddressCovered: (a) => a.governorate === "Cairo",
      };
      window.DartState = { read: () => null };
    });
    await page.addScriptTag({ content: read("Js/dart-checkout-manual-address.js") });
    assert.equal(await page.locator("#map").count(), 0);
    assert.equal(await page.locator(".other-addres").isVisible(), true);
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), false);
    for (const [id, value] of [
      ["checkout-name", "Test Customer"], ["checkout-phone1", "01000000000"],
      ["checkout-email", "test@example.com"], ["area-input", "Nasr City"],
      ["street-input", "Example Street"], ["checkout-building", "21"], ["checkout-floor", "3"],
    ]) await page.locator("#" + id).fill(value);
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), true);
    const snapshot = await page.evaluate(() => dartCheckoutAddress.snapshot());
    await page.locator("#street-input").fill("Changed street");
    assert.equal(await page.evaluate((previous) => dartCheckoutAddress.isCurrentSnapshot(previous), snapshot), false);
    await page.locator("#governorate-select").selectOption("Giza");
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), false);
    for (const width of [370, 480, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const order = await page.locator(".order-btn").boundingBox();
      assert.ok(order && order.x >= 0 && order.x + order.width <= width, "checkout button fits " + width);
    }
    assert.deepEqual(errors, []);
    console.log("PASS manual checkout Chromium, no map, shipping guard, address edits and responsive layout");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
