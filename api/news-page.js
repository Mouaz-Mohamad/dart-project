// Render published News from the existing authoritative public API, including without JS.
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const links = require("../Js/dart-news-links.js");
const PUBLIC_ORIGIN = "https://dart-project-psi.vercel.app";
const API_ORIGIN = "https://dart-api-dusky.vercel.app";
const template = fs.readFileSync(path.join(__dirname, "news-template.html"), "utf8");
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeJson = value => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const imageUrl = article => /^\/api\/v1\/catalog\/assets\/[A-Za-z0-9_-]+(?:\?v=[A-Za-z0-9_-]+)?$/.test(article.imageUrl || "")
  ? `${PUBLIC_ORIGIN}${article.imageUrl}` : `${PUBLIC_ORIGIN}/Photos/logo-1to1.png`;
function render(article, status = 200) {
  const available = status === 200, title = article?.title || (status === 404 ? "News not found" : "News temporarily unavailable");
  const description = available ? String(article.excerpt || article.body || "").slice(0, 280) : "Please return to Dart News or try again later.";
  const canonical = `${PUBLIC_ORIGIN}${available ? links.path(article) : "/#dart-news"}`;
  const image = imageUrl(article || {}), published = links.date(article?.publishedAt);
  const schema = available ? { "@context": "https://schema.org", "@type": "NewsArticle", "@id": `${canonical}#article`,
    url: canonical, mainEntityOfPage: { "@type": "WebPage", "@id": canonical }, headline: title,
    description, image: [image], articleBody: article.body,
    ...(published ? { datePublished: published } : {}),
    author: { "@type": "Organization", name: "Dart", url: `${PUBLIC_ORIGIN}/about.html` },
    publisher: { "@type": "Organization", name: "Dart | for you", url: `${PUBLIC_ORIGIN}/`,
      logo: { "@type": "ImageObject", url: `${PUBLIC_ORIGIN}/Photos/1080px.png` } } } : {};
  const data = safeJson(schema);
  const articleHtml = available ? `<nav class="news-page-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/#dart-news">Dart News</a><span aria-hidden="true">/</span><span dir="auto">${escape(title)}</span></nav>
    <article><div class="news-page-kicker">Dart News</div><h1 dir="auto">${escape(title)}</h1>
    <div class="news-page-meta"><a href="/about.html" rel="author">By Dart</a>${published ? `<time datetime="${escape(published)}">${escape(links.dateLabel(published))}</time>` : ""}<span>${links.readingTime(article.body)}</span></div>
    <p class="news-page-lead" dir="auto">${escape(description)}</p><div class="news-page-content"><img class="news-page-cover" width="600" height="800" src="${escape(image)}" alt="${escape(title)}" decoding="async">
    <div class="news-page-body">${String(article.body).split(/\n\s*\n/).map(paragraph => `<p dir="auto">${escape(paragraph)}</p>`).join("")}</div></div></article>`
    : `<h1>${escape(title)}</h1><p>${escape(description)}</p>`;
  const values = { title: escape(title), description: escape(description), robots: available ? "index, follow, max-image-preview:large" : "noindex, follow",
    canonical: escape(canonical), image: escape(image), schema: data,
    publishedMeta: available && published ? `<meta property="article:published_time" content="${escape(published)}">` : "",
    article: `${articleHtml}<a class="news-page-done" href="/#dart-news">Done</a>` };
  return { html: template.replace(/\{\{([A-Za-z]+)\}\}/g, (_, key) => values[key] || ""), data };
}
function send(response, article, status) {
  const result = render(article, status);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  // No stale caches: archived or unpublished content must disappear on the next request.
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Robots-Tag", status === 200 ? "index, follow, max-image-preview:large" : "noindex, follow");
  const hash = crypto.createHash("sha256").update(result.data).digest("base64");
  response.setHeader("Content-Security-Policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'sha256-${hash}'; script-src-attr 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; upgrade-insecure-requests`);
  return response.status(status).send(result.html);
}
async function handler(request, response) {
  const id = request.query?.id;
  if (typeof id !== "string" || !links.validId(id)) return send(response, null, 404);
  try {
    const upstream = await fetch(`${API_ORIGIN}/api/v1/news/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (upstream.status === 404) return send(response, null, 404);
    if (!upstream.ok) return send(response, null, 503);
    const { news } = await upstream.json();
    if (news?.newsId !== id || typeof news.title !== "string" || typeof news.body !== "string") return send(response, null, 503);
    const slug = typeof request.query?.slug === "string" ? request.query.slug : "";
    if (slug !== links.slug(news.title)) {
      response.setHeader("Cache-Control", "no-store");
      return response.redirect(308, `${PUBLIC_ORIGIN}${links.path(news)}`);
    }
    return send(response, news, 200);
  } catch { return send(response, null, 503); }
}
module.exports = handler;
module.exports._test = { render, escape, safeJson, imageUrl };
