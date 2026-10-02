// DART CODE GUIDE | scripts/lighthouse-summary.mjs
// الغرض: تلخيص Lighthouse Production scores وأهم الـaudits الناقصة في GitHub Actions.
import fs from "node:fs";

const reports = process.argv.slice(2);
if (!reports.length) {
  console.error("Usage: node scripts/lighthouse-summary.mjs <report.json> [...]");
  process.exit(1);
}

const percent = (value) => Math.round(Number(value ?? 0) * 100);
const interestingDetailAudits = new Set([
  "aria-prohibited-attr",
  "color-contrast",
  "heading-order",
  "list",
  "image-aspect-ratio",
  "errors-in-console",
  "image-delivery-insight",
  "render-blocking-insight",
  "unused-css-rules",
  "unused-javascript",
  "unminified-css",
  "unminified-javascript",
  "cache-insight",
  "mainthread-work-breakdown",
]);

function compact(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function collectDetailLines(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 4) return [];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) lines.push(...collectDetailLines(item, depth + 1, seen));
    return lines;
  }

  const node = value.node && typeof value.node === "object" ? value.node : null;
  const selector = node?.selector || value.selector;
  const snippet = node?.snippet || value.snippet;
  const failure = node?.explanation || node?.failureSummary || value.failureSummary;
  const url = value.url || value.sourceLocation?.url;
  const label = value.label || value.name || value.groupLabel || value.subItems?.type;
  const message = value.description || value.message || value.summary;
  const transfer = value.totalBytes ?? value.transferSize ?? value.wastedBytes;

  const parts = [];
  if (selector) parts.push(`selector=${compact(selector, 160)}`);
  if (snippet) parts.push(`snippet=${compact(snippet, 180)}`);
  if (failure) parts.push(`reason=${compact(failure, 220)}`);
  if (url) parts.push(`url=${compact(url, 180)}`);
  if (label) parts.push(`label=${compact(label, 140)}`);
  if (message) parts.push(`message=${compact(message, 220)}`);
  if (Number.isFinite(Number(transfer))) parts.push(`bytes=${Math.round(Number(transfer))}`);
  if (parts.length) lines.push(parts.join(" | "));

  for (const [key, child] of Object.entries(value)) {
    if (["node", "selector", "snippet", "failureSummary", "url", "sourceLocation", "label", "name", "groupLabel", "description", "message", "summary", "totalBytes", "transferSize", "wastedBytes"].includes(key)) continue;
    if (child && typeof child === "object") lines.push(...collectDetailLines(child, depth + 1, seen));
    if (lines.length >= 8) break;
  }
  return lines.slice(0, 8);
}

for (const file of reports) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const mode = file.toLowerCase().includes("desktop") ? "Desktop" : "Mobile";
  const categories = report.categories || {};
  const categoryScores = Object.fromEntries(
    Object.entries(categories).map(([key, category]) => [key, percent(category.score)]),
  );

  console.log(`\n=== Dart Lighthouse ${mode} ===`);
  console.log(`Performance: ${categoryScores.performance ?? "n/a"}`);
  console.log(`Accessibility: ${categoryScores.accessibility ?? "n/a"}`);
  console.log(`Best Practices: ${categoryScores["best-practices"] ?? "n/a"}`);
  console.log(`SEO: ${categoryScores.seo ?? "n/a"}`);

  const metricIds = [
    "first-contentful-paint",
    "largest-contentful-paint",
    "speed-index",
    "total-blocking-time",
    "cumulative-layout-shift",
    "interaction-to-next-paint",
  ];
  console.log("Metrics:");
  for (const id of metricIds) {
    const audit = report.audits?.[id];
    if (!audit?.displayValue) continue;
    console.log(`- ${audit.title}: ${audit.displayValue}`);
  }

  const referenced = new Set(
    Object.values(categories).flatMap((category) => category.auditRefs || []).map((ref) => ref.id),
  );
  const incomplete = [...referenced]
    .map((id) => report.audits?.[id])
    .filter((audit) => audit && typeof audit.score === "number" && audit.score < 1)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 30);

  if (incomplete.length) {
    console.log("Audits below 100:");
    for (const audit of incomplete) {
      const detail = audit.displayValue ? ` — ${audit.displayValue}` : "";
      console.log(`- [${percent(audit.score)}] ${audit.id}: ${audit.title}${detail}`);
      if (!interestingDetailAudits.has(audit.id)) continue;
      const lines = collectDetailLines(audit.details?.items ?? audit.details);
      for (const line of [...new Set(lines)].slice(0, 6)) console.log(`    • ${line}`);
    }
  } else {
    console.log("All scored audits in selected categories are at 100.");
  }
}
