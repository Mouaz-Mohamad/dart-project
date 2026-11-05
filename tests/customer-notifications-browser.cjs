"use strict";
// Real account markup/runtime against isolated cookie-backed API fixtures.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { chromium } = require("playwright");
const { openStorefrontFixture } = require("./helpers/storefront-fixture.cjs");
const root = path.resolve(__dirname, "../public");
let unavailable = false, meRequests = 0, notificationRequests = 0;
const user = { id: "customer-a", accountType: "customer", code: "DR-1", name: "Account Test", email: "fixture@example.test", phones: ["01000000001"], status: "active", birthday: "2000-01-01" };
function json(res, code, payload) { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const signedIn = /(?:^|; )dart_test_session=valid(?:;|$)/.test(req.headers.cookie || "");
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.includes("notifications") || url.pathname.includes("/push/")) notificationRequests++;
    if (url.pathname === "/api/v1/auth/login") {
      res.setHeader("Set-Cookie", ["dart_test_session=valid; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax", "dart_csrf=fixture; Path=/; Max-Age=31536000"]);
      return json(res, 200, { user, csrfToken: "fixture" });
    }
    if (url.pathname === "/api/v1/auth/logout") {
      res.setHeader("Set-Cookie", ["dart_test_session=; Path=/; Max-Age=0", "dart_csrf=; Path=/; Max-Age=0"]);
      res.writeHead(204); return res.end();
    }
    if (url.pathname === "/api/v1/me") {
      meRequests++;
      if (unavailable) return json(res, 503, {});
      if (!signedIn) return json(res, 401, { error: { code: "AUTH_REQUIRED" } });
      res.setHeader("Set-Cookie", "dart_csrf=fixture; Path=/; Max-Age=31536000");
      return json(res, 200, { user, csrfToken: "fixture" });
    }
    const payload = url.pathname === "/api/v1/catalog" ? { version: 1, models: [], stock: {} } :
      url.pathname === "/api/v1/site-settings" ? { version: 1, settings: {} } :
      url.pathname === "/api/v1/me/commerce" ? { orders: [], returns: [], cards: [], birthdayRewards: [], birthdayMessages: [], purchaseStats: { totalPieces: 0, monthlyPieces: 0 } } :
      url.pathname === "/api/v1/me/waiting" ? { entries: [] } :
      url.pathname === "/api/v1/reviews" ? { reviews: [] } :
      url.pathname === "/api/v1/auth/social/providers" ? { providers: {} } : { cart: null, entries: [], leaders: [], winners: [] };
    return json(res, 200, payload);
  }
  const file = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    res.setHeader("Content-Type", ({ ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" })[path.extname(file)] || "application/octet-stream");
    let content = openStorefrontFixture(file, fs.readFileSync(file));
    if (file.endsWith(".html")) content = content.toString().replace(/<(?:script|link)\b[^>]*(?:src|href)=["']https:\/\/[^>]*>(?:<\/script>)?/g, "");
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    let context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    let page = await context.newPage(); page.setDefaultTimeout(10000); const errors = [];
    if (process.env.DART_TEST_TRACE) page.on("framenavigated", frame => { if (frame === page.mainFrame()) console.log("Account test:", frame.url()); });
    page.on("pageerror", error => errors.push(error.message));
    for (const [route, next] of [["profile.html?view=orders", "next=profile&view=orders"], ["track.html?order=K-1", "next=track&order=K-1"], ["form-return.html", "next=return"]]) {
      await page.goto(`${origin}/${route}`);
      await page.waitForURL(url => url.pathname.includes("Sign%20Up") && url.search.includes(next));
    }
    await page.goto(`${origin}/Sign%20Up%20modern.html?next=profile&view=orders`);
    await page.locator("#loginForm [name=identifier]").fill(user.email);
    await page.locator("#loginForm [name=password]").fill("synthetic123");
    await page.locator("#loginForm button[type=submit]").click();
    await page.waitForURL("**/profile.html?view=orders");
    await page.locator(".order-info.active").waitFor();
    await page.reload(); await page.locator(".order-info.active").waitFor();
    await page.locator(".order-info [aria-label='Back to account']").click();
    assert.equal(new URL(page.url()).search, "");
    await page.locator("[data-account-view=profile]").click(); await page.locator(".profile-details.active").waitFor();
    await page.goBack(); assert.equal(await page.locator(".profile-details.active").count(), 0);
    await page.goForward(); await page.locator(".profile-details.active").waitFor();
    await page.keyboard.press("Escape"); await page.waitForURL("**/profile.html");
    for (const view of ["profile", "orders", "waiting", "returns"]) {
      await page.goto(`${origin}/profile.html?view=${view}`);
      await page.locator("body[data-customer-auth=ready]").waitFor();
      // Authentication is ready before the selected accordion becomes active on some devices.
      // Wait for the visible, route-specific section instead of asserting during the transition.
      await page.locator(".profile-details.active, .order-info.active, .waiting-info.active, .return-info.active")
        .waitFor({state:"visible"});
      assert.equal(await page.locator(".profile-details.active, .order-info.active, .waiting-info.active, .return-info.active").count(), 1);
    }
    await page.goto(`${origin}/profile.html`);
    await page.locator("body[data-customer-auth=ready]").waitFor();
    const notifications = page.locator("#customerNotifications");
    assert.equal(await notifications.locator("button, p, ul").count(), 0);
    assert.equal(await notifications.locator("h2").textContent(), "Notifications");
    assert.equal(await notifications.locator("svg").count(), 1);
    assert.equal(await page.locator("#birthdayWhatsappPreference").count(), 0);
    if (process.env.DART_ACCOUNT_SCREENSHOT) await page.screenshot({ path: process.env.DART_ACCOUNT_SCREENSHOT, fullPage: true });
    for (const width of [370, 480, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `account page overflow at ${width}`);
    }
    // Close/reopen a browser context with only its persistent cookies, without private data caches.
    const cookies = (await context.cookies()).filter(cookie => cookie.name === "dart_test_session");
    await context.close(); context = await browser.newContext(); await context.addCookies(cookies);
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/about.html`);
    await page.waitForFunction(() => window.DartPlatform?.currentUser()?.id === "customer-a");
    assert.equal((await context.cookies()).some(cookie => cookie.name === "dart_csrf"), true);
    await page.goto(`${origin}/Sign%20Up%20modern.html?next=profile&view=waiting`);
    await page.waitForURL("**/profile.html?view=waiting"); await page.locator(".waiting-info.active").waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.locator("body[data-customer-auth=ready] .waiting-info.active").waitFor();
    assert.equal(new URL(page.url()).search, "?view=waiting", "history restore must wait for authentication without a false login redirect");
    unavailable = true; await page.goto(`${origin}/profile.html?view=returns`);
    await page.locator("body[data-customer-auth=error]").waitFor();
    assert.equal(await page.locator("main").isVisible(), false);
    unavailable = false; await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator(".return-info.active").waitFor();
    await page.goto(`${origin}/profile.html`); await page.locator(".btn-accont-log-out").click();
    await page.waitForURL(url => url.pathname === "/index.html" || url.pathname.includes("Sign%20Up"));
    await page.goto(`${origin}/profile.html?view=profile`);
    await page.waitForURL("**/Sign%20Up%20modern.html?next=profile&view=profile");
    assert.equal(notificationRequests, 0); assert.ok(meRequests > 4); assert.deepEqual(errors, []);
    console.log("PASS Chromium account: real login/logout, five widths, URL reload/back/forward, private-route redirects, restored cookie without CSRF helper, outage/retry, compact notification header");
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
