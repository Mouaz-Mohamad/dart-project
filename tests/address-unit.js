// DART CODE GUIDE | tests/address-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
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

assert(address.addressParts({address:{state:'Cairo Governorate',road:'Example',house_number:'48'}}).building === '48', 'reverse geocoding must prefer the provider house number');
assert(address.addressParts({category:'building',type:'apartments',name:'Tower A',address:{state:'Cairo Governorate',road:'Example'}}).building === 'Tower A', 'building-like provider names may fill the building field when no house number exists');
assert(address.addressParts({category:'highway',type:'residential',name:'Example Street',address:{state:'Cairo Governorate',road:'Example Street'}}).building === '', 'street names must never be invented as building numbers');
const mobileParts = address.addressParts({address:{state:'Cairo Governorate',quarter:'El Manteqa',path:'Service Path'}});
assert(mobileParts.area === 'El Manteqa', 'mobile reverse geocoding should accept quarter as a precise area fallback');
assert(mobileParts.street === 'Service Path', 'mobile reverse geocoding should accept path when road is unavailable');
const addressSource = fs.readFileSync('Js/dart-address.js', 'utf8');
assert(addressSource.includes("namedetails: '1'"), 'reverse lookup should request provider naming details for building fallback');
assert(addressSource.includes('zoomControl: false'), 'address maps must not expose Leaflet zoom buttons');
assert(addressSource.includes('setPrefix(false)'), 'address maps must remove Leaflet framework branding while provider attribution remains');
assert(addressSource.includes('Exact map pin preserved. Address details updated without moving the destination.'), 'editing address details after choosing a pin must preserve the exact coordinates');
assert(addressSource.includes('maximumAge: 0'), 'mobile GPS selection must request a fresh high-accuracy position');
assert(addressSource.includes("dart:saved-address-hydrated"), 'the primary address controller must accept late server saved-address hydration');
assert(addressSource.includes('const restoredSavedAddress = applySavedAddress(savedAddress)'), 'server saved addresses must restore their exact stored pin without reverse-geocoding it');
assert(addressSource.includes('if (!restoredSavedAddress && Number.isFinite(initialLat)'), 'a restored exact saved pin must not be reverse-geocoded again during initialization');

console.log('PASS Cairo and Giza delivery-zone unit tests');
