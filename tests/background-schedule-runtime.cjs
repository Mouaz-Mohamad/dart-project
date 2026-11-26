"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
(async () => {
  const { readPolicy, shouldRun } = await import("../scripts/background-schedule.mjs");
  const policy = readPolicy("");
  for (const [time, allowed] of [["2026-11-25T23:00:00Z", false], ["2026-11-26T09:59:59Z", false],
    ["2026-11-26T10:00:00Z", true], ["2026-11-26T10:05:00Z", false], ["2026-11-26T10:15:00Z", true]])
    assert.equal(shouldRun(policy, new Date(time)), allowed, time);
  assert.equal(shouldRun(policy, new Date("2026-11-26T10:05:00Z"), "backup"), true);
  assert.equal(shouldRun(policy, new Date("2026-11-26T05:00:00Z"), "backup"), false);
  assert.equal(shouldRun(policy, new Date("2026-11-26T05:00:00Z"), "backup", true), true);
  assert.throws(() => readPolicy('{"revision":1,"schedule":{"intervalMinutes":1}}'));
  const listeners = new Map();
  // Execute the real clock guard separately from the page's unrelated media machinery.
  const source = fs.readFileSync("Js/dart-site-settings.js", "utf8");
  const start = source.indexOf("  let backgroundSchedule ="), end = source.indexOf("  const defaults =", start);
  const root = { addEventListener(name, callback) { listeners.set(name, callback); } };
  vm.runInNewContext(source.slice(start, end), { root, Intl, Date, Object });
  assert.equal(root.DartBackgroundPolicy.allows(new Date("2026-11-26T05:00:00Z")), false);
  assert.equal(root.DartBackgroundPolicy.allows(new Date("2026-11-26T12:00:00Z")), true);
  listeners.get("dart:background-schedule")({ detail: { schedule: { quietEnabled: true, quietStart: "23:00", quietEnd: "06:00" } } });
  assert.equal(root.DartBackgroundPolicy.allows(new Date("2026-11-26T00:00:00Z")), false);
  assert.equal(root.DartBackgroundPolicy.allows(new Date("2026-11-26T05:00:00Z")), true);
  const backendConfig = JSON.parse(fs.readFileSync("backend/vercel.json"));
  assert.deepEqual(backendConfig.crons, [], "Only one scheduler may poll the outbox");
  for (const file of ["vercel.json", "backend/vercel.json"])
    assert.equal(JSON.parse(fs.readFileSync(file)).git.deploymentEnabled["work/database-hosting-controls"], false);
  console.log("PASS Cairo schedule: quiet boundaries, overnight, interval, backup gating, browser clock and no-deploy branch");
})().catch(error => { console.error(error); process.exitCode = 1; });
