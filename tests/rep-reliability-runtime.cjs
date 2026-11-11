// Source-executing courier regression checks. Synthetic identity/GPS only; no network or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  let time = 1800000000000, watches = 0, clears = 0, nextId = 0;
  const callbacks = {}, timers = new Map(), requests = [], nodes = new Map();
  const element = id => {
    if (id === 'rep-return-card-template') return null;
    if (!nodes.has(id)) {
      const e = {hidden:true,dataset:{},textContent:'',open:false,children:[],writes:0,
        classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this[type]=fn;},setAttribute(){},
        querySelectorAll(){return [];},querySelector(){return null;},
        replaceChildren(){this.children=[];},appendChild(){this.children.push({});},
        showModal(){this.open=true;},close(){this.open=false;},reset(){}};
      Object.defineProperty(e,'innerHTML',{get(){return this.html||'';},set(v){this.html=v;this.writes++;this.children=[{}];}});
      nodes.set(id,e);
    }
    return nodes.get(id);
  };
  const document = {hidden:false,addEventListener(type,fn){callbacks[type]=fn;},dispatchEvent(){},
    getElementById:element,querySelectorAll(){return [];},createElement(){return {};},body:{classList:{add(){},remove(){}}}};
  class Clock extends Date { static now(){return time;} }
  const navigator = {geolocation:{watchPosition(ok,fail){watches++;callbacks.gps=ok;callbacks.gpsError=fail;return watches;},clearWatch(){clears++;}}};
  const window = {addEventListener(){},DartState:{formatMoney:v=>String(v)},DartApi:{isConfigured:true,request:async(path,options)=>{requests.push({path,options});return {updatedAt:new Clock(time).toISOString(),accepted:true};}},
    DartGoogleMaps:{attachRepresentatives:async()=>{},destroyRepresentatives(){},updateRepresentativeLocation(){},resizeRepresentatives(){},pauseRepresentatives(){},
      computeRoute:async()=>({geometry:[],steps:[],warnings:[]})}};
  const source=fs.readFileSync('Js/dart-rep.js','utf8').replace('    bindEvents();','    /* Event wiring is covered separately by browser CI. */')
    .replace('  window.DartRepPortal = {',`  window.audit = {publishRepresentativeLocation,ensureLocationWatch,clearRepresentativeSession,updateRouteProgress,
      renderOrders,openNavigation,closeNavigation,updateDeliveryControls,latestNavigationPosition,previewRepresentativePosition,
      entry(){return deliveryMaps.get(navigationOrderId);},location(){return latestApiLocation;},work(){return apiWork;},
      seed(work){saveSession({id:'rep',code:'REP-1',name:'Synthetic',phones:[],status:'active'});apiWork=work;},
      replaceWork(work){apiWork=work;},setNavigation(id){navigationOrderId=id;}};
    window.DartRepPortal = {`);
  vm.runInNewContext(source,{window,document,navigator,sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    location:{protocol:'https:',hostname:'fixture.invalid'},Date:Clock,console,AbortController,
    setInterval(){},setTimeout(fn,ms){const id=++nextId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},CustomEvent:class{}});
  const order={id:'one',orderId:'TEST-1',status:'Representative On The Way',deliveryStartedAt:'yes',latitude:30.05,longitude:31.25,
    clientName:'First name',phone1:'01000000000',address:'First street',finalAmount:100,
    courierLocation:{lat:30.04,lng:31.25,accuracy:5,updatedAt:new Clock(time).toISOString()}};
  return {window,document,navigator,callbacks,timers,requests,element,order,api:window.audit,
    advance(ms){time+=ms;},preview(){return {lat:30.04,lng:31.25,accuracy:5,sampledAt:new Clock(time).toISOString(),updatedAt:new Clock(time).toISOString()};},
    counts(){return {watches,clears};}};
}
(async()=>{
  let f=fixture();f.api.seed({orders:[f.order],returns:[]});
  assert.equal(await f.api.publishRepresentativeLocation(f.preview()),true);
  for(let i=0;i<59;i++){f.advance(100);await f.api.publishRepresentativeLocation(f.preview());}
  assert.equal(f.requests.length,1,'local GPS updates must not write before six seconds');
  f.advance(100);await f.api.publishRepresentativeLocation(f.preview());assert.equal(f.requests.length,2);
  assert(f.requests.every(r=>r.options.body.sampledAt),'server receives the GPS sample time');
  f.advance(6000);let finish;
  f.window.DartApi.request=()=>new Promise(resolve=>{finish=resolve;});
  const pending=f.api.publishRepresentativeLocation(f.preview());
  f.advance(6000);void f.api.publishRepresentativeLocation(f.preview());
  f.api.clearRepresentativeSession();finish({updatedAt:f.preview().updatedAt,accepted:true});await pending;
  assert.equal(f.api.location(),null,'an old account response cannot restore location after logout');
  assert.equal(f.api.work().orders.length,0);

  f=fixture();f.api.seed({orders:[f.order],returns:[]});f.api.ensureLocationWatch();
  f.callbacks.gpsError({code:2});f.api.ensureLocationWatch();
  assert.equal(f.counts().watches,1,'transient GPS errors must not create additional watches');
  f.api.clearRepresentativeSession();assert.equal(f.counts().clears,1,'logout must clear GPS');
  await f.callbacks.gps({coords:{latitude:30,longitude:31,accuracy:5}});
  assert.equal(f.requests.length,0,'old watch callback must not send after logout');

  f=fixture();f.api.seed({orders:[f.order],returns:[]});f.api.renderOrders();
  const list=f.element('repOrdersList'),writes=list.writes;
  f.api.replaceWork({orders:[{...f.order,clientName:'Updated name',phone1:'01000000001',address:'Updated street',finalAmount:250}],returns:[]});
  f.api.renderOrders();assert.equal(list.writes,writes+1);assert.match(list.innerHTML,/Updated name/);assert.match(list.innerHTML,/250/);

  f=fixture();f.api.seed({orders:[f.order],returns:[]});await f.api.openNavigation(f.order);
  const original=f.api.entry();
  const changed={...f.order,latitude:30.06};f.api.replaceWork({orders:[changed],returns:[]});
  await f.api.openNavigation(changed);assert.notEqual(f.api.entry(),original);assert.equal(f.api.entry().destination.lat,30.06);
  const entry=f.api.entry();entry.steps=Array.from({length:12},(_,i)=>({instruction:'Step '+i,start:{lat:30+(12-i)/1000,lng:31},end:{lat:30+(12-i)/1000,lng:31}}));
  f.api.updateRouteProgress(entry,{lat:30,lng:31});assert.equal(entry.stepIndex,0,'crossing/later steps must not skip unvisited Google turns');
  entry.steps=[{instruction:'First',start:{lat:30,lng:31},end:{lat:30.001,lng:31}},
    {instruction:'Next',start:{lat:30.001,lng:31},end:{lat:30.002,lng:31}}];entry.stepIndex=0;
  f.api.updateRouteProgress(entry,{lat:30.001,lng:31});assert.equal(entry.stepIndex,1,'reaching a Google turn advances in order');
  f.advance(1000);const fresh={...f.preview(),lat:30.041};f.window.DART_REP_LAST_LOCATION=fresh;
  assert.equal(f.api.latestNavigationPosition(f.order).lat,30.041,'route origin uses local GPS ahead of the database acknowledgement');
  f.advance(121000);assert.equal(f.api.latestNavigationPosition(f.order),null,'stale fixes cannot start navigation');
  const pickup={...f.order,id:'pickup',status:'Pickup On The Way',pickupStartedAt:'yes',requestType:'Return'};
  f.api.replaceWork({orders:[],returns:[pickup]});await f.api.openNavigation(pickup);assert.equal(f.api.entry().orderId,'pickup');

  f=fixture();f.window.DartApi.request=async path=>{if(path.endsWith('/me'))return {user:{id:'rep',status:'active'}};throw Error('temporary outage');};
  await f.callbacks.DOMContentLoaded();assert([...f.timers.values()].some(t=>t.ms===5000),'initial work failure must still schedule polling');
  console.log('PASS courier reliability: six-second serialized GPS, sample timestamps, logout/watch cleanup, transient GPS recovery, late-response isolation, updated cards/destination, bounded steps, embedded pickup and startup recovery');
})().catch(error=>{console.error(error);process.exitCode=1;});
