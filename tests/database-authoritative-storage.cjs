const fs = require("node:fs");

const files = [
  "Js/dart-catalog.js","Js/dart-site-settings.js","Js/dart-platform.js","Js/one .js",
  "Js/dart-tracking.js","Js/dart-rep.js","Js/dart-api.js","Js/dart-returns.js",
  "Eye/dart-domain-state.js","Eye/dart-orders-api.js","Eye/dart-admin-auth.js","Eye/dart-fixes.js",
  "Eye/dart.js","Eye/dart-finance.js","Eye/dart-settings.js","Eye/dart-operations-v4.js"
];
const keys = [
  "dart_models","dart_items","dart_customers","dart_orders","dart_returns","dart_reviews",
  "dart_cards","dart_representatives","dart_damage","dart_notifications","dart_contact_messages",
  "dart_birthday_rewards","dart_birthday_messages","dart_message_queue","dart_promotions",
  "dart_cart","user_last_address","dart_users","dart_password_reset_requests",
  "dart_finance_expenses","dart_finance_budgets","dart_finance_invoices","dart_finance_goals",
  "dart_finance_marketing","dart_finance_cod_settlements","dart_finance_audit",
  "dart_draw_eligibility_audit","dart_audit"
];
const verbs = ["getItem","setItem","removeItem"];
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const key of keys) {
    for (const verb of verbs) {
      for (const quote of ["'", String.fromCharCode(34), String.fromCharCode(96)]) {
        const needle = "localStorage." + verb + "(" + quote + key + quote;
        if (source.includes(needle)) failures.push(file + ": " + needle);
      }
    }
  }
  if (file === "Js/dart-catalog.js" && source.includes("indexedDB.")) {
    failures.push(file + ": product images must not persist in IndexedDB");
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Database-authoritative browser storage check passed");
