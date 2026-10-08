// Chromium regression: real storefront pages and the static Dart Eye News markup/modules.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const newsPage = require("../api/news-page.js"), newsSitemap = require("../api/news-sitemap.js");
const links = require("../Js/dart-news-links.js");
const originalFetch = global.fetch;
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
  if (pathname.startsWith("/news/") || pathname === "/news-sitemap.xml") {
    req.query = { id: pathname.split("/")[2], slug: pathname.split("/")[3] };
    res.status = code => { res.statusCode = code; return res; };
    res.send = body => res.end(body);
    res.redirect = (code, location) => { res.statusCode = code; res.setHeader("Location", location); res.end(); };
    return pathname === "/news-sitemap.xml" ? newsSitemap(req, res) : newsPage(req, res);
  }
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
  global.fetch = (url, options) => originalFetch(String(url).replace("https://dart-api-dusky.vercel.app", origin), options);
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
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const size = await page.locator(".dart-news-card img").first().evaluate(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; });
        assert.ok(Math.abs(size.width - width * .7) < 1, `card image width must be 70vw at ${width}px`);
        assert.ok(Math.abs(size.width / size.height - .75) < .001, "cover must stay 3:4");
        const cardWidth = await page.locator(".dart-news-card").first().evaluate(node => node.getBoundingClientRect().width);
        assert.ok(Math.abs(cardWidth - width * .7) < 1);
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
      if (process.env.DART_NEWS_SCREENSHOT_DIR && route === "/") {
        fs.mkdirSync(process.env.DART_NEWS_SCREENSHOT_DIR, { recursive: true });
        await page.locator(".dart-news-card").first().screenshot({ path: path.join(process.env.DART_NEWS_SCREENSHOT_DIR, "news-card-phone.png") });
      }
      await page.locator("[data-news-next]").click();
      assert.ok(await page.locator("[data-news-track]").evaluate(node => node.scrollLeft) > 100);
      await page.locator("[data-news-prev]").click();
      await page.locator("[data-news-read]").first().click();
      await page.waitForFunction(() => document.querySelector("[data-news-dialog-body]").textContent.includes("Paragraph two"));
      assert.equal(await page.evaluate(() => window.newsInjected), undefined, "News text must not become HTML");
      await page.locator("#dart-news-dialog").click({ position: { x: 10, y: 20 } });
      assert.equal(await page.locator("#dart-news-dialog").evaluate(node => node.open), true, "reader padding must not count as a backdrop click");
      assert.equal(await page.locator("[data-news-dialog-date]").textContent(), "8 Oct 2026");
      assert.equal(new URL(page.url()).pathname, links.path(records[0]));
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await page.locator("#dart-news-dialog").boundingBox();
        assert.ok(Math.abs(box.width - width * .9) < 1);
        assert.ok(Math.abs(box.height - 844 * .9) < 1);
        assert.ok(box.x > 0 && box.y > 0, "reader must have screen margins on phones and desktop");
        assert.equal(await page.locator("#dart-news-dialog").evaluate(node => node.scrollWidth > node.clientWidth), false);
        if (process.env.DART_NEWS_SCREENSHOT_DIR && route === "/" && width !== 768) await page.screenshot({ path: path.join(process.env.DART_NEWS_SCREENSHOT_DIR, `news-reader-${width}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("dart-news-dialog").open && !history.state?.dartNewsStep);
      if (route === "/") {
        const nativeClick = await page.locator("[data-news-read]").first().evaluate(node => {
          let allowed = false;
          const observe = event => { allowed = !event.defaultPrevented; event.preventDefault(); };
          window.addEventListener("click", observe, { once: true });
          node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
          return allowed;
        });
        assert.equal(nativeClick, true, "Ctrl-click must retain the browser's native anchor behavior");
        assert.equal(new URL(page.url()).pathname, route);
      }
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.locator("[data-news-read]").first().evaluate(node => node === document.activeElement), true);
      await page.locator("[data-news-read]").first().click();
      const scrollBefore = await page.evaluate(() => scrollY);
      await page.goBack();
      await page.waitForFunction(() => !document.getElementById("dart-news-dialog").open);
      assert.equal(new URL(page.url()).pathname, route, "native Back must close News instead of leaving the site");
      await page.waitForFunction(expected => Math.abs(scrollY - expected) < 3, scrollBefore);
      await page.goForward();
      await page.waitForFunction(() => document.getElementById("dart-news-dialog").open && document.querySelector("[data-news-dialog-body]").textContent.includes("Paragraph two"));
      await page.locator(".dart-news-dialog-footer button").click();
      await page.waitForFunction(() => !document.getElementById("dart-news-dialog").open && !history.state?.dartNewsStep);
      assert.equal(new URL(page.url()).pathname, route, "Done must consume exactly the News history step");
      await page.locator("[data-news-read]").first().click();
      await page.mouse.click(4, 4);
      await page.waitForFunction(() => !document.getElementById("dart-news-dialog").open && !history.state?.dartNewsStep);
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
    const historyLength = await page.evaluate(() => history.length);
    failDetail = false; await page.locator("[data-news-dialog-retry]").click(); await page.waitForFunction(() => document.querySelector("[data-news-dialog-body]").textContent.includes("Paragraph two"));
    assert.equal(await page.evaluate(() => history.length), historyLength, "retry must not add another modal history step");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !history.state?.dartNewsStep);
    detailDelay = 120; await page.locator("[data-news-read]").first().click(); await page.locator(".dart-news-close").click();
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
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await noJs.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const articlePage = await noJs.newPage();
    const direct = await articlePage.goto(origin + links.path(records[0]));
    assert.equal(direct.status(), 200); assert.equal(await articlePage.locator("h1").textContent(), records[0].title);
    assert.ok((await articlePage.locator(".news-page-body").textContent()).includes("Paragraph two"));
    assert.equal(await articlePage.locator('link[rel="canonical"]').getAttribute("href"), "https://dart-project-psi.vercel.app" + links.path(records[0]));
    records[0].isArchived = true;
    const archived = await articlePage.reload(); assert.equal(archived.status(), 404); assert.equal(await articlePage.locator(".news-page-body").count(), 0);
    assert.ok(!(await (await fetch(origin + "/news-sitemap.xml")).text()).includes(links.path(records[0])));
    records[0].isArchived = false; await noJs.close();

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
    assert.equal(new URL(admin.url()).pathname, "/admin-fixture", "private preview must never use a public article URL");
    await admin.goBack(); await admin.waitForFunction(() => !document.getElementById("dart-news-dialog").open);
    await admin.goForward(); await admin.waitForFunction(() => document.getElementById("dart-news-dialog").open && document.querySelector("[data-news-dialog-body]").textContent.includes("Complete plain text"));
    await admin.locator(".dart-news-dialog-footer button").click(); await admin.waitForFunction(() => !history.state?.dartNewsStep);
    await admin.locator('[data-news-action="preview"]').first().click();
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
    await adminContext.close(); console.log("News browser regression passed: 70vw/3:4 cards, 90vw/90dvh reader, Back/Forward/Done/Escape/backdrop, modifier links, SSR without JS, archive/sitemap visibility, autoplay, retries, CRUD and Staff security.");
  } finally { global.fetch = originalFetch; await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
