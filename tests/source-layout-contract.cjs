const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, readLayout, composeRuntime } = require("../scripts/build-source-runtime.cjs");

const layout = readLayout();
assert.deepEqual(layout.bundles.map((bundle) => bundle.output), ["Eye/dart.js", "Js/dart-platform.js"]);
for (const bundle of layout.bundles) {
  const generated = composeRuntime(bundle);
  assert.equal(fs.readFileSync(path.join(ROOT, bundle.output), "utf8"), generated,
    `${bundle.output} must match its ordered sources`);
  new vm.Script(generated, { filename: bundle.output });
  for (const source of bundle.sources) {
    new vm.Script(fs.readFileSync(path.join(ROOT, source), "utf8"), { filename: source });
  }
}
const builder = fs.readFileSync(path.join(ROOT, "scripts/build-home-runtime.cjs"), "utf8");
assert(builder.indexOf("buildSourceRuntimes();") < builder.indexOf("for (const [source, output]"),
  "Readable runtimes must be composed before homepage minification");
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/frontend-ci.yml"), "utf8");
assert.equal((workflow.match(/- "src\/\*\*"/g) || []).length, 2,
  "Source changes must run Frontend CI on both push and pull_request");
assert(!fs.readdirSync(path.join(ROOT, "scripts")).some((file) => file.endsWith(".source.js")),
  "Editor sources belong in src, while scripts owns build tools");
console.log("PASS canonical source ownership, source order, syntax, delivery freshness and CI coverage");
