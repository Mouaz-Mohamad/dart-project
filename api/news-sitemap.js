// Published, active News discovery; the public API excludes drafts and archived articles.
"use strict";
const links = require("../Js/dart-news-links.js");
const PUBLIC_ORIGIN = "https://www.dartofficial.com";
function build(rows) {
  const unique = new Map(rows.filter(row => links.validId(row.newsId)).map(row => [row.newsId, row]));
  const urls = [...unique.values()].map(row => `<url><loc>${PUBLIC_ORIGIN}${links.path(row)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
async function handler(_request, response) {
  try {
    let offset = 0;
    let pages = 0;
    const rows = [], deadline = Date.now() + 8000;
    do {
      if (++pages > 50) throw new Error("News sitemap request budget");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("News sitemap deadline");
      const upstream = await fetch(`https://dart-api-dusky.vercel.app/api/v1/news?limit=100&offset=${offset}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(remaining) });
      if (!upstream.ok) throw new Error("News unavailable");
      const payload = await upstream.json();
      if (!Array.isArray(payload.news)) throw new Error("Invalid News response");
      rows.push(...payload.news);
      if (rows.length > 50000) throw new Error("News sitemap capacity");
      const next = payload.nextOffset;
      if (next === null) break;
      if (!Number.isInteger(next) || next <= offset || next > 100000) throw new Error("Invalid News pagination");
      offset = next;
    } while (true);
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    return response.status(200).send(build(rows));
  } catch {
    require("../server/public-route-guard.cjs").logPublicFailure("news-sitemap", response);
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).send("News sitemap is temporarily unavailable.");
  }
}
module.exports = require("../server/public-route-guard.cjs").createGuard()(handler);
module.exports._test = { build };
