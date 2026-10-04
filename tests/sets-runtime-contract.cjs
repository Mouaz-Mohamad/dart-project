// DART CODE GUIDE | tests/sets-runtime-contract.cjs
// Browser contract for page-scoped Sets loading and additive storefront/dashboard integration.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const settings = fs.readFileSync("Js/dart-site-settings.js", "utf8");
const sets = fs.readFileSync("Js/dart-sets.js", "utf8");
const setModalUi = fs.readFileSync("Js/dart-set-modal-ui.js", "utf8");
const ui = fs.readFileSync("Js/dart-ui.js", "utf8");
const homeUi = fs.readFileSync("Js/dart-ui.home.min.js", "utf8");
const admin = fs.readFileSync("Eye/dart-sets-admin.js", "utf8");
const profile = fs.readFileSync("Js/dart-profile-records.js", "utf8");
const cartPage = fs.readFileSync("cart-checkout.html", "utf8");
const appRuntime = fs.readFileSync("backend/src/app.ts", "utf8");
const application = fs.readFileSync("backend/src/application.ts", "utf8");

assert.match(settings, /SET_STOREFRONT_PAGES/);
assert(settings.includes("normalizedPathname"), "Sets loader must normalize production extensionless routes");
for (const page of ["/products", "/cart-checkout", "/profile"]) {
  assert(settings.includes(page), `Sets loader must include canonical ${page}`);
}
assert(settings.includes('.replace(/\\.html$/i, "")'), "Sets loader must keep legacy .html URLs compatible");
assert(settings.includes('[data-target="models"]'), "Dart Eye Sets must lazy-load from Models navigation");
assert(settings.includes("dart:sets-load-request"), "Sets loader must expose an explicit lazy-load request hook");
assert(profile.includes('dart:sets-extension-ready'), "Profile rows must re-enhance after lazy Sets runtime loads");

assert(sets.includes('/api/v1/sets'), "Storefront Sets client must use the server Sets API");
assert(sets.includes('/api/v1/cart/set-groups'), "Set cart operations must use the server Set-cart API");
assert(!sets.includes('/api/v1/me/sets/waiting'), "Sets must not expose a separate Waiting flow");
assert(!appRuntime.includes('SetWaitingService'), "Runtime must not start the retired Set Waiting service");
assert(!application.includes('createSetWaitingRouter'), "API must not register retired Set Waiting routes");
assert(cartPage.includes('src="Js/dart-sets.js" defer data-dart-sets-asset="Js/dart-sets.js" data-dart-loaded="1"'), "Cart must preload Set grouping before its first render");
assert(!sets.includes("setFilterActive"), "Sets category must use the same category state as normal products, not a parallel filter state");
assert(sets.includes("function listingCategory()") && sets.includes("isSetsCategory"), "Set listing must read the shared product category state");
assert(sets.includes("sortedCombinedCards") && sets.includes("placeProductPageCards"), "Models and Sets must share one Products-page ordering and grid placement flow");
assert(sets.includes("updateListingCount(combined.length)"), "All-products result count must include Sets as products");
assert(sets.includes("!drafts().length && !cartRef().length"), "Fresh empty carts must not probe non-existent Set reservations");
assert(sets.includes("if (cartRef().length && !drafts().length) void restoreServerGroups()"), "Cart hydration must retry Set-group restoration when real cart lines arrive");
assert(sets.includes("data-set-color") && sets.includes("data-set-size"), "Set modal must select color and size per component");
assert(setModalUi.includes('.dart-set-carousel{margin:0;width:100%;aspect-ratio:3/4'), "Set carousel must use a portrait 3:4 aspect ratio");
assert(setModalUi.includes('calc(58dvh * 3 / 4)') && setModalUi.includes('aspect-ratio:3/4'), "Mobile Set carousel must preserve the portrait 3:4 aspect ratio");
assert(setModalUi.includes('.dart-set-piece-image img{display:block;width:100%;aspect-ratio:9/16'), "Set component images must remain portrait 9:16");
assert(sets.includes('sizes.every((size) =>') && sets.includes('colors.every((color) => variantAvailable'), "A Set must become Sold Out when any offered size/color option is unavailable");
assert(sets.includes('stockBadge.textContent = "Sold Out"') && !sets.includes('stockBadge.textContent = "Waiting available"'), "Set cards must show Sold Out instead of Waiting");
assert(sets.includes("function syncSetCards(rows, target = null)"), "Set catalogue rendering must reconcile keyed cards instead of recreating every card");
assert(sets.includes("function syncSetCartCard(card, group, set, pricing, key)"), "Set cart rendering must reconcile keyed group cards");
assert(!sets.includes('["productsPart1","productsPart2","productsContainer"].forEach'), "Set runtime must not observe and rewrite its own product containers");
assert(!sets.includes('new MutationObserver(scheduleCartDecoration).observe(cart'), "Set runtime must not observe and rewrite its own cart container");
assert(!sets.includes("new MutationObserver"), "Set runtime must not observe storefront DOM it also updates");
assert(ui.includes("dart:products-rendered") && homeUi.includes("dart:products-rendered"), "Desktop/products and curated Home renderers must publish an explicit completion event for additive Set rendering");
assert(ui.includes("dart:product-filters-rendered"), "Models filter renderer must publish an explicit completion event for additive Set rendering");
assert(sets.includes('root.addEventListener("dart:products-rendered",syncFiltersAndSets)'), "Sets must render after the Models-owned product renderer completes");
assert(sets.includes('root.addEventListener("dart:product-filters-rendered",syncFiltersAndSets)'), "Sets must render after the Models-owned filter renderer completes");
assert(!sets.includes('root.addEventListener("dart:site-settings-changed",scheduleSetRender)'), "Unrelated site-settings changes must not rerender Set cards");
assert(sets.includes('if (event.detail?.key!=="dart_cart") return;'), "Generic data changes must only trigger Set cart work for dart_cart");
assert(sets.includes('const settingsRequest = request("/api/v1/sets/settings")') && sets.includes('const setsPayload = await request("/api/v1/sets")'), "Set catalogue loading must not depend on Set settings availability");
assert(sets.includes('DEFAULT_SETTINGS = Object.freeze({ birthdayPercent: 10, dartCardPercent: 10, version: 1 })'), "Set settings fallback must remain 10% Birthday and 10% Dart Card");
assert(sets.includes('card.addEventListener("click"') && sets.includes('["Enter", " "].includes(event.key)'), "The whole Set card must open like a Product card by pointer or keyboard");
assert(sets.includes('const groupsById=new Map') && sets.includes('const serverGroupId=String(line.setGroupId'), "Cart Set grouping must use explicit server group identity");
assert(!sets.includes('cart.find(row=>!row.dartSetKey&&String(row.id)===selection.modelId'), "Cart Set grouping must never guess membership from model/color/size");
assert(sets.includes('root.renderCart=(...args)=>') && sets.includes('decorateCart(); return result;'), "Every generic cart rerender must synchronously re-apply Set grouping");
assert(sets.includes('root.updateCartTotals=(...args)=>') && sets.includes('if (drafts().length) renderSetAwareTotals()'), "Set-aware totals must win after generic totals");
assert(ui.includes('if (line?.setGroupId || line?.dartSetKey) return false;'), "Set components must not trigger ordinary Birthday/Dart Card fallback eligibility");

assert(admin.includes('setsButton.dataset.modelSetView="sets"'), "Models section must expose the Sets view inside the shared second bar");
assert(admin.includes('dashboardControls()'), "Models / Sets must share the existing Models dashboard controls");
assert(admin.includes('controls.second.insertBefore(modelsButton,controls.remove)') && admin.includes('controls.second.insertBefore(setsButton,controls.remove)'), "Models / Sets toggles must live in the existing second bar before Delete");
assert(admin.includes('currentView!=="sets"') && admin.includes('stopImmediatePropagation()'), "Shared Add/Delete controls must preserve existing Models handlers and intercept only Sets view");
assert(!admin.includes('data-set-search'), "Sets must reuse the existing Models search instead of creating a second search box");
assert(admin.includes('panel.className="cont-titel dart-sets-admin-panel"') && admin.includes('node.className=`model-row'), "Sets list must reuse the Models table and row visual structure");
assert(admin.includes("data-set-component-add"), "Set editor must support adding components");
assert(admin.includes('can("sets.manage")'), "Set mutations must honor central dashboard permissions");
assert(admin.includes('root.DartAdminHydration?.ready!==true'), "Sets admin must not initialize before authenticated dashboard hydration is ready");
assert(admin.includes('function syncAccess()') && admin.includes('dart:admin-authenticated'), "Sets permissions must be re-synced after admin authentication");
assert(admin.includes("Selling Below Cost"), "Owner below-cost override must remain visibly warned");

console.log("PASS Sets lazy runtime, storefront and Dart Eye contracts");
