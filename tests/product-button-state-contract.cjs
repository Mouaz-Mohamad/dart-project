const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "Js/dart-product-button-state.js"), "utf8");
const stateSource = fs.readFileSync(path.join(root, "Js/dart-state.js"), "utf8");
const storefrontSource = fs.readFileSync(path.join(root, "Js/dart-storefront.js"), "utf8");

function makeButton(text = "") {
  return {
    hidden: false,
    disabled: false,
    textContent: text,
    dataset: {},
    attrs: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    closest(selector) { return selector === ".modal-qty-row" ? this._qtyRow : null; },
  };
}

(async () => {
  assert.match(stateSource, /DOMContentLoaded/);
  assert.match(stateSource, /scheduleProductButtonState/);
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
  assert.match(
    storefrontSource,
    /if \(actionController\?\.sync\)/,
    "Loaded Buy\/Waiting controller must remain the action-button state owner",
  );

  const buy = makeButton("Buy");
  const waiting = makeButton("Waiting");
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
    ["modalWaitBtn", waiting],
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

  // One click starts the reservation immediately; a second click while busy is ignored.
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

  // Unavailable exact variant hides Buy and exposes a blue Waiting reservation action.
  actions.__resetForTests();
  modal.style.display = "flex";
  context.cartData.length = 0;
  context.getAvailableStock = () => 0;
  buy.hidden = false;
  waiting.hidden = true;
  waiting.disabled = false;
  const waitingState = actions.sync();
  assert.equal(waitingState.showWaiting, true);
  assert.equal(buy.hidden, true);
  assert.equal(waiting.hidden, false);
  assert.equal(waiting.style.background, "#2563eb");
  assert.equal(qtyRow.hidden, true);

  assert.equal(await actions.handleWaiting(), true);
  assert.deepEqual(waitingCalls, [["DT-1", "M", "Black"]]);
  assert.equal(waiting.textContent, "Reserved in Waiting");
  assert.equal(waiting.disabled, true);
  assert.ok(
    toasts.some(
      (message) =>
        message.includes("Regression Tee") && message.includes("M") && message.includes("Black"),
    ),
    "Waiting confirmation must identify product, size and color",
  );

  console.log("PASS single-click Buy + Adding state + real Waiting reservation contract");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
