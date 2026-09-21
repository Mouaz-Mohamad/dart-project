const fs = require("fs");
const assert = require("node:assert/strict");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function walkJsFiles(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) output.push(...walkJsFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(path);
  }
  return output;
}

const catalog = read("Js/dart-catalog.js");
const sizeChart = read("Eye/dart-size-chart-v5.js");
const fixes = read("Eye/dart-fixes.js");
const operations = read("Eye/dart-operations-v4.js");
const serviceWorker = read("sw.js");
const vercel = read("vercel.json");
const commerceService = read("backend/src/modules/commerce/commerce.service.ts");
const financeService = read("backend/src/modules/finance/finance.service.ts");
const relationalStore = read("backend/src/modules/dashboard/relational-domain.store.ts");
const relationalAuthorityMigration = read("backend/migrations/0019_relational_domains_authoritative.sql");

assert.match(
  catalog,
  /if\s*\(\s*!IS_ADMIN\s*&&\s*remoteStock\s*\)/,
  "storefront availability must use server stock even when a cart reservation exists",
);
assert.match(
  catalog,
  /function assetPath\(id\)[\s\S]*catalog\/assets[\s\S]*API_BASE/,
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
  relationalStore,
  /return_requests[\s\S]*damage_records[\s\S]*promotion_records[\s\S]*loyalty_cards/,
  "critical dashboard domains must have first-class relational storage",
);
assert.match(
  commerceService,
  /readRelationalDashboardDomain/,
  "commerce must read critical operational state from relational tables",
);
assert.ok(
  !commerceService.includes(
    "SELECT domain, data FROM dashboard_domain_state WHERE domain IN ('returns','cards','birthday_rewards','birthday_messages')",
  ),
  "customer snapshots must read relational return/loyalty/birthday rows",
);
for (const domain of ["returns", "cards", "damage", "promotions", "birthday_rewards"]) {
  assert.ok(
    !commerceService.includes(`SELECT data FROM dashboard_domain_state WHERE domain='${domain}'`) &&
      !commerceService.includes(`SELECT version::text, data FROM dashboard_domain_state WHERE domain='${domain}'`),
    `commerce must not use the JSONB compatibility envelope as the ${domain} read source`,
  );
}
assert.match(
  financeService,
  /readRelationalDashboardDomain/,
  "finance must calculate from relational domain rows",
);
assert.match(
  relationalAuthorityMigration,
  /BEFORE INSERT OR UPDATE OF data ON dashboard_domain_state/,
  "critical compatibility writes must be intercepted before JSON arrays persist",
);
assert.match(
  relationalAuthorityMigration,
  /DISTINCT ON \(dart_domain_record_id\(value\)\)/,
  "authoritative compatibility trigger must deduplicate legacy record IDs before UPSERT",
);
assert.match(
  relationalAuthorityMigration,
  /ordinality DESC/,
  "duplicate legacy IDs must resolve deterministically to the latest array record",
);
assert.match(
  relationalAuthorityMigration,
  /NEW\.data := '\[\]'::jsonb/,
  "critical dashboard JSON arrays must be cleared from the version envelope",
);

assert.match(
  serviceWorker,
  /\(\?:js\|css\)/,
  "service worker must recognize JavaScript and CSS requests",
);
const codeBranch = serviceWorker.slice(serviceWorker.indexOf("js|css"));
assert.match(
  codeBranch,
  /fetch\(request\)[\s\S]*caches\.match\(request\)/,
  "JavaScript and CSS must try the network before cached fallback so devices do not run stale business logic",
);

console.log("PASS server-authority contract");


const vercelConfig = JSON.parse(vercel);
assert.ok(
  Array.isArray(vercelConfig.rewrites) &&
    vercelConfig.rewrites.some(
      (rule) =>
        rule.source === "/api/:path*" &&
        /^https:\/\/[^/]+\.vercel\.app\/api\/:path\*$/.test(rule.destination),
    ),
  "storefront must proxy API calls through its own origin",
);


const coreBusinessKeys = [
  "dart_models",
  "dart_items",
  "dart_orders",
  "dart_customers",
  "dart_returns",
  "dart_reviews",
  "dart_cards",
  "dart_representatives",
  "dart_damage",
  "dart_site_settings",
  "dart_finance_expenses",
  "dart_finance_budgets",
  "dart_finance_invoices",
  "dart_finance_goals",
  "dart_finance_marketing",
  "dart_finance_cod_settlements",
];

for (const path of [...walkJsFiles("Eye"), ...walkJsFiles("Js")]) {
  const source = read(path);
  for (const key of coreBusinessKeys) {
    const forbiddenForms = [
      `localStorage.setItem("${key}"`,
      `localStorage.setItem('${key}'`,
      "localStorage.setItem(`" + key + "`",
    ];
    assert.ok(
      forbiddenForms.every((form) => !source.includes(form)),
      `${path} must not write ${key} directly to localStorage`,
    );
  }
}
