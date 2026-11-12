// Run build-time tests without inheriting production database/provider secrets.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const safeEnvironment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot"].filter(key => process.env[key])
    .map(key => [key, process.env[key]]),
);
const result = spawnSync(process.execPath,
  [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--maxWorkers=2"],
  { cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...safeEnvironment, NODE_ENV: "test", CI: "true", TZ: "Africa/Cairo" }, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
