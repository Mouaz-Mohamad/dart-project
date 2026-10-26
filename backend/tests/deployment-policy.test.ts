import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dart-deploy-policy-")); roots.push(root);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  mkdirSync(join(root, "backend")); mkdirSync(join(root, "backend", "tests")); mkdirSync(join(root, "backend", "scripts")); mkdirSync(join(root, "docs"));
  git("init", "-q"); git("config", "user.name", "Synthetic test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "index.html"), "initial"); writeFileSync(join(root, "backend", "server.ts"), "initial");
  git("add", "."); git("commit", "-qm", "initial"); const base = git("rev-parse", "HEAD");
  const commit = (files: string[], message = "Ordinary approved change without deployment markers") => {
    for (const file of files) writeFileSync(join(root, file), message);
    git("add", "."); git("commit", "-qm", message); return git("rev-parse", "HEAD");
  };
  const run = (backend: boolean, previous: string | undefined = base) => spawnSync("bash", [resolve(backend ? "scripts/vercel-ignore-backend.sh" : "../scripts/vercel-ignore-frontend.sh")],
    { cwd: backend ? join(root, "backend") : root, encoding: "utf8", env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous ?? "" } }).status;
  return { commit, run };
}
describe("deployment policy without numbered batches", () => {
  it.each([
    [["index.html"], 1, 0], [["backend/server.ts"], 0, 1],
    [["index.html", "backend/server.ts"], 1, 1], [["docs/readme.md"], 0, 0],
    [["backend/tests/regression.test.ts"], 0, 0], [["backend/scripts/vercel-ignore-backend.sh"], 0, 0],
    [["backend/server.ts", "backend/tests/regression.test.ts"], 0, 1],
  ] as const)("evaluates affected paths %j", (files, frontend, backend) => {
    const f = fixture(); f.commit([...files]); expect(f.run(false)).toBe(frontend); expect(f.run(true)).toBe(backend);
  });
  it("allows redeploys, initial builds and unavailable history", () => {
    const f = fixture(), current = f.commit(["docs/readme.md"]);
    for (const previous of [current, "", "f".repeat(40)]) for (const backend of [true, false]) expect(f.run(backend, previous)).toBe(1);
  });
});
