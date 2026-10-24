// Compose readable browser sources without changing their scope or execution order.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const LAYOUT = "src/runtime-layout.json";

function readLayout() {
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, LAYOUT), "utf8"));
  if (layout.version !== 1 || !Array.isArray(layout.bundles)) {
    throw new Error("Unsupported browser source layout");
  }
  const sources = new Set();
  const outputs = new Set();
  for (const bundle of layout.bundles) {
    if (!/^(?:Eye|Js)\/[\w-]+\.js$/.test(bundle.output) || outputs.has(bundle.output)) {
      throw new Error(`Invalid or duplicate runtime output: ${bundle.output}`);
    }
    outputs.add(bundle.output);
    if (!["global", "platform"].includes(bundle.scope) || !bundle.sources?.length) {
      throw new Error(`Missing scope or sources: ${bundle.output}`);
    }
    for (const source of bundle.sources) {
      if (!/^src\/(?:[\w-]+\/)+[\w-]+\.js$/.test(source) || sources.has(source)) {
        throw new Error(`Invalid or duplicate runtime source: ${source}`);
      }
      sources.add(source);
    }
  }
  return layout;
}

function composeRuntime(bundle) {
  const body = bundle.sources.map((source) => {
    const text = fs.readFileSync(path.join(ROOT, source), "utf8");
    // Every unit is a complete series of statements, never a partial function.
    new vm.Script(text, { filename: source });
    return text;
  }).join("");
  const program = bundle.scope === "platform" ? `(function () {\n${body}})();\n` : body;
  new vm.Script(program, { filename: bundle.output });
  const hash = crypto.createHash("sha256").update(program).digest("hex");
  return `/* Generated from ${LAYOUT}; edit its listed sources. source-sha256:${hash} */\n${program}`;
}

function buildSourceRuntimes({ check = false } = {}) {
  for (const bundle of readLayout().bundles) {
    const program = composeRuntime(bundle);
    const output = path.join(ROOT, bundle.output);
    const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
    if (current === program) continue;
    if (check) throw new Error(`Stale runtime: ${bundle.output}; run npm run build:js`);
    fs.writeFileSync(output, program);
  }
}

module.exports = { ROOT, readLayout, composeRuntime, buildSourceRuntimes };
if (require.main === module) {
  buildSourceRuntimes({ check: process.argv.includes("--check") });
  console.log("Readable browser runtimes are current.");
}
