// Local only: `node --import tsx experiments/direct-realtime/run.ts`.
import { createPilotCheckout } from "../realtime-pilot/fixtures.js";
import { directStore, directHarness, openStream, until, assertLocalPilotEnvironment } from "./test-support.js";

assertLocalPilotEnvironment();
const store = await directStore();
const harness = await directHarness(store, process.argv.includes("--browser-check")
  ? { lifetimeMs: 1200, heartbeatMs: 200, coalesceMs: 25 } : undefined);
if (process.argv.includes("--serve")) {
  // Synthetic session token for this local fixture only; never a real Dart login.
  console.log(JSON.stringify({ base: harness.base, syntheticCookie: harness.cookie, database: store.databaseKind }));
  const close = async () => { await harness.close(); await store.db.close(); process.exit(0); };
  process.on("SIGINT", () => void close()); process.on("SIGTERM", () => void close());
  // A deterministic local order after the browser has subscribed. No mutations in HTTP routes.
  const timer = setInterval(() => {
    if (!harness.feed.subscriberCount) return;
    clearInterval(timer);
    setTimeout(() => { void createPilotCheckout(store.pool).then(fixture => fixture.checkout()); }, 800);
    if (process.argv.includes("--browser-check")) {
      setTimeout(() => { void createPilotCheckout(store.pool).then(fixture => fixture.checkout()); }, 2000);
    }
  }, 50);
} else {
  const stream = await openStream(harness.base, harness.cookie);
  try {
    await until(() => stream.frames.some(frame => frame.includes("event: ready")));
    const snapshot = async () => {
      const response = await fetch(`${harness.base}/direct/snapshot`, { headers: { Cookie: harness.cookie } });
      if (!response.ok) throw new Error("Snapshot failed");
      return await response.json() as { orders: Array<{ orderId: string }> };
    };
    await snapshot();
    const idleBefore = harness.metrics();
    await new Promise(resolve => setTimeout(resolve, 150));
    const idleAfter = harness.metrics();
    const fixture = await createPilotCheckout(store.pool);
    const beforeCheckout = performance.now(), order = await fixture.checkout();
    await until(() => stream.frames.some(frame => frame.includes("event: orders.changed")));
    const checkoutStartToSignalMs = performance.now() - beforeCheckout;
    const state = await snapshot();
    console.log(JSON.stringify({ kind: "isolated-direct-postgres-sse-pilot", database: store.databaseKind,
      newServices: 0, externalProviderRequests: 0, committedOrderVisible: state.orders.some((row: { orderId: string }) => row.orderId === order.orderId),
      idleMeasuredMs: 150, idleExtraDataReads: idleAfter.dataReads - idleBefore.dataReads,
      idleExtraListenStatements: idleAfter.listenStatements - idleBefore.listenStatements,
      metrics: harness.metrics(), streamedBodyBytes: stream.bytes,
      checkoutStartToSignalMs: Number(checkoutStartToSignalMs.toFixed(2)),
      limitations: ["Local synthetic identity and one checkout; not production latency/load/billing", "Body bytes exclude HTTP/TLS headers and 24-hour keepalive/reconnect overhead", "Native cross-instance PostgreSQL/TCP is tested by CI when TEST_DATABASE_URL is present", "Vercel and database usage may rise while streams keep functions/compute active; no zero-cost guarantee", "No production trigger, endpoint or polling change"],
    }, null, 2));
  } finally { await stream.close(); await harness.close(); await store.db.close(); }
}
