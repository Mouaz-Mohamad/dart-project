// DART CODE GUIDE | tests/founder-media-runtime.cjs
// Verifies saved founder media wins over stale loads and restores the static fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../Js/dart-site-settings.js'), 'utf8');
const fallback = '/Photos/me.png?v=founder-png-v10';
function image(src = '/starting.png') {
  const attributes = new Map([['src', src], ['srcset', '/legacy.webp 2x'], ['sizes', '100vw']]);
  return {
    get src() { return attributes.get('src'); },
    set src(value) { attributes.set('src', value); },
    getAttribute: (key) => attributes.get(key) ?? null,
    removeAttribute: (key) => attributes.delete(key),
    closest: () => null,
  };
}
function fixture(loadImage = async () => {}) {
  let founder = image();
  const document = {
    readyState: 'loading', hidden: false, cookie: '',
    addEventListener() {}, querySelector: () => null,
    getElementById: (id) => id === 'dart-founder-image' ? founder : null,
  };
  const root = {
    document,
    location: { pathname: '/about.html', origin: 'http://localhost', href: 'http://localhost/about.html' },
    DartCatalog: { loadImage, imageSrc: (asset) => asset.url },
    dispatchEvent() {}, addEventListener() {}, setInterval() {},
  };
  vm.runInNewContext(source, { window: root, CustomEvent: class {}, console, URL, setTimeout, clearTimeout });
  return { api: root.DartSiteSettings, get image() { return founder; }, replace: () => { founder = image(); } };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

(async () => {
  const initial = fixture();
  initial.api.save({ founderImage: { id: 'saved', url: '/assets/saved.webp' } });
  await initial.api.applyPublicMedia();
  assert.equal(initial.image.src, '/assets/saved.webp');
  assert.equal(initial.image.getAttribute('srcset'), null);
  assert.equal(initial.image.getAttribute('sizes'), null);
  initial.api.save({ founderImage: null });
  await initial.api.applyPublicMedia();
  assert.equal(initial.image.src, fallback, 'clearing media must restore the original photo');

  const old = deferred();
  const update = fixture((asset) => asset.id === 'old' ? old.promise : Promise.resolve());
  update.api.save({ founderImage: { id: 'old', url: '/assets/old.webp' } });
  const pending = update.api.applyPublicMedia();
  update.api.save({ founderImage: { id: 'new', url: '/assets/new.webp' } });
  await update.api.applyPublicMedia();
  old.resolve();
  await pending;
  assert.equal(update.image.src, '/assets/new.webp', 'late old media must not overwrite the latest setting');

  const late = deferred();
  const clear = fixture(() => late.promise);
  clear.api.save({ founderImage: { id: 'old', url: '/assets/old.webp' } });
  const beforeClear = clear.api.applyPublicMedia();
  clear.api.save({ founderImage: null });
  await clear.api.applyPublicMedia();
  late.resolve();
  await beforeClear;
  assert.equal(clear.image.src, fallback, 'clearing must cancel an older image load');

  const detached = deferred();
  const replacement = fixture(() => detached.promise);
  replacement.api.save({ founderImage: { id: 'old', url: '/assets/old.webp' } });
  const beforeReplace = replacement.api.applyPublicMedia();
  const removed = replacement.image;
  replacement.replace();
  detached.resolve();
  await beforeReplace;
  assert.equal(removed.src, '/starting.png', 'a detached story must not be mutated by an old load');
  assert.equal(replacement.image.src, '/starting.png');

  const failed = fixture(async () => { throw new Error('synthetic image load failure'); });
  failed.api.save({ founderImage: { id: 'failed', url: '/assets/failed.webp' } });
  await failed.api.applyPublicMedia();
  assert.equal(failed.image.src, fallback, 'failed resolution must use the original fallback');
  console.log('PASS founder media: saved image, clear/reset, latest-wins, pending-clear, detached section and failed-load fallback');
})().catch((error) => { console.error(error); process.exitCode = 1; });
