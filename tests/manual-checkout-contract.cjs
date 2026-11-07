"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const markup = fs.readFileSync("cart-checkout.html", "utf8");
assert.doesNotMatch(markup, /leaflet|openstreetmap|dart-google-maps|id="map"/i);
assert.match(markup, /Js\/dart-checkout-manual-address\.js/);
class Input extends EventTarget {
  constructor(value = "") { super(); this.value = value; }
}
const form = Object.assign(new EventTarget(), {
  dataset: {}, elements: { namedItem: () => ({ value: "" }) },
});
const fields = {
  checkoutForm: form,
  "checkout-country": new Input("Egypt"),
  "governorate-select": new Input("Cairo"),
  "area-input": new Input(),
  "street-input": new Input(),
  "checkout-building": new Input(),
  "checkout-floor": new Input(),
  "formatted-address-input": new Input(),
  "checkout-address-status": new Input(),
};
const window = {
  DartShippingAvailability: {
    ready: true,
    isAddressCovered: (address) => address.governorate === "Cairo",
  },
  DartState: { read: () => null },
  addEventListener() {},
};
const document = {
  readyState: "complete",
  getElementById: (id) => fields[id] || null,
  dispatchEvent() {},
};
vm.runInNewContext(fs.readFileSync("Js/dart-checkout-manual-address.js", "utf8"),
  { window, document, Event });
const controller = window.dartCheckoutAddress;
assert.equal(controller.validate().ok, false, "incomplete address must fail");
for (const [id, val] of [
  ["area-input", "Nasr City"], ["street-input", "Example Street"],
  ["checkout-building", "21"], ["checkout-floor", "3"],
]) fields[id].value = val;
assert.equal(controller.validate().ok, true, "covered complete manual address is valid");
const original = controller.snapshot();
fields["street-input"].value = "Changed street";
assert.equal(controller.isCurrentSnapshot(original), false, "address edits must invalidate the in-flight snapshot");
fields["governorate-select"].value = "Alexandria";
assert.equal(controller.validate().ok, false, "uncovered governorate must fail");
window.DartShippingAvailability.ready = false;
assert.equal(controller.validate().ok, false, "coverage outage must fail closed");
console.log("PASS map-free manual checkout, coverage and stale address guards");
