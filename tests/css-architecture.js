"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "CSS/main.css"), "utf8");
const responsive = fs.readFileSync(path.join(root, "CSS/responsive.css"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "Eye/dart.css"), "utf8");

function skipQuoted(text, index, quote) {
  index += 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === quote) return index + 1;
    else index += 1;
  }
  throw new Error("Unclosed CSS string");
}

function skipComment(text, index) {
  const end = text.indexOf("*/", index + 2);
  if (end < 0) throw new Error("Unclosed CSS comment");
  return end + 2;
}

function mediaEnd(text, start) {
  let index = start;
  while (index < text.length && text[index] !== "{") index += 1;
  assert(index < text.length, "@media needs a block");
  let depth = 1;
  index += 1;
  while (index < text.length && depth) {
    if (text.startsWith("/*", index)) index = skipComment(text, index);
    else if (["\"", "'"].includes(text[index])) index = skipQuoted(text, index, text[index]);
    else {
      if (text[index] === "{") depth += 1;
      if (text[index] === "}") depth -= 1;
      index += 1;
    }
  }
  assert.strictEqual(depth, 0, "@media block must close");
  return index;
}

function topLevelParts(text) {
  const media = [];
  const normal = [];
  let index = 0;
  let last = 0;
  let depth = 0;
  while (index < text.length) {
    if (text.startsWith("/*", index)) { index = skipComment(text, index); continue; }
    if (["\"", "'"].includes(text[index])) { index = skipQuoted(text, index, text[index]); continue; }
    if (depth === 0 && text.startsWith("@media", index) && !/[\w-]/.test(text[index + 6] || "")) {
      const end = mediaEnd(text, index);
      normal.push(text.slice(last, index));
      media.push(text.slice(index, end));
      index = end;
      last = end;
      continue;
    }
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    assert(depth >= 0, "CSS cannot have an unmatched closing brace");
    index += 1;
  }
  assert.strictEqual(depth, 0, "CSS blocks must close");
  normal.push(text.slice(last));
  return { media, normal: normal.join("") };
}

assert.strictEqual(topLevelParts(main).media.length, 0, "Main storefront CSS must not contain @media queries");
const responsiveParts = topLevelParts(responsive);
assert(responsiveParts.media.length > 0, "Responsive CSS must contain @media queries");
assert.strictEqual(
  responsiveParts.normal.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  "",
  "Responsive CSS may only contain @media blocks",
);
assert(!/#(?:brand|finance|models|orders|returns|representative)\b/.test(main), "Dashboard section selectors must not leak into storefront CSS");
for (const [name, source] of [["main", main], ["responsive", responsive]]) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert(
    !/[^{}]+\{\s*\}/.test(withoutComments),
    `${name} storefront CSS must not contain empty rules`,
  );
}

assert(
  !dashboard.includes("&::-webkit-scrollbar"),
  "Dashboard CSS must use standard selectors instead of nested scrollbar syntax",
);
assert(
  !dashboard.includes("@import url("),
  "Dashboard CSS must not delay rendering with external @import stylesheets",
);
assert(
  /max-height:\s*calc\(100vh - 16px\);\s*max-height:\s*calc\(100dvh - 16px\);/.test(responsive),
  "Dynamic viewport sizing must retain a vh fallback",
);
assert(
  /max-height:\s*68vh;\s*max-height:\s*68dvh;/.test(responsive),
  "Size-chart scroll height must retain a vh fallback",
);

console.log(`PASS storefront/dashboard CSS architecture (${responsiveParts.media.length} responsive blocks)`);
