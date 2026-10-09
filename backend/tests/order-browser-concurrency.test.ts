// DART CODE GUIDE | backend/tests/order-browser-concurrency.test.ts
// الغرض: اختبار ترتيب ردود الطلبات، الضغط المتزامن، وفشل الاتصال دون كتابة حالة تجارية من المتصفح.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../Eye/dart-orders-api.js", import.meta.url), "utf8");
type Row = { id: string; orderId: string; status: string; finalAmount: number; isChecked?: boolean };
const initial = (): Row[] => [
  { id: "id-a", orderId: "K-A", status: "New", finalAmount: 600 },
  { id: "id-b", orderId: "K-B", status: "New", finalAmount: 600 },
];

function runtime() {
  let rows = initial();
  let snapshot = { version: 1, orders: initial() };
  let deferNextRead = false;
  let finishRead: ((payload: typeof snapshot) => void) | undefined;
  const pending: Array<{ path: string; resolve: (value: unknown) => void; failHttp: (status: number) => void; reject: (error: Error) => void }> = [];
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const fetch = vi.fn((url: string, options: { method: string; signal?: AbortSignal }) => {
    if (options.method === "GET") {
      if (!deferNextRead) return Promise.resolve({ ok: true, json: async () => snapshot });
      deferNextRead = false;
      return new Promise((resolve) => {
        finishRead = (payload) => resolve({ ok: true, json: async () => payload });
      });
    }
    return new Promise((resolve, reject) => {
      pending.push({ path: url, resolve: (payload) => resolve({ ok: true, json: async () => payload }),
        failHttp: (status) => resolve({ ok: false, status, json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Request failed" } }) }), reject });
      options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")));
    });
  });
  const catalog = vi.fn().mockImplementation(() => new Promise(() => {}));
  const window = {
    DART_API_BASE_URL: "https://dart.test", DartState: { read: () => rows, write: (_key: string, value: Row[]) => { rows = value; } },
    DartCatalog: { hydrate: catalog }, setInterval: vi.fn(),
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, [...listeners.get(type) || [], fn]); },
    dispatchEvent: (event: { type: string; detail?: unknown }) => { listeners.get(event.type)?.forEach((fn) => fn(event)); },
    DartOrdersApi: undefined as unknown as {
      hydrate: (force?: boolean) => Promise<Row[]>;
      workflow: (ref: string, input: { expectedStatus: string; target: string }) => Promise<Row[]>;
      write: (orders: Row[]) => void; read: () => Row[]; serverVersion: () => number; isBusy: (ref?: string) => boolean;
    },
  };
  runInNewContext(source, { window, location: { origin: "https://dart.test" },
    document: { cookie: "", hidden: false, addEventListener() {}, head: { append() {} }, createElement: () => ({}) },
    CustomEvent: class { constructor(public type: string, public options?: unknown) {} },
    fetch, setTimeout, clearTimeout, AbortController, console,
  });
  return { api: window.DartOrdersApi, pending, fetch, catalog, window,
    snapshot: (value: typeof snapshot) => { snapshot = value; },
    deferRead: () => { deferNextRead = true; },
    finishRead: (payload: typeof snapshot) => { finishRead!(payload); } };
}

describe("orders browser concurrency", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("publishes each confirmed response even when a second order is still pending", async () => {
    const { api, pending } = runtime(); await api.hydrate();
    const first = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    const second = api.workflow("K-B", { expectedStatus: "New", target: "Accepted" });
    expect(pending).toHaveLength(2);
    pending[0]!.resolve({ version: 2, orders: initial().map((row) => row.orderId === "K-A" ? { ...row, status: "Accepted" } : row) });
    await first;
    expect(api.read()[0]?.status).toBe("Accepted");
    expect(api.isBusy("id-a")).toBe(false);
    expect(api.isBusy("id-b")).toBe(true);
    pending[1]!.resolve({ version: 3, orders: initial().map((row) => ({ ...row, status: "Accepted" })) });
    await second;
    expect(api.read().every((row) => row.status === "Accepted")).toBe(true);
  });

  it("blocks refreshes during a mutation and discards reads initiated before that mutation", async () => {
    const f = runtime(); await f.api.hydrate();
    f.deferRead();
    const earlierRead = f.api.hydrate(true);
    const action = f.api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    await f.api.hydrate(true);
    expect(f.fetch.mock.calls.filter(([, options]) => options.method === "GET")).toHaveLength(2);
    f.pending[0]!.resolve({ version: 2, orders: initial().map((row) => row.orderId === "K-A" ? { ...row, status: "Accepted" } : row) });
    await action;
    f.finishRead({ version: 3, orders: initial() }); await earlierRead;
    expect(f.api.serverVersion()).toBe(2);
    expect(f.api.read()[0]?.status).toBe("Accepted");
    f.snapshot({ version: 3, orders: initial() });
    await f.api.hydrate(true);
    expect(f.api.serverVersion()).toBe(3);
  });

  it("does not let a slower older response overwrite a newer snapshot", async () => {
    const { api, pending } = runtime(); await api.hydrate();
    const first = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    const second = api.workflow("K-B", { expectedStatus: "New", target: "Accepted" });
    pending[1]!.resolve({ version: 3, orders: initial().map((row) => ({ ...row, status: "Accepted" })) }); await second;
    pending[0]!.resolve({ version: 2, orders: initial() }); await first;
    expect(api.serverVersion()).toBe(3);
    expect(api.read().every((row) => row.status === "Accepted")).toBe(true);
  });

  it("blocks duplicate actions through either the order code or database id", async () => {
    const { api, pending } = runtime(); await api.hydrate();
    const first = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    await expect(api.workflow("id-a", { expectedStatus: "New", target: "Cancelled" }))
      .rejects.toMatchObject({ code: "ORDER_ACTION_PENDING" });
    expect(pending).toHaveLength(1);
    pending[0]!.resolve({ version: 2, orders: initial() }); await first;
    expect(api.isBusy()).toBe(false);
  });

  it("keeps committed commands successful when a secondary refresh hangs and coalesces refreshes", async () => {
    const { api, pending, catalog } = runtime(); await api.hydrate();
    const first = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    const second = api.workflow("K-B", { expectedStatus: "New", target: "Accepted" });
    pending[0]!.resolve({ version: 2, orders: initial() }); await first;
    pending[1]!.resolve({ version: 3, orders: initial() }); await second;
    expect(api.isBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(151);
    expect(catalog).toHaveBeenCalledTimes(1);
  });

  it("retains orders when a committed response requires a refresh", async () => {
    const { api, pending, snapshot } = runtime(); await api.hydrate();
    const action = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    snapshot({ version: 2, orders: initial().map((row) => row.orderId === "K-A" ? { ...row, status: "Accepted" } : row) });
    pending[0]!.resolve({ version: 2, orders: [], refreshRequired: true }); await action;
    expect(api.read()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.read()[0]?.status).toBe("Accepted");
  });

  it("times out an unconfirmed mutation, unlocks its row and reconciles without retrying POST", async () => {
    const { api, fetch } = runtime(); await api.hydrate();
    const action = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    const rejection = expect(action).rejects.toMatchObject({ code: "ORDER_RESULT_UNKNOWN" });
    await vi.advanceTimersByTimeAsync(20001); await rejection;
    expect(api.isBusy("K-A")).toBe(false);
    expect(fetch.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("legacy writes can only change checkbox selection, never status, price or inventory", async () => {
    const { api, fetch } = runtime(); await api.hydrate();
    api.write(initial().map((row) => ({ ...row, status: "Delivered", finalAmount: 0, isChecked: true })));
    expect(api.read()[0]).toMatchObject({ status: "New", finalAmount: 600, isChecked: true });
    expect(fetch.mock.calls.some(([, options]) => options.method === "PUT")).toBe(false);
  });

  it("reconciles an uncertain server failure without automatically repeating the mutation", async () => {
    const { api, pending, snapshot, fetch } = runtime(); await api.hydrate();
    const action = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    snapshot({ version: 2, orders: initial().map((row) => row.orderId === "K-A" ? { ...row, status: "Accepted" } : row) });
    pending[0]!.failHttp(503);
    await expect(action).rejects.toMatchObject({ code: "ORDER_RESULT_UNKNOWN", status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.read()[0]?.status).toBe("Accepted");
    expect(api.isBusy()).toBe(false);
    expect(fetch.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("clears confirmed private rows and rejects a late mutation response after the session is cleared", async () => {
    const { api, pending, window } = runtime(); await api.hydrate();
    const action = api.workflow("K-A", { expectedStatus: "New", target: "Accepted" });
    window.DartState.write("dart_orders", []);
    window.dispatchEvent({ type: "dart:data-changed", detail: { key: "dart_orders", source: "logout" } });
    api.write(initial());
    expect(api.read()).toEqual([]);
    expect(api.isBusy()).toBe(false);
    pending[0]!.resolve({ version: 2, orders: initial() });
    await expect(action).rejects.toMatchObject({ code: "ORDER_SESSION_CHANGED" });
    expect(api.read()).toEqual([]);
    expect(api.serverVersion()).toBe(0);
  });
});
