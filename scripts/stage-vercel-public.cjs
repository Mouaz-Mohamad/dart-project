// DART CODE GUIDE | scripts/stage-vercel-public.cjs
// Stages only browser-facing storefront/admin assets into Vercel's static output directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUTPUT_DIR = 'public';
const PUBLIC_DIRECTORIES = ['CSS', 'Eye', 'Icons', 'Js', 'Photos', 'sections'];
const PUBLIC_ROOT_FILES = new Set([
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'sitemap-pages.xml',
  'sw.js',
]);

function copyEntry(source) {
  const destination = path.join(OUTPUT_DIR, source);
  fs.cpSync(source, destination, { recursive: true });
}

function versionCacheRecoveryAsset() {
  const recoveryPath = path.join(OUTPUT_DIR, 'Js', 'dart-cache-recovery.js');
  const indexPath = path.join(OUTPUT_DIR, 'index.html');
  const recovery = fs.readFileSync(recoveryPath);
  const version = crypto.createHash('sha256').update(recovery).digest('hex').slice(0, 16);
  const html = fs.readFileSync(indexPath, 'utf8');
  let replaced = false;
  const next = html.replace(
    /src=(["'])Js\/dart-cache-recovery\.js(?:\?v=[^"']*)?\1/i,
    (_match, quote) => {
      replaced = true;
      return `src=${quote}Js/dart-cache-recovery.js?v=${version}${quote}`;
    },
  );
  if (!replaced) throw new Error('index.html does not contain dart-cache-recovery.js');
  fs.writeFileSync(indexPath, next);
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

versionCacheRecoveryAsset();
console.log('Vercel static output staged safely in public/.');
