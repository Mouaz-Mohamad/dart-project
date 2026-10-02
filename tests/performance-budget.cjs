// DART CODE GUIDE | tests/performance-budget.cjs
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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

const generatedDeliveryFiles = new Set([
  "Js/dart-ui.home.min.js",
  "Js/dart-platform.home.min.js",
]);
const jsFiles = ["Js", "Eye"]
  .flatMap(walk)
  .filter((file) => file.endsWith(".js") && !generatedDeliveryFiles.has(file));
const pageScopedFeatureFiles = new Set([
  "Eye/dart-live-operations.js",
  "Eye/dart-order-group-ui.js",
  "Eye/dart-traffic-analytics.js",
  "Eye/dart-finance.js",
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
if (/script[^>]+src=["']dart-finance\.js["']/i.test(dashboardHtml)) {
  failures.push("Eye/Dart Eye.html: Finance must remain lazy-loaded");
}
if (!dashboardRuntime.includes('script.src = "dart-finance.js"')) {
  failures.push("Eye/dart.js: Finance lazy loader is missing");
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

// Repository total is a maintainability ceiling, not a page-load metric. Keep it
// bounded, but also budget the scripts the public homepage actually requests.
if (totalJsBytes > 1150 * 1024) {
  failures.push(`Repository browser JavaScript is ${Math.ceil(totalJsBytes / 1024)}KB; budget is 1150KB`);
}
const homeGeneratedScripts = [
  ["Js/dart-ui.js", "Js/dart-ui.home.min.js"],
  ["Js/dart-platform.js", "Js/dart-platform.home.min.js"],
];
for (const [sourceFile, generatedFile] of homeGeneratedScripts) {
  if (!fs.existsSync(generatedFile)) {
    failures.push(`${generatedFile}: generated homepage runtime is missing`);
    continue;
  }
  const sourceHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(sourceFile, "utf8"), "utf8")
    .digest("hex");
  const banner = `/* source-sha256:${sourceHash}; terser:5.44.0 */`;
  if (!fs.readFileSync(generatedFile, "utf8").startsWith(banner)) {
    failures.push(`${generatedFile}: stale minified runtime; rebuild from ${sourceFile} with Terser 5.44.0`);
  }
}

const homeHtml = fs.readFileSync("index.html", "utf8");
for (const [sourceFile, generatedFile] of homeGeneratedScripts) {
  if (!homeHtml.includes(`src="${generatedFile}"`)) {
    failures.push(`index.html: homepage must load ${generatedFile}`);
  }
  if (homeHtml.includes(`src="${sourceFile}"`)) {
    failures.push(`index.html: homepage must not load ${sourceFile} directly`);
  }
}
const homeScriptSources = [...homeHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)]
  .map((match) => match[1].replace(/^\//, "").replace(/\?.*$/, ""))
  .filter((file, index, list) => list.indexOf(file) === index && fs.existsSync(file));
const homeInitialJsBytes = homeScriptSources.reduce((sum, file) => sum + fs.statSync(file).size, 0);
if (homeInitialJsBytes > 350 * 1024) {
  failures.push(`Homepage direct JavaScript is ${Math.ceil(homeInitialJsBytes / 1024)}KB; budget is 350KB`);
}

const homeCssSources = ["CSS/main.css", "CSS/base.css", "CSS/responsive.css"];
const expectedHomeCss =
  "/* DART HOME CSS BUNDLE\n" +
  "   Generated from CSS/main.css + CSS/base.css + CSS/responsive.css\n" +
  "   Keep source files authoritative; this bundle is home-page delivery only. */\n\n" +
  fs.readFileSync(homeCssSources[0], "utf8").trimEnd() +
  "\n\n/* === CSS/base.css === */\n" +
  fs.readFileSync(homeCssSources[1], "utf8").trimEnd() +
  "\n\n/* === CSS/responsive.css === */\n" +
  fs.readFileSync(homeCssSources[2], "utf8").trimEnd() +
  "\n";
if (!fs.existsSync("CSS/home.css")) {
  failures.push("CSS/home.css: homepage stylesheet bundle is missing");
} else if (fs.readFileSync("CSS/home.css", "utf8") !== expectedHomeCss) {
  failures.push("CSS/home.css: bundle is stale; rebuild it from main.css + base.css + responsive.css in that order");
}
const homeCssHash = crypto.createHash("sha256").update(expectedHomeCss, "utf8").digest("hex");
const homeMinCssBanner = `/* source-sha256:${homeCssHash}; clean-css:5.6.3; level:1 */`;
if (!fs.existsSync("CSS/home.min.css")) {
  failures.push("CSS/home.min.css: minified homepage stylesheet is missing");
} else if (!fs.readFileSync("CSS/home.min.css", "utf8").startsWith(homeMinCssBanner)) {
  failures.push("CSS/home.min.css: stale minified stylesheet; rebuild from CSS/home.css with CleanCSS 5.6.3 -O1");
}
if (!/<link\b[^>]*href=["']CSS\/home\.min\.css["'][^>]*>/i.test(homeHtml)) {
  failures.push("index.html: homepage must load CSS/home.min.css");
}
if (/<link\b[^>]*href=["']CSS\/home\.css["'][^>]*>/i.test(homeHtml)) {
  failures.push("index.html: homepage must not load CSS/home.css directly");
}
for (const source of homeCssSources) {
  const sourceName = source.replace("CSS/", "");
  const directPattern = new RegExp(`<link\\b[^>]*href=[\"']CSS\\/${sourceName.replace(".", "\\.")}[\"'][^>]*>`, "i");
  if (directPattern.test(homeHtml)) {
    failures.push(`index.html: ${source} must not load separately from CSS/home.css`);
  }
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
  `PASS performance budget: ${jsFiles.length} JS files, ${Math.ceil(coreJsBytes / 1024)}KB initial/core, ${Math.ceil(homeInitialJsBytes / 1024)}KB homepage direct, ${Math.ceil(totalJsBytes / 1024)}KB repository total`,
);
