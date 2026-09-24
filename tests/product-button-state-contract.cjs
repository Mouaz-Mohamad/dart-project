const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "Js/dart-product-button-state.js"), "utf8");
const stateSource = fs.readFileSync(path.join(root, "Js/dart-state.js"), "utf8");
const storefrontSource = fs.readFileSync(path.join(root, "Js/dart-storefront.js"), "utf8");

function makeStyle() {
  const values = new Map();
  return {
    setProperty(name, value) { values.set(name, String(value)); },
    removeProperty(name) { values.delete(name); },
    getPropertyValue(name) { return values.get(name) || ""; },
  };
}

function makeButton(text = "") {
  return {
    hidden: false,
    disabled: false,
    textContent: text,
    dataset: {},
    attrs: {},
    style: makeStyle(),
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    closest(selector) { return selector === ".modal-qty-row" ? this._qtyRow : null; },
  };
}

(async () => {
  assert.match(stateSource, /DOMContentLoaded/);
  assert.match(stateSource, /scheduleProductButtonState/);
  assert.match(stateSource, /20260924-single-action-v\d+/, "controller URL must be versioned so stale browser code cannot survive deployment");
  assert.match(stateSource, /DartProductButtonState\?\.sync/, "controller load must immediately resync the product action");
  assert.doesNotMatch(
    storefrontSource,
    /availableStock\(product, selectedSize, selectedColor\) <= 0\)[\s\S]{0,120}selectedSize = null/,
    "Storefront must never erase the selected size just because the exact variant is out of stock",
  );
  assert.match(
    storefrontSource,
    /const showWaiting = Boolean\(waitingEnabled && hasVariant && qty <= 0\)/,
    "Storefront must have an immediate Waiting fallback while the action controller loads",
  );
  assert.ok(
    source.includes('action=state.showWaiting?handleWaiting:handleBuy'),
    "the single primary action must route unavailable variants to Waiting, not Buy",
  );
  assert.ok(
    source.includes('data-dart-action="waiting"') && source.includes("#2563eb"),
    "Waiting must have a scoped blue visual rule on the primary action",
  );

  const buy = makeButton("Buy");
  const legacyWaiting = makeButton("Waiting");
  const qtyRow = { hidden: false };
  const qtyControl = makeButton();
  qtyControl._qtyRow = qtyRow;

  const modal = {
    style: { display: "flex" },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const nodes = new Map([
    ["modalBuyBtn", buy],
    ["modalWaitBtn", legacyWaiting],
    ["modalQtyControl", qtyControl],
    ["SectionModel", modal],
  ]);

  const documentListeners = {};
  const document = {
    readyState: "complete",
    getElementById(id) { return nodes.get(id) || null; },
    addEventListener(type, fn) { documentListeners[type] = fn; },
  };

  const statuses = [];
  const toasts = [];
  const waitingCalls = [];
  let persistCalls = 0;
  let resolvePersist;
  let closeCalls = 0;

  const context = {
    console,
    encodeURIComponent,
    queueMicrotask,
    document,
    window: null,
    globalThis: null,
    activeProduct: {
      id: "DT-1",
      title: "Regression Tee",
      price: 600,
      images: ["x.jpg"],
    },
    selectedSize: "M",
    selectedColor: "Black",
    modalQuantity: 1,
    cartData: [],
    getAvailableStock: () => 1,
    setProductOptionStatus: (message, state) => statuses.push({ message, state }),
    showToast: (message) => toasts.push(message),
    cacheFastCartSnapshot: () => {},
    renderCart: () => {},
    updateCartCount: () => {},
    showCartBanner: () => {},
    closeProductModal: () => {
      closeCalls += 1;
      modal.style.display = "none";
    },
    persistCartReservation: () => {
      persistCalls += 1;
      return new Promise((resolve) => { resolvePersist = resolve; });
    },
    sessionStorage: { setItem() {} },
    location: { pathname: "/products.html", assign() {} },
    addEventListener() {},
    DartSiteSettings: { get: () => ({ waiting: { enabled: true } }) },
    DartCatalog: { model: () => ({}), cover: () => "cover.jpg" },
    DartPlatform: {
      currentUser: () => ({ id: "C1" }),
      cartReservationId: "CART-1",
      joinWaiting: async (...args) => {
        waitingCalls.push(args);
        return { id: "W1" };
      },
    },
    DartStorefront: { refresh() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const actions = context.DartProductButtonState;
  assert.ok(actions, "Buy/Waiting controller must load");

  const inStock = actions.decide({ hasColor: true, hasSize: true, stock: 2, waitingEnabled: true });
  assert.equal(inStock.showBuy, true);
  assert.equal(inStock.showWaiting, false);

  const outOfStock = actions.decide({ hasColor: true, hasSize: true, stock: 0, waitingEnabled: true });
  assert.equal(outOfStock.showBuy, false);
  assert.equal(outOfStock.showWaiting, true);

  const firstBuy = actions.handleBuy();
  assert.equal(buy.disabled, true);
  assert.equal(buy.textContent, "Adding…");
  assert.equal(context.cartData.length, 1, "optimistic cart update must be immediate");
  const secondBuy = actions.handleBuy();
  assert.equal(persistCalls, 1, "two immediate Buy attempts must create one reservation write");
  resolvePersist(true);
  assert.equal(await firstBuy, true);
  assert.equal(await secondBuy, false);
  assert.equal(closeCalls, 1);
  assert.equal(toasts.some((message) => /Only \d+/i.test(message)), false);

  actions.__resetForTests();
  modal.style.display = "flex";
  context.cartData.length = 0;
  context.getAvailableStock = () => 0;
  buy.hidden = false;
  legacyWaiting.hidden = true;
  const waitingState = actions.sync();
  assert.equal(waitingState.showWaiting, true);
  assert.equal(buy.hidden, false, "primary action must never disappear for an unavailable selected variant");
  assert.equal(buy.dataset.dartAction, "waiting");
  assert.equal(buy.textContent, "Waiting");
  assert.equal(legacyWaiting.hidden, true, "legacy secondary Waiting node must stay out of the visual path");
  assert.equal(qtyRow.hidden, true);

  assert.equal(await actions.handleWaiting(), true);
  assert.deepEqual(waitingCalls, [["DT-1", "M", "Black"]]);
  assert.equal(buy.textContent, "Reserved in Waiting");
  assert.equal(buy.disabled, true);
  assert.ok(
    toasts.some(
      (message) =>
        message.includes("Regression Tee") && message.includes("M") && message.includes("Black"),
    ),
    "Waiting confirmation must identify product, size and color",
  );

  console.log("PASS single-primary-action Buy + Adding + real Waiting reservation contract");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
