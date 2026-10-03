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
  assert.match(stateSource, /20261003-shared-modal-v\d+/, "controller URL must be versioned so stale browser code cannot survive deployment");
  assert.match(stateSource, /DartProductButtonState\?\.sync/, "controller load must immediately resync the product action");
  assert.doesNotMatch(
    storefrontSource,
    /availableStock\(product, selectedSize, selectedColor\) <= 0\)[\s\S]{0,120}selectedSize = null/,
    "Storefront must never erase the selected size just because the exact variant is out of stock",
  );
  assert.match(storefrontSource, /DartProductButtonState\?\.sync/);
  assert.doesNotMatch(storefrontSource, /\$\("modalWaitBtn"\)/, "Waiting state must have one owner");
  assert.match(source, /waiting\.hidden = !state\.showWaiting/);
  assert.match(source, /buy\.hidden = state\.showWaiting/);
  assert.doesNotMatch(source, /createElement\(["']style["']\)/, "the shared action owner must not inject duplicate modal CSS");

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
    showToast: (message) => toasts.push(message),
    cacheFastCartSnapshot: () => {},
    renderCart: () => {},
    updateCartCount: () => {},
    showCartBanner: () => {},
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
    DartStorefront: {
      refresh() {},
      setOptionStatus: (message, state) => statuses.push({ message, state }),
      close() {
        closeCalls += 1;
        modal.style.display = "none";
      },
    },
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
  assert.equal(buy.hidden, true, "Buy must disappear for an unavailable selected variant");
  assert.equal(legacyWaiting.hidden, false, "the shared Waiting action must replace Buy");
  assert.equal(legacyWaiting.textContent, "Notify me when available");
  assert.equal(qtyRow.hidden, true);

  assert.equal(await actions.handleWaiting(), true);
  assert.deepEqual(waitingCalls, [["DT-1", "M", "Black"]]);
  assert.equal(legacyWaiting.textContent, "Already in Waiting");
  assert.equal(legacyWaiting.disabled, true);
  assert.ok(
    toasts.some(
      (message) =>
        message.includes("Regression Tee") && message.includes("M") && message.includes("Black"),
    ),
    "Waiting confirmation must identify product, size and color",
  );

  console.log("PASS shared Buy + Waiting reservation controller contract");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
