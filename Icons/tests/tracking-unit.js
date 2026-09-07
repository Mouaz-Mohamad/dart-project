const fs = require('fs');
const vm = require('vm');

class Storage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

const localStorage = new Storage();
const sessionStorage = new Storage();
const callbacks = {};
const document = {
  hidden:false,
  addEventListener(type, callback) { (callbacks[type] ||= []).push(callback); },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
const window = {addEventListener(){},DartPlatform:{currentUser(){return {customerId:'DA-1'};}}};
window.window = window;
const context = vm.createContext({
  window,document,localStorage,sessionStorage,location:{search:''},URLSearchParams,
  L:undefined,fetch:async()=>({json:async()=>({})}),setInterval(){},setTimeout(){},
  console,Date,Math,JSON,Object,Array,String,Number,Boolean,RegExp,Error,Set,Map
});

function assert(condition, message) { if (!condition) throw new Error(message); }

localStorage.setItem('dart_orders', JSON.stringify([
  {id:'O1',orderId:'K-1',clientId:'DA-1',createdAt:'2026-09-04T10:00:00Z'},
  {id:'O2',orderId:'K-2',clientId:'DA-1',createdAt:'2026-09-05T10:00:00Z'},
  {id:'O3',orderId:'K-3',clientId:'DA-2',createdAt:'2026-09-06T10:00:00Z'}
]));

vm.runInContext(fs.readFileSync('Js/dart-tracking.js','utf8'), context, {filename:'Js/dart-tracking.js'});
assert(window.DartTracking.currentOrder().orderId === 'K-2', 'Tracking should use the signed-in customer latest order when no query is present');
sessionStorage.setItem('dart_last_order_id','K-1');
assert(window.DartTracking.currentOrder().orderId === 'K-1', 'Tracking should remember the order created in checkout');
context.location.search='?order=K-3';
assert(window.DartTracking.currentOrder().orderId === 'K-3', 'Explicit tracking links should select their exact order');
console.log('PASS tracking order-resolution unit tests');
