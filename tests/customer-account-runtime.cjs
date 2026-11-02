// Exercise the actual session adapter and safe return routes without production writes.
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const read = path => fs.readFileSync(path, "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function context() {
  const events = new Map(); let request = async () => ({ user: { id: "a", accountType: "customer", code: "DR-1", name: "Test" } });
  const c = { URL, URLSearchParams, Date, API_BASE: "https://dart.test", apiUserCache: null, apiSessionUnavailable: false,
    apiSessionPromise: null, apiSessionGeneration: 0, apiSessionChecked: false, apiSessionLastChecked: 0,
    customerCommerceGeneration: 0, customerCommercePromise: null, customerCommerceStatus: "idle", serverReviewEligible: null, serverPurchaseStats: null,
    CustomEvent: class {}, document: { cookie: "", querySelectorAll: () => [], body: { hasAttribute: () => false } },
    location: { href: "https://dart.test/profile.html", pathname: "/profile.html", search: "", replace(value) { c.redirect = value; } },
    window: { addEventListener: (name, fn) => events.set(name, fn), dispatchEvent() {} },
    clearCustomerPrivateCache() { c.cleared = true; }, trackAnalyticsEvent: async () => {}, apiRequest: (...args) => request(...args) };
  vm.createContext(c);
  vm.runInContext(read("src/storefront/platform/customer-state.js") + read("src/storefront/platform/birthday-ui.js") + read("src/storefront/platform/account-navigation.js"), c);
  c.refreshCustomerCommerceInBackground = () => {};
  c.request = fn => request = fn; c.events = events;
  return c;
}
(async () => {
  const c = context(); let calls = 0, resolve;
  c.request(() => { calls++; return new Promise(yes => resolve = yes); });
  const one = c.hydrateApiSession(), two = c.hydrateApiSession();
  assert.equal(calls, 1, "overlapping session checks share one request even without a CSRF cookie");
  resolve({ user: { id: "a", accountType: "customer", code: "DR-1", name: "Test" } });
  await Promise.all([one, two]); assert.equal(c.currentUser().id, "a");
  c.request(async () => { throw Object.assign(new Error("offline"), { status: 503 }); });
  await assert.rejects(c.hydrateApiSession()); assert.equal(c.currentUser().id, "a", "network failure must not log out");
  c.request(async () => { throw Object.assign(new Error("revoked"), { status: 401 }); });
  assert.equal(await c.hydrateApiSession(), null); assert.equal(c.currentUser(), null); assert.equal(c.cleared, true);
  c.request(() => new Promise(yes => resolve = yes)); const stale = c.hydrateApiSession();
  c.cacheApiUser(null); resolve({ user: { id: "a", accountType: "customer" } }); await stale;
  assert.equal(c.currentUser(), null, "a late response cannot resurrect logout");
  for (const [query, expected] of [
    ["?next=profile&view=orders", "profile.html?view=orders"],
    ["?next=profile&view=waiting", "profile.html?view=waiting"],
    ["?next=return", "form-return.html"], ["?next=checkout", "cart-checkout.html"],
    ["?next=track&order=K-1", "track.html?order=K-1"],
    ["?next=https://evil.test&view=__proto__", "profile.html"],
  ]) { c.location.search = query; assert.equal(c.requestedAuthDestination(), expected); }
  c.location.href = "https://dart.test/profile.html?view=returns";
  assert.equal(c.customerLoginUrl(), "Sign%20Up%20modern.html?next=profile&view=returns");
  const html = read("profile.html");
  assert.doesNotMatch(html, /birthdayWhatsappPreference|data-notification-refresh|data-notification-mark|data-push-toggle/);
  assert.doesNotMatch(html, /src="Js\/dart-(?:whatsapp-preferences|customer-notifications)\.js"/);
  console.log("PASS account sessions: absent CSRF helper, coalesced checks, network failure, revocation, stale response and safe deep-link returns");
  await tick();
})().catch(error => { console.error(error); process.exitCode = 1; });
