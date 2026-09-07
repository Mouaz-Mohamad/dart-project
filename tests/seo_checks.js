/* BEGIN SEO and structure checks — keep public metadata and canonical files unique. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicPages = [
  "index.html",
  "products.html",
  "about.html",
  "Contact us.html",
  "policies.html",
];
const privatePages = [
  "cart-checkout.html",
  "profile.html",
  "Sign Up modern.html",
  "track.html",
  "rep.html",
  "pdf.html",
  "Eye/Dart Eye.html",
];
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

function withoutComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

for (const page of publicPages) {
  const html = read(page);
  const required = [
    [/<title>[^<]+<\/title>/i, "title"],
    [/<meta\s+name="description"\s+content="[^"]+"/i, "description"],
    [/<meta\s+name="robots"\s+content="[^"]*index/i, "index robots"],
    [/<link\s+rel="canonical"\s+href="https:\/\/dart-project-psi\.vercel\.app\//i, "canonical"],
    [/<meta\s+property="og:title"/i, "Open Graph title"],
    [/<meta\s+property="og:description"/i, "Open Graph description"],
    [/<meta\s+property="og:image"/i, "Open Graph image"],
    [/<meta\s+name="twitter:card"/i, "Twitter card"],
    [/<script\s+type="application\/ld\+json">/i, "JSON-LD"],
    [/<h1\b/i, "page heading"],
  ];
  for (const [expression, label] of required)
    if (!expression.test(html)) errors.push(`${page}: missing ${label}`);
  if (count(html, /<title>/gi) !== 1) errors.push(`${page}: title must be unique`);
  if (count(html, /rel="canonical"/gi) !== 1)
    errors.push(`${page}: canonical must be unique`);
  for (const block of html.matchAll(
    /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
  )) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      errors.push(`${page}: invalid JSON-LD (${error.message})`);
    }
  }
}

for (const page of privatePages) {
  const html = read(page);
  if (!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html))
    errors.push(`${page}: private page must be noindex`);
}

for (const page of [...publicPages, ...privatePages]) {
  const html = withoutComments(read(page));
  for (const button of html.matchAll(/<button\b[^>]*>/gi))
    if (!/\btype\s*=\s*["'][^"']+["']/i.test(button[0]))
      errors.push(`${page}: button without an explicit type`);
  for (const anchor of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi))
    if (!/\brel=["'][^"']*noopener/i.test(anchor[0]))
      errors.push(`${page}: external link missing rel=noopener`);
}

const singletonPaths = {
  "manifest.json": "manifest.json",
  "service worker": "sw.js",
  sitemap: "sitemap.xml",
  robots: "robots.txt",
  policies: "policies.html",
  receipt: "pdf.html",
  leaderboard: "sections/leaderboard-card.html",
};
for (const [label, expected] of Object.entries(singletonPaths)) {
  const basename = path.basename(expected);
  const matches = [];
  (function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === basename) matches.push(path.relative(root, full));
    }
  })(root);
  if (matches.length !== 1 || matches[0] !== expected)
    errors.push(`${label}: expected only ${expected}; found ${matches.join(", ")}`);
}

const sectionNames = fs.readdirSync(path.join(root, "sections"));
if (sectionNames.some((name) => !name.endsWith(".html")))
  errors.push("sections: contains a non-HTML fragment");
for (const name of sectionNames) {
  const html = read(path.join("sections", name));
  if (/<(?:link|script)\b/i.test(html))
    errors.push(`sections/${name}: fragment duplicates a stylesheet or script`);
}

const sitemap = read("sitemap.xml");
for (const page of publicPages) {
  const canonical = read(page).match(/rel="canonical"\s+href="([^"]+)"/i)?.[1];
  if (!canonical || !sitemap.includes(canonical))
    errors.push(`${page}: canonical missing from sitemap`);
}
for (const page of privatePages)
  if (sitemap.includes(encodeURI(page)))
    errors.push(`${page}: private page must not appear in sitemap`);

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exit(1);
}
console.log("PASS SEO metadata, JSON-LD, sitemap, noindex and unique structure checks");
/* END SEO and structure checks. */
