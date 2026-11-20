// Observable scroll, overscroll and keyboard navigation behavior without browser APIs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const events = {}, docEvents = {}, headerEvents = {}, classes = new Set(), frames = [];
const header = { dataset: {}, offsetHeight: 108, querySelector: () => ({}), contains: node => node === "menu",
  classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
  addEventListener: (type, action) => { headerEvents[type] = action; } };
const document = { readyState: "complete", activeElement: null,
  documentElement: { scrollHeight: 5000 }, body: { classList: { add() {}, remove() {}, contains: () => false } },
  getElementById: () => header,
  addEventListener: (type, action) => { (docEvents[type] ||= []).push(action); } };
const window = { document, scrollY: 0, innerHeight: 800, location: { href: "https://dart.example/", origin: "https://dart.example" },
  navigator: {}, addEventListener: (type, action) => { (events[type] ||= []).push(action); },
  setTimeout: () => 1, clearTimeout() {},
  requestAnimationFrame: action => { frames.push(action); return frames.length; } };
vm.runInNewContext(fs.readFileSync("src/storefront/shopping-bar.js", "utf8"), { window, URL, Set, Object, Math });
function scroll(y) { window.scrollY = y; events.scroll.forEach(action => action()); while (frames.length) frames.shift()(); }
scroll(500); assert(classes.has("dart-nav-hidden"), "scrolling down hides the header");
scroll(499); assert(!classes.has("dart-nav-hidden"), "one upward pixel reveals the header mid-page");
scroll(501); assert(!classes.has("dart-nav-hidden"), "small downward jitter leaves the header visible");
scroll(520); assert(classes.has("dart-nav-hidden"));
document.activeElement = "menu"; headerEvents.focusin(); scroll(550);
assert(!classes.has("dart-nav-hidden"), "keyboard navigation stays visible");
document.activeElement = null; scroll(60); assert(!classes.has("dart-nav-hidden"));
scroll(4200); scroll(4300); assert(classes.has("dart-nav-hidden"), "bottom rubber-band does not masquerade as upward scrolling");
scroll(4199); assert(!classes.has("dart-nav-hidden"));
scroll(4250); events.pageshow.forEach(action => action()); assert(!classes.has("dart-nav-hidden"), "history restoration starts visible");
docEvents["dart:section-loaded"].forEach(action => action()); assert.equal(events.scroll.length, 1, "section reload does not duplicate listeners");
console.log("PASS scroll header: direction, jitter, overscroll, keyboard, restoration and single installation");
