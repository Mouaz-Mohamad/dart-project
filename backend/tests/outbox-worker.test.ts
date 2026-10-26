import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runWorker(mode: "empty" | "full" | "provider" | "network" | "uncertain" | "exhausted" | "missing-health") {
  const directory = mkdtempSync(join(tmpdir(), "dart-worker-test-"));
  try {
    const workflow = readFileSync(resolve(process.cwd(), "../.github/workflows/outbox-worker.yml"), "utf8");
    const script = workflow.split("        run: |\n")[1]!.split("\n")
      .map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
    const counter = join(directory, "calls");
    writeFileSync(join(directory, "curl"), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.DART_TEST_COUNTER, 'call\\n');
if (process.env.DART_TEST_MODE === 'network') process.exit(22);
const args = process.argv.slice(2);
const target = args[args.indexOf('--output') + 1];
const full = process.env.DART_TEST_MODE === 'full';
const providerFailure = process.env.DART_TEST_MODE === 'provider' && fs.readFileSync(process.env.DART_TEST_COUNTER,'utf8').trim().split('\\n').length === 1;
fs.writeFileSync(target, JSON.stringify({ configured: true, claimed: full || providerFailure ? 5 : 0,
  published: full ? 5 : providerFailure ? 4 : 0, failed: providerFailure ? 1 : 0,
  health: process.env.DART_TEST_MODE === 'missing-health' ? undefined : {
    uncertain: process.env.DART_TEST_MODE === 'uncertain' ? 2 : 0,
    exhausted: process.env.DART_TEST_MODE === 'exhausted' ? 1 : 0, terminal: 0 } }));
`, { mode: 0o700 });
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DART_OUTBOX_CRON_SECRET: "isolated-worker-secret".repeat(2),
        DART_TEST_COUNTER: counter, DART_TEST_MODE: mode } });
    const calls = readFileSync(counter, "utf8").trim().split("\n").length;
    return { status: result.status, calls, output: `${result.stdout}${result.stderr}` };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("bounded durable outbox worker", () => {
  it("stops immediately when the durable queue is empty", () => {
    expect(runWorker("empty")).toMatchObject({ status: 0, calls: 1 });
  });
  it("drains at most twelve batches and never loops indefinitely", () => {
    expect(runWorker("full")).toMatchObject({ status: 0, calls: 12 });
  }, 30_000);
  it("drains subsequent batches after a provider failure and then makes the failure visible", () => {
    expect(runWorker("provider")).toMatchObject({ status: 1, calls: 2 });
  });
  it("stops after an HTTP or network failure", () => {
    expect(runWorker("network")).toMatchObject({ status: 22, calls: 1 });
  });
  it.each(["uncertain", "exhausted", "missing-health"] as const)("fails visibly for %s even when no new event is claimed", (mode) => {
    expect(runWorker(mode)).toMatchObject({ status: 1, calls: 1 });
  });
});
