// Check canonical source ownership, basic formatting, syntax, and generated output freshness.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, readLayout, buildSourceRuntimes } = require("./build-source-runtime.cjs");

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

const sourceFiles = filesIn(path.join(ROOT, "src")).filter((file) => file.endsWith(".js"));
const listed = new Set(readLayout().bundles.flatMap((bundle) => bundle.sources));
const deliveryBuild = fs.readFileSync(path.join(ROOT, "scripts/build-home-runtime.cjs"), "utf8");
for (const file of sourceFiles) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  const text = fs.readFileSync(file, "utf8");
  if (!listed.has(relative) && !deliveryBuild.includes(`'${relative}'`)) {
    throw new Error(`Browser source is not wired into a build: ${relative}`);
  }
  if (text.includes("\r") || /[^\S\n]+\n/.test(text) || !text.endsWith("\n")) {
    throw new Error(`Use LF, a final newline, and no trailing whitespace: ${relative}`);
  }
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) {
    throw new Error(`Unresolved merge marker: ${relative}`);
  }
  new vm.Script(text, { filename: relative });
}
buildSourceRuntimes({ check: true });
console.log(`PASS source layout: ${sourceFiles.length} maintained browser sources, syntax and current runtimes`);
