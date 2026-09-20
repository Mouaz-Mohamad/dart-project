const fs = require("node:fs");
const path = require("node:path");

const roots = ["Js", "Eye"];
const businessKeys = [
  "dart_models","dart_items","dart_customers","dart_orders","dart_returns","dart_reviews",
  "dart_cards","dart_representatives","dart_damage","dart_notifications","dart_contact_messages",
  "dart_birthday_rewards","dart_birthday_messages","dart_message_queue","dart_promotions",
  "dart_cart","user_last_address","dart_users","dart_password_reset_requests",
  "dart_finance_expenses","dart_finance_budgets","dart_finance_invoices","dart_finance_goals",
  "dart_finance_marketing","dart_finance_cod_settlements","dart_finance_audit",
  "dart_draw_eligibility_audit","dart_audit","dart_platform_counters","dart_rep_session",
  "dart_site_settings"
];
const storageObjects = ["localStorage", "sessionStorage"];
const verbs = ["getItem", "setItem", "removeItem"];
const failures = [];

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(file));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(file);
  }
  return files;
}

for (const file of roots.flatMap(walk)) {
  const source = fs.readFileSync(file, "utf8");
  for (const key of businessKeys) {
    for (const object of storageObjects) {
      for (const verb of verbs) {
        for (const quote of ["'", '"', "`"]) {
          const needle = object + "." + verb + "(" + quote + key + quote;
          if (source.includes(needle)) failures.push(file + ": " + needle);
        }
      }
    }
  }
}

const catalog = fs.readFileSync("Js/dart-catalog.js", "utf8");
if (/indexedDB\s*\.\s*(?:open|deleteDatabase)\s*\(/.test(catalog)) {
  failures.push("Js/dart-catalog.js: product media must be persisted through the API, never IndexedDB");
}

const cart = fs.readFileSync("Js/one .js", "utf8");
if (/function\s+saveCartToLocalStorage\s*\(/.test(cart)) {
  failures.push("Js/one .js: stale saveCartToLocalStorage name hides the server-backed cart contract");
}
if (!/function\s+persistCartReservation\s*\(/.test(cart)) {
  failures.push("Js/one .js: server-backed cart persistence function is missing");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("PASS database-authoritative browser storage contract");
