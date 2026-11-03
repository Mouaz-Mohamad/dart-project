import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPilotCheckout } from "../experiments/realtime-pilot/fixtures.js";
import { directHarness, directStore, openStream, until, assertLocalPilotEnvironment } from "../experiments/direct-realtime/test-support.js";
import { DirectOrderFeed, directConnection } from "../experiments/direct-realtime/notifications.js";
import type { ListenConnection } from "../experiments/direct-realtime/notifications.js";
import { subscribeToEvents } from "../experiments/direct-realtime/event-source.js";
import { directSnapshotSource } from "../experiments/direct-realtime/source.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const signals = (stream: Awaited<ReturnType<typeof openStream>>) => stream.frames.filter(frame => frame.includes("event: orders.changed"));

describe("direct PostgreSQL to protected SSE pilot", () => {
  let store: Awaited<ReturnType<typeof directStore>>;
  const harnesses: Array<Awaited<ReturnType<typeof directHarness>>> = [];
  const streams: Array<Awaited<ReturnType<typeof openStream>>> = [];
  beforeAll(async () => { store = await directStore(); }, 30_000);
  afterEach(async () => { await Promise.all(streams.splice(0).map(stream => stream.close())); await Promise.all(harnesses.splice(0).map(h => h.close())); });
  afterAll(async () => { await store?.db.close(); });
  const harness = async (timing?: { lifetimeMs: number; heartbeatMs: number; coalesceMs: number }) => {
    const h = await directHarness(store, timing); harnesses.push(h); return h;
  };
  const stream = async (h: Awaited<ReturnType<typeof directHarness>>) => {
    const s = await openStream(h.base, h.cookie); streams.push(s); await until(() => s.frames.some(f => f.includes("event: ready"))); return s;
  };

  it("signals a real checkout automatically after commit, with no publishing worker; replay creates no second signal", async () => {
    const h = await harness(), s = await stream(h);
    const fixture = await createPilotCheckout(store.pool);
    const order = await fixture.checkout(); await until(() => signals(s).length === 1);
    await fixture.checkout(); await sleep(50); expect(signals(s)).toHaveLength(1);
    const frame = signals(s)[0]!;
    expect(frame).not.toContain(order.orderId); expect(frame).not.toContain("Synthetic");
    const response = await fetch(`${h.base}/direct/snapshot`, { headers: { Cookie: h.cookie } });
    const snapshot = await response.json() as { orders: Array<{ orderId: string }> };
    expect(snapshot.orders.some(row => row.orderId === order.orderId)).toBe(true);
    expect(h.feed.metrics.connectionsOpened).toBe(1); expect(h.feed.metrics.listenStatements).toBe(1);
  });

  it("never sends uncommitted/rolled-back versions and notifies only after COMMIT", async () => {
    const h = await harness(), s = await stream(h), writer = await store.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='orders'");
      await sleep(40); expect(signals(s)).toHaveLength(0);
      await writer.query("ROLLBACK"); await sleep(40); expect(signals(s)).toHaveLength(0);
      await writer.query("BEGIN");
      await writer.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='orders'");
      await sleep(40); expect(signals(s)).toHaveLength(0);
      await writer.query("COMMIT"); await until(() => signals(s).length === 1);
    } finally { await writer.query("ROLLBACK"); writer.release(); }
  });

  it("fans out a commit to two independent API feeds and shares a listener within each feed", async () => {
    const first = await harness(), second = await harness();
    const a = await stream(first), b = await stream(first), c = await stream(second);
    await (await createPilotCheckout(store.pool)).checkout();
    await until(() => [a, b, c].every(s => signals(s).length === 1));
    expect(first.feed.metrics.connectionsOpened).toBe(1); expect(second.feed.metrics.connectionsOpened).toBe(1);
    await a.close(); expect(first.feed.connected).toBe(true);
    await b.close(); await until(() => !first.feed.connected);
  });

  it("does not read versions/snapshots or issue repeated LISTEN/auth queries while idle; keepalive is a comment", async () => {
    const h = await harness({ lifetimeMs: 2000, heartbeatMs: 20, coalesceMs: 5 }), s = await stream(h);
    const before = h.metrics(); await sleep(130);
    expect(h.metrics()).toEqual(before); expect(before.dataReads).toBe(0);
    expect(s.frames.some(frame => frame === ": keepalive")).toBe(true);
  });

  it("revalidates actual session/central permission gates before sending, and denies reconnect after revocation", async () => {
    const h = await harness(), s = await stream(h); h.revoke();
    await (await createPilotCheckout(store.pool)).checkout();
    await until(() => s.done); expect(signals(s)).toHaveLength(0);
    const response = await fetch(`${h.base}/direct/events`, { headers: { Cookie: h.cookie } });
    expect(response.status).toBe(403);
    h.logout(); expect((await fetch(`${h.base}/direct/snapshot`, { headers: { Cookie: h.cookie } })).status).toBe(401);
  });

  it("rejects anonymous/cross-origin streams and caps concurrent streams per session", async () => {
    const h = await harness();
    expect((await fetch(`${h.base}/direct/events`)).status).toBe(401);
    expect((await fetch(`${h.base}/direct/events`, { headers: { Cookie: h.cookie, Origin: "https://other.example" } })).status).toBe(403);
    await stream(h); await stream(h);
    expect((await fetch(`${h.base}/direct/events`, { headers: { Cookie: h.cookie } })).status).toBe(429);
  });

  it("ends streams on database loss; reconnect's authoritative snapshot recovers a final event missed offline", async () => {
    const h = await harness(), first = await stream(h);
    h.feed.close(); await until(() => first.done);
    const missed = await (await createPilotCheckout(store.pool)).checkout();
    const next = await stream(h); expect(next.frames[0]).toContain("event: ready");
    const snapshot = await (await fetch(`${h.base}/direct/snapshot`, { headers: { Cookie: h.cookie } })).json() as { orders: Array<{ orderId: string }> };
    expect(snapshot.orders.some(row => row.orderId === missed.orderId)).toBe(true);
    expect(h.feed.metrics.connectionsOpened).toBe(2);
  });

  it("coalesces a committed burst and drops malformed signals without sending extra data", async () => {
    const h = await harness(), s = await stream(h);
    const writer = await store.pool.connect();
    try {
      await writer.query("BEGIN");
      for (let i = 0; i < 10; i++) await writer.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='orders'");
      await writer.query("COMMIT");
    } finally { writer.release(); }
    await until(() => signals(s).length === 1); await sleep(50); expect(signals(s)).toHaveLength(1);
    await store.pool.query("SELECT pg_notify($1,$2)", [store.channel, '{"id":"bad","version":999999}']);
    await sleep(40); expect(signals(s)).toHaveLength(1);
    expect(h.feed.metrics.notifications).toBe(10);
  });

  it("rotates bounded streams, releases the DB listener, and keeps fixture SQL out of production", async () => {
    const h = await harness({ lifetimeMs: 90, heartbeatMs: 30, coalesceMs: 5 }), s = await stream(h);
    await until(() => s.done); expect(h.feed.subscriberCount).toBe(0); expect(h.feed.connected).toBe(false);
    const sql = await readFile(new URL("../experiments/direct-realtime/schema.sql", import.meta.url), "utf8");
    await expect(store.pool.query(sql)).rejects.toThrow("isolated schema");
    expect(await readFile(new URL("../src/application.ts", import.meta.url), "utf8")).not.toContain("direct-realtime");
    expect(await readFile(new URL("../src/server.ts", import.meta.url), "utf8")).not.toContain("direct-realtime");
  });
});

describe("direct feed failure and browser adapter contracts", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  class Connection extends EventEmitter implements ListenConnection {
    queries: string[] = []; ended = false;
    async connect() {}
    async query(sql: string) { this.queries.push(sql); }
    async end() { this.ended = true; this.emit("end"); }
  }
  const channel = `dart_pilot_orders_${"a".repeat(32)}`;
  it("fetches only the small version after an unchanged reconnect, but loads data after changes or a missed event", async () => {
    let receive!: (signal: { id: string; version: number }) => void;
    let version = 1;
    const loadVersion = vi.fn(async () => version), loadSnapshot = vi.fn(async () => ({ version }));
    const source = directSnapshotSource({ subscribe: async fn => { receive = fn; return { close() {} }; }, loadVersion, loadSnapshot, apply() {} });
    await source.subscribe(() => {}, () => {});
    const signal = new AbortController().signal;
    await source.snapshot(signal); await source.snapshot(signal);
    expect(loadVersion).toHaveBeenCalledOnce(); expect(loadSnapshot).toHaveBeenCalledOnce();
    version = 2; receive({ id: randomUUID(), version }); await source.snapshot(signal);
    expect(loadVersion).toHaveBeenCalledOnce(); expect(loadSnapshot).toHaveBeenCalledTimes(2);
    version = 3; await source.snapshot(signal); // Final event was missed while offline.
    expect(loadVersion).toHaveBeenCalledTimes(2); expect(loadSnapshot).toHaveBeenCalledTimes(3);
  });
  it("fails closed on listener errors, bounds subscribers, and never reconnects without a consumer", async () => {
    const connection = new Connection(), lost = vi.fn(), receive = vi.fn();
    const feed = new DirectOrderFeed(() => connection, channel, 1);
    await feed.subscribe(receive, lost);
    await expect(feed.subscribe(receive, lost)).rejects.toThrow("capacity");
    connection.emit("error", new Error("sensitive internal details"));
    expect(lost).toHaveBeenCalledOnce(); expect(feed.connected).toBe(false); expect(connection.ended).toBe(true);
    expect(feed.metrics.listenStatements).toBe(1);
  });
  it("rejects pooled URLs and rejects production or nonlocal test configurations without exposing credentials", () => {
    expect(() => directConnection("postgres://x:x@ep-example-pooler.neon.tech/db")).toThrow("direct");
    vi.stubEnv("NODE_ENV", "production"); expect(assertLocalPilotEnvironment).toThrow("isolated");
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TEST_DATABASE_URL", "postgres://x:x@external.example/dart_test");
    expect(assertLocalPilotEnvironment).toThrow("loopback");
  });
  it("waits for LISTEN-ready, validates events, resumes on reconnect and closes on startup timeout", async () => {
    vi.useFakeTimers();
    const events = new Map<string, (event: { data?: string }) => void>(), close = vi.fn(), state = vi.fn(), receive = vi.fn();
    const create = () => ({ close, addEventListener: (name: string, fn: (event: { data?: string }) => void) => { events.set(name, fn); } });
    const opening = subscribeToEvents(create, receive, state);
    events.get("ready")!({}); const subscription = await opening;
    events.get("orders.changed")!({ data: JSON.stringify({ id: randomUUID(), version: 2 }) });
    events.get("orders.changed")!({ data: "invalid" }); expect(receive).toHaveBeenCalledOnce();
    events.get("error")!({}); expect(state).toHaveBeenLastCalledWith(false);
    events.get("ready")!({}); expect(state).toHaveBeenLastCalledWith(true);
    subscription.close(); events.get("ready")!({}); expect(state).toHaveBeenLastCalledWith(false);
    const timeout = subscribeToEvents(create, receive, state, 20); const rejection = expect(timeout).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25); await rejection; expect(close).toHaveBeenCalledTimes(2);
  });
});
