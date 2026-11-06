"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "localhost") return route.abort();
      const file = decodeURIComponent(url.pathname).slice(1) || "cart-checkout.html";
      if (file.includes("..") || !fs.existsSync(path.join(root, file))) return route.fulfill({ status: 404, body: "" });
      const contentType = file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
      let body = fs.readFileSync(path.join(root, file));
      if (file.endsWith(".html")) body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      return route.fulfill({ contentType, body });
    });
    await page.goto("http://localhost/cart-checkout.html");
    await page.clock.install();
    // The real form and production modules run against a controllable map/GPS
    // and geocoder. No order or lookup is sent to a production service.
    await page.evaluate(() => {
      document.getElementById("checkoutView").style.display = "block";
      document.getElementById("cartView").style.display = "none";
      const values = { "checkout-name": "Synthetic", "checkout-phone1": "01000000001", "checkout-email": "synthetic@example.test", "checkout-building": "10", "checkout-floor": "2" };
      for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
      window.DartState = { read: () => ({ lat: 30.04, lng: 31.23, country: "Egypt", governorate: "Cairo", area: "Old area", street: "Old street", building: "10", floor: "2", address: "Old destination" }) };
      const map = { attributionControl: { setPrefix() {} }, setView() { return this; }, on() {}, removeLayer() {}, invalidateSize() {} };
      window.L = {
        map: () => map, tileLayer: () => ({ addTo() {} }), divIcon: () => ({}),
        marker: () => ({ addTo() { return this; }, setLatLng() {}, on() {}, bindPopup() { return this; }, openPopup() { return this; } }),
        control: () => ({ addTo() { this.onAdd(); } }), DomUtil: { create: (tag) => document.createElement(tag) }, DomEvent: { disableClickPropagation() {}, on(el, type, fn) { el.addEventListener(type, fn); } },
      };
      window.lookups = [];
      window.fetch = (_url, { signal, ...options }) => new Promise((resolve, reject) => {
        window.lookups.push({ url: _url, options, resolve: (result) => resolve({ ok: true, json: async () => result }), reject });
        signal.addEventListener("abort", () => reject(new Error("Synthetic timeout")), { once: true });
      });
      window.syntheticResult = (name, lat, lon) => ({ lat, lon, display_name: name, address: { country: "Egypt", state: "Cairo", suburb: `${name} area`, road: `${name} street` } });
    });
    await page.addScriptTag({ content: read("Js/dart-address.js") });
    await page.evaluate(() => DartAddress.initCheckout());
    await page.addScriptTag({ content: read("Js/dart-checkout-stability.js") });
    await page.evaluate(() => {
      window.submits = 0;
      document.getElementById("checkoutForm").addEventListener("submit", (event) => { event.preventDefault(); window.submits++; });
    });
    const submit = page.locator('#checkoutForm [type="submit"]');
    const payment = page.getByRole('region', { name: 'Cash on delivery' });
    assert.equal(await payment.count(), 1);
    assert.equal(await payment.locator('input, select, button').count(), 0, 'cash-only payment is information, not a choice');
    assert.equal(await payment.getByText('Pay when your order arrives.', { exact: true }).count(), 1);
    assert.equal(await submit.isDisabled(), false);
    await page.evaluate(() => { void dartCheckoutAddress.selectLocation(30.05, 31.35); });
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await submit.textContent(), "Checking location…");
    await page.evaluate(() => document.getElementById("checkoutForm").requestSubmit());
    assert.equal(await page.evaluate(() => submits), 0);
    await page.clock.fastForward(8001);
    assert.equal(await submit.isDisabled(), true, "no eight-second fallback to the old pin");
    await page.evaluate(() => lookups[0].resolve(syntheticResult("New destination", 30.05, 31.35)));
    await page.waitForFunction(() => document.getElementById("checkoutForm").dataset.dartAddressState === "success");
    assert.equal(await submit.isDisabled(), false);
    assert.equal(await page.locator("#street-input").inputValue(), "New destination street");
    assert.equal(await page.locator("#lat-input").inputValue(), "30.0500000");
    await page.locator("#checkout-floor").fill("4");
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), true);
    await page.evaluate(() => {
      document.getElementById("checkoutForm").setAttribute("aria-busy", "true");
    });
    await page.waitForFunction(() => document.querySelector('#checkoutForm [type="submit"]').disabled);
    assert.equal(await submit.textContent(), "Adding…");
    await page.evaluate(() => document.getElementById("checkoutForm").setAttribute("aria-busy", "false"));
    await page.waitForFunction(() => !document.querySelector('#checkoutForm [type="submit"]').disabled);
    await submit.click(); assert.equal(await page.evaluate(() => submits), 1);
    // A verification timeout releases the UI for retry, but cannot submit an
    // earlier location or queue a delayed automatic order.
    await page.evaluate(() => { void dartCheckoutAddress.selectLocation(30.06, 31.36); });
    await page.clock.fastForward(13000);
    await page.waitForFunction(() => document.getElementById("checkoutForm").dataset.dartAddressState === "error");
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), false);
    assert.equal(await page.locator("#lat-input").inputValue(), "");
    assert.equal(await page.evaluate(() => submits), 1);
    await page.locator('#confirm-manual-pin').click();
    assert.equal(await page.evaluate(() => lookups.at(-1).url.endsWith('/shipping/validate-point')), true);
    assert.equal(await page.evaluate(() => JSON.parse(lookups.at(-1).options.body).governorate), 'Cairo');
    assert.equal(await submit.isDisabled(), true, 'server geometry must finish before ordering');
    await page.evaluate(() => lookups.at(-1).resolve({ valid: true }));
    await page.waitForFunction(() => dartCheckoutAddress.validate().ok);
    assert.equal(await page.locator('#lat-input').inputValue(), '30.0600000');
    assert.equal(await page.evaluate(() => document.getElementById('checkoutForm').dataset.dartAddressSource), 'manual-pin');
    await page.locator('#checkout-floor').fill('5');
    assert.equal(await page.evaluate(() => dartCheckoutAddress.validate().ok), false, 'edited manual details need reconfirmation');
    await page.locator('#confirm-manual-pin').click();
    await page.evaluate(() => lookups.at(-1).resolve({ valid: false }));
    await page.waitForFunction(() => document.getElementById('checkoutForm').dataset.dartAddressState === 'error');
    assert.equal(await page.locator('#lat-input').inputValue(), '', 'a mismatched governorate cannot leave usable coordinates');
    await page.locator('#confirm-manual-pin').click();
    await page.evaluate(() => lookups.at(-1).resolve({ valid: true }));
    await page.waitForFunction(() => dartCheckoutAddress.validate().ok);
    assert.equal(await page.evaluate(() => submits), 1, 'confirmation never creates an order');
    for (const width of [370, 480, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await submit.boundingBox(); assert.ok(bounds && bounds.width <= width, `button fits ${width}`);
      const paymentBounds = await payment.boundingBox();
      assert.ok(paymentBounds && paymentBounds.x >= 0 && paymentBounds.x + paymentBounds.width <= width, `cash payment fits ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log("PASS checkout Chromium: actual form, disabled button/Enter, 8s delay, new address fields, unit edits, busy guard, timeout/retry and mobile/desktop button");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
