// Domain migration regression: execute both maintained and delivered catalog runtimes.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function fixture(file, origin, apiOrigin = origin) {
  const memory = new Map();
  const model = { modelId: "DW-101", name: "Dart fixture", selling: 800, active: true,
    sizeOptions: [{ name: "M", active: true }], colorOptions: [{ name: "Black", active: true,
      images: [{ id: "fixture-image", url: "https://dart-project-psi.vercel.app/api/v1/catalog/assets/fixture-image?v=content-version" }] }] };
  const document = { hidden: false, cookie: "", addEventListener() {} };
  const location = { origin, pathname: "/", href: `${origin}/` };
  const window = { location, document, DART_API_BASE_URL: apiOrigin,
    DartState: { read: (key, fallback) => memory.get(key) ?? fallback, write: (key, value) => memory.set(key, value) },
    dispatchEvent() {}, addEventListener() {}, setInterval() {} };
  const requests = [];
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { window, location, document, URL, console,
    CustomEvent: class {}, Event: class {}, clearInterval() {}, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      assert.equal(options.method, "GET", "loading images must never write business data");
      requests.push(url);
      return { ok: true, json: async () => ({ version: 1, models: [model], stock: {} }) };
    } }, { filename: file });
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  return window.DartCatalog;
}

(async () => {
  const path = "/api/v1/catalog/assets/fixture-image?v=content-version";
  for (const file of ["src/storefront/catalog.js", "Js/dart-catalog.js"]) {
    for (const origin of ["https://www.dartofficial.com", "https://dartofficial.com", "https://preview.vercel.app", "http://localhost:4173"]) {
      const catalog = await fixture(file, origin);
      for (const savedOrigin of ["https://dart-project-psi.vercel.app", "https://dart-api-dusky.vercel.app", "https://dartofficial.com", "https://www.dartofficial.com"]) {
        assert.equal(catalog.imageSrc({ id: "fixture-image", url: savedOrigin + path }), origin + path);
        assert.equal(catalog.imageSrc(savedOrigin + path), origin + path, "Set and order image strings must follow the same rule");
      }
      assert.equal(catalog.imageSrc(path), origin + path);
      assert.equal(catalog.products()[0].images[0], origin + path, "rendered product projections must use the current domain");
      assert.equal(catalog.imageSrc({ id: "fixture-image" }), origin + path.split("?")[0]);
      assert.equal(catalog.imageSrc(null), catalog.placeholder);
      for (const untouched of ["https://cdn.example/image.webp", "https://www.dartofficial.com.attacker.example" + path,
        "https://dart-project-psi.vercel.app/unrelated.png", "data:image/png;base64,AA==", "blob:https://www.dartofficial.com/fixture"]) {
        assert.equal(catalog.imageSrc({ url: untouched }), untouched, "unrelated origins and local previews must not be rewritten");
      }
    }
    const override = await fixture(file, "https://www.dartofficial.com", "https://api.custom.test");
    assert.equal(override.imageSrc("https://dart-project-psi.vercel.app" + path), "https://api.custom.test" + path);
  }
  console.log("PASS custom-domain media: products, Set/order strings, saved versions, API override, previews, fallback and origin boundaries");
})().catch(error => { console.error(error); process.exitCode = 1; });
