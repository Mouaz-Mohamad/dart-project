// DART CODE GUIDE | tests/tracking-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
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
window.DartState={read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}};
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
localStorage.setItem('dart_returns', JSON.stringify([
  {id:'RDB1',returnId:'R-1',clientId:'DA-1',isPostDeliveryReturn:true,status:'Pending Request',createdAt:'2026-09-07T10:00:00Z'},
  {id:'RDB2',returnId:'R-2',clientId:'DA-1',isPostDeliveryReturn:true,status:'Completed',completedAt:'2026-09-08T10:00:00Z',createdAt:'2026-09-08T10:00:00Z'},
  {id:'RDB3',returnId:'R-3',clientId:'DA-2',isPostDeliveryReturn:true,status:'Pending Request',createdAt:'2026-09-09T10:00:00Z'},
]));

const trackingSource = fs.readFileSync('Js/dart-tracking.js','utf8');
const representativeSource = fs.readFileSync('Js/dart-rep.js','utf8');
const liveOperationsSource = fs.readFileSync('Eye/dart-live-operations.js','utf8');
const mainCss = fs.readFileSync('CSS/main.css','utf8');
vm.runInContext(trackingSource, context, {filename:'Js/dart-tracking.js'});
assert(window.DartTracking.currentOrder().orderId === 'K-2', 'Tracking should use the signed-in customer latest order when no query is present');
sessionStorage.setItem('dart_last_order_id','K-1');
assert(window.DartTracking.currentOrders().length === 2, 'A signed-in customer must see every active order, even when checkout saved one last order ID');
assert(window.DartTracking.currentOrder().orderId === 'K-2', 'The latest active customer order remains first while all groups stay visible');
context.location.search='?order=K-3';
assert(window.DartTracking.currentOrder().orderId === 'K-3', 'Explicit tracking links should select their exact order');
context.location.search='';
assert(window.DartTracking.currentReturns().length === 1, 'Completed returns must leave active tracking while pending returns remain visible');
sessionStorage.setItem('dart_last_return_id','R-1');
assert(window.DartTracking.currentReturns()[0].returnId === 'R-1', 'Tracking must remember the newly created return request');
context.location.search='?return=R-3';
assert(window.DartTracking.currentReturns()[0].returnId === 'R-3', 'Explicit return tracking links must select their exact request');
assert(trackingSource.includes('LIVE_LOCATION_POLL_MS = 1000'), 'Customer live tracking must poll at one-second cadence while visible');
assert(trackingSource.includes('/api/v1/me/tracking/live'), 'Tracking must use the lightweight live-location endpoint');
assert(trackingSource.includes('setLatLng'), 'Courier movement must update existing Leaflet markers instead of recreating the map');
assert(trackingSource.includes('Reset view'), 'Manual map movement must expose a Reset view control');
assert(trackingSource.includes('manualView'), 'Tracking must preserve customer-controlled zoom until Reset view is used');
assert(!trackingSource.includes('setInterval(() => void refreshServerTracking(), 3000)'), 'The old single three-second full-render tracking loop must stay removed');
assert(representativeSource.includes('lastLocationSyncAt < 3000'), 'Active representative GPS sync must use the approved three-second cadence');
assert(representativeSource.includes('updateDeliveryMapsLocation(latestApiLocation)'), 'Representative GPS updates must move existing map layers instead of rerendering the whole work UI');
assert(representativeSource.includes('async function syncFreshRepresentativeLocation()'), 'Starting a delivery must have an explicit fresh-GPS sync path');
assert(representativeSource.includes('await syncFreshRepresentativeLocation();'), 'Starting a delivery must publish a GPS sample even when the courier remains stationary');
assert(trackingSource.includes('const businessId = kind === \"order\" ? record?.orderId : record?.returnId;'), 'Live tracking must key trips by stable public order/return IDs before internal UUIDs');
assert(representativeSource.includes('maximumAge: 0'), 'The first delivery GPS sample must not reuse a stale device location');
assert(trackingSource.includes('function activeTrackingRecord(records = [])'), 'Grouped customer tracking must resolve the actively delivered order instead of binding the map to the first grouped order');
assert(trackingSource.includes('router.project-osrm.org/route/v1/driving'), 'Customer live tracking must request a road-aware route while delivery is active');
assert(liveOperationsSource.includes('let representativeFilterId = \"\";'), 'Live Operations must keep explicit filtering separate from focused representative state');
assert(liveOperationsSource.includes('return !representativeFilterId || String(rep.id) === representativeFilterId;'), 'Focusing a representative must not hide other active representatives unless an explicit filter is applied');
assert(liveOperationsSource.includes('function selectRepresentative(id, focus = false, preserveFilter = false)'), 'representative focus must distinguish itself from the explicit dropdown filter');
assert(liveOperationsSource.includes('representativeFilterId = "";'), 'normal representative focus must clear stale filters so all couriers remain visible');
assert(liveOperationsSource.includes('selectRepresentative(representativeFilterId, true, true)'), 'only the explicit representative dropdown may preserve map filtering');
assert(liveOperationsSource.includes('zoomControl: false'), 'Live Operations map must disable Leaflet zoom controls at construction time');
assert(liveOperationsSource.includes('setPrefix(false)'), 'Live Operations must remove Leaflet framework branding while keeping provider attribution');
assert(mainCss.includes('.order-tracking-list .tracking-card { width:min(760px,100%); color:#000; }'), 'tracking cards must force readable black text');
assert(mainCss.includes('.dart-tracked-order-unit { display:grid; gap:7px; padding:4px 0; background:transparent; }'), 'grouped tracked-order units must override the global section background');
assert(mainCss.includes('background: rgba(51, 65, 85, 0.30);'), 'the waiting tracking overlay must be exactly 30% translucent gray');
assert(/#tracking-map,\s*\n\.tracking-order-map\s*\{[\s\S]*?height:\s*300px;/.test(mainCss), 'every customer order map surface must have a real 300px Leaflet height under the 30% overlay');
assert(trackingSource.includes('L.polyline([], {'), 'customer routing must start with an empty route until real road geometry arrives');
assert(trackingSource.includes('state.route.setLatLngs([]);'), 'customer routing failure must remove the route instead of drawing a fake straight line');
assert(!trackingSource.includes('[state.destination.lat, state.destination.lng],\n          [position.lat, position.lng]'), 'customer tracking must never seed a straight destination-to-courier route');
assert(representativeSource.includes('router.project-osrm.org/route/v1/driving'), 'representative delivery maps must request road-aware OSRM geometry');
assert(representativeSource.includes('entry.route.setLatLngs([]);'), 'representative routing failure must leave pins visible without a fake straight line');
assert(!/polyline\(\s*\[\s*\[courierLat, courierLng\],\s*\[destinationLat, destinationLng\]/.test(representativeSource), 'representative delivery maps must not draw direct courier-to-customer polylines');
assert(liveOperationsSource.includes('async function roadLegGeometries(rep, coordinates)'), 'Live Operations must road-route every visible representative rather than only a selected one');
assert(liveOperationsSource.includes('steps=true'), 'Live Operations must request per-leg road geometry so current and upcoming stops keep their own colors');
assert(!liveOperationsSource.includes('String(rep.id) !== selectedRepresentativeId'), 'Live Operations road routing must not be restricted to the selected representative');
assert(!liveOperationsSource.includes('[coordinates[index - 1], coordinates[index]]'), 'Live Operations must not fall back to straight operational route segments');
assert(liveOperationsSource.includes('dart-live-rep-brief'), 'dart-live-sidebar cards must show order count plus current and next stops');
assert(trackingSource.includes('state.shell?.classList.remove("is-disabled");'), 'a saved destination map must stay visible while courier GPS is pending');
assert(trackingSource.includes('Waiting for representative location'), 'a started delivery without GPS must explicitly wait for the first courier location');
assert(trackingSource.includes('record.status === \"Representative On The Way\"'), 'authoritative delivery status must activate live tracking even when a legacy start timestamp is absent');
assert(liveOperationsSource.includes('renderRepresentativeList();\n    renderMarkers();'), 'clearing an order-focus filter must repaint all representative markers immediately');
assert(!mainCss.includes('.leaflet-control-attribution {\n    display: none !important;'), 'required tile-provider attribution must not be globally hidden');
console.log('PASS tracking order-resolution unit tests');
