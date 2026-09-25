// DART CODE GUIDE | tests/performance-budget.cjs
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const fs = require("node:fs");
const path = require("node:path");

const failures = [];
const rootHtml = fs.readdirSync(".").filter((name) => name.endsWith(".html"));
for (const file of rootHtml) {
  const source = fs.readFileSync(file, "utf8");
  const headMarkup = source.match(/<head\b[\s\S]*?<\/head>/i)?.[0] || "";
  if (/>\\n\s*</.test(headMarkup)) {
    failures.push(`${file}: <head> contains a literal \\n escape instead of a real newline`);
  }
  const faviconTags = source.match(/<link\b[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>/gi) || [];
  for (const tag of faviconTags) {
    if (/logo-1to1\.png|dart_logo\.png/i.test(tag)) {
      failures.push(`${file}: favicon/touch icon must use a small dedicated asset`);
    }
  }
}

for (const [file, forbidden] of [
  ["rep.html", /<img\b[^>]*src=["']Photos\/dart_logo\.png["']/i],
  ["Eye/Dart Eye.html", /<img\b[^>]*src=["']dart_logo\.png["']/i],
]) {
  if (forbidden.test(fs.readFileSync(file, "utf8"))) {
    failures.push(`${file}: runtime logo must not use a multi-megabyte source image`);
  }
}

const storefront = fs.readFileSync("Js/dart-ui.js", "utf8");
if (!storefront.includes("img.loading = 'lazy'")) {
  failures.push("Js/dart-ui.js: product-card images must lazy-load");
}
if (!storefront.includes("img.decoding = 'async'")) {
  failures.push("Js/dart-ui.js: product-card images must decode asynchronously");
}

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

const jsFiles = ["Js", "Eye"].flatMap(walk).filter((file) => file.endsWith(".js"));
const pageScopedFeatureFiles = new Set([
  "Eye/dart-live-operations.js",
  "Eye/dart-order-group-ui.js",
  "Eye/dart-traffic-analytics.js",
  "Js/dart-rep.js",
  "Js/dart-tracking.js",
  "Js/dart-checkout-stability.js",
]);
const dashboardHtml = fs.readFileSync("Eye/Dart Eye.html", "utf8");
const dashboardRuntime = fs.readFileSync("Eye/dart.js", "utf8");
if (/script[^>]+src=["']dart-live-operations\.js["']/i.test(dashboardHtml)) {
  failures.push("Eye/Dart Eye.html: Live Operations must remain lazy-loaded");
}
if (!dashboardRuntime.includes('script.src = "dart-live-operations.js"')) {
  failures.push("Eye/dart.js: Live Operations lazy loader is missing");
}
if (!dashboardRuntime.includes('script.src = "dart-traffic-analytics.js"')) {
  failures.push("Eye/dart.js: Brand Traffic Analytics lazy loader is missing");
}
if (/script[^>]+src=["']dart-traffic-analytics\.js["']/i.test(dashboardHtml)) {
  failures.push("Eye/Dart Eye.html: Brand Traffic Analytics must remain lazy-loaded");
}
const maxJsBytes = 260 * 1024;
let totalJsBytes = 0;
let coreJsBytes = 0;
for (const file of jsFiles) {
  const size = fs.statSync(file).size;
  totalJsBytes += size;
  if (!pageScopedFeatureFiles.has(file)) coreJsBytes += size;
  if (size > maxJsBytes) {
    failures.push(`${file}: ${Math.ceil(size / 1024)}KB exceeds the 260KB per-file JS budget`);
  }
}
if (coreJsBytes > 900 * 1024) {
  failures.push(`Core browser JavaScript is ${Math.ceil(coreJsBytes / 1024)}KB; budget is 900KB`);
}
if (totalJsBytes > 1100 * 1024) {
  failures.push(`Repository browser JavaScript is ${Math.ceil(totalJsBytes / 1024)}KB; budget is 1100KB`);
}

const imageFiles = walk("Photos").filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file));
const maxImageBytes = 2500 * 1024;
for (const file of imageFiles) {
  const size = fs.statSync(file).size;
  if (size > maxImageBytes) {
    failures.push(`${file}: ${Math.ceil(size / 1024)}KB exceeds the 2.5MB legacy image ceiling`);
  }
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL ${item}`).join("\n"));
  process.exit(1);
}
console.log(
  `PASS performance budget: ${jsFiles.length} JS files, ${Math.ceil(coreJsBytes / 1024)}KB initial/core, ${Math.ceil(totalJsBytes / 1024)}KB repository total; page-scoped modules budgeted separately`,
);
