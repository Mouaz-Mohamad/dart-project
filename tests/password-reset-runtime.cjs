// Exercise the maintained reset dialog with isolated DOM and API doubles.
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const source = fs.readFileSync("src/storefront/platform/authentication.js", "utf8");
function fixture() {
  const nodes = new Map(); let handler = async () => ({ challengeId: "synthetic-challenge" });
  const calls = [], document = { activeElement: null, getElementById: id => nodes.get(id) || null };
  class Element {
    constructor(tag = "button", parent = null) { this.tag = tag; this.parent = parent; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.children = []; this.hidden = false; this.disabled = false; this.value = ""; this.minLength = 0; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] || null; }
    appendChild(child) { this.children.push(child); child.parent = this; if (child.id) nodes.set(child.id, child); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() { document.activeElement = this; }
    closest() { return this.hidden ? this : this.parent?.closest() || null; }
    querySelectorAll(selector) { const tags = selector.split(","); return this.children.flatMap(child => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.selectors?.[selector] || this.querySelectorAll(selector)[0] || null; }
    reset() { Object.values(this.elements || {}).forEach(input => { input.value = ""; }); }
    checkValidity() { return Object.values(this.elements || {}).every(input => input.value && input.value.length >= input.minLength && (input.name !== "code" || /^\d{6}$/.test(input.value))); }
    reportValidity() { this.invalid = true; }
    fire(name, extra = {}) { return this.listeners[name]?.({ preventDefault() {}, target: this, ...extra }); }
    set innerHTML(value) {
      this.markup = value; this.selectors = {};
      const control = (tag, selector, parent = this) => { const node = new Element(tag); parent.appendChild(node); this.selectors[selector] = node; return node; };
      control("button", "[data-reset-close]");
      for (const [id, names] of [["dartPasswordResetRequestForm", ["identifier"]], ["dartPasswordResetCompleteForm", ["code", "password", "confirmation"]]]) {
        const form = control("form", `#${id}`); form.id = id; nodes.set(id, form); form.elements = {};
        form.hidden = id.includes("Complete");
        for (const name of names) { const input = control("input", `${id}:${name}`, form); input.name = name; form.elements[name] = input; }
        control("button", `${id}:submit`, form);
      }
      control("button", "[data-reset-resend]", this.selectors["#dartPasswordResetCompleteForm"]);
      const success = control("div", "[data-reset-success]"); success.hidden = true;
      control("button", "[data-reset-login]", success);
    }
  }
  document.createElement = tag => new Element(tag); document.head = new Element("head"); document.body = new Element("body");
  const trigger = new Element("a"); trigger.focus();
  const login = new Element("form"); login.elements = { identifier: new Element("input"), password: new Element("input") }; nodes.set("loginForm", login);
  const c = { document, API_BASE: "https://synthetic.test", requestAnimationFrame: fn => fn(),
    setStatus(form, message, error = false) { form.status = message; form.error = error; },
    apiRequest: async (...args) => { calls.push(args); return handler(...args); } };
  vm.createContext(c); vm.runInContext(source, c); c.openPasswordReset("customer", "synthetic@example.test");
  const dialog = nodes.get("dartPasswordResetDialog"), request = nodes.get("dartPasswordResetRequestForm"), complete = nodes.get("dartPasswordResetCompleteForm");
  const click = selector => dialog.querySelector(selector).fire("click");
  return { c, dialog, request, complete, calls, login, trigger, click, api(fn) { handler = fn; } };
}
(async () => {
  assert.match(source, /\.dart-reset-card \[hidden\]\{display:none\}/, "author styles must honor hidden steps");
  const f = fixture(); assert.equal(f.complete.hidden, true); assert.equal(f.complete.elements.password.minLength, 6);
  const controls = f.dialog.querySelectorAll("button,input").filter(node => !node.closest("[hidden]"));
  controls.at(-1).focus(); await f.dialog.fire("keydown", { key: "Tab" });
  assert.equal(f.c.document.activeElement, controls[0]);
  await f.dialog.fire("keydown", { key: "Tab", shiftKey: true });
  assert.equal(f.c.document.activeElement, controls.at(-1));
  f.request.elements.identifier.value = ""; await f.request.fire("submit");
  assert.equal(f.calls.length, 0); assert.equal(f.request.invalid, true);
  f.request.elements.identifier.value = "synthetic@example.test";
  let resolve; f.api(() => new Promise(yes => resolve = yes));
  const first = f.request.fire("submit"); await f.request.fire("submit");
  assert.equal(f.calls.length, 1); assert.equal(f.request.elements.identifier.disabled, true);
  resolve({ challengeId: "first" }); await first;
  assert.equal(f.request.hidden, true); assert.equal(f.complete.hidden, false);
  assert.match(f.complete.status, /If the account exists/); assert.equal(f.dialog.dataset.challengeId, "first");
  f.complete.elements.code.value = "123456"; f.complete.elements.password.value = "abcdef"; f.complete.elements.confirmation.value = "ghijkl";
  await f.complete.fire("submit"); assert.match(f.complete.status, /do not match/); assert.equal(f.calls.length, 1);
  f.complete.elements.confirmation.value = "abcdef";
  for (const [code, message] of [["OTP_INVALID", /incorrect/], ["OTP_EXPIRED", /expired/], ["PASSWORD_REUSED", /recently/]]) {
    f.api(async () => { throw Object.assign(new Error("private internal diagnostic"), { code }); });
    await f.complete.fire("submit"); assert.match(f.complete.status, message); assert.equal(f.complete.elements.password.disabled, false);
    assert.equal(f.complete.elements.password.value, "abcdef");
  }
  f.api(() => new Promise(yes => resolve = yes)); const changing = f.complete.fire("submit"); await f.complete.fire("submit");
  const count = f.calls.length; resolve({}); await changing; assert.equal(f.calls.length, count);
  assert.equal(f.complete.hidden, true); assert.equal(f.dialog.querySelector("[data-reset-success]").hidden, false);
  assert.equal(f.complete.elements.password.value, ""); assert.equal(f.dialog.dataset.challengeId, "");
  f.click("[data-reset-login]"); assert.equal(f.dialog.hidden, true); assert.equal(f.login.elements.identifier.value, "synthetic@example.test");
  assert.equal(f.c.document.activeElement, f.login.elements.password);

  const stale = fixture(); stale.api(() => new Promise(yes => resolve = yes)); const waiting = stale.request.fire("submit");
  stale.click("[data-reset-close]"); assert.equal(stale.c.document.activeElement, stale.trigger);
  stale.c.openPasswordReset("representative", "rep@example.test"); assert.equal(stale.complete.elements.password.minLength, 12);
  resolve({ challengeId: "old-account" }); await waiting;
  assert.equal(stale.request.hidden, false); assert.equal(stale.dialog.dataset.challengeId, ""); assert.equal(stale.request.elements.identifier.disabled, false);
  stale.api(async () => { throw new Error("private connection string"); }); await stale.request.fire("submit");
  assert.match(stale.request.status, /check your connection/); assert.doesNotMatch(stale.request.status, /private/);
  stale.api(async () => ({ challengeId: "second" })); await stale.request.fire("submit");
  stale.complete.elements.password.value = "do-not-retain"; stale.click("[data-reset-resend]");
  assert.equal(stale.request.hidden, false); assert.equal(stale.complete.hidden, true); assert.equal(stale.complete.elements.password.value, "");
  assert.equal(stale.dialog.dataset.challengeId, ""); assert.equal(stale.request.elements.identifier.value, "rep@example.test");
  await stale.dialog.fire("keydown", { key: "Escape" }); assert.equal(stale.dialog.hidden, true);
  console.log("PASS password reset UI: step visibility, policy, duplicate submits, mismatch, invalid/expired/reused codes, success/login, retries, resend, stale responses, Escape and secret cleanup");
})().catch(error => { console.error(error); process.exitCode = 1; });
