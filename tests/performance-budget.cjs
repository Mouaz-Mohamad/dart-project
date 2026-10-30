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
  "Js/dart-navigation.min.js",
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
  "Js/dart-sets.js",
  "Js/dart-set-modal-ui.js",
  "Js/dart-navigation.js",
  "Eye/dart-sets-admin.js",
  "Js/dart-news-runtime.js",
  "Js/dart-news-links.js",
  "Eye/dart-news-admin.js",
  "Eye/dart-catalog-admin.js",
  "Js/dart-whatsapp-preferences.js",
  "Js/dart-customer-notifications.js",
]);
for (const file of rootHtml.filter(file => file !== "profile.html")) {
  if (/src="Js\/dart-(whatsapp-preferences|customer-notifications)\.js"/.test(fs.readFileSync(file,"utf8"))) {
    failures.push(`${file}: Customer preference/notification code must stay on the customer profile`);
  }
}
const dashboardHtml = fs.readFileSync("Eye/Dart Eye.html", "utf8");
const dashboardRuntime = fs.readFileSync("Eye/dart.js", "utf8");
const newsLoader = fs.readFileSync("Js/dart-news.js", "utf8");
for (const source of ["index.html", "about.html", "Eye/Dart Eye.html"]) {
  if (/script[^>]+src=["'][^"']*dart-news-(?:runtime|admin)\.js/i.test(fs.readFileSync(source, "utf8"))) {
    failures.push(`${source}: News runtime and management must remain lazy-loaded`);
  }
}
if (!newsLoader.includes('asset("/Js/dart-news-runtime.js")') || !newsLoader.includes('asset("/Eye/dart-news-admin.js")')) {
  failures.push("Js/dart-news.js: News lazy loaders are missing");
}
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
if (!/script\.src = "dart-finance\.js(?:\?[^\"]*)?"/.test(dashboardRuntime)) {
  failures.push("Eye/dart.js: Finance lazy loader is missing");
}
const settingsRuntime = fs.readFileSync("Js/dart-site-settings.js", "utf8");
if (!settingsRuntime.includes("SET_STOREFRONT_PAGES")) {
  failures.push("Js/dart-site-settings.js: Sets storefront runtime must stay page-scoped");
}
if (!settingsRuntime.includes('[data-target="models"]')) {
  failures.push("Js/dart-site-settings.js: Dart Eye Sets must lazy-load from the Models section");
}

// This script is loaded only by the standalone WhatsApp feedback page, not
// by any general storefront/dashboard page. Budget it independently.
const standaloneScripts = new Set(["Js/dart-public-feedback.js"]);
const maxJsBytes = 260 * 1024;
let totalJsBytes = 0;
let coreJsBytes = 0;
let lazyJsBytes = 0;
let standaloneJsBytes = 0;
for (const file of jsFiles) {
  const size = fs.statSync(file).size;
  totalJsBytes += size;
  if (standaloneScripts.has(file)) standaloneJsBytes += size;
  else if (pageScopedFeatureFiles.has(file)) lazyJsBytes += size;
  else coreJsBytes += size;
  if (size > maxJsBytes) {
    failures.push(`${file}: ${Math.ceil(size / 1024)}KB exceeds the 260KB per-file JS budget`);
  }
}
if (standaloneJsBytes > 8 * 1024) {
  failures.push("Standalone public feedback runtime exceeds its 8KB budget");
}
// This is the repository aggregate, not the bytes loaded on one page. The
// Dashboard details, editor, feedback and display choices add scoped source; public delivery budgets stay unchanged.
// Permission presentation and scoped feedback saves add under 5 KiB to the core aggregate after minifying Staff delivery.
if (fs.statSync("Eye/dart-permissions.js").size > 6 * 1024) failures.push("Staff permission adapter exceeds its 6 KiB delivery budget");
if (fs.statSync("Eye/dart-staff.js").size > 14 * 1024) failures.push("Staff directory exceeds its 14 KiB delivery budget");
if (coreJsBytes > 963 * 1024) {
  failures.push(`Core browser JavaScript is ${Math.ceil(coreJsBytes / 1024)}KB; budget is 963KB`);
}
if (fs.statSync('Eye/dart-dashboard-ui.js').size > 14 * 1024) failures.push('Dashboard details adapter exceeds its 14 KiB source budget');
// Combined finance hydration and public navigation add 14 KiB of source. Home delivery still fits 225 KiB.
// Versioned inventory-only writes add under 0.5 KiB of scoped delivery code.
if (fs.statSync("Eye/dart-catalog-admin.js").size > 3 * 1024) failures.push("Catalog editor exceeds its 3 KiB delivery budget");
// Customer notifications and WhatsApp consent are profile-only, with independent file caps.
if (fs.statSync("Js/dart-customer-notifications.js").size > 12 * 1024) failures.push("Customer notification runtime exceeds its 12 KiB profile budget");
if (fs.statSync("Js/dart-whatsapp-preferences.js").size > 3 * 1024) failures.push("WhatsApp preference runtime exceeds its 3 KiB profile budget");
if (lazyJsBytes > 449 * 1024) {
  failures.push(`Lazy/page-scoped browser JavaScript is ${Math.ceil(lazyJsBytes / 1024)}KB; budget is 449KB`);
}

// Platform delivery is still an exact minified derivative of dart-platform.js.
const generatedPlatformRuntime = ["Js/dart-platform.js", "Js/dart-platform.home.min.js"];
{
  const [sourceFile, generatedFile] = generatedPlatformRuntime;
  if (!fs.existsSync(generatedFile)) {
    failures.push(`${generatedFile}: generated homepage runtime is missing`);
  } else {
    const sourceHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(sourceFile, "utf8"), "utf8")
      .digest("hex");
    const banner = `/* source-sha256:${sourceHash}; terser:5.44.0 */`;
    if (!fs.readFileSync(generatedFile, "utf8").startsWith(banner)) {
      failures.push(`${generatedFile}: stale minified runtime; rebuild from ${sourceFile} with Terser 5.44.0`);
    }
  }
}

// Homepage UI is now a curated page-scoped runtime, not a minified copy of dart-ui.js.
const curatedHomeUi = "Js/dart-ui.home.min.js";
for (const [input, output] of [['src/storefront/catalog.js', 'Js/dart-catalog.js'], ['src/storefront/profile-records.js', 'Js/dart-profile-records.js'], ['src/storefront/home-ui.js', curatedHomeUi], ['Js/dart-navigation.js', 'Js/dart-navigation.min.js'], ['src/dashboard/staff-admin.js', 'Eye/dart-staff.js'], ['src/dashboard/staff-permissions.js', 'Eye/dart-permissions.js'], ['src/dashboard/dashboard-ui.js','Eye/dart-dashboard-ui.js'], ['src/dashboard/news-admin.js','Eye/dart-news-admin.js'], ['src/dashboard/sets-admin.js','Eye/dart-sets-admin.js']]) {
  const text = require('../scripts/build-home-runtime.cjs').sourceText(input);
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  if (!fs.readFileSync(output, 'utf8').startsWith(`/* source-sha256:${hash}; terser:5.44.0 */`)) {
    failures.push(`${output}: stale delivery runtime; run node scripts/build-home-runtime.cjs`);
  }
}
if (!fs.existsSync(curatedHomeUi)) {
  failures.push(`${curatedHomeUi}: curated homepage UI runtime is missing`);
} else {
  const source = fs.readFileSync(curatedHomeUi, "utf8");
  if (!source.includes("Homepage-only storefront runtime")) {
    failures.push(`${curatedHomeUi}: missing curated homepage runtime marker`);
  }
  for (const [label, pattern] of [
    ["checkout", /\bcheckoutForm\b/],
    ["tracking", /\btracking-card\b/],
    ["returns", /\breturnRequestForm\b/],
    ["maps", /\bdartCheckoutAddress\b/],
  ]) {
    if (pattern.test(source)) {
      failures.push(`${curatedHomeUi}: ${label} code must stay out of the homepage runtime`);
    }
  }
  const size = fs.statSync(curatedHomeUi).size;
  if (size > 40 * 1024) {
    failures.push(`${curatedHomeUi}: ${Math.ceil(size / 1024)}KB exceeds the 40KB curated UI budget`);
  }
}

const homeHtml = fs.readFileSync("index.html", "utf8");
if (!homeHtml.includes(`src="${curatedHomeUi}"`)) {
  failures.push(`index.html: homepage must load ${curatedHomeUi}`);
}
if (homeHtml.includes('src="Js/dart-ui.js"')) {
  failures.push("index.html: homepage must not load Js/dart-ui.js directly");
}
{
  const [sourceFile, generatedFile] = generatedPlatformRuntime;
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
if (homeInitialJsBytes > 225 * 1024) {
  failures.push(`Homepage direct JavaScript is ${Math.ceil(homeInitialJsBytes / 1024)}KB; budget is 225KB`);
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
if (!/<link\b[^>]*href=["']CSS\/home\.min\.css(?:\?[^"']*)?["'][^>]*>/i.test(homeHtml)) {
  failures.push("index.html: homepage must load CSS/home.min.css");
}
if (/<link\b[^>]*href=["']CSS\/home\.css["'][^>]*>/i.test(homeHtml)) {
  failures.push("index.html: homepage must not load CSS/home.css directly");
}
for (const source of homeCssSources) {
  const sourceName = source.replace("CSS/", "");
  const directPattern = new RegExp(`<link\\b[^>]*href=[\\"']CSS\\/${sourceName.replace(".", "\\.")}[\\"'][^>]*>`, "i");
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
  `PASS performance budget: ${jsFiles.length} JS files, ${Math.ceil(coreJsBytes / 1024)}KB initial/core, ${Math.ceil(homeInitialJsBytes / 1024)}KB homepage direct, ${Math.ceil(lazyJsBytes / 1024)}KB lazy/page-scoped, ${Math.ceil(totalJsBytes / 1024)}KB repository source`,
);
