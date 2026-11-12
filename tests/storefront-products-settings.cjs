const assert = require("node:assert/strict");
const rules = require("../Js/dart-storefront-products.js");
const cards = [
  {code:"JACKET",cardColor:"black",stock:{M:{black:0}}},
  {code:"JACKET",cardColor:"burgundy",stock:{M:{burgundy:2}}},
  {code:"JEANS",cardColor:"blue",stock:{M:{blue:0}}},
  {code:"HOODIE",cardColor:"grey",stock:{M:{grey:3}}},
  {code:"TEE",cardColor:"white",stock:{M:{white:1}}}
];
const settings = {storefrontProducts:{
  productsFirstGroupCount:2,homeNewestCount:3,bestProductsLimit:2,
  bestModelIds:["JEANS","JACKET","HOODIE"]
}};
assert.deepEqual(rules.best(cards,settings).map(c=>c.code),["JEANS","JACKET"],"manual order overrides stock and sales");
assert.equal(rules.best(cards,settings)[1].cardColor,"burgundy","prefer available color card within the chosen model");
assert.deepEqual(rules.newest(cards,settings),cards.slice(0,3),"Home count works");
const [first,second]=rules.groups(cards,settings);
assert.deepEqual(first,cards.slice(0,2));
assert.deepEqual(second,cards.slice(2),"second group gets every remaining card");
assert.deepEqual(rules.best(cards, {storefrontProducts:{...settings.storefrontProducts,bestModelIds:[]}}),[],"no automatic Best Products fallback");
assert.deepEqual(rules.best(cards,{storefrontProducts:{...settings.storefrontProducts,bestProductsLimit:0}}),[],"zero Best Products hides all");
assert.equal(rules.groups(cards,{storefrontProducts:{productsFirstGroupCount:300}})[1].length,0,"oversized count is safe");
assert.deepEqual(rules.normalize({storefrontProducts:{bestModelIds:["JEANS","JEANS","HOODIE"]}}).bestModelIds,["JEANS","HOODIE"],"no duplicate model IDs");
console.log("PASS storefront merchandising selection, counts, split and ordering");
