"use strict";
// Real profile markup and browser layout; delivery endpoints stay isolated fixtures.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const profile = fs.readFileSync(path.join(root, "profile.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace("</body>", '<script src="/notification-fixture.js"></script><script src="/Js/dart-customer-notifications.js"></script></body>');
const fixture = `window.fixtureUser={id:'customer-a'};window.permissionRequests=0;window.registrations=[];
Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default',async requestPermission(){window.permissionRequests++;this.permission='granted';return 'granted';}}});
window.PushManager=window.PushManager||function(){};
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',toJSON(){return {endpoint:this.endpoint,keys:{}};},async unsubscribe(){return true;}};
const registration={active:{},pushManager:{async getSubscription(){return null;},async subscribe(){return subscription;}}};
Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{async getRegistration(){return null;},async register(url,options){window.registrations.push({url,options});return registration;}}});
window.DartPlatform={currentUser:()=>window.fixtureUser,apiRequest:async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});if(!response.ok)throw new Error('private diagnostic');return response.status===204?{}:response.json();}};`;
let mode = "ready", readFailure = false, read = false, pushWrites = 0;
function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/profile.html") { res.setHeader("Content-Type", "text/html"); return res.end(profile); }
  if (url.pathname === "/notification-fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(fixture); }
  if (url.pathname === "/api/v1/me/notifications") {
    const result = () => mode === "error" ? json(res, 503, {}) : json(res, 200, { notifications: mode === "empty" ? [] : [
      { id: "synthetic", eventType: "ORDER_PLACED", title: '<img src=x onerror="window.injected=true">', orderCode: "K-SYNTHETIC", message: "Your order has been placed.", createdAt: "2026-10-27T00:00:00.000Z", readAt: read ? "2026-10-27T01:00:00.000Z" : null },
    ], unreadCount: read || mode === "empty" ? 0 : 1, nextCursor: null });
    return mode === "slow" ? setTimeout(result, 250) : result();
  }
  if (url.pathname === "/api/v1/me/notifications/read") { if (readFailure) return json(res, 503, {}); read = true; return json(res, 200, { updated: 1 }); }
  if (url.pathname === "/api/v1/me/push/config") return json(res, 200, { configured: true, publicKey: "A".repeat(87) });
  if (url.pathname === "/api/v1/me/push/subscriptions") { if (req.method === "POST") { pushWrites++; return json(res, 200, { id: "device", enabled: true }); } return json(res, 200, { subscriptions: [] }); }
  if (url.pathname === "/api/v1/me/push/subscriptions/device") { res.writeHead(204); return res.end(); }
  const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try { res.setHeader("Content-Type", ({ ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp" })[path.extname(file)] || "application/octet-stream"); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    mode = "slow"; await page.goto(origin + "/profile.html", { waitUntil: "domcontentloaded" });
    await page.getByText("Loading notifications…", { exact: true }).waitFor();
    await page.locator("[data-notification-list] li").waitFor();
    assert.equal(await page.evaluate(() => window.permissionRequests), 0); assert.equal(pushWrites, 0);
    assert.equal(await page.locator("[data-notification-list] img").count(), 0); assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#customerNotifications").scrollIntoViewIfNeeded();
      const dimensions = await page.locator("#customerNotifications").evaluate(node => ({ width: node.getBoundingClientRect().width, overflow: node.scrollWidth > node.clientWidth }));
      assert.ok(dimensions.width > 200 && dimensions.width <= width); assert.equal(dimensions.overflow, false);
      assert.equal(await page.locator("[data-push-toggle]").evaluate(node => node.getBoundingClientRect().height >= 44), true);
    }
    readFailure = true; await page.getByRole("button", { name: "Mark shown as read", exact: true }).click();
    await page.getByText("Read status was not saved. Please retry.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-notification-list] li").getAttribute("data-unread"), "true");
    readFailure = false; await page.getByRole("button", { name: "Mark shown as read", exact: true }).click();
    await page.getByText("Marked as read.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-notification-list] li").getAttribute("data-unread"), "false");
    mode = "error"; await page.locator("[data-notification-refresh]").click();
    await page.getByText("Notifications are unavailable. Select Refresh to retry.", { exact: true }).waitFor();
    mode = "empty"; await page.locator("[data-notification-refresh]").click();
    await page.getByText("No notifications yet. New order updates will appear here.", { exact: true }).waitFor();
    await page.locator("[data-push-toggle]").click();
    await page.getByText("Enabled for this sign-in. Signing out stops future delivery.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.permissionRequests), 1); assert.equal(pushWrites, 1);
    assert.equal(await page.evaluate(() => window.registrations[0].options.scope), "/push/");
    await page.locator("[data-push-toggle]").click();
    await page.getByText("Browser notifications disabled. In-site updates remain available.", { exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureUser = null; window.dispatchEvent(new CustomEvent("dart:customer-session-changed")); });
    await page.getByText("Sign in to view your notifications.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-notification-list] li").count(), 0); assert.deepEqual(errors, []);
    console.log("PASS Chromium customer notifications: real profile, four widths, safe text, loading/empty/error/retry, read acknowledgement, explicit push consent, opt-out and logout");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
