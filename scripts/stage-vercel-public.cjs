// DART CODE GUIDE | scripts/stage-vercel-public.cjs
// Stages only browser-facing storefront/admin assets into Vercel's static output directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUTPUT_DIR = 'public';
const OUTPUT_ROOT = path.resolve(OUTPUT_DIR);
const PUBLIC_DIRECTORIES = ['CSS', 'Eye', 'Icons', 'Js', 'Photos', 'sections'];
const PUBLIC_ROOT_FILES = new Set([
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'sitemap-pages.xml',
  'sw.js',
]);
const VERSIONABLE_ASSET_RE = /\b(src|href)\s*=\s*(["'])([^"'?#]+\.(?:css|js))(?:\?[^"'#]*)?(#[^"']*)?\2/gi;

function copyEntry(source) {
  const destination = path.join(OUTPUT_DIR, source);
  fs.cpSync(source, destination, { recursive: true });
}

function collectHtmlFiles(directory) {
  const htmlFiles = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) htmlFiles.push(...collectHtmlFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
  }
  return htmlFiles;
}

function resolveLocalAsset(htmlPath, assetUrl) {
  if (/^(?:https?:)?\/\//i.test(assetUrl) || /^(?:data|blob|javascript):/i.test(assetUrl)) return null;
  const candidate = assetUrl.startsWith('/')
    ? path.resolve(OUTPUT_DIR, `.${assetUrl}`)
    : path.resolve(path.dirname(htmlPath), assetUrl);
  if (candidate !== OUTPUT_ROOT && !candidate.startsWith(`${OUTPUT_ROOT}${path.sep}`)) return null;
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

function contentVersion(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}

function versionHtmlAssets() {
  let versionedReferences = 0;
  for (const htmlPath of collectHtmlFiles(OUTPUT_DIR)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const next = html.replace(
      VERSIONABLE_ASSET_RE,
      (match, attribute, quote, assetUrl, fragment = '') => {
        const localAsset = resolveLocalAsset(htmlPath, assetUrl);
        if (!localAsset) return match;
        versionedReferences += 1;
        return `${attribute}=${quote}${assetUrl}?v=${contentVersion(localAsset)}${fragment || ''}${quote}`;
      },
    );
    if (next !== html) fs.writeFileSync(htmlPath, next);
  }
  if (!versionedReferences) throw new Error('No local CSS/JS references were content-versioned');
  return versionedReferences;
}

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const directory of PUBLIC_DIRECTORIES) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Required public directory is missing: ${directory}`);
  }
  copyEntry(directory);
}

for (const entry of fs.readdirSync('.', { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith('.html') && !PUBLIC_ROOT_FILES.has(entry.name)) continue;
  copyEntry(entry.name);
}

for (const required of ['index.html', 'products.html', 'CSS/home.min.css', 'Js/dart-cache-recovery.js', 'sw.js']) {
  if (!fs.existsSync(path.join(OUTPUT_DIR, required))) {
    throw new Error(`Required Vercel output is missing: ${required}`);
  }
}

const versionedReferences = versionHtmlAssets();
console.log(`Vercel static output staged safely in public/ with ${versionedReferences} versioned CSS/JS references.`);
