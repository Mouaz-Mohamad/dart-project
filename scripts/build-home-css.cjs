// DART CODE GUIDE | scripts/build-home-css.cjs
// Builds the homepage CSS delivery bundle from the three authoritative storefront CSS files.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SOURCES = ['CSS/main.css', 'CSS/base.css', 'CSS/responsive.css'];
const BUNDLE = 'CSS/home.css';
const MINIFIED = 'CSS/home.min.css';
const INDEX = 'index.html';
const VERSIONED = process.argv.includes('--versioned');

function composeBundle() {
  return (
    '/* DART HOME CSS BUNDLE\n' +
    '   Generated from CSS/main.css + CSS/base.css + CSS/responsive.css\n' +
    '   Keep source files authoritative; this bundle is home-page delivery only. */\n\n' +
    fs.readFileSync(SOURCES[0], 'utf8').trimEnd() +
    '\n\n/* === CSS/base.css === */\n' +
    fs.readFileSync(SOURCES[1], 'utf8').trimEnd() +
    '\n\n/* === CSS/responsive.css === */\n' +
    fs.readFileSync(SOURCES[2], 'utf8').trimEnd() +
    '\n'
  );
}

function minifyBundle(sourceHash) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    ['--yes', 'clean-css-cli@5.6.3', '-O1', '-o', MINIFIED, BUNDLE],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`clean-css-cli failed with exit code ${result.status}`);
  }

  const minified = fs.readFileSync(MINIFIED, 'utf8').trim();
  const banner = `/* source-sha256:${sourceHash}; clean-css:5.6.3; level:1 */`;
  fs.writeFileSync(MINIFIED, `${banner}\n${minified}\n`);
}

function versionHomepageAsset(sourceHash) {
  const html = fs.readFileSync(INDEX, 'utf8');
  const version = sourceHash.slice(0, 16);
  let replaced = false;
  const next = html.replace(
    /href=(["'])CSS\/home\.min\.css(?:\?v=[^"']*)?\1/i,
    (_match, quote) => {
      replaced = true;
      return `href=${quote}CSS/home.min.css?v=${version}${quote}`;
    },
  );
  if (!replaced) {
    throw new Error('index.html does not contain the homepage CSS asset link');
  }
  fs.writeFileSync(INDEX, next);
}

const bundle = composeBundle();
const sourceHash = crypto.createHash('sha256').update(bundle, 'utf8').digest('hex');
fs.writeFileSync(BUNDLE, bundle);
minifyBundle(sourceHash);
if (VERSIONED) versionHomepageAsset(sourceHash);

console.log(`Homepage CSS bundle rebuilt (${sourceHash.slice(0, 16)}).`);
