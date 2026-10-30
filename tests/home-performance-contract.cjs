// DART CODE GUIDE | tests/home-performance-contract.cjs
// Contract coverage for the homepage-only performance layer.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("Js/dart-home-performance.js", "utf8");
const home = fs.readFileSync("index.html", "utf8");

assert.match(source, /url\.pathname === "\/api\/v1\/me"/, "guest session probe must only short-circuit /api/v1/me");
assert.match(source, /Cache-Control["']?:\s*["']no-store["']/, "guest session response must remain no-store");
assert.match(source, /data-dart-lazy-reviews/, "reviews must keep a lazy activation marker");
assert.match(source, /IntersectionObserver/, "reviews must activate through viewport proximity when supported");
assert.match(source, /rootMargin:\s*["']700px 0px["']/, "reviews must not wait until they are already visible");
assert.match(source, /__dartHomeRenderGuard/, "homepage product rendering must remain guarded against duplicate DOM rebuilds");
assert.match(source, /productRenderSignature/, "render guard must compare visible catalogue state");
assert.match(source, /requestIdleCallback/, "non-critical brand assets should stay outside the critical render path");
assert.match(
  source,
  /root\.setTimeout\(loadFontAwesome,\s*0\)/,
  "Font Awesome must start automatically without waiting for the first pointer or keyboard interaction",
);

const perfIndex = home.indexOf('src="Js/dart-home-performance.js"');
const uiIndex = home.indexOf('src="Js/dart-ui.home.min.js"');
assert.ok(perfIndex >= 0, "homepage must load dart-home-performance.js");
assert.ok(uiIndex >= 0, "homepage must load the curated home UI runtime");
assert.ok(perfIndex < uiIndex, "performance/session guard must install before the home UI runtime executes");
assert.ok(!home.includes('src="Js/dart-ui.js"'), "homepage must not regress to the full shared UI runtime");
assert.ok(!home.includes('src="Js/dart-platform.js"'), "homepage must not regress to the full unminified platform runtime");

const reviewsUi = fs.readFileSync("src/storefront/home-ui.js", "utf8");
const feedback = fs.readFileSync("sections/form-feedback.html", "utf8");
const styles = fs.readFileSync("CSS/main.css", "utf8");
assert.match(home, /id="dartReviewDialog"/, "long reviews need a full-text dialog");
assert.match(home, /data-review-read-more/, "cards need a Read More control");
assert.match(reviewsUi, /showModal\(\)/, "full reviews open a native dialog");
assert.match(home, /data-review-read-more hidden/, "Read More must start hidden until real clipping is measured");
assert.match(reviewsUi, /syncReviewReadMore/, "long reviews must be checked after rendering");
assert.match(reviewsUi, /range\.getClientRects\(\)/, "rendered text lines must determine Read More visibility");
assert.match(styles, /\.dart-review-dialog \{[\s\S]*?width: 90vw;[\s\S]*?height: 90dvh;/, "full-review dialog must use 90% of both viewport dimensions");
assert.match(styles, /overflow-x: hidden;\s*overflow-y: auto;/, "full-review dialog scrolls vertically only");
assert.match(styles, /-webkit-line-clamp: 2/, "review title must be two lines");
assert.match(styles, /-webkit-line-clamp: 4/, "review body must be four lines");
assert.doesNotMatch(feedback, /<select[^>]+name="rating"/, "rating must not use a dropdown");
assert.equal((feedback.match(/type="radio"[^>]+name="rating"/g) || []).length, 5, "choose from five native star radios");
assert.doesNotMatch(feedback, /name="rating"[^>]+checked/, "star rating must start empty");
assert.match(feedback, /name="rating" value="1"[^>]+required/, "native star selection must be required");
assert.match(styles, /direction: ltr/, "star-picker order must stay left to right on RTL pages");
console.log("PASS home performance contract: guest probe, lazy reviews, automatic icons, render guard and runtime ordering");
