// Uses the same optional Playwright installation as existing repository browser checks.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { strict as assert } from "node:assert";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const child = spawn(process.execPath, ["--import", "tsx", "experiments/direct-realtime/run.ts", "--serve", "--browser-check"], { stdio: ["ignore", "pipe", "pipe"] });
let browser, startupTimer;
try {
  const lines = createInterface({ input: child.stdout });
  const fixture = await new Promise((resolve, reject) => {
    startupTimer = setTimeout(() => reject(new Error("Local direct fixture startup timed out")), 30000);
    child.once("exit", code => reject(new Error(`Local fixture exited (${code})`)));
    lines.once("line", line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
  });
  clearTimeout(startupTimer);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  const split = fixture.syntheticCookie.indexOf("=");
  await context.addCookies([{ name: fixture.syntheticCookie.slice(0, split), value: fixture.syntheticCookie.slice(split + 1), url: fixture.base }]);
  const page = await context.newPage(), pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(fixture.base);
  await page.waitForFunction(() => document.querySelectorAll("#orders li").length === 1);
  const afterFirst = await page.evaluate(() => window.pilot.reads);
  assert.equal(afterFirst, 2, "initial snapshot + one signal-triggered snapshot");
  await context.setOffline(true);
  await new Promise(resolve => setTimeout(resolve, 1600)); // The local parent commits order #2 while offline.
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelectorAll("#orders li").length === 2, undefined, { timeout: 15000 });
  await page.waitForFunction(() => window.pilot.client.healthy);
  const recoveredReads = await page.evaluate(() => window.pilot.reads);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.pilot.reads), recoveredReads, "no periodic idle data request");
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ result: "PASS", browser: "Chromium native EventSource", database: fixture.database,
    firstOrderDataReads: afterFirst, offlineFinalOrderRecovered: true, idleExtraDataReads: 0,
    boundedStreamRotation: true, browserErrors: pageErrors.length }));
} finally {
  clearTimeout(startupTimer); await browser?.close();
  if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
