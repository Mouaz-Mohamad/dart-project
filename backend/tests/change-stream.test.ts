import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Client } from "pg";
import { describe, it, expect, vi } from "vitest";
import { ChangeFeed, type ChangeConnection, type ChangeSignal } from "../src/modules/changes/change-feed.js";
import { createChangeRouter, canReceiveChange } from "../src/modules/changes/change.routes.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { embeddedStore } from "./embedded-store.js";

const channel = "dart_changes_" + createHash("md5").update("public").digest("hex");
class Connection extends EventEmitter {
  connect = vi.fn(async () => {});
  query = vi.fn(async () => ({ rows: [{ schema: "public", installed: true }] }));
  end = vi.fn(async () => {});
  signal(value: unknown) { this.emit("notification", { channel, payload: typeof value === "string" ? value : JSON.stringify(value) }); }
}
const catalog: ChangeSignal = { scope: "version", name: "catalog_inventory", version: 2 };
describe("direct database change feed", () => {
  it("shares one listener, filters malformed signals, performs no idle reads and releases its last subscriber", async () => {
    const connection = new Connection(), factory = vi.fn(() => connection as unknown as ChangeConnection);
    const feed = new ChangeFeed(factory), first = vi.fn(), second = vi.fn();
    const [a, b] = await Promise.all([feed.subscribe(first, vi.fn()), feed.subscribe(second, vi.fn())]);
    expect(factory).toHaveBeenCalledOnce(); expect(connection.query).toHaveBeenCalledTimes(2);
    connection.signal("not-json"); connection.signal({ ...catalog, version: -1 });
    connection.signal({ ...catalog, name: "secret\nfield" }); connection.signal(catalog);
    expect(first).toHaveBeenCalledExactlyOnceWith(catalog); expect(second).toHaveBeenCalledExactlyOnceWith(catalog);
    await delay(10); expect(connection.query).toHaveBeenCalledTimes(2);
    a.close(); expect(connection.end).not.toHaveBeenCalled(); b.close(); expect(connection.end).toHaveBeenCalledOnce();
  });
  it("fails closed on a missing migration, listener loss and capacity", async () => {
    const connection = new Connection(); connection.query.mockResolvedValueOnce({ rows: [{ schema: "public", installed: false }] });
    const feed = new ChangeFeed(() => connection as unknown as ChangeConnection, 1);
    await expect(feed.subscribe(vi.fn(), vi.fn())).rejects.toThrow(); expect(feed.subscriberCount).toBe(0);
    const disconnected = vi.fn(); await feed.subscribe(vi.fn(), disconnected);
    await expect(feed.subscribe(vi.fn(), vi.fn())).rejects.toThrow("capacity");
    connection.emit("error", new Error("synthetic disconnect")); expect(disconnected).toHaveBeenCalledOnce(); expect(feed.subscriberCount).toBe(0);
  });
  it.each([
    [{ scope: "version", name: "admin_notifications", version: 1 }, [], false, false],
    [{ scope: "version", name: "admin_notifications", version: 1 }, ["orders.read"], true, false],
    [{ scope: "version", name: "admin_notifications", version: 1 }, ["notifications.read"], true, true],
    [catalog, [], false, true], [{ scope: "version", name: "orders", version: 1 }, [], false, false],
    [{ scope: "domain", name: "customers", version: 1 }, ["orders.read"], true, false],
    [{ scope: "domain", name: "customers", version: 1 }, ["customers.read"], true, true],
    [{ scope: "domain", name: "finance_expenses", version: 1 }, ["finance.view_revenue"], true, false],
    [{ scope: "domain", name: "finance_expenses", version: 1 }, ["finance.view_cost"], true, true],
    [catalog, ["inventory.manage"], true, true], [catalog, [], true, false],
  ] as const)("filters signal %# using the existing domain read policy", (signal, grants, admin, accepted) => {
    expect(canReceiveChange(signal as ChangeSignal, [...grants], admin)).toBe(accepted);
  });
});

function routerFixture() {
  let receive: ((signal: ChangeSignal) => void) | undefined;
  const close = vi.fn(), feed = { subscribe: vi.fn(async (fn: (signal: ChangeSignal) => void) => { receive = fn; return { close }; }) };
  const auth = { userId: randomUUID(), sessionId: randomUUID(), accountType: "staff", permissions: ["orders.read"], mfaRequired: true, mfaSatisfied: true };
  const identity = { authenticate: vi.fn(async () => ({ ...auth, permissions: [...auth.permissions] })) } as unknown as IdentityService;
  const app = express(); app.use(cookieParser());
  app.use("/api/v1", createChangeRouter(feed as unknown as ChangeFeed, identity, { sessionCookieName: "dart_session", corsOrigins: [] }, { lifetimeMs: 3000, heartbeatMs: 1000, coalesceMs: 1 }));
  app.use((error: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ error: "denied" }));
  return { app, auth, feed, close, emit: (signal: ChangeSignal) => receive?.(signal), cookie: `dart_session_staff=${auth.sessionId}.${"a".repeat(43)}` };
}
describe("change-stream authorization and HTTP lifecycle", () => {
  it("keeps two public streams per IP and returns a bounded graceful fallback for another tab", async () => {
    const f = routerFixture(), server = f.app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const controllers = [new AbortController(), new AbortController()];
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/catalog/changes`;
      for (const controller of controllers) {
        const response = await fetch(url, { signal: controller.signal });
        expect(response.status).toBe(200);
        expect(new TextDecoder().decode((await response.body!.getReader().read()).value)).toContain("event: ready");
      }
      const fallback = await fetch(url);
      expect(fallback.status).toBe(200); expect(fallback.headers.get("content-type")).toContain("text/event-stream");
      const frame = await fallback.text(); expect(frame).toContain("event: unavailable"); expect(frame).not.toContain("event: ready");
      expect(f.feed.subscribe).toHaveBeenCalledTimes(2);
    } finally { controllers.forEach(controller => controller.abort()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("rejects guests, customers, missing grants/MFA and foreign origins before opening a listener", async () => {
    const f = routerFixture();
    await request(f.app).get("/api/v1/admin/changes").expect(401);
    f.auth.accountType = "customer"; await request(f.app).get("/api/v1/admin/changes").set("Cookie", f.cookie).expect(403);
    f.auth.accountType = "staff"; f.auth.permissions = []; await request(f.app).get("/api/v1/admin/changes").set("Cookie", f.cookie).expect(403);
    f.auth.permissions = ["orders.read"]; f.auth.mfaSatisfied = false; await request(f.app).get("/api/v1/admin/changes").set("Cookie", f.cookie).expect(403);
    f.auth.mfaSatisfied = true; await request(f.app).get("/api/v1/admin/changes").set("Cookie", f.cookie).set("Origin", "https://foreign.example").expect(403);
    expect(f.feed.subscribe).not.toHaveBeenCalled();
  });
  it("streams only authorized signals and closes a live stream after permissions are revoked", async () => {
    const f = routerFixture(), server = f.app.listen(0, "127.0.0.1"), controller = new AbortController();
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/changes`, { headers: { Cookie: f.cookie }, signal: controller.signal });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader(), decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
      f.emit({ scope: "domain", name: "customers", version: 3 });
      f.emit({ scope: "version", name: "orders", version: 4 });
      const frame = decoder.decode((await reader.read()).value); expect(frame).toContain('"name":"orders"'); expect(frame).not.toContain("customers");
      f.auth.permissions = []; f.emit({ scope: "version", name: "orders", version: 5 });
      expect((await reader.read()).done).toBe(true); expect(f.close).toHaveBeenCalledOnce();
    } finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

it.skipIf(!process.env.TEST_DATABASE_URL)("publishes SQL version notifications after COMMIT, never after ROLLBACK", async () => {
  const store = await embeddedStore(true), schema = String((await store.pool.query("SELECT current_schema() AS schema")).rows[0].schema);
  const feed = new ChangeFeed(() => new Client({ connectionString: process.env.TEST_DATABASE_URL!, options: `-c search_path=${schema},public` }) as unknown as ChangeConnection);
  const signals: ChangeSignal[] = [], writer = await store.pool.connect();
  let subscription: { close(): void } | undefined;
  try {
    subscription = await feed.subscribe(signal => signals.push(signal), vi.fn());
    await writer.query("BEGIN"); await writer.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='catalog_inventory'");
    await delay(30); expect(signals).toHaveLength(0); await writer.query("COMMIT");
    for (let i = 0; i < 100 && !signals.length; i++) await delay(10);
    expect(signals).toHaveLength(1); expect(signals[0]).toMatchObject({ scope: "version", name: "catalog_inventory" });
    await writer.query("BEGIN"); await writer.query("UPDATE domain_state_versions SET version=version+1 WHERE domain='catalog_inventory'"); await writer.query("ROLLBACK");
    await delay(30); expect(signals).toHaveLength(1);
  } finally { await writer.query("ROLLBACK"); writer.release(); subscription?.close(); feed.close(); await store.db.close(); }
}, 30000);
