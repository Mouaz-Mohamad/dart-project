"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const html = fs.readFileSync("cart-checkout.html","utf8");
const source = fs.readFileSync("Js/dart-checkout-google.js","utf8");
assert.match(html,/id="dart-checkout-google-map"/);
assert.match(html,/Js\/dart-google-maps-config\.js/);
assert.match(html,/Js\/dart-checkout-google\.js/);
assert.doesNotMatch(html,/leaflet|openstreetmap|dart-checkout-manual-address/i);
assert.match(source,/maps\.googleapis\.com\/maps\/api\/js/);
assert.match(source,/shipping\/validate-point/);
assert.match(source,/dart:checkout-address-ready/);
assert.match(source,/isAddressCovered/);
assert.match(source,/isCurrentSnapshot/);
assert.match(source,/if \(form\.dataset\.dartAddressState === "loading"\)/,
  "changing the address must clear pending verification status");
assert.match(source,/"manual"/);
assert.doesNotMatch(source,/openstreetmap|leaflet|nominatim/i);
new Function(source);
console.log("PASS checkout Google Maps, server pin validation, manual fallback, no legacy maps");
