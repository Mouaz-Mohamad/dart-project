// DART CODE GUIDE | scripts/build-home-runtime.cjs
// Deterministic, pinned delivery builds. Global UI names remain available to shared modules.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function sourceText(source) {
  const text = fs.readFileSync(source, 'utf8');
  if (source !== 'scripts/home-ui.source.js') return text;
  const shared = fs.readFileSync('Js/dart-ui.js', 'utf8');
  const start = shared.indexOf('// BEGIN Shared static section loader');
  const end = shared.indexOf('\n\nfunction ensureAboutImages()', start);
  if (start < 0 || end < 0 || !text.includes('/* DART_SHARED_SECTIONS */')) throw new Error('Shared Home sections source is missing');
  return text.replace('/* DART_SHARED_SECTIONS */', shared.slice(start, end));
}

module.exports = { sourceText };
if (require.main === module) for (const [source, output] of [
  ['scripts/home-ui.source.js', 'Js/dart-ui.home.min.js'],
  ['Js/dart-platform.js', 'Js/dart-platform.home.min.js'],
  ['Js/dart-navigation.js', 'Js/dart-navigation.min.js'],
  ['scripts/catalog-admin.source.js', 'Eye/dart-catalog-admin.js'],
  ['scripts/staff-admin.source.js', 'Eye/dart-staff.js'],
  ['scripts/staff-permissions.source.js', 'Eye/dart-permissions.js'],
  ['scripts/dashboard-ui.source.js', 'Eye/dart-dashboard-ui.js'],
  ['scripts/news-admin.source.js', 'Eye/dart-news-admin.js'],
  ['scripts/sets-admin.source.js', 'Eye/dart-sets-admin.js'],
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
