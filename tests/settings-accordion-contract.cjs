"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Eye/Dart Eye.html"), "utf8");
const js = fs.readFileSync(path.join(root, "Eye/dart-settings-accordion.js"), "utf8");
const css = fs.readFileSync(path.join(root, "Eye/dart-settings-accordion.css"), "utf8");
new vm.Script(js, { filename: "dart-settings-accordion.js" });
assert.match(html, /dart-settings-accordion\.css\?v=/);
assert.match(html, /dart-settings-accordion\.js\?v=/);
assert.match(css, /:not\(\.is-open\)[\s\S]*?display:\s*none\s*!important/);
assert.match(js, /aria-expanded/);
assert.match(js, /settings-search-results/);
assert.match(js, /settings-jump/);
assert.match(js, /dart-settings-tabs/);
assert.doesNotMatch(js, /\blocalStorage\b|\bsessionStorage\b|\bfetch\s*\(/);
const cards = [...html.matchAll(/<article\b[^>]*data-settings-group="[^"]+"/g)];
assert.ok(cards.length >= 12, "all settings cards should remain in the HTML");
for (const id of ["settings-commerce-form", "settings-return-period-form", "settings-promotion-form", "settings-display-form", "open-reset-data-modal"]) {
  assert.ok(html.includes('id="' + id + '"'), "original control preserved: " + id);
}

// Lightweight DOM fixture checks keyboard-accessible triggers and one-card-at-a-time state.
class ClassList {
  constructor() { this.values = new Set(); }
  add(v) { this.values.add(v); }
  contains(v) { return this.values.has(v); }
  toggle(v, b) { if (b) this.add(v); else this.values.delete(v); }
}
class El {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.dataset = {}; this.classList = new ClassList();
    this.listeners = {}; this.attributes = {}; this.textContent = ""; this.hidden = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  insertBefore(el, next) { this.children.splice(this.children.indexOf(next), 0, el); }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  matches(selector) { return selector === "article[data-settings-group]" && this.tag === "article"; }
  querySelector(selector) {
    if (selector === ":scope > .dart-settings-accordion-trigger") return this.children.find(e => e.className === "dart-settings-accordion-trigger") || null;
    if (selector === ":scope > .dart-settings-card-copy") return this.copy || null;
    if (selector === "h2") return this.heading || null;
    if (selector === ":scope > span") return this.eyebrow || null;
    if (selector === ".dart-settings-accordion-hint") return this.children.flatMap(e => [e, ...(e.children || [])]).find(e => e.className === "dart-settings-accordion-hint") || null;
    return this.named?.[selector] || null;
  }
}
const fixtureCards = ["one", "two", "blocked"].map((id, i) => {
  const card = new El("article"); card.id = id; card.dataset.settingsGroup = i === 1 ? "sales" : "general";
  card.hidden = i === 2;
  const copy = new El(); copy.heading = { textContent: "Card " + id }; copy.eyebrow = { textContent: "GROUP" };
  card.copy = copy; card.children.push(new El(), copy);
  return card;
});
const content = new El(); content.children = fixtureCards;
const results = new El(), jump = new El(), tabs = new El();
const page = new El();
page.named = { "#settings-jump": jump, "#settings-search-results": results, ".dart-settings-tabs": tabs };
let activated = "";
const lookup = { settings: page, "settings-content": content };
for (const card of fixtureCards) lookup[card.id] = card;
vm.runInNewContext(js, {
  document: { getElementById: id => lookup[id] || null, createElement: tag => new El(tag) },
  window: { DartSettingsTabs: { activate: id => { activated = id; } } },
});
const first = fixtureCards[0], second = fixtureCards[1], blocked = fixtureCards[2];
assert.equal(first.querySelector(":scope > .dart-settings-accordion-trigger").attributes["aria-expanded"], "false");
first.querySelector(":scope > .dart-settings-accordion-trigger").listeners.click[0]();
assert.equal(first.classList.contains("is-open"), true);
second.querySelector(":scope > .dart-settings-accordion-trigger").listeners.click[0]();
assert.equal(first.classList.contains("is-open"), false);
assert.equal(second.classList.contains("is-open"), true);
second.querySelector(":scope > .dart-settings-accordion-trigger").listeners.click[0]();
assert.equal(second.classList.contains("is-open"), false);
jump.listeners.change[0]({ target: { value: "one" } });
assert.equal(first.classList.contains("is-open"), true);
results.contains = () => true;
results.listeners.click[0]({ target: { closest: () => ({ dataset: { settingsResult: "two" } }) } });
assert.equal(second.classList.contains("is-open"), true);
assert.equal(first.classList.contains("is-open"), false);
assert.equal(activated, "sales");
tabs.listeners.click[0]({ target: { closest: () => ({}) } });
assert.equal(second.classList.contains("is-open"), false);
jump.listeners.change[0]({ target: { value: "blocked" } });
assert.equal(blocked.classList.contains("is-open"), false);
console.log("PASS settings accordion: initial collapse, exclusive opening, close, jump, search, tabs and hidden permissions");
