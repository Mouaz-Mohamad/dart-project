import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
interface Control {
  id: string; type: string; dataset: Record<string, string>; disabled: boolean;
  matches(selector: string): boolean; closest(selector: string): Control | null;
  dartPermissionSource?: Control;
}
function node(id = "", classes: string[] = [], attributes: string[] = [], parent: Control | null = null, form = false): Control {
  const result: Control = { id, type: "button", dataset: {}, disabled: false,
    matches(selector) { return selector.split(",").some(part => {
      const value = part.trim();
      return value === "button" ? !form && !classes.includes("dashboard-section") : value === "form" ? form : value.startsWith("#") ? value.slice(1) === id :
        value.startsWith(".") ? classes.includes(value.slice(1)) :
          value.startsWith("[") ? attributes.includes(value.slice(1, -1)) : false;
    }); },
    closest(selector) { return this.matches(selector) ? this : parent?.closest(selector) || null; },
  };
  return result;
}
interface Policy {
  any(...keys: string[]): boolean; catalogRead(): boolean; domainRead(): boolean;
  required(node: Control, submit?: boolean): string[] | null; refresh(scope?: unknown): void;
  canPersist(key: string): boolean | null;
}
function fixture(initial: string[] = []) {
  let grants = new Set(initial);
  const controls: Control[] = [], fields = new Map<string, { value: string }>();
  const callbacks = new Map<string, (event: unknown) => void>();
  const document = { readyState: "loading", getElementById: (id: string) => fields.get(id),
    querySelectorAll: () => controls, addEventListener: (name: string, callback: (event: unknown) => void) => callbacks.set(name, callback) };
  const window = { document, DartAdminPermissions: undefined as unknown as Policy,
    DartAdminAccess: { can: (key: string) => grants.has(key), list: () => [...grants] },
    addEventListener() {}, DartDialog: { alert: vi.fn() } };
  runInNewContext(read("Eye/dart-permissions.js"), { window });
  const policy = window.DartAdminPermissions;
  return { policy, controls, fields, callbacks, grant: (...keys: string[]) => { grants = new Set(keys); },
    allowed: (control: Control, submit = false) => policy.any(...policy.required(control, submit) || []) };
}
describe("dashboard action presentation and execution permissions", () => {
  it("keeps view-only accounts from editing while preserving independent grants", () => {
    const f = fixture(["orders.read"]), section = node("orders", ["dashboard-section"]);
    const edit = node("", ["btn-edit"], [], section), remove = node("", ["btn-hard-delete"], [], section);
    expect(f.allowed(edit)).toBe(false); expect(f.allowed(remove)).toBe(false);
    f.grant("orders.edit"); expect(f.allowed(edit)).toBe(true); expect(f.allowed(remove)).toBe(false);
    f.grant("orders.delete"); expect(f.allowed(edit)).toBe(false); expect(f.allowed(remove)).toBe(true);
    f.grant("orders.manage"); expect(f.allowed(edit)).toBe(true); expect(f.allowed(remove)).toBe(true);
  });
  it("allows piece edits without model edits or unrelated return actions", () => {
    const f = fixture(["inventory.manage"]);
    expect(f.policy.catalogRead()).toBe(true);
    expect(f.allowed(node("", ["btn-edit"], [], node("items", ["dashboard-section"])))).toBe(true);
    expect(f.allowed(node("", ["btn-edit"], [], node("models", ["dashboard-section"])))).toBe(false);
    expect(f.allowed(node("", ["return-accept-btn"]))).toBe(false);
    f.grant("returns.assign");
    expect(f.allowed(node("", ["return-assign-btn"]))).toBe(true);
    expect(f.allowed(node("", ["return-accept-btn"]))).toBe(false);
    expect(f.allowed(node("", ["return-good-btn"]))).toBe(false);
  });
  it("rechecks create/edit on submit and blocks unauthorized direct clicks", () => {
    const f = fixture(["orders.create"]), form = node("orderForm", [], [], null, true);
    expect(f.allowed(form, true)).toBe(true);
    f.fields.set("modal-order-edit-id", { value: "O-1" });
    expect(f.allowed(form, true)).toBe(false);
    const event = { target: form, type: "submit", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    f.callbacks.get("submit")!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    f.grant("orders.edit"); const click = { target: node("", ["dart-back-btn"]), type: "click", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    f.callbacks.get("click")!(click); expect(click.preventDefault).toHaveBeenCalledOnce();
  });
  it("hides both compact action proxies and originals without overwriting busy state", () => {
    const f = fixture(["orders.read"]), primary = node("", ["dart-back-btn"]), proxy = node();
    primary.disabled = true; proxy.dartPermissionSource = primary; f.controls.push(primary, proxy);
    f.policy.refresh(); expect(primary.dataset.dartAccessDenied).toBe("true"); expect(proxy.dataset.dartAccessDenied).toBe("true");
    f.grant("orders.manage"); f.policy.refresh();
    expect(primary.dataset.dartAccessDenied).toBe("false"); expect(primary.disabled).toBe(true);
  });
  it("does not turn an action-only grant into a forbidden domain read", () => {
    const f = fixture(["returns.assign", "customers.manage"]); expect(f.policy.domainRead()).toBe(false);
    f.grant("contacts.read"); expect(f.policy.domainRead()).toBe(true);
    f.grant("finance.manage_expenses"); expect(f.policy.domainRead()).toBe(true);
  });
  it("limits shared saves to the employee's writable domains", () => {
    const f = fixture(["inventory.manage", "contacts.read", "customers.manage"]);
    expect(f.policy.canPersist("dart_items")).toBe(true);
    expect(f.policy.canPersist("dart_models")).toBe(false);
    expect(f.policy.canPersist("dart_customers")).toBe(true);
    expect(f.policy.canPersist("dart_contact_messages")).toBe(false);
    const source = read("src/dashboard/core/bootstrap.js");
    const save = source.slice(source.indexOf("function saveDataToStorage("), source.indexOf("function openModal("));
    const write = vi.fn();
    const run = runInNewContext(save + "saveDataToStorage", { window: { DartAdminPermissions: f.policy, DartCatalog: { write } } }) as (key: string, rows: unknown[]) => void;
    run("dart_models", []); expect(write).not.toHaveBeenCalled();
    run("dart_items", []); expect(write).toHaveBeenCalledOnce();
  });
  it("routes shared feedback saves to the correct permission and durable domain", () => {
    const f = fixture(["contacts.read", "contacts.manage"]);
    const source = read("src/dashboard/core/bootstrap.js"), write = vi.fn();
    const save = source.slice(source.indexOf("function saveDataToStorage("), source.indexOf("function openModal("));
    const run = runInNewContext(save + "saveDataToStorage", { window: { DartAdminPermissions: f.policy,
      DartDomainState: { domainForStorageKey: () => true, write } } }) as (key: string, rows: unknown[]) => void;
    const review = { id: "review" }, contact = { id: "contact", recordType: "contact" };
    run("dart_reviews", [review, contact]);
    expect(write).toHaveBeenCalledExactlyOnceWith("dart_contact_messages", [contact]);
    write.mockClear(); f.grant("reviews.read", "reviews.manage");
    run("dart_reviews", [review, contact]);
    expect(write).toHaveBeenCalledExactlyOnceWith("dart_reviews", [review]);
  });
});

describe("permission-aware bootstrap and polling", () => {
  it.each(["catalog.read", "inventory.manage", "catalog.manage"])("hydrates allowed catalogue context for %s", async permission => {
    const source = read("Eye/dart-admin-auth.js"), start = source.indexOf("  async function unlock()"), end = source.indexOf("  function friendlyAuthError", start);
    const hydrate = vi.fn(), remove = vi.fn();
    const window = { DartAdminAccess: { can: (key: string) => key === permission, list: () => [permission] },
      DartCatalog: { hydrate }, DartState: { remove }, dispatchEvent() {} };
    const run = runInNewContext(source.slice(start, end) + "unlock", { window,
      document: { body: { classList: { remove() {} } } }, authView: {}, logoutButton: {}, CustomEvent: class {},
      hydrateStage: async (_stage: string, work: () => Promise<void>) => work() }) as () => Promise<void>;
    await run(); expect(hydrate).toHaveBeenCalledOnce();
    expect(remove.mock.calls.some(([key]) => key === "dart_models" || key === "dart_items")).toBe(false);
  });
  it.each(["Eye/dart-orders-api.js", "Eye/dart-domain-state.js"])("%s never repeatedly polls forbidden endpoints", async file => {
    const intervals: Array<() => Promise<void>> = [], listeners = new Map<string, Array<() => void>>();
    let grants: string[] = [];
    const window = { DartAdminAccess: { can: (key: string) => grants.includes(key), list: () => grants },
      DartState: { read: () => [], write() {}, remove() {} }, DartAdminPermissions: undefined as unknown as Policy,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, [...listeners.get(name) || [], callback]),
      dispatchEvent() {}, setInterval: (callback: () => Promise<void>) => intervals.push(callback) };
    runInNewContext(read("Eye/dart-permissions.js"), { window });
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN" } }) });
    runInNewContext(read(file), { window, document: { cookie: "", hidden: false, head: { append() {} }, createElement: () => ({}), addEventListener() {} },
      location: { origin: "https://dart.test" }, fetch, CustomEvent: class {}, structuredClone, TextEncoder, crypto: globalThis.crypto,
      setTimeout: vi.fn(), clearTimeout: vi.fn(), console: { warn: vi.fn(), error: vi.fn() } });
    listeners.get("dart:admin-authenticated")!.forEach(fn => fn());
    for (let tick = 0; tick < 2; tick++) for (const fn of intervals) await fn();
    expect(fetch).not.toHaveBeenCalled();
    grants = [file.includes("orders") ? "orders.read" : "contacts.read"];
    listeners.get("dart:admin-authenticated")!.forEach(fn => fn());
    for (let tick = 0; tick < 3; tick++) for (const fn of intervals) await fn();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
