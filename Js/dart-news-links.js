// Shared public News URL and presentation rules; no durable article state.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DartNewsLinks = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const validId = value => /^[A-Za-z0-9_-]{1,120}$/.test(String(value || ""));
  function slug(title) {
    return String(title || "news").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "news";
  }
  function path(record) {
    return validId(record?.newsId) ? `/news/${record.newsId}/${encodeURIComponent(slug(record.title))}` : "";
  }
  function date(value) {
    const parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  function dateLabel(value) {
    const iso = date(value);
    return iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(new Date(iso)) : "";
  }
  const readingTime = body => `${Math.max(1, Math.ceil(String(body || "").trim().split(/\s+/).filter(Boolean).length / 200))} min read`;
  return Object.freeze({ validId, slug, path, date, dateLabel, readingTime });
});
