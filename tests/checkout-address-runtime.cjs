"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = (file) => fs.readFileSync(file, "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const place = (name, lat = 30.05, lon = 31.35, state = "Cairo") => ({
  lat, lon, display_name: `${name}, ${state}, Egypt`,
  address: { country: "Egypt", state, suburb: `${name} area`, road: `${name} street` },
});
class Element extends EventTarget {
  constructor(tagName = "INPUT") {
    super(); Object.assign(this, { tagName, value: "", dataset: {}, style: {}, textContent: "", disabled: false, attributes: {} });
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild() {}
}
class DetailEvent extends Event {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}
function fixture(saved = true) {
  const form = new Element("FORM"), submit = new Element("BUTTON"), mapElement = new Element("DIV");
  submit.textContent = "Order";
  form.querySelector = () => submit;
  const selectors = { form, map: mapElement };
  for (const name of ["latitude", "longitude", "fullAddress", "country", "governorate", "area", "street", "building", "floor", "status"]) selectors[name] = new Element();
  Object.assign(selectors.country, { value: "Egypt" });
  Object.assign(selectors.governorate, { value: "Cairo" });
  Object.assign(selectors.area, { value: "Old area" });
  Object.assign(selectors.street, { value: "Old street" });
  selectors.building.value = "10"; selectors.floor.value = "2";
  const mapEvents = {}, markers = [], buttons = [], gps = [], requests = [], timers = new Map();
  let timerId = 0, now = 10000;
  const map = { attributionControl: { setPrefix() {} }, setView() { return this; }, on(type, fn) { mapEvents[type] = fn; }, removeLayer() {}, invalidateSize() {} };
  const L = {
    map: () => map, tileLayer: () => ({ addTo() {} }), divIcon: () => ({}),
    marker: () => {
      const events = {};
      const marker = { events, addTo() { return this; }, on(type, fn) { events[type] = fn; }, setLatLng() {}, bindPopup() { return this; }, openPopup() { return this; } };
      markers.push(marker); return marker;
    },
    control: () => ({ addTo() { this.onAdd(); } }),
    DomUtil: { create(tag) { const el = new Element(tag.toUpperCase()); if (tag === "button") buttons.push(el); return el; } },
    DomEvent: { disableClickPropagation() {}, on(el, type, fn) { el.addEventListener(type, fn); } },
  };
  const window = { L, addEventListener() {}, DartState: { read: () => saved ? {
    lat: 30.04, lng: 31.23, country: "Egypt", governorate: "Cairo", area: "Old area", street: "Old street", building: "10", floor: "2", address: "Old destination",
  } : null } };
  const c = {
    window, L, document: { readyState: "complete", querySelector: (key) => selectors[key], getElementById: (key) => key === "checkoutForm" ? form : null },
    navigator: { onLine: true, geolocation: { getCurrentPosition(success, error) { gps.push({ success, error }); } } },
    Event, CustomEvent: DetailEvent, AbortController, URLSearchParams,
    MutationObserver: class { observe() {} },
    Date: class extends Date { static now() { now += 2000; return now; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, { signal }) {
      const gate = deferred(); requests.push({ url, ...gate });
      signal.addEventListener("abort", () => gate.reject(new Error("Synthetic timeout")), { once: true });
      return gate.promise;
    },
  };
  vm.createContext(c); vm.runInContext(source("Js/dart-address.js"), c);
  const controller = window.DartAddress.create({ ...Object.fromEntries(Object.keys(selectors).map((key) => [key, key])), overwriteFromMap: true });
  window.dartCheckoutAddress = controller;
  vm.runInContext(source("Js/dart-checkout-stability.js"), c);
  const respond = (index, result) => requests[index].resolve({ ok: true, json: async () => result });
  const fire = (delay) => {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
  };
  return { c, window, form, submit, fields: selectors, controller, requests, respond, fire, gps, buttons, markers, mapEvents };
}
async function selectionRaces() {
  const f = fixture(); assert.equal(f.controller.validate().ok, true);
  const pending = f.controller.selectLocation(30.05, 31.35);
  assert.equal(f.fields.latitude.value, "", "invalidate the old pin immediately");
  assert.equal(f.controller.validate().ok, false); assert.equal(f.submit.disabled, true);
  const submitEvent = new Event("submit", { cancelable: true }); f.form.dispatchEvent(submitEvent);
  assert.equal(submitEvent.defaultPrevented, true, "Enter/requestSubmit must also be blocked");
  f.fire(8000); assert.equal(f.submit.disabled, true, "elapsed time cannot restore the saved pin");
  f.respond(0, place("New")); await pending;
  assert.equal(f.fields.latitude.value, "30.0500000"); assert.equal(f.fields.street.value, "New street");
  assert.equal(f.fields.fullAddress.value, "New, Cairo, Egypt"); assert.equal(f.fields.floor.value, "2");
  assert.equal(f.controller.validate().ok, true); assert.equal(f.submit.disabled, false);
  const snapshot = f.controller.snapshot(); f.fields.floor.value = "3"; f.fields.floor.dispatchEvent(new Event("input"));
  assert.equal(f.controller.validate().ok, true, "unit edits preserve the verified pin");
  assert.equal(f.controller.isCurrentSnapshot(snapshot), false, "unit edits invalidate an in-flight checkout snapshot");
  const older = f.controller.selectLocation(30.06, 31.36), newer = f.controller.selectLocation(30.07, 31.37);
  f.respond(2, place("Latest", 30.07, 31.37)); await newer;
  f.requests[1].reject(new Error("Older lookup failed")); await older;
  assert.equal(f.fields.latitude.value, "30.0700000"); assert.equal(f.controller.validate().ok, true, "old errors cannot clear the latest valid destination");
  const first = f.controller.selectLocation(30.08, 31.38), second = f.controller.selectLocation(30.09, 31.39);
  f.respond(4, place("Second", 30.09, 31.39)); await second;
  f.respond(3, place("First", 30.08, 31.38)); await first;
  assert.equal(f.fields.street.value, "Second street", "late success cannot overwrite the latest choice");
  f.markers.at(-1).events.dragstart(); assert.equal(f.controller.validate().ok, false, "dragging invalidates before dragend");
}
async function failuresAndManual() {
  const f = fixture(); const pending = f.controller.selectLocation(30.05, 31.35);
  f.fire(12000); await pending;
  assert.equal(f.form.dataset.dartAddressState, "error"); assert.equal(f.controller.validate().ok, false); assert.equal(f.fields.latitude.value, "");
  const outside = f.controller.selectLocation(29.3, 30.85); f.respond(1, place("Outside", 29.3, 30.85, "Faiyum")); await outside;
  assert.equal(f.controller.validate().ok, false, "out-of-zone cannot reuse a saved destination");
  const manual = f.controller.locateManualAddress(), map = f.controller.selectLocation(30.06, 31.36);
  f.respond(3, place("Map", 30.06, 31.36)); await map;
  f.respond(2, [place("Manual")]); await manual;
  assert.equal(f.fields.street.value, "Map street", "late manual lookup cannot replace a map choice");
  const oldMap = f.controller.selectLocation(30.07, 31.37), currentManual = f.controller.locateManualAddress();
  f.respond(5, [place("Manual latest", 30.08, 31.38)]); await currentManual;
  f.respond(4, place("Old map", 30.07, 31.37)); await oldMap;
  assert.equal(f.fields.latitude.value, "30.0800000");
  const staleManual = f.controller.locateManualAddress();
  f.fields.street.value = "Edited"; f.fields.street.dispatchEvent(new Event("input"));
  assert.equal(f.controller.validate().ok, false, "debouncing does not leave the old address ready");
  f.respond(6, [place("Before edit")]); await staleManual;
  assert.equal(f.fields.latitude.value, "", "an edit supersedes a manual lookup before debounce finishes");
  f.fire(1500); f.respond(7, [place("Edited", 30.09, 31.39)]); await tick();
  assert.equal(f.controller.validate().ok, true);
  const missingStreet = place("No road"); delete missingStreet.address.road;
  await f.controller.selectLocation(30.05, 31.35, missingStreet);
  assert.equal(f.fields.street.value, "", "missing provider route must not retain the previous street");
  assert.equal(f.controller.validate().ok, false);
}
async function gpsRaces() {
  const f = fixture(); f.buttons[0].dispatchEvent(new Event("click"));
  assert.equal(f.controller.validate().ok, false, "GPS waiting invalidates before a position callback"); assert.equal(f.submit.disabled, true);
  await f.controller.selectLocation(30.07, 31.37, place("User choice", 30.07, 31.37));
  f.gps[0].success({ coords: { latitude: 30.05, longitude: 31.35 } }); await tick();
  assert.equal(f.requests.length, 0, "late GPS callback must not even start reverse geocoding");
  f.gps[0].error(); assert.equal(f.controller.validate().ok, true);
  f.buttons[0].dispatchEvent(new Event("click")); f.gps[1].error();
  assert.equal(f.controller.validate().ok, false); assert.equal(f.fields.latitude.value, "");
}
function checkoutContext(f, quoteGate) {
  const fields = { customer_name: "Synthetic", phone1: "01000000001", email: "synthetic@example.test" };
  f.form.elements = { namedItem(name) {
    const key = ({ latitude: "latitude", longitude: "longitude", full_address: "fullAddress" })[name] || name;
    return f.fields[key] || { value: fields[name] || "" };
  } };
  const calls = [];
  Object.assign(f.c, { API_BASE: "https://synthetic.test", CART_RESERVATION_ID: "synthetic", cartData: [{ id: "M1", color: "Black", size: "M", quantity: 1 }],
    currentUser: () => ({ id: "customer", name: "Synthetic" }), displayPhone: (x) => x, cleanupCartReservations: async () => {},
    apiRequest: async (url, options) => { calls.push({ url, options }); return url.includes("/cart/quote") ? quoteGate.promise : { order: { orderId: "K-SYNTHETIC" } }; },
    write() {}, uid: () => "next", setCartReservationId() {}, sessionStorage: { setItem() {} }, saveCustomerAddress() {}, hydrateCustomerCommerce() {},
  });
  vm.runInContext(source("src/storefront/platform/checkout.js"), f.c); return calls;
}
const quote = () => ({ lines: [{ modelId: "M1", color: "Black", size: "M" }], fingerprint: "a".repeat(64), totalMinor: 50000 });
async function checkoutRaces() {
  for (const change of ["pending", "verified", "unit"]) {
    const f = fixture(), gate = deferred(), calls = checkoutContext(f, gate);
    const operation = f.c.checkout(f.form); await tick();
    const rejected = assert.rejects(operation, /location changed/);
    if (change === "unit") f.fields.floor.value = "4";
    else if (change === "verified") await f.controller.selectLocation(30.07, 31.37, place("Latest", 30.07, 31.37));
    else void f.controller.selectLocation(30.07, 31.37);
    gate.resolve(quote()); await rejected;
    assert.equal(calls.filter((call) => call.options?.method === "POST").length, 0, change);
  }
  const f = fixture(), gate = deferred(), calls = checkoutContext(f, gate);
  const operation = f.c.checkout(f.form); await tick(); gate.resolve(quote());
  assert.equal((await operation).orderId, "K-SYNTHETIC");
  assert.equal(calls[1].options.body.address.latitude, "30.0400000"); assert.equal(calls[1].options.body.address.fullAddress, "Old destination");
  assert.equal(calls[1].options.headers["Idempotency-Key"], "checkout-synthetic");
  const blocked = fixture(), blockedCalls = checkoutContext(blocked, deferred());
  void blocked.controller.selectLocation(30.07, 31.37);
  await assert.rejects(blocked.c.checkout(blocked.form), /verified/); assert.equal(blockedCalls.length, 0);
  delete blocked.window.dartCheckoutAddress;
  await assert.rejects(blocked.c.checkout(blocked.form), /Verify the delivery/); assert.equal(blockedCalls.length, 0);
}
(async () => {
  await selectionRaces(); await failuresAndManual(); await gpsRaces(); await checkoutRaces();
  console.log("PASS checkout address races: immediate invalidation, delayed/out-of-order success/errors, manual edits/debounce, GPS/drag, timeout, zone rejection and pre-POST snapshot");
})().catch((error) => { console.error(error); process.exitCode = 1; });
