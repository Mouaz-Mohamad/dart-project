// DART CODE GUIDE | backend/tests/traffic-browser-runtime.test.ts
// الغرض: اختبار هوية الضيف وطلبات الفلتر الفعلية مع محاكاة المتصفح دون بيانات إنتاج.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const platform = readFileSync(new URL("../../Js/dart-platform.js", import.meta.url), "utf8");
const identitySource = platform.slice(platform.indexOf("  // BEGIN Website analytics identity"), platform.indexOf("  // END Website analytics identity."));
const dashboardSource = readFileSync(new URL("../../Eye/dart-traffic-analytics.js", import.meta.url), "utf8");

function browserIdentity(options: { cookies?: boolean; throwingCookie?: boolean; storage?: boolean; initialCookie?: string } = {}) {
  let cookie = options.initialCookie || "";
  let clock = Date.parse("2026-10-22T12:00:00Z");
  const storage = new Map<string, string>();
  const events: Array<{ body: { visitorId: string; sessionId: string; eventType: string } }> = [];
  const document = {};
  Object.defineProperty(document, "cookie", {
    get() { if (options.throwingCookie) throw new Error("Cookies unavailable"); return cookie; },
    set(value: string) { if (options.throwingCookie) throw new Error("Cookies unavailable"); if (options.cookies !== false) cookie = value.split(";")[0] || ""; },
  });
  function page() {
    return runInNewContext(`${identitySource}\n({ visitorId: ANALYTICS_VISITOR_ID, session: ensureAnalyticsSession, track: trackAnalyticsEvent })`, {
      document, location: { protocol: "https:", pathname: "/" }, crypto: webcrypto, Uint8Array,
      Date: { now: () => clock },
      sessionStorage: {
        getItem(key: string) { if (options.storage === false) throw new Error("Storage unavailable"); return storage.get(key); },
        setItem(key: string, value: string) { if (options.storage === false) throw new Error("Storage unavailable"); storage.set(key, value); },
      },
      apiRequest: async (_url: string, event: typeof events[number]) => { events.push(event); },
    });
  }
  return { page, events, storage, advance: (ms: number) => { clock += ms; }, clearTab: () => storage.clear() };
}

describe("guest identity lifecycle", () => {
  it("keeps an existing cookie across navigation, new visits and closing/reopening a tab", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const browser = browserIdentity({ initialCookie: `dart_vid=${id}` });
    const first = browser.page();
    await first.track("visit");
    const next = browser.page();
    await next.track("visit");
    expect(next.visitorId).toBe(id);
    expect(browser.events[1]?.body.sessionId).toBe(browser.events[0]?.body.sessionId);
    browser.advance(31 * 60_000);
    await next.track("add_to_cart", {});
    expect(browser.events.slice(-2).map(event => event.body.eventType)).toEqual(["visit", "add_to_cart"]);
    expect(browser.events.at(-1)?.body.sessionId).not.toBe(browser.events[0]?.body.sessionId);
    browser.clearTab();
    expect(browser.page().visitorId).toBe(id);
    expect(browser.events.every(event => event.body.visitorId === id)).toBe(true);
  });

  it.each([{ cookies: false }, { throwingCookie: true }, { initialCookie: "dart_vid=%bad-encoding" }])(
    "reuses the tab identity when cookies are absent, inaccessible or malformed: %j", options => {
      const browser = browserIdentity(options);
      const first = browser.page();
      browser.advance(31 * 60_000);
      expect(browser.page().visitorId).toBe(first.visitorId);
      expect(browser.storage.get("dart_analytics_visitor_id")).toBe(first.visitorId);
    },
  );

  it("keeps different browsers separate and tolerates unavailable analytics storage in memory", async () => {
    expect(browserIdentity().page().visitorId).not.toBe(browserIdentity().page().visitorId);
    const browser = browserIdentity({ throwingCookie: true, storage: false });
    const page = browser.page();
    await page.track("visit");
    await page.track("visit");
    expect(browser.events[0]?.body.visitorId).toBe(browser.events[1]?.body.visitorId);
    expect(browser.events[0]?.body.sessionId).toBe(browser.events[1]?.body.sessionId);
  });

  it("re-identifies a newly authenticated customer without delaying login or inventing a new session", () => {
    const start = platform.indexOf("  function cacheApiUser(profile)");
    const source = platform.slice(start, platform.indexOf("  async function hydrateCustomerCommerce", start));
    const track = vi.fn();
    const cache = runInNewContext(`let apiUserCache=null, customerCommerceGeneration=0, customerCommercePromise=null, serverReviewEligible=null, serverPurchaseStats=null; ${source}\ncacheApiUser`, {
      adaptApiUser: (profile: unknown) => profile,
      trackAnalyticsEvent: track,
      window: {},
    });
    cache({ id: "account-1" });
    cache({ id: "account-1" });
    cache(null);
    expect(track).toHaveBeenCalledExactlyOnceWith("visit");
  });
});

function trafficDashboard() {
  const callbacks = new Map<string, (event?: { detail?: unknown }) => void>();
  const nodes = new Map<string, ReturnType<typeof node>>();
  function node() {
    return { textContent: "", replaceChildren() {}, appendChild() {}, classList: { toggle() {} }, addEventListener() {} };
  }
  const button = { dataset: { chartPeriodTow: "hourly" }, classList: { toggle() {} }, addEventListener: (_event: string, callback: () => void) => { callbacks.set("hours", callback); } };
  let range = { start: "2026-01-01", end: "2026-10-22" };
  const request = vi.fn(async (url: string) => {
    const query = new URL(url, "https://fixture").searchParams;
    return { start: query.get("start"), end: query.get("end"), group: query.get("group"), series: [], visitors: [], summary: {} };
  });
  const window = {
    DartFinance: { currentRangeSelection: () => range }, DartAdminApi: { request },
    addEventListener: (name: string, callback: () => void) => callbacks.set(name, callback),
    setTimeout: (callback: () => void) => callback(),
  };
  runInNewContext(dashboardSource, {
    window, Intl, Date, URL,
    document: {
      getElementById: (id: string) => id === "analyticsChartTow" ? null : nodes.get(id) || (nodes.set(id, node()), nodes.get(id)),
      querySelectorAll: () => [button], createElement: node,
      addEventListener: (name: string, callback: () => void) => callbacks.set(name, callback),
    },
  });
  return { request, nodes, callbacks, select: (next: typeof range) => { range = next; callbacks.get("dart:finance-period-changed")?.({ detail: next }); } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
describe("traffic period UI", () => {
  it("loads the selected period immediately when Brand lazy-loads after DOMContentLoaded", async () => {
    const ui = trafficDashboard(); await settle();
    expect(ui.request.mock.calls[0]?.[0]).toContain("start=2026-01-01&end=2026-10-22&group=daily");
    expect(ui.nodes.get("trafficPeriodLabelTow")?.textContent).toContain("2026-01-01");
  });

  it("uses the global range for Hours, Last Year and Custom without a separate day window", async () => {
    const ui = trafficDashboard();
    ui.callbacks.get("hours")?.(); await settle();
    expect(ui.request.mock.calls.at(-1)?.[0]).toContain("start=2026-01-01&end=2026-10-22&group=hourly");
    ui.select({ start: "2025-01-01", end: "2025-12-31" }); await settle();
    expect(ui.request.mock.calls.at(-1)?.[0]).toContain("start=2025-01-01&end=2025-12-31&group=hourly");
    ui.select({ start: "2024-02-29", end: "2026-03-01" }); await settle();
    expect(ui.request.mock.calls.at(-1)?.[0]).toContain("start=2024-02-29&end=2026-03-01&group=hourly");
  });

  it("ignores stale responses and clears the old report on failure", async () => {
    const ui = trafficDashboard();
    let release: (value: Awaited<ReturnType<typeof ui.request>>) => void = () => {};
    ui.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    ui.callbacks.get("hours")?.();
    ui.select({ start: "2025-01-01", end: "2025-12-31" }); await settle();
    release({ start: "2026-01-01", end: "2026-10-22", group: "hourly", series: [], visitors: [], summary: { uniqueVisitors: 999 } });
    await settle();
    expect(ui.nodes.get("trafficPeriodLabelTow")?.textContent).toContain("2025-01-01");
    expect(ui.nodes.get("trafficUniqueVisitorsTow")?.textContent).toBe("0");
    ui.request.mockRejectedValueOnce(new Error("Analytics temporarily unavailable"));
    ui.select({ start: "2024-01-01", end: "2024-12-31" }); await settle();
    expect(ui.nodes.get("trafficUniqueVisitorsTow")?.textContent).toBe("—");
    expect(ui.nodes.get("trafficPeriodLabelTow")?.textContent).toBe("Analytics unavailable");
  });
});
