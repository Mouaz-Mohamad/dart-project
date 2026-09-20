const fs = require("fs");
const assert = require("node:assert/strict");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const catalog = read("Js/dart-catalog.js");
const sizeChart = read("Eye/dart-size-chart-v5.js");
const fixes = read("Eye/dart-fixes.js");
const operations = read("Eye/dart-operations-v4.js");
const serviceWorker = read("sw.js");

assert.match(
  catalog,
  /ifs*(s*!IS_ADMINs*&&s*remoteStocks*)/,
  "storefront availability must use server stock even when a cart reservation exists",
);
assert.match(
  catalog,
  /function assetPath(id)[\s\S]*API_BASE[\s\S]*catalog\/assets/,
  "catalog assets must resolve through the configured API base",
);
assert.match(
  catalog,
  /syncAdminState[\s\S]*\/api\/v1\/admin\/catalog-state/,
  "admin catalog changes must persist through the catalog API",
);
assert.match(
  catalog,
  /\/api\/v1\/catalog\/version/,
  "storefront must observe catalog version changes for live refresh",
);
assert.match(
  sizeChart,
  /DartCatalog\.write\(['"]dart_models['"]/,
  "size chart changes must write through DartCatalog",
);
assert.match(
  sizeChart,
  /DartCatalog\.syncAdminState/,
  "size chart changes must wait for server persistence",
);
assert.match(
  fixes,
  /DartDomainState\.write\(['"]dart_message_queue['"]/,
  "birthday message queue must persist through server domain state",
);
assert.match(
  fixes,
  /DartDomainState\.write\(['"]dart_birthday_messages['"]/,
  "birthday message history must persist through server domain state",
);
assert.match(
  operations,
  /DartOrdersApi\.write/,
  "order operations must route through the orders synchronizer",
);
assert.match(
  operations,
  /DartDomainState\.write/,
  "non-order operational writes must route through dashboard domain state",
);
assert.match(
  serviceWorker,
  /\.(?:js\|css)[\s\S]*fetch\(request\)/,
  "JavaScript and CSS must prefer the network so devices do not run stale business logic",
);

console.log("PASS server-authority contract");
