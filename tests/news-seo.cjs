// Exercise actual News SSR/sitemap handlers; published reads only, no browser JS required.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), crypto = require("node:crypto");
const page = require("../api/news-page.js"), sitemap = require("../api/news-sitemap.js");
const links = require("../Js/dart-news-links.js");
const article = { newsId: "NEWS-stable--ID", title: 'إطلاق Dart <new> & "news"',
  excerpt: "First details & more.", body: "Complete news.\n\n<script>secret()</script> {{title}} $&\nFinal paragraph.",
  imageUrl: "/api/v1/catalog/assets/NEWSIMG-cover?v=abc123", publishedAt: "2026-10-08T08:00:00Z" };
const origin = "https://dart-project-psi.vercel.app";
function response() {
  return { code: null, headers: {}, body: "", setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; },
    redirect(code, location) { this.code = code; this.headers.Location = location; return this; } };
}
const rendered = page._test.render(article).html;
assert.ok(rendered.includes(`${origin}${links.path(article)}`));
assert.ok(rendered.includes("Complete news."));
assert.ok(rendered.includes("Final paragraph."));
assert.ok(rendered.includes("&lt;script&gt;secret()&lt;/script&gt;"));
assert.ok(rendered.includes("{{title}} $&"), "template replacement must not reprocess article tokens");
assert.ok(!rendered.includes("<script>secret()"));
assert.ok(!/\son(?:load|click|error)=/i.test(rendered));
assert.ok(rendered.includes("8 Oct 2026"));
assert.ok(rendered.includes('width="600" height="800"'));
assert.ok(rendered.includes('property="og:type" content="article"'));
const data = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
const graph = JSON.parse(data);
assert.equal(graph["@type"], "NewsArticle");
assert.equal(graph.headline, article.title);
assert.equal(graph.articleBody, article.body);
assert.equal(graph.datePublished, article.publishedAt.replace("Z", ".000Z"));
assert.equal(graph.author["@type"], "Organization");
assert.equal(graph.image[0], `${origin}${article.imageUrl}`);
assert.ok(!graph.dateModified, "do not claim publication time is last modification time");
assert.equal(links.path({ newsId: "../private", title: "Injection" }), "");
assert.equal(links.dateLabel("invalid"), "");
assert.equal(links.slug("عنوان قديم"), "عنوان-قديم");
assert.match(links.path(article), /^\/news\/NEWS-stable--ID\//, "opaque ID retains exact case and delimiters");
assert.ok(sitemap._test.build([article, article]).includes(links.path(article)));
assert.equal((sitemap._test.build([article, article]).match(/<url>/g) || []).length, 1);
const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
assert.equal(config.functions["api/news-page.js"].includeFiles, "api/news-template.html");
assert.ok(config.rewrites.findIndex(row => row.source === "/news/:id/:slug") < config.rewrites.findIndex(row => row.source === "/api/:path*"));
assert.ok(fs.readFileSync("sitemap.xml", "utf8").includes("/news-sitemap.xml"));
for (const file of ["index.html", "about.html"]) {
  const html = fs.readFileSync(file, "utf8");
  assert.ok(html.includes('<a data-news-read>'), `${file} cards must be real crawlable anchors`);
  assert.ok(html.includes('class="section-title-">Dart News'));
}
const originalFetch = global.fetch;
(async () => {
  try {
    let calls = [];
    global.fetch = async url => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ news: article }) }; };
    let res = response();
    await page({ query: { id: article.newsId, slug: links.slug(article.title) } }, res);
    assert.equal(res.code, 200); assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(res.body.includes('content="index, follow'));
    const hash = crypto.createHash("sha256").update(data).digest("base64");
    assert.ok(res.headers["Content-Security-Policy"].includes(`'sha256-${hash}'`));
    assert.ok(!res.headers["Content-Security-Policy"].includes("unsafe-inline"));
    assert.ok(calls.every(url => url.startsWith("https://dart-api-dusky.vercel.app/api/v1/news/")));
    res = response(); await page({ query: { id: article.newsId, slug: "old-title" } }, res);
    assert.equal(res.code, 308); assert.equal(res.headers.Location, `${origin}${links.path(article)}`);
    calls = []; res = response(); await page({ query: { id: "../admin" } }, res);
    assert.equal(res.code, 404); assert.equal(calls.length, 0);
    res = response(); await page({ query: { id: [article.newsId] } }, res); assert.equal(res.code, 404);
    global.fetch = async () => ({ ok: false, status: 404 });
    res = response(); await page({ query: { id: article.newsId, slug: "old" } }, res);
    assert.equal(res.code, 404); assert.ok(res.body.includes("noindex")); assert.ok(!res.body.includes(article.body));
    global.fetch = async () => { throw new Error("private upstream diagnostic"); };
    res = response(); await page({ query: { id: article.newsId } }, res);
    assert.equal(res.code, 503); assert.ok(!res.body.includes("private upstream"));
    global.fetch = async () => ({ ok: true, json: async () => ({ news: { ...article, newsId: "OTHER" } }) });
    res = response(); await page({ query: { id: article.newsId } }, res); assert.equal(res.code, 503);
    calls = [];
    global.fetch = async url => { calls.push(url); return { ok: true, json: async () => url.includes("offset=0") ?
      { news: [article], nextOffset: 100 } : { news: [{ ...article, newsId: "NEWS-second" }], nextOffset: null } }; };
    res = response(); await sitemap({}, res);
    assert.equal(res.code, 200); assert.equal(calls.length, 2); assert.ok(calls[1].includes("offset=100"));
    assert.equal((res.body.match(/<url>/g) || []).length, 2);
    global.fetch = async () => ({ ok: true, json: async () => ({ news: [], nextOffset: null }) });
    res = response(); await sitemap({}, res); assert.equal(res.code, 200); assert.ok(!res.body.includes("<url>"));
    global.fetch = async () => ({ ok: true, json: async () => ({ news: [article], nextOffset: 0 }) });
    res = response(); await sitemap({}, res); assert.equal(res.code, 503, "invalid pagination must not publish a partial sitemap");
    global.fetch = async () => ({ ok: false, status: 503 });
    res = response(); await sitemap({}, res); assert.equal(res.code, 503);
    console.log("PASS News SSR: complete safe HTML, canonical/old links, NewsArticle/social metadata, 404/503 noindex, CSP, sitemap pagination/empty/retry safety");
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
