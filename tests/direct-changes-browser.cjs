"use strict";
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs");
const { chromium } = require("playwright");
const streams = new Set(); let supported = true, opened = 0, probes = 0, limited = false;
const server = http.createServer((req, res) => {
  if (req.url === "/api/v1/health/live") {
    probes++; res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ capabilities: supported ? ["direct-updates-v1"] : [] }));
  }
  if (req.url === "/api/v1/catalog/changes") {
    if (limited) {
      opened++; res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      return res.end('event: unavailable\ndata: {"retryMs":60000}\n\n');
    }
    opened++; streams.add(res); res.on("close", () => streams.delete(res));
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    return res.write("event: ready\ndata: {}\n\n");
  }
  if (req.url === "/Js/dart-changes.js") {
    res.setHeader("Content-Type", "text/javascript"); return res.end(fs.readFileSync("Js/dart-changes.js"));
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><title>Direct updates test</title><script>window.changes=[];addEventListener("dart:server-change",e=>changes.push(e.detail))</script><script src="/Js/dart-changes.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin); await page.waitForFunction(() => window.DartChanges.active);
    assert.equal(opened, 1); assert.equal(probes, 1);
    for (const res of streams) res.write('event: change\ndata: {"scope":"version","name":"catalog_inventory","version":7}\n\n');
    await page.waitForFunction(() => changes.some(signal => signal.version === 7));
    for (const res of streams) res.end();
    await page.waitForFunction(() => changes.filter(signal => signal.reconcile).length === 2);
    assert.equal(opened, 2); assert.equal(probes, 1, "reconnect reuses capability, then asks consumers to reconcile versions");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForFunction(() => !window.DartChanges.active);
    for (let attempt = 0; attempt < 100 && streams.size; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(streams.size, 0, "a hidden tab releases its HTTP stream");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForFunction(() => window.DartChanges.active);
    assert.equal(opened, 3);
    // Restore the native visibility getter before closing. Keeping hidden=false
    // during teardown can make Chromium's closing visibility event reconnect.
    await page.evaluate(() => { delete document.hidden; });
    await page.close(); supported = false;
    for (let attempt = 0; attempt < 100 && streams.size; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(streams.size, 0, "closing the supported tab releases its stream before testing the older API");
    const fallback = await browser.newPage(); await fallback.goto(origin);
    await fallback.waitForLoadState("networkidle");
    assert.equal(await fallback.evaluate(() => window.DartChanges.active), false);
    assert.equal(opened, 3, "an older/disabled API never opens an incompatible event source");
    await fallback.close(); supported = true; limited = true;
    const saturated = await browser.newPage(), capacityErrors = [];
    await saturated.addInitScript(() => {
      const NativeSource = window.EventSource;
      window.EventSource = class extends NativeSource {
        constructor(...args) {
          super(...args);
          this.addEventListener('unavailable', () => { window.capacityUnavailable = true; });
        }
      };
    });
    saturated.on('console', message => { if (message.type() === 'error') capacityErrors.push(message.text()); });
    const capacityResponse = saturated.waitForResponse(response => response.url().endsWith('/api/v1/catalog/changes'));
    await saturated.goto(origin); await capacityResponse;
    // An EventSource response is a stream: loadingFinished is not portable
    // across Chromium versions. Wait for the actual protocol event instead.
    await saturated.waitForFunction(() => window.capacityUnavailable === true);
    await saturated.waitForTimeout(1100);
    assert.equal(await saturated.evaluate(() => window.DartChanges.active), false);
    assert.equal(opened, 4, "a saturated stream uses the minute cooldown rather than immediate EventSource retries");
    assert.deepEqual(capacityErrors, [], "normal saturation must not create HTTP/console errors");
    assert.deepEqual(errors, []);
    console.log("PASS native Chromium SSE: push delivery, bounded reconnect, version reconciliation, hidden-tab cleanup and capability fallback");
  } finally {
    await browser.close(); for (const res of streams) res.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.closeAllConnections(); server.close(); process.exitCode = 1; });
