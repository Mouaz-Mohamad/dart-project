"use strict";
const path = require("node:path");
const assert = require("node:assert/strict");

// Local HTTP fixtures exercise the open storefront while the separately tested
// Coming Soon cover remains published. This helper is never staged for production.
exports.openStorefrontFixture = function openStorefrontFixture(file, content) {
  if (path.basename(file) !== "index.html") return content;
  const html = content.toString();
  if (!html.includes('id="dart-coming-soon-cover"')) return content;
  assert.match(html, /<style\s+id="dart-coming-soon-style">[\s\S]*?<\/style>/);
  assert.match(html, /<!-- DART COMING SOON: remove this cover[\s\S]*?<!-- END DART COMING SOON\. -->/);
  return html.replace(/<style\s+id="dart-coming-soon-style">[\s\S]*?<\/style>/, "")
    .replace(/<!-- DART COMING SOON: remove this cover[\s\S]*?<!-- END DART COMING SOON\. -->/, "");
};
