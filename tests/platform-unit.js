// DART CODE GUIDE | tests/platform-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const fs = require("fs");
const vm = require("vm");
const { webcrypto } = require("crypto");

class Storage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

const localStorage = new Storage(),
  sessionStorage = new Storage();
const productsData = [1, 2, 3].map((id, index) => ({
  id,
  category: "shirt",
  title: `Product ${id}`,
  code: index ? "DA-DUP" : "DA-ONE",
  price: 400 + id * 100,
  images: [`Photos/products/${id}.jpg`],
  description: `Product ${id}`,
  stock: { M: { Black: 4 } },
}));

const listeners = {};
const document = {
  cookie: "",
  addEventListener(type, callback) {
    (listeners[type] ||= []).push(callback);
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  getElementById() {
    return null;
  },
  body: {},
};
const window = {
  DART_API_BASE_URL: "",
  addEventListener() {},
  dartAppliedPromotion: null,
  dispatchEvent() {},
};
const context = vm.createContext({
  window,
  document,
  localStorage,
  sessionStorage,
  productsData,
  cartData: [],
  appliedDiscountRate: 0,
  crypto: webcrypto,
  TextEncoder,
  URLSearchParams,
  fetch: async () => {
    throw new Error("not used");
  },
  navigator: {},
  location: { assign() {}, replace() {}, href: "", origin: "", protocol: "http:", hostname: "localhost", pathname: "/Eye/unit-test" },
  MutationObserver: class {
    observe() {}
  },
  setInterval() {
    return 0;
  },
  setTimeout(callback) {
    callback();
    return 0;
  },
  clearTimeout() {},
  clearInterval() {},
  Event: class {
    constructor(type) {
      this.type = type;
    }
  },
  CustomEvent: class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  Set,
  Map,
});
window.window = window;
window.document = document;
window.localStorage = localStorage;
window.sessionStorage = sessionStorage;
window.setInterval = context.setInterval;
window.DartState = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  remove(key) { localStorage.removeItem(key); },
};

vm.runInContext(fs.readFileSync("Js/dart-catalog.js", "utf8"), context);
context.DartCatalog = window.DartCatalog;
const source = fs.readFileSync("Js/dart-platform.js", "utf8");
vm.runInContext(source, context, { filename: "Js/dart-platform.js" });
const platform = window.DartPlatform;
assert(source.includes('dart:customer-session-changed'), 'customer session hydration must notify forms that can safely refill empty contact fields');
assert(source.includes('publicLeaderboardRows = serverRows;'), 'successful server leaderboard responses, including empty lists, must remain authoritative');
assert(!source.includes('serverRows.length ? serverRows : localLeaderboardRows()'), 'browser state must never replace a valid empty leaderboard returned by PostgreSQL');
assert(!source.includes('function localLeaderboardRows()'), 'dead local leaderboard reconstruction must stay removed from production runtime');
assert(source.includes('zoomControl: false'), 'legacy tracking map must not expose zoom controls');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function form(values) {
  return {
    dataset: { dartAddressSource: "manual" },
    elements: {
      namedItem(name) {
        return values[name] == null ? null : { value: String(values[name]) };
      },
    },
  };
}

(async () => {
  platform.ensureCatalogInventory();
  assert(
    !localStorage.getItem("dart_models"),
    "empty installation must not seed models",
  );
  assert(
    !localStorage.getItem("dart_items"),
    "empty installation must not seed items",
  );
  // Explicit test fixtures; these records never ship as runtime defaults.
  localStorage.setItem(
    "dart_models",
    JSON.stringify([
      {
        id: "m1",
        modelId: "DA-ONE",
        name: "Product 1",
        selling: 500,
        cost: 200,
        discount: 0,
        sizeOptions: [{ name: "M", active: true }],
        colorOptions: [{ name: "Black", active: true, images: [] }],
      },
    ]),
  );
  localStorage.setItem(
    "dart_items",
    JSON.stringify(
      [1, 2].map((n) => ({
        id: "i" + n,
        itemCode: "I-" + n,
        modelId: "DA-ONE",
        color: "Black",
        size: "M",
        status: "In stock",
      })),
    ),
  );
  assert(
    platform.money(780.9) === "780 EGP",
    "money must display without piastres or decimal rounding",
  );

  const customer = await platform.register({
    name: "Unit Customer",
    email: "unit@example.com",
    phone1: "01012345678",
    phone2: "",
    password: "StrongPassword123",
    birthday: "2000-01-01",
  });
  const rememberedSession = JSON.parse(localStorage.getItem("dart_session"));
  assert(
    rememberedSession.rememberedUntilLogout === true &&
      !("expiresAt" in rememberedSession),
    "customer login must remain remembered until explicit logout",
  );
  let duplicateRejected = false;
  try {
    await platform.register({
      name: "Duplicate",
      email: "UNIT@example.com",
      phone1: "01112345678",
      phone2: "",
      password: "AnotherPassword123",
      birthday: "2000-01-01",
    });
  } catch {
    duplicateRejected = true;
  }
  assert(duplicateRejected, "duplicate email must be rejected");

  context.cartData = [
    {
      id: "DA-ONE",
      title: "Product 1",
      price: 500,
      quantity: 1,
      size: "M",
      color: "Black",
    },
  ];
  context.appliedDiscountRate = 0.25;
  window.dartCheckoutAddress = {
    validate() {
      return { ok: true, source: "manual", zone: "cairo-giza" };
    },
  };
  const order = await platform.checkout(
    form({
      customer_name: "Unit Customer",
      phone1: "01012345678",
      email: "unit@example.com",
      country: "Egypt",
      governorate: "Cairo",
      area: "Nasr City",
      street: "Example Street",
      building: "12",
      floor: "4",
      latitude: "30.05",
      longitude: "31.30",
      full_address: "12 Example Street, Nasr City, Cairo",
    }),
  );
  assert(
    order.clientId === customer.customerId,
    "checkout must attach the logged customer",
  );
  assert(order.totalPrice === 500, "subtotal must be saved before discount");
  assert(
    order.orderLevelDiscountAmount === 125,
    "discount amount must be saved",
  );
  assert(
    order.finalAmount === 375,
    "final amount must be saved after discount",
  );
  assert(
    platform.orderNet(order) === 375,
    "all consumers must read the saved final amount",
  );
  assert(
    order.latitude === "30.05" && order.addressSource === "manual",
    "address coordinates and source must be saved",
  );

  context.cartData = [
    {
      id: "DA-ONE",
      title: "Product 1",
      price: 500,
      quantity: 1,
      size: "M",
      color: "Black",
    },
  ];
  let outsideZoneRejected = false;
  try {
    await platform.checkout(
      form({
        customer_name: "Unit Customer",
        phone1: "01012345678",
        email: "unit@example.com",
        country: "Egypt",
        governorate: "Alexandria",
        area: "Smouha",
        street: "Example Street",
        building: "12",
        floor: "4",
        latitude: "31.20",
        longitude: "29.92",
        full_address: "Alexandria",
      }),
    );
  } catch {
    outsideZoneRejected = true;
  }
  assert(
    outsideZoneRejected,
    "checkout must reject every governorate except Cairo and Giza",
  );

  // BEGIN Price reconfirmation and expiration regressions.
  const validForm = form({
    customer_name: "Unit Customer",
    phone1: "01012345678",
    email: "unit@example.com",
    country: "Egypt",
    governorate: "Cairo",
    area: "Nasr City",
    street: "Example Street",
    building: "12",
    floor: "4",
    latitude: "30.05",
    longitude: "31.30",
  });
  const updated = JSON.parse(localStorage.getItem("dart_models"));
  updated[0].selling = 600;
  localStorage.setItem("dart_models", JSON.stringify(updated));
  let priceRejected = false;
  try {
    await platform.checkout(validForm);
  } catch (e) {
    priceRejected = e.message.includes("تغيّر سعر");
  }
  assert(
    priceRejected,
    "changed cart price must require explicit reconfirmation",
  );
  assert(
    JSON.parse(localStorage.getItem("dart_orders")).length === 1,
    "price conflict must not create an order",
  );
  assert(
    order.priceSnapshot[0].finalUnitPrice === 500,
    "previous order retains original unit price",
  );
  context.cartData[0].reservationUntil = new Date(0).toISOString();
  localStorage.setItem("dart_cart", JSON.stringify(context.cartData));
  let expiredRejected = false;
  try {
    await platform.checkout(validForm);
  } catch {
    expiredRejected = true;
  }
  assert(
    expiredRejected && context.cartData.length === 0,
    "expired cart must clear before checkout reads its items",
  );
  assert(
    JSON.parse(localStorage.getItem("dart_orders")).length === 1,
    "expired cart must not create an order",
  );
  // END Price reconfirmation and expiration regressions.

  platform.requestPasswordReset("unit@example.com");
  const requests = JSON.parse(
    localStorage.getItem("dart_password_reset_requests"),
  );
  assert(
    requests.length === 1 && requests[0].accountId,
    "password reset request must reach dashboard storage",
  );

  // Leaderboard totals are now covered by the server commerce service tests.
  // The storefront must not reconstruct business totals from browser state.

  // BEGIN V9 birthday reward regression.
  const fixedBirthdayWindow = platform.birthdayWindow(
    "2008-09-02",
    new Date("2026-09-02T12:00:00+03:00"),
  );
  assert(fixedBirthdayWindow, "birthday reward must start on the Cairo birthday");
  assert(
    fixedBirthdayWindow.expiresAt.toISOString() === "2026-09-08T21:00:00.000Z",
    "birthday reward must expire after seven Cairo calendar days",
  );
  assert(
    platform.birthdayWindow(
      "2-9-2008",
      new Date("2026-09-02T12:00:00+03:00"),
    ),
    "birthday reward must support existing day-month-year birthday values",
  );

  const cairoToday = platform.cairoParts(new Date()),
    users = JSON.parse(localStorage.getItem("dart_users"));
  users[0].birthday = `2000-${String(cairoToday.month).padStart(2, "0")}-${String(cairoToday.day).padStart(2, "0")}`;
  localStorage.setItem("dart_users", JSON.stringify(users));
  localStorage.setItem(
    "dart_items",
    JSON.stringify([
      {
        id: "i-birthday",
        itemCode: "I-BIRTHDAY",
        modelId: "DA-ONE",
        color: "Black",
        size: "M",
        status: "In stock",
      },
    ]),
  );
  context.cartData = [
    {
      id: "DA-ONE",
      title: "Product 1",
      price: 600,
      quantity: 1,
      size: "M",
      color: "Black",
    },
  ];
  context.appliedDiscountRate = 0.4;
  window.dartAppliedPromotion = { cardId: "HIGHER-DART-CARD" };
  const birthdayOrder = await platform.checkout(validForm);
  assert(
    birthdayOrder.discount === 30 && birthdayOrder.finalAmount === 420,
    "birthday discount must automatically override a higher Dart Card discount",
  );
  assert(
    birthdayOrder.birthdayRewardId && !birthdayOrder.dartCardId,
    "birthday order must not consume the Dart Card",
  );
  let birthdayRewards = JSON.parse(
    localStorage.getItem("dart_birthday_rewards"),
  );
  assert(
    birthdayRewards[0].status === "Reserved" &&
      birthdayRewards[0].orderId === birthdayOrder.orderId,
    "birthday reward must be reserved when the order is created",
  );
  birthdayOrder.deliveredAt = new Date().toISOString();
  platform.updateBirthdayRewardForOrder(birthdayOrder, "Delivered");
  birthdayRewards = JSON.parse(localStorage.getItem("dart_birthday_rewards"));
  assert(
    birthdayRewards[0].status === "Used" && birthdayRewards[0].usedCount === 1,
    "birthday reward must become used when the order is delivered",
  );
  platform.updateBirthdayRewardForOrder(birthdayOrder, "Cancelled");
  birthdayRewards = JSON.parse(localStorage.getItem("dart_birthday_rewards"));
  assert(
    birthdayRewards[0].status === "Active",
    "a cancelled birthday order must restore the still-valid reward",
  );
  // END V9 birthday reward regression.

  localStorage.setItem(
    "dart_items",
    JSON.stringify([
      {
        id: "i-guest",
        itemCode: "I-GUEST",
        modelId: "DA-ONE",
        color: "Black",
        size: "M",
        status: "In stock",
      },
    ]),
  );
  context.cartData = [
    {
      id: "DA-ONE",
      title: "Product 1",
      price: 600,
      quantity: 1,
      size: "M",
      color: "Black",
    },
  ];
  platform.logout();
  context.cartData = [{ id: "DA-ONE", title: "Product 1", price: 600, quantity: 1, size: "M", color: "Black" }];
  let guestCheckoutRejected = false;
  try {
    await platform.checkout(validForm);
  } catch (error) {
    guestCheckoutRejected = error.message.includes("تسجيل الدخول");
  }
  assert(
    guestCheckoutRejected,
    "checkout must require a registered, logged-in customer",
  );
  console.log("PASS platform unit tests");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
