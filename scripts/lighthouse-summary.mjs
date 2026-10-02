// DART CODE GUIDE | scripts/lighthouse-summary.mjs
// الغرض: تلخيص Lighthouse Production scores وأهم الـaudits الناقصة في GitHub Actions.
import fs from "node:fs";

const reports = process.argv.slice(2);
if (!reports.length) {
  console.error("Usage: node scripts/lighthouse-summary.mjs <report.json> [...]");
  process.exit(1);
}

const percent = (value) => Math.round(Number(value ?? 0) * 100);

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
    .slice(0, 25);

  if (incomplete.length) {
    console.log("Audits below 100:");
    for (const audit of incomplete) {
      const detail = audit.displayValue ? ` — ${audit.displayValue}` : "";
      console.log(`- [${percent(audit.score)}] ${audit.id}: ${audit.title}${detail}`);
    }
  } else {
    console.log("All scored audits in selected categories are at 100.");
  }
}
