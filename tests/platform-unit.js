const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');

class Storage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const localStorage = new Storage(), sessionStorage = new Storage();
const productsData = [1,2,3].map((id, index) => ({
  id, category:'shirt', title:`Product ${id}`, code:index ? 'DA-DUP' : 'DA-ONE', price:400 + id * 100,
  images:[`Photos/products/${id}.jpg`], description:`Product ${id}`,
  stock:{M:{Black:4}}
}));

const listeners = {};
const document = {
  addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
  querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, body:{}
};
const window = {DART_API_BASE_URL:'',addEventListener(){},dartAppliedPromotion:null};
const context = vm.createContext({
  window, document, localStorage, sessionStorage, productsData, cartData:[], appliedDiscountRate:0,
  crypto:webcrypto, TextEncoder, URLSearchParams, fetch:async()=>{throw new Error('not used');},
  navigator:{}, location:{assign(){},replace(){},href:''}, MutationObserver:class { observe(){} },
  setInterval(){return 0;}, setTimeout(callback){callback();return 0;}, clearTimeout(){},
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map
});
window.window = window; window.document = document; window.localStorage = localStorage; window.sessionStorage = sessionStorage;

const source = fs.readFileSync('Js/dart-platform.js','utf8');
vm.runInContext(source, context, {filename:'Js/dart-platform.js'});
const platform = window.DartPlatform;

function assert(condition, message) { if (!condition) throw new Error(message); }
function form(values) { return {dataset:{dartAddressSource:'manual'},elements:{namedItem(name){return values[name] == null ? null : {value:String(values[name])};}}}; }

(async () => {
  platform.ensureCatalogInventory();
  assert(JSON.parse(localStorage.getItem('dart_models')).length === 3, 'reset must retain exactly 3 models');
  assert(JSON.parse(localStorage.getItem('dart_items')).length === 12, 'reset must retain exactly 12 physical items');
  assert(platform.money(780.9) === '780 EGP', 'money must display without piastres or decimal rounding');

  const customer = await platform.register({name:'Unit Customer',email:'unit@example.com',phone1:'01012345678',phone2:'',password:'password1',birthday:'2000-01-01'});
  let duplicateRejected = false;
  try { await platform.register({name:'Duplicate',email:'UNIT@example.com',phone1:'01112345678',phone2:'',password:'password2',birthday:'2000-01-01'}); }
  catch { duplicateRejected = true; }
  assert(duplicateRejected, 'duplicate email must be rejected');

  context.cartData = [{id:1,title:'Product 1',price:500,quantity:1,size:'M',color:'Black'}];
  context.appliedDiscountRate = 0.25;
  window.dartCheckoutAddress = {validate(){return {ok:true,source:'manual',zone:'cairo-giza'};}};
  const order = await platform.checkout(form({customer_name:'Unit Customer',phone1:'01012345678',email:'unit@example.com',country:'Egypt',governorate:'Cairo',area:'Nasr City',street:'Example Street',building:'12',floor:'4',latitude:'30.05',longitude:'31.30',full_address:'12 Example Street, Nasr City, Cairo'}));
  assert(order.clientId === customer.customerId, 'checkout must attach the logged customer');
  assert(order.totalPrice === 500, 'subtotal must be saved before discount');
  assert(order.orderLevelDiscountAmount === 125, 'discount amount must be saved');
  assert(order.finalAmount === 375, 'final amount must be saved after discount');
  assert(platform.orderNet(order) === 375, 'all consumers must read the saved final amount');
  assert(order.latitude === '30.05' && order.addressSource === 'manual', 'address coordinates and source must be saved');

  context.cartData = [{id:1,title:'Product 1',price:500,quantity:1,size:'M',color:'Black'}];
  let outsideZoneRejected = false;
  try { await platform.checkout(form({customer_name:'Unit Customer',phone1:'01012345678',email:'unit@example.com',country:'Egypt',governorate:'Alexandria',area:'Smouha',street:'Example Street',building:'12',floor:'4',latitude:'31.20',longitude:'29.92',full_address:'Alexandria'})); }
  catch { outsideZoneRejected = true; }
  assert(outsideZoneRejected, 'checkout must reject every governorate except Cairo and Giza');

  platform.requestPasswordReset('unit@example.com');
  const requests = JSON.parse(localStorage.getItem('dart_password_reset_requests'));
  assert(requests.length === 1 && requests[0].accountId, 'password reset request must reach dashboard storage');
  console.log('PASS platform unit tests');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
