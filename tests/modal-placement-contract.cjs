// DART CODE GUIDE | Modal markup belongs beside the section or cards that open it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const dashboard = read("Eye/Dart Eye.html");
const groups = {
  Models: ["model-modal", "size-chart-modal"],
  Items: ["item-add-modal", "image-preview-modal"],
  Customers: ["customerModal", "password-requests-modal"],
  Orders: ["orderModal", "rep-assignment-modal", "order-reason-modal"],
  Returns: ["return-modal", "return-approval-modal", "return-rejection-modal", "return-rep-assignment-modal"],
  Damage: ["damage-modal"],
  Review: ["customer-review-modal"],
  Representative: ["representative-modal"],
  Card: ["card-modal"],
  Finance: ["dart-finance-modal"],
  Settings: ["reset-data-modal"],
};

for (const [section, ids] of Object.entries(groups)) {
  const start = `<!-- BEGIN ${section} modals:`;
  const end = `<!-- END ${section} modals. -->`;
  const sectionOpen = dashboard.indexOf(`<section id="${section.toLowerCase()}"`);
  const groupStart = dashboard.indexOf(start);
  const groupEnd = dashboard.indexOf(end);
  assert.ok(sectionOpen >= 0 && sectionOpen < groupStart && groupStart < groupEnd,
    `${section} dialogs must follow their owning dashboard section`);
  assert.match(dashboard.slice(sectionOpen, groupStart), /<\/section>\s*$/,
    `${section} dialogs must be siblings, not children of a hidden section`);
  const block = dashboard.slice(groupStart, groupEnd);
  for (const id of ids) {
    const occurrence = new RegExp(`id=["']${id}["']`, "g");
    assert.equal((dashboard.match(occurrence) || []).length, 1, `${id} must have one DOM owner`);
    assert.match(block, occurrence, `${id} must live with ${section}`);
  }
}

for (const filename of ["index.html", "products.html"]) {
  const html = read(filename);
  const start = html.indexOf("<!-- BEGIN Product-card dialogs:");
  const end = html.indexOf("<!-- END Product-card dialogs. -->");
  const block = html.slice(start, end);
  assert.ok(start > 0 && end > start, `${filename} must group its product dialogs`);
  assert.match(html.slice(0, start), /<\/section>\s*$/,
    `${filename} dialogs must follow the product listing`);
  assert.match(block, /id="product-modal-host"[^>]+sections\/product-modal\.html/);
  assert.match(block, /id="dartSetModal"/);
  assert.equal((html.match(/id="dartSetModal"/g) || []).length, 1);
}

console.log("PASS dashboard dialogs follow their sections; storefront dialogs follow product cards");
