// DART CODE GUIDE | tests/server-authority-contract.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
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
const sizeChart = read("Eye/dart-size-chart.js");
const operations = read("Eye/dart-operations.js");
const serviceWorker = read("sw.js");
const vercel = read("vercel.json");
const commerceService = read("backend/src/modules/commerce/commerce.service.ts");
const financeService = read("backend/src/modules/finance/finance.service.ts");
const relationalStore = read("backend/src/modules/dashboard/relational-domain.store.ts");
const relationalAuthorityMigration = read("backend/migrations/0025_relational_domains_authoritative.sql");
const customerInteractionService = read("backend/src/modules/commerce/customer-interaction.service.ts");
const typedReturnDamageMigration = read("backend/migrations/0026_return_damage_typed_core.sql");
const commerceRoutes = read("backend/src/modules/commerce/commerce.routes.ts");
const catalogRoutes = read("backend/src/modules/catalog/catalog.routes.ts");
const actionPermissionMigration = read("backend/migrations/0027_action_permissions.sql");
const dashboardHtml = read("Eye/Dart Eye.html");
const dashboardRuntime = read("Eye/dart.js");
const storefrontRuntime = read("Js/dart-ui.js");
const operationsRuntime = read("Eye/dart-operations.js");
const ordersApiRuntime = read("Eye/dart-orders-api.js");
const platformRuntime = read("Js/dart-platform.js");
const stateRuntime = read("Js/dart-state.js");

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
  dashboardRuntime,
  /DartDomainState\.write\(['"]dart_message_queue['"]/,
  "birthday message queue must persist through server domain state",
);
assert.match(
  dashboardRuntime,
  /DartDomainState\.write\(['"]dart_birthday_messages['"]/,
  "birthday message history must persist through server domain state",
);
assert.match(
  operations,
  /DartOrdersApi\.write/,
  "order operations must route through the orders synchronizer",
);
assert.match(
  ordersApiRuntime,
  /\/api\/v1\/admin\/orders\/\$\{encodeURIComponent\(orderRef\)\}\/workflow/,
  "dashboard order workflow changes must use the atomic workflow endpoint",
);
assert.match(
  ordersApiRuntime,
  /authoritativeEpoch[\s\S]*hasMutationBarrier\(\)[\s\S]*return readLocal\(\)/,
  "stale order hydration must be blocked while an authoritative mutation is active",
);
assert.match(
  dashboardRuntime,
  /await window\.DartOrdersApi\.workflow\(order\.orderId \|\| order\.id/,
  "forward order transitions must wait for server confirmation",
);
assert.match(
  dashboardRuntime,
  /async function dartRollbackOrderOneStep[\s\S]*await window\.DartOrdersApi\.workflow/,
  "Back must use the same server-authoritative workflow path",
);
assert.match(
  dashboardRuntime,
  /await dartRequestOrderTransition\(\[o\], target\)/,
  "single-order workflow clicks must await server confirmation",
);
assert.match(
  dashboardRuntime,
  /await dartRequestOrderTransition\(selected, target\)/,
  "bulk order workflow clicks must await server confirmation",
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
for (const key of [
  "orders.create","orders.edit","orders.archive","orders.delete","orders.bulk_manage",
  "returns.create_manual","returns.review","returns.assign","returns.inspect",
  "damage.resolve","catalog.read","catalog.edit",
]) {
  assert.ok(actionPermissionMigration.includes(`'${key}'`), `missing fine-grained permission ${key}`);
}
assert.match(
  commerceRoutes,
  /requireActionPermission\("action",[\s\S]*returns\.review[\s\S]*returns\.assign[\s\S]*returns\.inspect/,
  "return actions must be permissioned independently",
);
assert.match(
  commerceRoutes,
  /requireAnyPermission\("orders\.manage", "orders\.create"\)/,
  "manual order creation must accept the dedicated create permission",
);
assert.match(
  catalogRoutes,
  /requireAnyPermission\("damage\.manage", "damage\.resolve"\)/,
  "damage resolution must accept its dedicated permission",
);

assert.match(
  customerInteractionService,
  /INSERT INTO return_requests\(record_id,position,payload\)/,
  "new customer returns must use a row-level authoritative insert",
);
assert.ok(
  !customerInteractionService.includes(
    'writeLockedDomain(client, "returns", returnsState.version, [...existingReturns, record])',
  ),
  "new customer returns must not rewrite the full legacy returns array",
);
assert.match(
  typedReturnDamageMigration,
  /customer_user_id UUID REFERENCES customers/,
  "typed returns must have a customer foreign key",
);
assert.match(
  typedReturnDamageMigration,
  /inventory_item_id TEXT REFERENCES inventory_items/,
  "typed return and damage rows must link to physical inventory",
);
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

for (const path of [...walkJsFiles("Eye"), ...walkJsFiles("Js")]) {
  const source = read(path);
  for (const deadName of [
    "CSRF_STORAGE_KEY",
    "LEGACY_MIGRATION_PREFIX",
    "LEGACY_MIGRATION_KEY",
    "CSRF_KEY",
    "EXPENSE_CATEGORIES",
    "RESET_MARKER",
    "PASSWORD_REQUESTS_KEY",
    "DART_SCHEMA_VERSION",
    "DART_V3_ID_MIGRATION_KEY",
  ]) {
    assert.ok(!source.includes(deadName), `${path} must not retain dead legacy declaration ${deadName}`);
  }
}
for (const [runtimeName, source] of [
  ["dashboard", dashboardRuntime],
  ["storefront", storefrontRuntime],
  ["operations", operationsRuntime],
  ["platform", platformRuntime],
]) {
  for (const deadName of ["setMode","dartCanHardDelete","saveSectionState","dartVisibleRows","dartSectionKeyFromContainer","dartTomorrowBirthdays","dartEnsureMonthlyDartCardWinners","dartEnsureBrandExtraCards","dartMigrateSequentialIds","updateColorsAvailability","initTrackingMap","hashPassword","safeDemoReset","resetLocalDemoDataOnce","isCompletedCustomerReturn","leaderboardDataSignature","publicCustomerName"]) {
    assert.ok(
      !new RegExp(`\\b${deadName}\\b`).test(source),
      `${runtimeName} runtime must not retain dead legacy helper ${deadName}`,
    );
  }
}
assert.match(
  stateRuntime,
  /typeof root\.structuredClone === "function"[\s\S]*JSON\.parse\(JSON\.stringify\(value\)\)/,
  "shared runtime cloning must fall back when structuredClone is unavailable",
);
assert.ok(
  !storefrontRuntime.includes("structuredClone(") &&
    !operationsRuntime.includes("structuredClone("),
  "feature runtimes must use the shared clone compatibility helper",
);
assert.ok(
  !catalog.includes("const uid = () => crypto.randomUUID();"),
  "catalog IDs must retain a getRandomValues fallback for browsers without randomUUID",
);
assert.ok(
  !dashboardRuntime.includes(".replaceAll("),
  "dashboard runtime should avoid replaceAll when simple global replacement is enough",
);
assert.match(
  dashboardRuntime,
  /querySelectorAll\("\[data-sales-year-delta\]"\)[\s\S]*addEventListener\("click"/,
  "dashboard sales-year controls must be wired through external event listeners",
);
assert.match(
  dashboardRuntime,
  /querySelectorAll\("\[data-chart-period-tow\]"\)[\s\S]*addEventListener\("click"/,
  "dashboard chart-period controls must be wired through external event listeners",
);
assert.ok(
  !dashboardRuntime.includes("dartEnsureMonthlyDartCardWinners"),
  "monthly Dart Card winner selection must not run authoritatively in the browser",
);
assert.ok(!dashboardHtml.includes('class=""'), "dashboard HTML must not retain empty class attributes");
assert.ok(
  !/<[^>]*\btype=["'][^"']+["'][^>]*\btype=["'][^"']+["'][^>]*>/i.test(dashboardHtml),
  "dashboard HTML must not contain duplicate type attributes",
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
const globalSecurityHeaders = vercelConfig.headers
  .find((entry) => entry.source === "/(.*)")?.headers || [];
const csp = globalSecurityHeaders
  .find((header) => header.key === "Content-Security-Policy")?.value || "";
assert.ok(csp, "storefront must publish a Content-Security-Policy");
assert.ok(
  !/script-src[^;]*'unsafe-inline'/.test(csp),
  "script-src must not allow unsafe-inline execution",
);
assert.match(
  csp,
  /script-src-attr 'none'/,
  "inline JavaScript event attributes must be blocked by CSP",
);
assert.match(
  csp,
  /frame-src 'none';/,
  "Dart Eye no longer needs third-party authentication frames",
);
assert.ok(
  !/accounts\.google\.com/.test(csp) && !/supabase\.co/.test(csp),
  "retired Google/Supabase Staff auth origins must not remain in the browser CSP",
);

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
