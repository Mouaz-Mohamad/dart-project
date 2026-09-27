const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Eye", "Dart Eye.html"), "utf8");
const settings = fs.readFileSync(path.join(root, "Eye", "dart-settings.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "Js", "dart-ui.js"), "utf8");
const catalog = fs.readFileSync(path.join(root, "Js", "dart-catalog.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "backend", "migrations", "0053_item_level_discount_priority.sql"), "utf8");

for (const id of [
  "settings-promotion-form",
  "settings-promotion-limit-basis",
  "settings-promotion-total-limit",
  "settings-promotion-customer-limit",
  "settings-promotion-audience",
  "settings-promotions-list",
]) assert(html.includes(`id="${id}"`), `missing promotion control ${id}`);

assert(settings.includes("/api/v1/admin/promotions"), "campaign manager must use the protected API");
assert(settings.includes("expectedVersion"), "campaign edits must use optimistic concurrency");
assert(ui.includes("/api/v1/me/promotions/resolve"), "cart must resolve automatic campaigns from the server");
assert(!catalog.includes("activeSiteDiscount?.()"), "legacy global site discount must not override item pricing");
assert(migration.includes("count(DISTINCT pu.customer_user_id)"), "first-customer limit must count unique customers");
assert(migration.includes("FOR UPDATE"), "campaign reservation and reward restoration must lock authoritative rows");
assert(migration.includes("dart_restore_birthday_discount_after_return"), "birthday reuse after a full return must be database-backed");

console.log("Promotion settings and item-priority contract checks passed.");
