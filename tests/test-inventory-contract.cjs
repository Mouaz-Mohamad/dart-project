// DART CODE GUIDE | tests/test-inventory-contract.cjs
// Prevent silent orphan tests: every root test must be wired into Frontend CI or explicitly classified as legacy.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");
const manifest = JSON.parse(fs.readFileSync(path.join(testsDir, "test-inventory.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "frontend-ci.yml"), "utf8");

const testFiles = fs.readdirSync(testsDir)
  .filter((name) => /\.(?:js|cjs|py)$/i.test(name))
  .sort();
const staticTests = new Set(manifest.ciStatic || []);
const browserTests = new Set(manifest.ciBrowser || []);
const legacyRewrite = new Set(Object.keys(manifest.legacyRewrite || {}));
const legacyRetire = new Set(Object.keys(manifest.legacyRetire || {}));
const classified = new Set([...staticTests, ...browserTests, ...legacyRewrite, ...legacyRetire]);

assert.equal(classified.size, staticTests.size + browserTests.size + legacyRewrite.size + legacyRetire.size,
  "A test file must have exactly one inventory classification");
assert.deepEqual([...classified].sort(), testFiles,
  "Every root test file must be classified; update tests/test-inventory.json when adding/removing a test");

const [staticBlock = "", browserBlock = ""] = workflow.split(/\n\s*browser-smoke:/, 2);
for (const name of staticTests) {
  assert(staticBlock.includes(`tests/${name}`), `${name} is classified ciStatic but is not wired into static-regression`);
}
for (const name of browserTests) {
  assert(browserBlock.includes(`tests/${name}`), `${name} is classified ciBrowser but is not wired into browser-smoke`);
}
for (const name of [...legacyRewrite, ...legacyRetire]) {
  assert(!workflow.includes(`tests/${name}`), `${name} is legacy-classified and must not run in Frontend CI until rewritten`);
}

for (const [name, reason] of [
  ...Object.entries(manifest.legacyRewrite || {}),
  ...Object.entries(manifest.legacyRetire || {}),
]) {
  assert(String(reason || "").trim().length >= 24, `${name} needs a concrete legacy classification reason`);
}

console.log(`PASS test inventory: ${staticTests.size} static CI, ${browserTests.size} browser CI, ${legacyRewrite.size} rewrite, ${legacyRetire.size} retire`);
