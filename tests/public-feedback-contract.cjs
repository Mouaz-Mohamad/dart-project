const fs = require("node:fs");
const assert = require("node:assert/strict");
const standalone = fs.readFileSync("sections/form-feedback.html","utf8");
const embed = fs.readFileSync("sections/form-feedback-embed.html","utf8");
const runtime = fs.readFileSync("Js/dart-public-feedback.js","utf8");
const api = fs.readFileSync("backend/src/modules/commerce/customer-interaction.routes.ts","utf8");
const service = fs.readFileSync("backend/src/modules/commerce/customer-interaction.service.ts","utf8");
for (const ui of [standalone, embed]) {
  assert.match(ui,/id="reviewForm"/);
  assert.equal((ui.match(/type="radio" name="rating"/g)||[]).length, 5);
}
assert.match(standalone,/<!DOCTYPE html>/i);
assert.match(standalone,/src="\/Js\/dart-public-feedback.js"/);
assert.match(standalone,/name="email"[^>]*autocomplete="email"[^>]*>/);
assert.doesNotMatch(standalone,/name="email"[^>]*required/);
assert.match(standalone,/id="dart-public-review-status"/);
assert.match(standalone,/name="website"/);
assert.match(runtime,/fetch\("\/api\/v1\/reviews\/public"/);
assert.match(runtime,/if \(submitting/);
assert.match(api,/router\.post\("\/reviews\/public"/);
assert.match(api,/sharedRateLimitStore\(config, "public-feedback"\)/);
assert.match(api,/signedIn,\s*csrf,\s*requireAccountType\("customer"\)/);
assert.match(service,/source: "Public Feedback Link"/);
assert.match(service,/verifiedPurchase: false/);
assert.match(service,/status: "Pending"/);
for (const path of ["src/storefront/home-ui.js","Js/dart-ui.js"]) {
 const content = fs.readFileSync(path,"utf8");
 assert.match(content,/sections\/form-feedback-embed\.html/);
 assert.doesNotMatch(content,/sections\/form-feedback\.html/);
}
console.log("PASS separate public WhatsApp form, protected customer reviews and moderation contract");
