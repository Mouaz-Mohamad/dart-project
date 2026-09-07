const fs = require('fs');
const vm = require('vm');

const window = {};
const context = vm.createContext({
  window,
  document:{querySelector(){return null;}},
  navigator:{onLine:true},
  URLSearchParams,
  fetch:async () => { throw new Error('Network is not used by these tests'); },
  setTimeout,
  clearTimeout,
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  Set,
  Map,
  Promise
});
window.window = window;

vm.runInContext(fs.readFileSync('Js/dart-address.js', 'utf8'), context, {filename:'Js/dart-address.js'});
const address = window.DartAddress;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(address.isSupportedGovernorateName('Cairo Governorate'), 'English Cairo governorate must be accepted');
assert(address.isSupportedGovernorateName('محافظة القاهرة'), 'Arabic Cairo governorate must be accepted');
assert(address.isSupportedGovernorateName('Giza'), 'Giza must be accepted');
assert(address.isSupportedGovernorateName('محافظة الجيزة'), 'Arabic Giza governorate must be accepted');
assert(!address.isSupportedGovernorateName('Alexandria'), 'A third governorate must be rejected');
assert(address.isSupportedDeliveryResult({lat:'30.0444', lon:'31.2357', address:{state:'Cairo Governorate'}}), 'A verified Cairo result must be accepted');
assert(address.isSupportedDeliveryResult({lat:'30.0131', lon:'31.2089', address:{state:'Giza Governorate'}}), 'A verified Giza result must be accepted');
assert(address.isSupportedDeliveryResult({lat:'28.3500', lon:'28.9000', address:{state:'Giza Governorate'}}), 'A verified Giza-governorate result must not be rejected by the old city-centre radius');
assert(!address.isSupportedDeliveryResult({lat:'29.3000', lon:'30.8500', address:{state:'Faiyum Governorate'}}), 'A third governorate inside the broad map envelope must still be rejected');
assert(!address.isSupportedDeliveryResult({lat:'31.2000', lon:'29.9187', address:{state:'Alexandria Governorate'}}), 'A result outside the delivery zone must be rejected');

console.log('PASS Cairo and Giza delivery-zone unit tests');
