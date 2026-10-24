// Run the same maintained static regression suite used by Frontend CI.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const inventory = require("../tests/test-inventory.json");
const root = path.resolve(__dirname, "..");

for (const file of inventory.ciStatic) {
  const result = spawnSync(process.execPath, [path.join("tests", file)], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS ${inventory.ciStatic.length} frontend static checks`);
