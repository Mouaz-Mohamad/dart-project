import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const catalogSource = readFileSync(new URL("../../Js/dart-catalog.js", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../../Eye/dart-domain-state.js", import.meta.url), "utf8");
const response = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
type ReadResponse = ReturnType<typeof response>;
type CatalogApi = { hydrate: (force?: boolean) => Promise<void>; refreshChanged: () => Promise<void>;
  write: (key: string, data: unknown[]) => void; serverVersion: () => number };
type DomainApi = { hydrateDomain: (domain: string) => Promise<unknown[]>; refreshChanged: () => Promise<void>;
  write: (key: string, data: unknown[]) => void; writeAndSync: (key: string, data: unknown[]) => Promise<unknown[]>;
  version: (domain: string) => number; hydrateAudit: () => Promise<unknown[]> };

function runtime(source: string) {
  const state = new Map<string, unknown[]>();
  const remote = { catalog: { version: 1, models: [] as unknown[], items: [] as unknown[] },
    domains: { cards: { version: 1, data: [{ id: "card-1" }] },
      returns: { version: 1, data: [{ id: "return-1" }] } } as Record<string, { version: number; data: unknown[] }> };
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const fetch = vi.fn(async (url: string, _options?: { method?: string }): Promise<ReadResponse> => {
    const path = new URL(url).pathname;
    if (path.endsWith("catalog/version")) return response({ version: remote.catalog.version });
    if (path.endsWith("catalog-state")) return response(structuredClone(remote.catalog));
    if (path.endsWith("domain-state-versions")) return response({ versions: Object.fromEntries(
      Object.entries(remote.domains).map(([domain, row]) => [domain, row.version])) });
    if (path.includes("domain-state/")) return response(structuredClone(remote.domains[path.split("/").at(-1)!]));
    if (path.endsWith("audit")) return response({ audit: [{ id: "audit-1" }] });
    throw new Error(`Unexpected read: ${path}`);
  });
  const window = {
    DART_API_BASE_URL: "https://dart.test", DartCatalog: undefined as unknown as CatalogApi,
    DartDomainState: undefined as unknown as DomainApi,
    DartState: { read: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      write: (key: string, value: unknown[]) => { state.set(key, value); }, remove: (key: string) => state.delete(key) },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, [...listeners.get(type) || [], fn]); },
    dispatchEvent: (event: { type: string; detail?: unknown }) => { listeners.get(event.type)?.forEach((fn) => fn(event)); },
    setInterval: vi.fn(),
  };
  runInNewContext(source, { window, location: { origin: "https://dart.test", pathname: "/Eye/dart.html" },
    document: { cookie: "", hidden: false, addEventListener() {} },
    CustomEvent: class { constructor(public type: string, public options?: unknown) {} },
    Event: class { constructor(public type: string) {} }, fetch, setTimeout, clearTimeout, clearInterval,
    structuredClone, TextEncoder, crypto: globalThis.crypto, console,
  });
  return { window, state, remote, fetch, logout: () => {
    state.clear(); window.dispatchEvent({ type: "dart:data-changed", detail: { key: "dart_orders", source: "logout" } });
  } };
}

describe("read-only related state refresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("reads domain versions once and fetches only changed allowed domains", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    await api.hydrateDomain("cards"); await api.hydrateDomain("returns"); f.fetch.mockClear();
    f.remote.domains.returns!.version = 2;
    f.remote.domains.returns!.data = [{ id: "return-2" }];
    await api.refreshChanged();
    expect(f.fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/v1/admin/domain-state-versions", "/api/v1/admin/domain-state/returns",
    ]);
    expect(f.state.get("dart_returns")).toEqual([{ id: "return-2" }]);
    expect(f.state.get("dart_cards")).toEqual([{ id: "card-1" }]);
    expect(f.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });

  it("does not save or overwrite a local domain edit during a related refresh", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    await api.hydrateDomain("cards"); api.write("dart_cards", [{ id: "local-edit" }]); f.fetch.mockClear();
    f.remote.domains.cards!.version = 2;
    await api.refreshChanged();
    expect(f.fetch).toHaveBeenCalledTimes(2); // Version check plus the previously unhydrated allowed returns domain.
    expect(f.fetch.mock.calls.some(([url]) => url.endsWith("/cards"))).toBe(false);
    expect(f.state.get("dart_cards")).toEqual([{ id: "local-edit" }]);
    expect(f.fetch.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  });

  it("ignores an older domain read arriving after a newer snapshot", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    await api.hydrateDomain("cards");
    let resolve!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = api.hydrateDomain("cards");
    f.remote.domains.cards = { version: 3, data: [{ id: "newer" }] };
    await api.hydrateDomain("cards");
    resolve(response({ version: 2, data: [{ id: "older" }] })); await old;
    expect(api.version("cards")).toBe(3);
    expect(f.state.get("dart_cards")).toEqual([{ id: "newer" }]);
  });

  it("rechecks versions when a mutation refresh joins an earlier in-flight check", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    await api.hydrateDomain("cards"); await api.hydrateDomain("returns"); f.fetch.mockClear();
    let resolve!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = api.refreshChanged();
    f.remote.domains.cards = { version: 2, data: [{ id: "after-mutation" }] };
    const second = api.refreshChanged(); expect(second).toBe(first);
    resolve(response({ versions: { cards: 1, returns: 1 } })); await second;
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith("domain-state-versions"))).toHaveLength(2);
    expect(f.state.get("dart_cards")).toEqual([{ id: "after-mutation" }]);
  });

  it("does not restore private domain or audit data after logout", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    let resolveDomain!: (value: ReadResponse) => void;
    let resolveAudit!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolveDomain = done; }));
    const domain = api.hydrateDomain("cards");
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolveAudit = done; }));
    const audit = api.hydrateAudit(); f.logout();
    resolveDomain(response({ version: 2, data: [{ id: "private" }] }));
    resolveAudit(response({ audit: [{ id: "private-audit" }] })); await domain; await audit;
    expect(f.state.size).toBe(0); expect(api.version("cards")).toBe(0);
  });

  it("does not start a queued edit when logout interrupts its initial hydration", async () => {
    const f = runtime(domainSource); const api = f.window.DartDomainState;
    let resolve!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const edit = api.writeAndSync("dart_cards", [{ id: "old-session-edit" }]);
    const rejected = expect(edit).rejects.toThrow("Staff session changed");
    f.logout(); resolve(response({ version: 2, data: [] })); await rejected;
    expect(f.state.size).toBe(0);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  });

  it("fetches catalog data only after its version changes", async () => {
    const f = runtime(catalogSource); const api = f.window.DartCatalog;
    await api.hydrate(); f.fetch.mockClear();
    await api.refreshChanged();
    expect(f.fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/api/v1/catalog/version"]);
    f.remote.catalog = { version: 2, models: [{ modelId: "new-model" }], items: [{ id: "new-item" }] };
    await api.refreshChanged();
    expect(api.serverVersion()).toBe(2);
    expect(f.state.get("dart_items")).toEqual([{ id: "new-item" }]);
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith("catalog-state"))).toHaveLength(1);
  });

  it("does not save dirty catalog data as a side effect of an order refresh", async () => {
    const f = runtime(catalogSource); const api = f.window.DartCatalog;
    await api.hydrate(); api.write("dart_models", [{ modelId: "local" }]); f.fetch.mockClear();
    f.remote.catalog.version = 2;
    await api.refreshChanged();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0]?.[0]).toMatch(/catalog\/version$/);
    expect(f.state.get("dart_models")).toEqual([{ modelId: "local" }]);
  });

  it("preserves a catalog edit made after a read starts, even on a forced read", async () => {
    const f = runtime(catalogSource); const api = f.window.DartCatalog;
    await api.hydrate();
    let resolve!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const read = api.hydrate(true); api.write("dart_models", [{ modelId: "local" }]);
    resolve(response({ version: 2, models: [{ modelId: "remote" }], items: [] })); await read;
    expect(f.state.get("dart_models")).toEqual([{ modelId: "local" }]);
    expect(api.serverVersion()).toBe(1);
  });

  it("does not regress catalog versions or restore a late private read after logout", async () => {
    const f = runtime(catalogSource); const api = f.window.DartCatalog;
    await api.hydrate();
    let resolve!: (value: ReadResponse) => void;
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = api.hydrate(); f.remote.catalog = { version: 3, models: [], items: [{ id: "newest" }] };
    await api.hydrate(); resolve(response({ version: 2, models: [], items: [{ id: "older" }] })); await old;
    expect(api.serverVersion()).toBe(3);
    f.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const privateRead = api.hydrate(); f.logout();
    resolve(response({ version: 4, models: [], items: [{ id: "private" }] })); await privateRead;
    expect(f.state.size).toBe(0); expect(api.serverVersion()).toBe(0);
  });
});
