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

const perfIndex = home.indexOf('src="Js/dart-home-performance.js"');
const uiIndex = home.indexOf('src="Js/dart-ui.home.min.js"');
assert.ok(perfIndex >= 0, "homepage must load dart-home-performance.js");
assert.ok(uiIndex >= 0, "homepage must load the curated home UI runtime");
assert.ok(perfIndex < uiIndex, "performance/session guard must install before the home UI runtime executes");
assert.ok(!home.includes('src="Js/dart-ui.js"'), "homepage must not regress to the full shared UI runtime");
assert.ok(!home.includes('src="Js/dart-platform.js"'), "homepage must not regress to the full unminified platform runtime");

console.log("PASS home performance contract: guest probe, lazy reviews, render guard and runtime ordering");
