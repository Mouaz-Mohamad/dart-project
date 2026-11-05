"use strict";
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs");
const { chromium } = require("playwright");
const streams = new Set(); let supported = true, opened = 0, probes = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/api/v1/health/live") {
    probes++; res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ capabilities: supported ? ["direct-updates-v1"] : [] }));
  }
  if (req.url === "/api/v1/catalog/changes") {
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
    await page.close(); supported = false;
    const fallback = await browser.newPage(); await fallback.goto(origin);
    await fallback.waitForLoadState("networkidle");
    assert.equal(await fallback.evaluate(() => window.DartChanges.active), false);
    assert.equal(opened, 3, "an older/disabled API never opens an incompatible event source");
    assert.deepEqual(errors, []);
    console.log("PASS native Chromium SSE: push delivery, bounded reconnect, version reconciliation, hidden-tab cleanup and capability fallback");
  } finally {
    await browser.close(); for (const res of streams) res.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.closeAllConnections(); server.close(); process.exitCode = 1; });
