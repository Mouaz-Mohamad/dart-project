// DART CODE GUIDE | tests/product-modal-shared-contract.cjs
// Prevents Home and Products from regaining separate Product Modal markup or owners.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const home = read("index.html");
const products = read("products.html");
const fragment = read("sections/product-modal.html");
const storefront = read("Js/dart-storefront.js");
const actions = read("Js/dart-product-button-state.js");
const homeUi = read("Js/dart-ui.home.min.js");
const productsUi = read("Js/dart-ui.js");
const homePerformance = read("Js/dart-home-performance.js");
const dialog = read("Js/dart-dialog.js");
const productPage = read("api/product-page.js");

const host = '<div id="product-modal-host" data-section-src="sections/product-modal.html"></div>';
assert.ok(home.includes(host), "Home must load the shared Product Modal fragment");
assert.ok(products.includes(host), "Products must load the same Product Modal fragment");
assert.doesNotMatch(home, /id=["']SectionModel["']/, "Home must not hardcode the modal");
assert.doesNotMatch(products, /id=["']SectionModel["']/, "Products must not hardcode the modal");

assert.equal((fragment.match(/id=["']SectionModel["']/g) || []).length, 1);
[
  "SectionModel",
  "modelCarousel",
  "carouselTrack",
  "carouselPrev",
  "carouselNext",
  "carouselDots",
  "productSizeChartBtn",
  "productSizeChartPanel",
  "productSizeChartTitle",
  "productSizeChartContent",
  "closeProductSizeChart",
  "productOptionStatus",
  "modalQtyControl",
  "modalQtyDecrease",
  "modalQtyValue",
  "modalQtyIncrease",
  "modalBuyBtn",
  "modalWaitBtn",
].forEach((id) => assert.match(fragment, new RegExp(`id=["']${id}["']`), `missing #${id}`));
[
  "colors-container",
  "sizes-container",
  "model-product-title",
  "model-product-price",
  "model-all-detelis",
].forEach((className) => assert.match(fragment, new RegExp(`class=["'][^"']*${className}`)));

assert.match(fragment, /role="dialog"/);
assert.match(fragment, /aria-modal="true"/);
assert.match(fragment, /aria-labelledby="dartProductModalTitle"/);
assert.match(fragment, /aria-hidden="true"/);
assert.match(fragment, /<button[^>]+class="dart-modal-close"/);
assert.doesNotMatch(fragment, /fa-[a-z-]+/, "core modal controls must not depend on Font Awesome");

assert.match(storefront, /function ensureModal/);
assert.match(storefront, /modal\.setAttribute\("aria-hidden", "false"\)/);
assert.match(storefront, /modal\.setAttribute\("aria-hidden", "true"\)/);
assert.match(storefront, /event\.key !== "Escape"/);
assert.match(storefront, /addEventListener\("popstate"/);
assert.match(storefront, /window\.DartStorefront = \{[\s\S]{0,120}\bopen,[\s\S]{0,80}\bclose,/);
assert.match(storefront, /setOptionStatus: setProductOptionStatus/);
assert.match(dialog, /product-modal-host/);
assert.match(dialog, /dart-product-route-fix\.js\?v=1\.1/);
assert.match(actions, /\$\("modalBuyBtn"\)/);
assert.match(actions, /\$\("modalWaitBtn"\)/);
assert.match(actions, /DartPlatform\.joinWaiting/);
assert.doesNotMatch(homeUi, /closeProductModal|modalWaitBtn|modalBuyBtn/);
assert.doesNotMatch(productsUi, /closeProductModal|modalWaitBtn|modalBuyBtn/);
assert.doesNotMatch(homePerformance, /closeProductModal|bindProductModalAccessibility|SectionModel/);

assert.doesNotMatch(productPage, /SectionModel|product-modal-host/, "SSR must remain independent of the UI modal");
assert.match(productPage, /canonical/i);
assert.match(productPage, /Product(Group)?/);
assert.match(productPage, /404/);

console.log("PASS one shared accessible Product Modal + one storefront/action owner + independent SSR contract");
