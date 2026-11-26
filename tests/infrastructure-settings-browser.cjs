"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const original = fs.readFileSync(path.join(root, "Eye/Dart Eye.html"), "utf8");
const fixture = `
window.fixtureCalls=[];
window.fixturePayload={revision:0,schedulerConfigured:true,settings:{schedule:{enabled:true,intervalMinutes:15,quietEnabled:true,quietStart:"01:00",quietEnd:"12:00"},calculator:{plan:"paid",computeCu:0.25,computeRateUsd:0.106,freeAllowanceCuHours:100,hostingBudgetUsd:25}}};
window.DartAdminAccess={can:()=>new URLSearchParams(location.search).get("denied")!=="true"};
window.DartSiteSettings={hydrate:async()=>{}};
window.DartSettingsTabs={refresh(){}};
window.DartAdminApi={request:async(url,options)=>{
  fixtureCalls.push({url,options});
  if(url.endsWith("/usage/database"))return {available:true,usedCuHours:110,storageBytes:54738944,periodEnd:"2026-12-01T00:00:00Z",asOf:"2026-11-26T00:00:00Z"};
  if(url.endsWith("/usage/hosting"))return {available:true,billedUsd:8,requests:17,deployments:[{available:true,complete:true,count:4}],periodStart:"2026-11-01T00:00:00Z",asOf:"2026-11-26T00:00:00Z"};
  if(url.endsWith("/process"))return {published:2,failed:0};
  if(options?.method==="PUT"){if(options.body.expectedRevision!==fixturePayload.revision)throw {status:409};fixturePayload={...fixturePayload,revision:fixturePayload.revision+1,settings:options.body.settings};}
  return structuredClone(fixturePayload);
}};
document.body.classList.remove("dart-admin-locked");
document.getElementById("dart-admin-auth").hidden=true;
document.querySelectorAll(".dashboard-section").forEach(node=>{node.hidden=node.id!=="settings";node.classList.toggle("active-section",node.id==="settings");});
for(const tab of document.querySelectorAll("[data-settings-tab]"))tab.addEventListener("click",()=>{
  document.getElementById("settings-content").dataset.activeSettingsTab=tab.dataset.settingsTab;
  document.querySelectorAll("[data-settings-tab]").forEach(node=>node.classList.toggle("is-active",node===tab));
});
`;
const html = original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace("</body>", '<script src="/__infrastructure-fixture.js"></script><script src="/Js/dart-dialog.js"></script><script src="/Eye/dart-settings-accordion.js"></script><script src="/Eye/dart-infrastructure.js"></script></body>');
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://fixture").pathname);
  if (pathname === "/Eye/Dart Eye.html") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
  if (pathname === "/__infrastructure-fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(fixture); return; }
  const target = path.resolve(root, "." + pathname);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" }[path.extname(target)] || "application/octet-stream");
    response.end(fs.readFileSync(target));
  } catch { response.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [370, 480, 767, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(origin + "/Eye/Dart%20Eye.html", { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => fixtureCalls.length), 0, "Settings opening must not poll providers");
      await page.locator("#settings-tab-database").click();
      await page.locator("#settings-database-card > .dart-settings-accordion-trigger").click();
      await page.locator("#infra-interval").waitFor({ state: "visible" });
      assert.equal(await page.locator("#infra-interval").inputValue(), "15");
      assert.equal(await page.locator("#infra-start").inputValue(), "01:00");
      assert.equal(await page.locator("#infra-end").inputValue(), "12:00");
      await page.locator("#infra-interval").fill("30");
      await page.locator("#infra-start").fill("02:00");
      await page.locator("#infra-end").fill("11:00");
      await page.locator("#infrastructure-save").click();
      await page.waitForFunction(() => document.getElementById("infrastructure-status").textContent.includes("تم حفظ"));
      assert.deepEqual(await page.evaluate(() => fixturePayload.settings.schedule), { enabled: true, intervalMinutes: 30, quietEnabled: true, quietStart: "02:00", quietEnd: "11:00" });
      await page.locator("#infrastructure-database-refresh").click();
      await page.waitForFunction(() => document.getElementById("infrastructure-database-usage").textContent.includes("110"));
      for (const category of ["database", "hosting"]) {
        await page.locator(`#settings-tab-${category}`).click();
        const card = page.locator(`#settings-${category}-card`);
        await card.waitFor({ state: "visible" });
        await card.locator(":scope > .dart-settings-accordion-trigger").click();
        const geometry = await card.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, scroll: node.scrollWidth, client: node.clientWidth,
            color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor,
            textColors: [...node.querySelectorAll("p,label,small,button,h2,dt,dd,output")].filter(child => child.getClientRects().length).map(child => getComputedStyle(child).color) };
        });
        assert(geometry.left >= -1 && geometry.right <= width + 1, `${category} card exceeds viewport at ${width}px`);
        assert(geometry.scroll <= geometry.client + 1, `${category} contents overflow at ${width}px`);
        assert.equal(geometry.color, "rgb(23, 23, 23)");
        assert.equal(geometry.background, "rgb(255, 253, 248)");
        assert(geometry.textColors.every(color => ["rgb(23, 23, 23)", "rgb(104, 21, 45)"].includes(color)), "Text must stay black or burgundy");
      }
      await page.locator("#infrastructure-hosting-refresh").click();
      await page.waitForFunction(() => document.getElementById("infrastructure-hosting-usage").textContent.includes("17"));
      assert.deepEqual(errors, []);
      await page.close();
    }
    const denied = await browser.newPage();
    await denied.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await denied.goto(origin + "/Eye/Dart%20Eye.html?denied=true", { waitUntil: "networkidle" });
    assert.equal(await denied.locator("#settings-tab-database").isVisible(), false);
    assert.equal(await denied.locator("#settings-tab-hosting").isVisible(), false);
    assert.equal(await denied.evaluate(() => fixtureCalls.length), 0);
    await denied.close();
    console.log("PASS infrastructure Settings at five widths: delivered markup/styles, black/burgundy text, editable intervals/windows, save, on-demand provider reads and denied access");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
