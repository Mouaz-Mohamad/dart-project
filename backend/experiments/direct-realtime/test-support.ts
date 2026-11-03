// Test/experiment-only runtime. It never reads Vercel secrets or production URLs.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import type { PGlite } from "@electric-sql/pglite";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { embeddedStore } from "../../tests/embedded-store.js";
import { CommerceService } from "../../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../../src/modules/identity/identity.types.js";
import { installDirectFixture } from "./fixture.js";
import { DirectOrderFeed, directConnection } from "./notifications.js";
import { directPilotRouter } from "./router.js";
import type { ListenConnection } from "./notifications.js";

export function assertLocalPilotEnvironment() {
  if (process.env.VERCEL || process.env.NODE_ENV === "production" || process.env.DATABASE_URL) throw new Error("Direct pilot requires an isolated local test process");
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    // pg accepts query-string host overrides: validate the entire effective target.
    const unknownOptions = [...url.searchParams.keys()].some(key => key !== "sslmode");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || unknownOptions ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/dart_(test|pilot[a-z0-9_]*)$/.test(url.pathname)) {
      throw new Error("Direct pilot accepts only a named loopback test database");
    }
  }
}
class EmbeddedListenConnection extends EventEmitter implements ListenConnection {
  private unlisten: (() => Promise<void>) | undefined;
  constructor(private readonly db: PGlite) { super(); }
  async connect() {}
  async query(sql: string) {
    const channel = /^LISTEN "(dart_pilot_orders_[a-f0-9]{32})"$/.exec(sql)?.[1];
    if (!channel) throw new Error("Only a fixture LISTEN is allowed");
    this.unlisten = await this.db.listen(channel, payload => this.emit("notification", { channel, payload, processId: 0 }));
  }
  async end() { await this.unlisten?.(); this.emit("end"); }
}
export async function directStore() {
  assertLocalPilotEnvironment();
  const store = await embeddedStore(true);
  try {
    const channel = await installDirectFixture(store.pool);
    const nativeUrl = process.env.TEST_DATABASE_URL;
    const factory = (): ListenConnection => nativeUrl ? directConnection(nativeUrl) : new EmbeddedListenConnection(store.db as PGlite);
    return { ...store, channel, factory, databaseKind: nativeUrl ? "native PostgreSQL/TCP" : "PGlite PostgreSQL engine; no native TCP or multiple processes" };
  } catch (error) { await store.db.close(); throw error; }
}

export async function directHarness(store: Awaited<ReturnType<typeof directStore>>, timing?: { lifetimeMs: number; heartbeatMs: number; coalesceMs: number }) {
  const feed = new DirectOrderFeed(store.factory, store.channel);
  let account: AuthenticatedAccount | null = { userId: randomUUID(), sessionId: randomUUID(), accountType: "staff", permissions: ["orders.read"], mfaRequired: false } as AuthenticatedAccount;
  let authReads = 0, dataReads = 0, dataJsonBytes = 0;
  const identity = { authenticate: async () => { authReads++; return account; } } as unknown as IdentityService;
  const commerce = new CommerceService(store.pool);
  const app = express(); app.use(cookieParser());
  app.use("/direct", (req, res, next) => {
    if (["/snapshot", "/version"].includes(req.path)) {
      dataReads++;
      const json = res.json.bind(res);
      res.json = body => { dataJsonBytes += Buffer.byteLength(JSON.stringify(body)); return json(body); };
    }
    next();
  }, directPilotRouter(identity, commerce, { sessionCookieName: "dart_session" }, feed, timing));
  const sourceFiles: Record<string, URL> = {
    "client.js": new URL("../realtime-pilot/client.ts", import.meta.url),
    "events.js": new URL("./event-source.ts", import.meta.url),
    "source.js": new URL("./source.ts", import.meta.url),
  };
  app.get("/demo/:module", async (req, res, next) => {
    const path = sourceFiles[String(req.params.module)]; if (!path) { next(); return; }
    const source = await readFile(path, "utf8");
    res.type("js").send(transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText);
  });
  app.get("/", async (_req, res) => res.type("html").send(await readFile(new URL("./demo.html", import.meta.url), "utf8")));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode || 500).json({ code: error.code || "PILOT_ERROR" });
  });
  const server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing local fixture port");
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = `dart_session=${randomUUID()}.${"x".repeat(43)}`;
  return { base, feed, commerce, cookie,
    revoke() { if (account) account = { ...account, permissions: [] }; },
    resetAccount() { if (account) account = { ...account, permissions: ["orders.read"] }; },
    logout() { account = null; },
    metrics: () => ({ dataReads, dataJsonBytes, authReads, ...feed.metrics }),
    close: async () => { feed.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

// A real streamed HTTP reader for tests; browser verification uses native EventSource.
export async function openStream(base: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/direct/events`, { headers: { Cookie: cookie }, signal: controller.signal });
  if (response.status !== 200) { controller.abort(); throw new Error(`Stream rejected: ${response.status}`); }
  const frames: string[] = [];
  let done = false, bytes = 0, buffer = "";
  const reader = response.body!.getReader();
  const completion = (async () => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) { frames.push(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      }
    } catch { /* Intentional browser disconnect or server expiry. */ }
    finally { done = true; reader.releaseLock(); }
  })();
  return { frames, get done() { return done; }, get bytes() { return bytes; }, close: async () => { controller.abort(); await completion; } };
}
export async function until(check: () => boolean | Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error("Direct pilot condition timed out"); await new Promise(resolve => setTimeout(resolve, 5)); }
}
