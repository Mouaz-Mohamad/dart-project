// DART CODE GUIDE | scripts/build-home-runtime.cjs
// Deterministic, pinned delivery builds. Global UI names remain available to shared modules.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceRuntimes } = require('./build-source-runtime.cjs');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function sourceText(source) {
  const text = fs.readFileSync(source, 'utf8');
  if (source !== 'src/storefront/home-ui.js') return text;
  const shared = fs.readFileSync('Js/dart-ui.js', 'utf8');
  const start = shared.indexOf('// BEGIN Shared static section loader');
  const end = shared.indexOf('\n\nfunction ensureAboutImages()', start);
  if (start < 0 || end < 0 || !text.includes('/* DART_SHARED_SECTIONS */')) throw new Error('Shared Home sections source is missing');
  return text.replace('/* DART_SHARED_SECTIONS */', shared.slice(start, end));
}

module.exports = { sourceText };
if (require.main === module) buildSourceRuntimes();
if (require.main === module) for (const [source, output] of [
  ['src/storefront/catalog.js', 'Js/dart-catalog.js'],
  ['src/storefront/home-ui.js', 'Js/dart-ui.home.min.js'],
  ['src/storefront/profile-records.js', 'Js/dart-profile-records.js'],
  ['Js/dart-platform.js', 'Js/dart-platform.home.min.js'],
  ['Js/dart-navigation.js', 'Js/dart-navigation.min.js'],
  ['src/dashboard/catalog-admin.js', 'Eye/dart-catalog-admin.js'],
  ['src/dashboard/staff-admin.js', 'Eye/dart-staff.js'],
  ['src/dashboard/staff-permissions.js', 'Eye/dart-permissions.js'],
  ['src/dashboard/dashboard-ui.js', 'Eye/dart-dashboard-ui.js'],
  ['src/dashboard/display-preferences.js', 'Eye/dart-display-preferences.js'],
  ['src/dashboard/news-admin.js', 'Eye/dart-news-admin.js'],
  ['src/dashboard/sets-admin.js', 'Eye/dart-sets-admin.js'],
]) {
  const text = sourceText(source);
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const banner = `/* source-sha256:${hash}; terser:5.44.0 */`;
  if (fs.existsSync(output) && fs.readFileSync(output, 'utf8').startsWith(banner)) continue;
  const result = spawnSync(npx, ['--yes', 'terser@5.44.0', '--compress', '--mangle',
    '--comments', '/Homepage-only storefront runtime/', '--output', output], { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Terser failed for ${source}`);
  fs.writeFileSync(output, `${banner}\n${fs.readFileSync(output, 'utf8').trim()}\n`);
}
if (require.main === module) console.log('Home and navigation delivery runtimes are current.');
