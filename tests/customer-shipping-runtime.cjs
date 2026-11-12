const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ui = fs.readFileSync('Js/dart-ui.js', 'utf8');
const functions = ui.slice(ui.indexOf('function applyCartQuote('), ui.indexOf('function renderCart()', ui.indexOf('function applyCartQuote(')));
let fee = 100, quote = null;
const elements = Object.fromEntries(['subtotalVal','discountVal','shippingVal','totalVal'].map(id=>[id,{textContent:'',setAttribute(){},removeAttribute(){}}]));
const c = { console, document:{getElementById:id=>elements[id]}, cartData:[{id:'M1',quantity:2}],
  DartCatalog:{model:()=>({selling:500,discount:20})}, syncBirthdayCheckoutDiscount(){}, appliedDiscountRate:0,
  window:{DartSiteSettings:{get:()=>({shippingFeePerOrder:fee})},DartPlatform:{currentCartQuote:()=>quote,currentUser:()=>null}} };
vm.createContext(c); vm.runInContext(functions,c);
c.updateCartTotals();
assert.equal(elements.subtotalVal.textContent,'1000 EGP');
assert.equal(elements.discountVal.textContent,'200 EGP');
assert.equal(elements.shippingVal.textContent,'100 EGP');
assert.equal(elements.totalVal.textContent,'900 EGP');
assert.equal(c.window.dartDisplayedTotalMinor,90000);
fee=125.25;c.updateCartTotals();assert.equal(elements.totalVal.textContent,'925.25 EGP');
fee=0;c.updateCartTotals();assert.equal(elements.shippingVal.textContent,'0 EGP');assert.equal(elements.totalVal.textContent,'800 EGP');
quote={fingerprint:'fresh',subtotalMinor:100000,discountMinor:20000,shippingMinor:15000,totalMinor:95000};
assert.equal(c.applyCartQuote(quote),true);assert.equal(elements.shippingVal.textContent,'150 EGP');assert.equal(elements.totalVal.textContent,'950 EGP');
assert.equal(c.applyCartQuote({...quote,fingerprint:'stale'}),false);assert.equal(elements.totalVal.textContent,'950 EGP');
quote=null;c.cartData=[];c.updateCartTotals();assert.equal(elements.shippingVal.textContent,'0 EGP');assert.equal(elements.totalVal.textContent,'0 EGP');
const settings=fs.readFileSync('Js/dart-site-settings.js','utf8');assert.match(settings,/shippingFeePerOrder: 100/);
const checkout=fs.readFileSync('cart-checkout.html','utf8');assert.equal((checkout.match(/id="shippingVal"/g)||[]).length,1);
console.log('PASS shipping display: once per order, discount exclusion, zero/decimal fees, current server quote, stale quote rejection and empty cart');
