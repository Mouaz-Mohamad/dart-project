// Reproducible experiment. No env-file loading, provider credentials or production mounts.
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { embeddedStore } from "../../tests/embedded-store.js";
import { CommerceService } from "../../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../../src/modules/identity/identity.types.js";
import { installPilotFixture, createPilotCheckout } from "./fixtures.js";
import { BrokerFixture } from "./broker-fixture.js";
import { PilotClient } from "./client.js";
import { PilotOutbox } from "./outbox.js";
import { pilotRouter } from "./router.js";

if (process.env.VERCEL || process.env.NODE_ENV === "production" || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL) {
  throw new Error("Pilot requires an isolated local process without database connection environment variables");
}

async function scenario(mode: "polling" | "push") {
  const store = await embeddedStore(true);
  let client: PilotClient<{ version: number; orders: Array<{ orderId: string }> }> | undefined;
  let dataCalls = 0, dataBytes = 0, dataSql = 0, deliverySql = 0;
  const metered = (delivery: boolean) => {
    const query = async (sql: string, values?: unknown[]) => {
      if (delivery) deliverySql++; else dataSql++;
      return store.pool.query(sql, values);
    };
    return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  };
  try {
    if (mode === "push") await installPilotFixture(store.pool);
    const f = await createPilotCheckout(store.pool);
    const readCommerce = new CommerceService(metered(false));
    const account = { userId: randomUUID(), sessionId: randomUUID(), accountType: "staff", permissions: ["orders.read"], mfaRequired: false } as AuthenticatedAccount;
    const identity = { authenticate: async () => account } as unknown as IdentityService;
    const app = express(); app.use(cookieParser()); app.use("/pilot", pilotRouter(identity, readCommerce, { sessionCookieName: "dart_session" }));
    const cookie = `dart_session=${randomUUID()}.${"x".repeat(43)}`;
    const get = async (endpoint: string) => {
      const response = await request(app).get(`/pilot/${endpoint}`).set("Cookie", cookie);
      if (response.status !== 200) throw new Error(`Synthetic endpoint failed: ${response.status}`);
      dataCalls++; dataBytes += Buffer.byteLength(response.text);
      return response.body as { version: number; orders: Array<{ orderId: string }> };
    };
    let visibleVersion = 0, visibleOrders: Array<{ orderId: string }> = [];
    const apply = (snapshot: { version: number; orders: Array<{ orderId: string }> }) => {
      visibleVersion = snapshot.version; visibleOrders = snapshot.orders;
    };
    const broker = new BrokerFixture();
    if (mode === "push") {
      client = new PilotClient({ subscribe: (receive, state) => broker.subscribe(async () => true, receive, state), snapshot: () => get("snapshot"), apply }, 5);
      await client.start();
    } else apply(await get("snapshot"));
    const callsBeforeIdle = dataCalls;
    // Ninety seconds of virtual activity: one checkout at t=45s. No real 90s sleep.
    let order: Record<string, unknown> | undefined, idleCalls = 0;
    for (let second = 3; second <= 90; second += 3) {
      if (second === 45) {
        idleCalls = dataCalls - callsBeforeIdle;
        order = await f.checkout();
        if (mode === "push") {
          const outbox = new PilotOutbox(metered(true), broker, () => new Date(Date.now() + 2000));
          const delivered = await outbox.drain();
          if (delivered.published !== 1) throw new Error("Synthetic event was not published");
          // Await the event's coalescing timer and its actual protected HTTP read.
          const deadline = Date.now() + 5000;
          while (!visibleOrders.some(row => row.orderId === order!.orderId)) {
            if (Date.now() > deadline) throw new Error("Synthetic dashboard did not catch up");
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
      }
      if (mode === "polling") {
        const version = await get("version");
        if (version.version > visibleVersion) apply(await get("snapshot"));
      }
    }
    if (!order || !visibleOrders.some(row => row.orderId === order!.orderId)) throw new Error("Missing committed order");
    return { mode, scenarioSeconds: 90, checkIntervalSeconds: mode === "polling" ? 3 : null,
      dataEndpointCalls: dataCalls, idleDataCallsBeforeChange: idleCalls,
      applicationJsonBytes: dataBytes, providerSignalJsonBytes: broker.messages.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message)), 0),
      dataSqlStatements: dataSql, publisherSqlStatements: deliverySql,
      committedOrders: 1, visibleCommittedOrders: 1, providerSignals: broker.messages.length };
  } finally { client?.stop(); await store.db.close(); }
}
const polling = await scenario("polling"), push = await scenario("push");
console.log(JSON.stringify({
  kind: "isolated-synthetic-pilot", database: "PGlite with production migrations and real CommerceService.checkout",
  transport: "in-process broker fixture; not a hosted Ably connection",
  limitations: ["Virtual time, synthetic accounts and one order; not production traffic or a capacity test",
    "Bytes are application JSON only: exclude HTTP headers, TLS, SDK/auth, heartbeat and provider billing",
    "SQL counts include read/publisher statements; mutation statements common to both are excluded",
    "SQL counts are driver calls, not internal engine work; the trigger's extra journal INSERT is not included",
    "Synthetic broker rechecks grants; real Ably authorization/revocation, quota and delivery latency still need a sandbox test",
    "Trigger/event journal exists only in the isolated fixture; no production migration, endpoint or polling change"],
  polling, push,
  dataCallReductionPercent: Number(((1 - push.dataEndpointCalls / polling.dataEndpointCalls) * 100).toFixed(2)),
}, null, 2));
