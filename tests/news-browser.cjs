// Chromium regression: real storefront pages and the static Dart Eye News markup/modules.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "Eye/Dart Eye.html"), "utf8");
const adminMarkup = dashboard.match(/<!-- BEGIN News management:[\s\S]*?<!-- END News management\. -->/)[0];
const readerMarkup = dashboard.match(/<!-- BEGIN News details:[\s\S]*?<!-- END News details\. -->/)[0];
const adminHtml = `<!doctype html><html><head><link rel="stylesheet" href="/Eye/dart.css"><link rel="stylesheet" href="/Eye/dart-news.css"></head><body>
<nav><ul><li hidden><a href="#" data-target="news">News</a></li></ul></nav><main>${adminMarkup}${readerMarkup}</main>
<script src="/fixture-admin.js"></script><script src="/Js/dart-news.js"></script></body></html>`;
const fixtureScript = `window.fixturePermissions=['news.read','news.manage'];window.fixtureCalls=[];
window.DartAdminAccess={can:p=>window.fixturePermissions.includes(p)};window.DartAdminHydration={ready:true};
window.DartDialog={confirm:async()=>true};window.DartAdminApi={request:async(path,options={})=>{
window.fixtureCalls.push({path,options});const response=await fetch(path,{method:options.method||'GET',headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});
const result=await response.json();if(!response.ok){const error=new Error('private diagnostic must not leak');error.status=response.status;throw error;}return result;}};
document.querySelector('[data-target="news"]').addEventListener('click',e=>{e.preventDefault();document.getElementById('news').classList.add('active-section');});`;
let mode = "ready", failSave = false, failList = false, failDetail = false, failAsset = false, assetCalls = 0, detailDelay = 0, saveDelay = 0;
const assetIds = [];
let records = [];
function seed() {
  records = Array.from({ length: 8 }, (_, i) => ({ newsId: `NEWS-${i}`, title: `Story ${i}`,
    excerpt: "Short News preview, with two lines of copy.", body: `Paragraph one ${i}.\n\nParagraph two. <script>window.newsInjected=true</script>`,
    imageUrl: `/api/v1/catalog/assets/NEWSIMG-cover${i}?v=test`, coverAssetId: `NEWSIMG-UPLOADED-cover${i}`,
    status: "published", sortOrder: null, isArchived: false, version: 1, publishedAt: "2026-10-08T08:00:00Z", updatedAt: "2026-10-08T08:00:00Z" }));
}
seed();
function json(res, status, value) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"), pathname = decodeURIComponent(url.pathname);
  if (pathname === "/admin-fixture") { res.setHeader("Content-Type", "text/html"); return res.end(adminHtml); }
  if (pathname === "/fixture-admin.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(fixtureScript); }
  if (pathname.startsWith("/api/v1/catalog/assets/")) { res.setHeader("Content-Type", "image/jpeg"); return res.end(fs.readFileSync(path.join(root, "Photos/products/1.jpg"))); }
  if (pathname === "/api/v1/news") {
    if (mode === "error") return json(res, 503, { error: { message: "private database secret" } });
    const news = mode === "empty" ? [] : records.filter(row => row.status === "published" && !row.isArchived);
    return json(res, 200, { news, total: news.length, nextOffset: null });
  }
  if (pathname.startsWith("/api/v1/news/")) {
    const row = records.find(row => row.newsId === pathname.split("/").pop() && row.status === "published" && !row.isArchived);
    const respond = () => failDetail ? json(res, 503, { error: { message: "private body" } }) : json(res, row ? 200 : 404, row ? { news: row } : {});
    return detailDelay ? setTimeout(respond, detailDelay) : respond();
  }
  if (pathname.startsWith("/api/v1/admin/news")) {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (pathname === "/api/v1/admin/news/assets") { assetCalls++; assetIds.push(body.assetId); return json(res, failAsset ? 503 : 200, { id: body.assetId }); }
    if (pathname === "/api/v1/admin/news" && req.method === "GET") {
      if (failList) return json(res, 503, {});
      const q = url.searchParams.get("q") || "", archive = url.searchParams.get("archive") || "active", status = url.searchParams.get("status") || "all";
      const news = records.filter(row => (status === "all" || row.status === status) && (archive === "all" || row.isArchived === (archive === "archived")) && row.title.toLowerCase().includes(q.toLowerCase()));
      return json(res, 200, { news, total: news.length, nextOffset: null });
    }
    const id = pathname.split("/")[5], row = records.find(row => row.newsId === id);
    if (req.method === "GET") return json(res, row ? 200 : 404, { news: row });
    if (pathname.endsWith("/state")) { row.isArchived = body.action === "archive"; row.version++; return json(res, 200, { news: row }); }
    if (failSave) return json(res, 503, {});
    if (row && body.expectedVersion !== row.version) return json(res, 409, {});
    const result = { ...(row || {}), ...body, newsId: body.newsId || id, imageUrl: "/api/v1/catalog/assets/NEWSIMG-new?v=test", isArchived: false, version: (row?.version || 0) + 1 };
    if (row) Object.assign(row, result); else records.push(result);
    return saveDelay ? setTimeout(() => json(res, 200, { news: result }), saveDelay) : json(res, 200, { news: result });
  }
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/v1/catalog") return json(res, 200, { version: 1, models: [], stock: {} });
    if (pathname === "/api/v1/site-settings") return json(res, 200, { version: 1, settings: {} });
    if (pathname === "/api/v1/sets") return json(res, 200, { sets: [] });
    if (pathname.endsWith("/version")) return json(res, 200, { version: 1 });
    return json(res, 200, { reviews: [], rows: [] });
  }
  const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
  if (!file.startsWith(root + path.sep)) return json(res, 403, {});
  try { res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" })[path.extname(file)] || "application/octet-stream"); res.end(fs.readFileSync(file)); }
  catch { res.statusCode = 404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
    await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    for (const route of ["/", "/about.html"]) {
      await page.goto(origin + route); await page.locator("#dart-news").scrollIntoViewIfNeeded();
      await page.locator(".dart-news-card").first().waitFor();
      assert.equal(await page.locator(".dart-news-card").count(), 8);
      assert.equal(await page.evaluate(route => { const news = document.getElementById("dart-news"); return route === "/" ? Array.from(news.parentElement.querySelectorAll(":scope > section")).filter(node => !node.hidden && node.compareDocumentPosition(news) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1)?.matches(".products-section") : news.previousElementSibling.id === "story"; }, route), true);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const size = await page.locator(".dart-news-card img").first().evaluate(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; });
        assert.deepEqual(size, { width: 187.5, height: 250 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      // Mouse drag moves the same track used by native touch scrolling.
      await page.locator("[data-news-track]").scrollIntoViewIfNeeded();
      const trackBox = await page.locator("[data-news-track]").boundingBox();
      await page.mouse.move(trackBox.x + 290, trackBox.y + 50); await page.mouse.down();
      await page.mouse.move(trackBox.x + 70, trackBox.y + 50, { steps: 6 }); await page.mouse.up();
      assert.ok(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft) > 100);
      await page.locator("[data-news-track]").evaluate(node => node.scrollLeft = 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("[data-news-next]").click();
      assert.ok(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft) > 100);
      await page.locator("[data-news-prev]").click();
      await page.locator("[data-news-read]").first().click();
      await page.waitForFunction(() => document.querySelector("[data-news-dialog-body]").textContent.includes("Paragraph two"));
      assert.equal(await page.evaluate(() => window.newsInjected), undefined, "News text must not become HTML");
      assert.equal(await page.locator("#dart-news-dialog").evaluate(node => node.getBoundingClientRect().width), 390);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#dart-news-dialog").evaluate(node => node.open), false);
      assert.equal(await page.locator("[data-news-read]").first().evaluate(node => node === document.activeElement), true);
    }
    mode = "error"; await page.reload(); await page.locator("#dart-news").scrollIntoViewIfNeeded();
    await page.locator("[data-news-retry]").waitFor(); assert.ok(!(await page.locator("[data-news-status]").textContent()).includes("private"));
    mode = "ready"; await page.locator("[data-news-retry]").click(); await page.locator(".dart-news-card").first().waitFor();
    mode = "empty"; await page.reload(); await page.evaluate(() => document.getElementById("dart-news").scrollIntoView());
    await page.waitForFunction(() => document.getElementById("dart-news").hidden); mode = "ready";
    // Closing a slow request must never reopen a modal or render a late response.
    await page.reload(); await page.locator("#dart-news").scrollIntoViewIfNeeded(); await page.locator(".dart-news-card").first().waitFor();
    failDetail = true; await page.locator("[data-news-read]").first().click(); await page.locator("[data-news-dialog-retry]").waitFor();
    assert.ok(!(await page.locator("[data-news-dialog-status]").textContent()).includes("private"));
    failDetail = false; await page.locator("[data-news-dialog-retry]").click(); await page.waitForFunction(() => document.querySelector("[data-news-dialog-body]").textContent.includes("Paragraph two")); await page.keyboard.press("Escape");
    detailDelay = 120; await page.locator("[data-news-read]").first().click(); await page.locator("[data-news-dialog-close]").click();
    await page.waitForTimeout(180); assert.equal(await page.locator("#dart-news-dialog").evaluate(node => node.open), false); detailDelay = 0;
    // Auto every five seconds, pause, no movement while interacting or with reduced motion.
    await page.clock.install(); await page.emulateMedia({ reducedMotion: "no-preference" }); await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement.blur());
    await page.clock.fastForward(5300); await page.clock.fastForward(500); await page.waitForTimeout(350);
    assert.ok(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft) > 100);
    await page.locator("[data-news-auto]").click(); await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement.blur());
    const paused = await page.locator("[data-news-track]").evaluate(node => node.scrollLeft);
    await page.clock.fastForward(11000); assert.equal(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft), paused);
    await page.locator("[data-news-auto]").click(); await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement.blur());
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(350);
    const reduced = await page.locator("[data-news-track]").evaluate(node => node.scrollLeft);
    await page.clock.fastForward(11000); assert.equal(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft), reduced);
    await context.close();

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await adminContext.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const admin = await adminContext.newPage(); admin.on("pageerror", error => errors.push(error.message));
    await admin.goto(origin + "/admin-fixture");
    await admin.locator('[data-target="news"]').click(); await admin.locator(".dart-news-row").first().waitFor();
    assert.equal(await admin.locator("#news > .first").count(), 1); assert.equal(await admin.locator("#news > .second").count(), 1);
    await admin.locator("#news-add").click();
    await admin.locator('#news-form [name="title"]').fill("New draft"); await admin.locator('#news-form [name="body"]').fill("Complete plain text.");
    await admin.locator('#news-form [name="cover"]').setInputFiles(path.join(root, "Photos/products/1.jpg"));
    failAsset = true; await admin.locator("#news-save").click(); await admin.waitForFunction(() => document.getElementById("news-form-message").classList.contains("is-error"));
    assert.equal(assetCalls, 1); failAsset = false;
    failSave = true; await admin.locator("#news-save").click(); await admin.waitForFunction(() => document.getElementById("news-form-message").classList.contains("is-error"));
    assert.equal(assetCalls, 2); assert.equal(assetIds[0], assetIds[1], "A timed-out image upload reuses the same asset ID"); assert.equal(await admin.locator("#news-editor").evaluate(node => node.open), true);
    assert.ok(!(await admin.locator("#news-form-message").textContent()).includes("private"));
    failSave = false; await admin.locator("#news-save").click(); await admin.waitForFunction(() => !document.getElementById("news-editor").open);
    assert.equal(assetCalls, 2, "A saved image is reused when the article save is retried");
    await admin.locator("#news-search").fill("New draft"); await admin.waitForFunction(() => document.querySelectorAll(".dart-news-row").length === 1);
    let row = admin.locator(".dart-news-row").first(); await row.locator('[data-news-action="edit"]').click();
    await admin.locator('#news-form [name="status"]').selectOption("published"); await admin.locator('#news-form [name="sortOrder"]').fill("0");
    await admin.locator('#news-form [name="cover"]').setInputFiles(path.join(root, "Photos/products/1.jpg"));
    await admin.locator("#news-save").click(); await admin.waitForFunction(() => !document.getElementById("news-editor").open);
    assert.equal(assetCalls, 3, "Editing an existing uploaded cover must upload the replacement image");
    row = admin.locator(".dart-news-row").first(); await row.locator("[data-news-select]").check(); await admin.locator("#news-delete").click();
    await admin.waitForFunction(() => document.querySelectorAll(".dart-news-row").length === 0);
    await admin.locator("#news-archive").selectOption("archived"); await admin.locator(".dart-news-row").first().waitFor();
    await admin.locator('[data-news-action="state"]').first().click(); await admin.waitForFunction(() => document.querySelectorAll(".dart-news-row").length === 0);
    await admin.locator("#news-archive").selectOption("active"); await admin.locator(".dart-news-row").first().waitFor();
    // A stale edit leaves the editor open with a dedicated reload action.
    row = admin.locator(".dart-news-row").first(); await row.locator('[data-news-action="edit"]').click(); records.find(row => row.title === "New draft").version++;
    await admin.locator("#news-save").click(); await admin.locator("#news-reload-record").waitFor();
    await admin.locator("#news-reload-record").click(); await admin.locator("#news-editor [data-news-editor-close]").first().click();
    failList = true; await admin.locator("#news-status").selectOption("published"); await admin.locator("#news-retry").waitFor();
    failList = false; await admin.locator("#news-retry").click(); await admin.locator(".dart-news-row").first().waitFor();
    await admin.evaluate(() => { window.fixturePermissions = ['news.read']; window.dispatchEvent(new CustomEvent('dart:admin-authenticated')); });
    await admin.waitForFunction(() => document.getElementById("news-add").hidden); assert.equal(await admin.locator("#news-add").isHidden(), true); await admin.waitForFunction(() => document.querySelector('[data-news-action="edit"]').hidden); assert.equal(await admin.locator('[data-news-action="edit"]').first().isHidden(), true);
    await admin.locator('[data-news-action="preview"]').first().click(); assert.equal(await admin.locator("#dart-news-dialog").evaluate(node => node.open), true);
    await admin.evaluate(() => { window.fixturePermissions = []; document.body.classList.add('dart-admin-locked'); });
    await admin.waitForFunction(() => document.getElementById("news").hidden);
    assert.equal(await admin.locator("[data-news-dialog-body]").textContent(), "");
    assert.equal(await admin.locator(".dart-news-row").count(), 0);
    // An in-flight save cannot rehydrate private rows after logout.
    await admin.reload(); await admin.locator('[data-target="news"]').click(); await admin.locator(".dart-news-row").first().waitFor();
    await admin.locator('[data-news-action="edit"]').first().click(); saveDelay = 300; await admin.locator("#news-save").click();
    await admin.waitForFunction(() => document.getElementById("news-save").disabled);
    await admin.evaluate(() => document.body.classList.add('dart-admin-locked')); await admin.waitForTimeout(500);
    assert.equal(await admin.locator(".dart-news-row").count(), 0); assert.equal(await admin.locator("#news-editor").evaluate(node => node.open), false);
    assert.equal(await admin.locator('#news-form [name="body"]').inputValue(), "");
    assert.deepEqual(errors, []);
    await adminContext.close(); console.log("News browser regression passed: sizes, placement, modal, text safety, autoplay/pause, retries, CRUD, archive/restore, permissions and stale edits.");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
