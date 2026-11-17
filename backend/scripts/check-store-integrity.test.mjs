import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITICAL_CHECKS, INTEGRITY_SQL, evaluateIntegrity, readIntegrityReport } from "./check-store-integrity.mjs";

const good = () => Object.fromEntries([...CRITICAL_CHECKS, "expired_cart_holds"].map((name) => [name, "0"]));

test("healthy reports are safe and do not include customer records", () => {
  const report = evaluateIntegrity(good());
  assert.equal(report.status, "ok");
  assert.deepEqual(report.critical, []);
  assert.deepEqual(Object.keys(report.checks).length, 7);
  assert.ok(!INTEGRITY_SQL.includes("SELECT *"));
});

test("an order/finance integrity violation fails the gate", () => {
  for (const name of CRITICAL_CHECKS) {
    const report = evaluateIntegrity({ ...good(), [name]: "1" });
    assert.equal(report.status, "critical");
    assert.deepEqual(report.critical, [name]);
  }
});

test("expired reservations warn without blocking an existing backup", () => {
  const report = evaluateIntegrity({ ...good(), expired_cart_holds: "2" });
  assert.equal(report.status, "warning");
  assert.deepEqual(report.critical, []);
});

test("unknown and malformed aggregates never silently pass", () => {
  assert.throws(() => evaluateIntegrity({ ...good(), reserved_without_cart: null }));
  assert.throws(() => evaluateIntegrity({ ...good(), active_deleted_users: "NaN" }));
  assert.throws(() => evaluateIntegrity({ ...good(), active_deleted_users: "-1" }));
});

test("database transaction is explicitly read-only and consistent", async () => {
  const calls = [];
  const report = await readIntegrityReport({ query: async (sql) => {
    calls.push(sql);
    return { rows: sql === INTEGRITY_SQL ? [good()] : [] };
  }});
  assert.equal(report.status, "ok");
  assert.match(calls[0], /READ ONLY/);
  assert.deepEqual(calls.slice(-1), ["COMMIT"]);
});

test("failed checks roll back and do not claim success", async () => {
  const calls = [];
  await assert.rejects(readIntegrityReport({ query: async (sql) => {
    calls.push(sql);
    if (sql === INTEGRITY_SQL) throw new Error("connection lost");
    return { rows: [] };
  }}));
  assert.equal(calls.at(-1), "ROLLBACK");
});
