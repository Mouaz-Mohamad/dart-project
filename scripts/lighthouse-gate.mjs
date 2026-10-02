// DART CODE GUIDE | scripts/lighthouse-gate.mjs
// Fails production quality checks when Dart regresses below agreed Lighthouse floors.
import fs from "node:fs";

const [mobileFile, desktopFile] = process.argv.slice(2);
if (!mobileFile || !desktopFile) {
  console.error("Usage: node scripts/lighthouse-gate.mjs <mobile.json> <desktop.json>");
  process.exit(2);
}

const load = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const score = (report, key) => Number(report.categories?.[key]?.score ?? 0);
const metric = (report, key) => Number(report.audits?.[key]?.numericValue ?? 0);
const failures = [];

const mobile = load(mobileFile);
const desktop = load(desktopFile);

for (const [label, report] of [["Mobile", mobile], ["Desktop", desktop]]) {
  for (const category of ["accessibility", "best-practices", "seo"]) {
    const value = score(report, category);
    if (value < 1) failures.push(`${label} ${category} must remain 100; got ${Math.round(value * 100)}`);
  }
}

const mobilePerformance = score(mobile, "performance");
const desktopPerformance = score(desktop, "performance");
if (mobilePerformance < 0.70)
  failures.push(`Mobile performance must stay >= 70 on the CI runner; got ${Math.round(mobilePerformance * 100)}`);
if (desktopPerformance < 0.95)
  failures.push(`Desktop performance must stay >= 95 on the CI runner; got ${Math.round(desktopPerformance * 100)}`);

for (const [label, report] of [["Mobile", mobile], ["Desktop", desktop]]) {
  const cls = metric(report, "cumulative-layout-shift");
  if (cls > 0.1) failures.push(`${label} CLS must stay <= 0.1; got ${cls}`);
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL ${item}`).join("\n"));
  process.exit(1);
}
console.log(
  `PASS Lighthouse gate: mobile ${Math.round(mobilePerformance * 100)}, desktop ${Math.round(desktopPerformance * 100)}, a11y/best-practices/SEO 100`,
);
