// Contract tests for the two-step return/exchange form.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "form-return.html"), "utf8");
const wizard = fs.readFileSync(path.join(root, "Js/dart-return-step-flow.js"), "utf8");
const platform = fs.readFileSync(path.join(root, "Js/dart-platform.js"), "utf8");
const css = fs.readFileSync(path.join(root, "CSS/dart-return-step-flow.css"), "utf8");

for (const id of ["return-full-name", "return-phone-1", "return-phone-2", "return-item-code",
  "return-request-type", "return-reason", "return-exchange-options", "return-pickup-address",
  "return-latitude", "return-longitude", "return-area", "return-street", "return-building", "return-floor"]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Preserve existing API/address field " + id);
}
assert.match(html, /id="return-step-details"/);
assert.match(html, /id="return-step-address"[^>]*hidden/);
assert.match(html, /id="return-pickup-address"[^>]*disabled/);
assert.match(html, /id="return-next-step"[^>]*type|type="button" id="return-next-step"/);
assert.match(html, /id="return-back-step"/);
assert.match(html, /id="return-email" name="email"/);
assert.doesNotMatch(html, /id="return-email"[^>]*required/);
assert.doesNotMatch(html, /id="return-notes"/);
assert.match(html, /<aside class="dart-return-notices"/);
assert.match(html, /id="return-fee-summary" class="dart-return-fee-summary"/);
assert.match(wizard, /event\.stopImmediatePropagation\(\)/);
assert.match(wizard, /pickup\.disabled = !showingAddress/);
assert.match(wizard, /map\?\.invalidate\?\.\(\)/);
assert.match(wizard, /form\.addEventListener\("invalid"/);
assert.match(platform, /window\.dartReturnAddress \|\| window\.DartAddress\?\.initReturnRequest/);
assert.match(platform, /values\.phone1 && order\.phone1/);
assert.match(css, /\.dart-return-step\[hidden\]/);
console.log("Return wizard layout, validation, map and API contract: passed");
