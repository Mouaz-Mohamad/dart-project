import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { createPilotCheckout, installPilotFixture } from "../experiments/realtime-pilot/fixtures.js";
import { AblyRestPublisher, PilotOutbox } from "../experiments/realtime-pilot/outbox.js";
import { BrokerFixture } from "../experiments/realtime-pilot/broker-fixture.js";
import { PilotClient } from "../experiments/realtime-pilot/client.js";
import { pilotRouter } from "../experiments/realtime-pilot/router.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { VersionedSnapshot } from "../experiments/realtime-pilot/client.js";
import type { OrderSignal } from "../experiments/realtime-pilot/outbox.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("isolated real-time order pilot (no production mounts)", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, commerce: CommerceService;
  const clients: Array<{ stop(): void }> = [];
  beforeAll(async () => {
    store = await embeddedStore(true); commerce = new CommerceService(store.pool);
    await installPilotFixture(store.pool);
  }, 30000);
  beforeEach(async () => { await store.pool.query("DELETE FROM realtime_pilot_events"); });
  afterEach(() => { clients.splice(0).forEach(client => client.stop()); });
  afterAll(async () => { await store?.db.close(); });

  it("requires an explicit fixture guard and is not imported by production", async () => {
    await expect(store.pool.query(await readFile(new URL("../experiments/realtime-pilot/schema.sql", import.meta.url), "utf8")))
      .rejects.toThrow("explicitly isolated fixture");
    expect(await readFile(new URL("../src/application.ts", import.meta.url), "utf8")).not.toContain("realtime-pilot");
  });

  it("creates a real checkout and event atomically; replay does not create a second event", async () => {
    const f = await createPilotCheckout(store.pool);
    const order = await f.checkout(), replay = await f.checkout();
    expect(replay.orderId).toBe(order.orderId);
    const events = await store.pool.query("SELECT * FROM realtime_pilot_events");
    expect(events.rows).toHaveLength(1); expect(events.rows[0].state).toBe("pending");
    const version = await commerce.adminOrdersVersion(); expect(Number(events.rows[0].version)).toBe(version);
    await store.pool.query("BEGIN");
    await store.pool.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='orders'");
    await store.pool.query("ROLLBACK");
    expect((await store.pool.query("SELECT id FROM realtime_pilot_events")).rows).toHaveLength(1);
  });

  it("keeps a committed order when publishing fails and retries the same durable event", async () => {
    const f = await createPilotCheckout(store.pool), order = await f.checkout();
    const broker = new BrokerFixture(); broker.fail = true;
    let now = Date.now() + 2000;
    const outbox = new PilotOutbox(store.pool, broker, () => new Date(now));
    expect(await outbox.drain()).toMatchObject({ failed: 1, published: 0 });
    expect((await commerce.adminOrders()).orders.some(row => row.orderId === order.orderId)).toBe(true);
    expect((await outbox.health()).pending).toBe("1");
    expect((await outbox.drain()).claimed).toBe(0);
    now += 600; broker.fail = false;
    expect((await outbox.drain()).published).toBe(1);
    expect((await outbox.drain()).claimed).toBe(0);
    expect(broker.messages).toHaveLength(1);
    expect(Object.keys(broker.messages[0]!).sort()).toEqual(["id", "version"]);
  });

  it("fences active worker leases and safely replays after provider success / lost DB acknowledgement", async () => {
    await (await createPilotCheckout(store.pool)).checkout();
    const gatePublish = gate<void>(), broker = new BrokerFixture();
    let now = Date.now() + 2000;
    const first = new PilotOutbox(store.pool, { publish: async signal => { await broker.publish(signal); await gatePublish.promise; } }, () => new Date(now));
    const operation = first.drain(); await sleep(10);
    const second = new PilotOutbox(store.pool, broker, () => new Date(now));
    expect((await second.drain()).claimed).toBe(0);
    // The first worker's lease expires after it published but before it can ack.
    now += 11000;
    expect((await second.drain()).published).toBe(1);
    gatePublish.resolve(); expect((await operation).published).toBe(0);
    expect(broker.messages).toHaveLength(1); expect((await second.health()).pending).toBe("0");
  });

  it("uses the central permission/MFA/session middleware for snapshot reads", async () => {
    let auth: AuthenticatedAccount | null = { userId: randomUUID(), sessionId: randomUUID(), accountType: "staff", permissions: ["orders.read"], mfaRequired: false } as AuthenticatedAccount;
    const identity = { authenticate: async () => auth } as unknown as IdentityService;
    const app = express(); app.use(cookieParser()); app.use("/pilot", pilotRouter(identity, commerce, { sessionCookieName: "dart_session" }));
    app.use((error: { statusCode?: number; status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || error.status || 500).json({ code: error.code }));
    const cookie = `dart_session=${randomUUID()}.${"x".repeat(43)}`;
    expect((await request(app).get("/pilot/snapshot").set("Cookie", cookie)).status).toBe(200);
    auth.permissions = []; expect((await request(app).get("/pilot/snapshot").set("Cookie", cookie)).status).toBe(403);
    auth.accountType = "customer"; auth.permissions = ["orders.read"];
    expect((await request(app).get("/pilot/snapshot").set("Cookie", cookie)).status).toBe(403);
    auth.accountType = "staff"; auth.mfaRequired = true; auth.mfaSatisfied = false;
    expect((await request(app).get("/pilot/snapshot").set("Cookie", cookie)).status).toBe(403);
    auth = null; expect((await request(app).get("/pilot/snapshot").set("Cookie", cookie)).status).toBe(401);
  });

  it("delivers a committed order to a dashboard state, coalesces duplicates and recovers a missed last event", async () => {
    const broker = new BrokerFixture(); let reads = 0, allowed = true;
    let dashboard: Awaited<ReturnType<CommerceService["adminOrders"]>> | null = null;
    const client = new PilotClient({
      subscribe: (receive, state) => broker.subscribe(async () => allowed, receive, state),
      snapshot: async () => { reads++; return commerce.adminOrders(); }, apply: snapshot => { dashboard = snapshot; },
    }, 5); clients.push(client);
    await client.start(); expect(client.healthy).toBe(true); expect(reads).toBe(1);
    const order = await (await createPilotCheckout(store.pool)).checkout();
    const outbox = new PilotOutbox(store.pool, broker, () => new Date(Date.now() + 2000));
    await outbox.drain();
    await sleep(20); await client.reconcile();
    expect(dashboard!.orders.some(row => row.orderId === order.orderId)).toBe(true);
    const beforeDuplicates = reads;
    const signal = broker.messages[0]!; client.receive(signal); client.receive({ ...signal, version: signal.version - 1 });
    await sleep(15); expect(reads).toBe(beforeDuplicates);
    broker.connection(false);
    const missed = await (await createPilotCheckout(store.pool)).checkout(); await outbox.drain();
    broker.connection(true); await client.reconcile();
    expect(dashboard!.orders.some(row => row.orderId === missed.orderId)).toBe(true);
    allowed = false;
    await (await createPilotCheckout(store.pool)).checkout(); const beforeRevoke = reads;
    await outbox.drain(); await sleep(15);
    expect(reads).toBe(beforeRevoke); expect(client.healthy).toBe(false);
    // This proves the synthetic broker contract, not hosted Ably token revocation.
  });

  it("has a bounded snapshot retry, protects initial snapshot races and rejects post-logout replies", async () => {
    let receive!: (signal: OrderSignal) => void, state!: (connected: boolean) => void;
    const old = gate<VersionedSnapshot>(), applied: number[] = []; let reads = 0;
    const client = new PilotClient({
      subscribe: async (fn, connection) => { receive = fn; state = connection; state(true); return { close() {} }; },
      snapshot: async () => { reads++; return reads === 1 ? old.promise : { version: 3 }; },
      apply: snapshot => applied.push(snapshot.version),
    }, 5); clients.push(client);
    const starting = client.start(); await sleep(1);
    receive({ id: randomUUID(), version: 3 }); old.resolve({ version: 1 }); await starting;
    expect(applied).toEqual([1, 3]); expect(reads).toBe(2);
    const late = gate<VersionedSnapshot>();
    const other = new PilotClient({ subscribe: async (_fn, connection) => { connection(true); return { close() {} }; }, snapshot: () => late.promise, apply: () => { throw new Error("reply after logout"); } });
    const pending = other.start(); await sleep(1); other.stop(); late.resolve({ version: 9 }); await pending;
    expect(other.healthy).toBe(false);
    const behind = new PilotClient({ subscribe: async (_fn, connection) => { connection(true); return { close() {} }; }, snapshot: async () => ({ version: 1 }), apply() {} }, 5); clients.push(behind);
    await behind.start(); behind.receive({ id: randomUUID(), version: 9 }); await behind.reconcile();
    expect(behind.healthy).toBe(false);
  });

  it("does not send secrets in payloads or raw provider errors, and keeps a stable publish id on retry", async () => {
    const call = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    const provider = new AblyRestPublisher("synthetic.key:synthetic-secret", call);
    const signal = { id: randomUUID(), version: 3 };
    await provider.publish(signal); await provider.publish(signal);
    const options = call.mock.calls[0]![1]!;
    expect(options.body).toBe(call.mock.calls[1]![1]!.body);
    expect(JSON.parse(String(options.body))).toEqual({ id: signal.id, name: "orders.changed", data: { version: 3 } });
    expect(String(options.body)).not.toContain("secret");
    call.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "private@example.test key" } as Response);
    await expect(provider.publish(signal)).rejects.toThrow("Realtime provider rejected publish (429)");
  });

  it("coalesces a burst into one read and makes no idle reads for ninety virtual seconds", async () => {
    vi.useFakeTimers();
    let version = 1, reads = 0;
    const client = new PilotClient({
      subscribe: async (_receive, state) => { state(true); return { close() {} }; },
      snapshot: async () => { reads++; return { version }; }, apply() {},
    }, 25);
    try {
      await client.start(); version = 11;
      for (let v = 2; v <= 11; v++) client.receive({ id: randomUUID(), version: v });
      await vi.advanceTimersByTimeAsync(25);
      expect(reads).toBe(2); expect(client.appliedVersion).toBe(11);
      await vi.advanceTimersByTimeAsync(90_000); expect(reads).toBe(2);
      client.visibility(false); version = 12; client.receive({ id: randomUUID(), version });
      await vi.advanceTimersByTimeAsync(1000); expect(reads).toBe(2);
      await client.visibility(true); expect(reads).toBe(3); expect(client.appliedVersion).toBe(12);
    } finally { client.stop(); vi.useRealTimers(); }
  });

  it("resynchronizes when reconnect races an already in-flight snapshot without a new message", async () => {
    const old = gate<VersionedSnapshot>(); let reads = 0;
    const client = new PilotClient({
      subscribe: async (_receive, state) => { state(true); return { close() {} }; },
      snapshot: async () => ++reads === 1 ? old.promise : { version: 2 }, apply() {},
    }); clients.push(client);
    const starting = client.start(); await sleep(1);
    client.connection(false); client.connection(true); old.resolve({ version: 1 });
    await starting; expect(reads).toBe(2); expect(client.appliedVersion).toBe(2);
  });

  it("surfaces exhausted publishing instead of silently reporting a healthy feed", async () => {
    await (await createPilotCheckout(store.pool)).checkout();
    await store.pool.query("UPDATE realtime_pilot_events SET attempts=7");
    const broker = new BrokerFixture(); broker.fail = true;
    let now = Date.now() + 2000;
    const outbox = new PilotOutbox(store.pool, broker, () => new Date(now));
    expect((await outbox.drain()).failed).toBe(1);
    expect((await outbox.health()).exhausted).toBe("1");
    now += 60_000; expect((await outbox.drain()).claimed).toBe(0);
  });
});
