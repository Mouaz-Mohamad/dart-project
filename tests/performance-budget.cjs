const fs = require("node:fs");
const path = require("node:path");

const failures = [];
const rootHtml = fs.readdirSync(".").filter((name) => name.endsWith(".html"));
for (const file of rootHtml) {
  const source = fs.readFileSync(file, "utf8");
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

const storefront = fs.readFileSync("Js/one .js", "utf8");
if (!storefront.includes("img.loading = 'lazy'")) {
  failures.push("Js/one .js: product-card images must lazy-load");
}
if (!storefront.includes("img.decoding = 'async'")) {
  failures.push("Js/one .js: product-card images must decode asynchronously");
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
const maxJsBytes = 260 * 1024;
let totalJsBytes = 0;
for (const file of jsFiles) {
  const size = fs.statSync(file).size;
  totalJsBytes += size;
  if (size > maxJsBytes) {
    failures.push(`${file}: ${Math.ceil(size / 1024)}KB exceeds the 260KB per-file JS budget`);
  }
}
if (totalJsBytes > 900 * 1024) {
  failures.push(`Core browser JavaScript is ${Math.ceil(totalJsBytes / 1024)}KB; budget is 900KB`);
}

const imageFiles = walk("Photos").filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file));
const maxImageBytes = 2700 * 1024;
for (const file of imageFiles) {
  const size = fs.statSync(file).size;
  if (size > maxImageBytes) {
    failures.push(`${file}: ${Math.ceil(size / 1024)}KB exceeds the 2.7MB legacy image ceiling`);
  }
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL ${item}`).join("\n"));
  process.exit(1);
}
console.log(
  `PASS performance budget: ${jsFiles.length} JS files, ${Math.ceil(totalJsBytes / 1024)}KB total core JS, lightweight runtime icons enforced`,
);
