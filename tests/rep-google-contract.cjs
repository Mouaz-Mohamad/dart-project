"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs");
const rep=fs.readFileSync("rep.html","utf8"),maps=fs.readFileSync("Js/dart-google-maps.js","utf8");
const courier=fs.readFileSync("Js/dart-rep.js","utf8");
const query=fs.readFileSync("backend/src/modules/commerce/commerce.operations-queries.ts","utf8");
assert.doesNotMatch(rep,/leaflet|openstreetmap/i);
assert.match(rep,/Js\/dart-google-maps-config\.js/);
assert.match(rep,/Js\/dart-google-maps\.js/);
assert.doesNotMatch(maps,/leaflet|openstreetmap|nominatim/i);
assert.match(maps,/maps\.googleapis\.com/);
assert.match(maps,/gm_authFailure/);
assert.match(maps,/dart:rep-road-route/);
assert.match(courier,/العنوان مكتوب يدويًا/);
assert.match(maps,/Route.computeRoutes/);
assert.match(maps,/zoomControl: true, rotateControl: true/);
assert.match(courier,/englishDigits/);
assert.doesNotMatch(courier,/every 6 seconds/);
assert.match(rep,/id="repOrdersList"[^>]*dir="rtl"/);
assert.doesNotMatch(courier,/router\.project-osrm\.org/);
assert.match(rep,/id="repNavigationDialog"/);
assert.match(maps,/loadMaps/);
assert.match(courier,/addressSource !== "manual"/);
assert.match(courier,/العنوان مكتوب يدويًا بدون دبوس مؤكد/);
assert.match(query,/addressSource: address\.addressSource/);
assert.doesNotMatch(courier,/window\.L\.map\(/);
assert.match(courier,/ROAD_ROUTE_REFRESH_MS = 15000/);
assert.match(courier,/setTimeout\(pollAssignedWork, assigned \? 5000 : 15000\)/);
assert.doesNotMatch(courier,/setInterval\(async \(\) =>/);
new Function(maps);
new Function(courier);
console.log("PASS courier Google Maps only, route polylines and manual orders");

// Execute the renderer lifecycle with synthetic maps and time; no browser, GPS or Google calls.
(async () => {
  const vm = require('node:vm');
  let time = 1800000000000, nextTimer = 0, mapCount = 0, cameraWrites = 0, nativeSwitches = 0, latestMap, blank = true, chooseRaster = false;
  const timers = new Map(), callbacks = new Map();
  const later = (fn, ms) => { const id=++nextTimer;timers.set(id,{fn,at:time+ms});return id; };
  function advance(ms) {
    const until=time+ms;
    for (;;) { const due=[...timers].filter(([,row])=>row.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn(); }
    time=until;
  }
  const dialog={open:true};
  const node={dataset:{repLiveMap:'',orderId:'synthetic'},isConnected:true,
    closest:()=>dialog,getBoundingClientRect:()=>({width:390,height:dialog.open?675:0}),
    replaceChildren(){},appendChild(){}};
  const document={hidden:false,querySelectorAll:()=>[node],createElement:()=>({style:{},addEventListener(){},setAttribute(){},appendChild(){}}),
    addEventListener(type,fn){callbacks.set(type,fn)},dispatchEvent(event){callbacks.get(event.type)?.(event)}};
  class Clock extends Date { static now(){return time;} }
  const google={maps:{Map:class{
    constructor(_el,options){mapCount++;latestMap=this;this.options=options;this.renderer=options.renderingType;this.heading=options.heading;this.tilt=options.tilt;this.events={};
      if(!blank)later(()=>this.events.tilesloaded?.(),0);}
    addListener(type,fn){this.events[type]=()=>{if(type==='tilesloaded')this.ready=true;fn();};}
    getRenderingType(){return chooseRaster ? "RASTER" : this.renderer;}
    setRenderingType(value){nativeSwitches++;this.renderer=value;this.ready=false;this.events.renderingtype_changed?.();}
    setTilt(value){this.tilt=value;}setHeading(value){this.heading=value;}
    getHeading(){return this.heading;}getTilt(){return this.tilt;}getCenter(){return this.center;}setCenter(value){cameraWrites++;this.center=value;}panTo(value){cameraWrites++;this.center=value;}setZoom(){}
    moveCamera(value){cameraWrites++;this.heading=value.heading;this.tilt=value.tilt;this.events.heading_changed?.();if(this.ready)this.events.tilesloaded?.();}
  },Marker:class{setMap(){}setPosition(){}setIcon(){}},Polyline:class{constructor(options){window.__routePath=options.path;}setMap(){}setPath(){}},Point:class{},
    event:{clearInstanceListeners(map){map.events={};},trigger(){}}}};
  const window={google,DART_GOOGLE_MAPS_BROWSER_KEY:'synthetic',setTimeout:later,clearTimeout:id=>timers.delete(id),
    cancelAnimationFrame(){},matchMedia:()=>({matches:true})};
  const context={window,google,document,Date:Clock,performance:{now:()=>time},setTimeout:later,clearTimeout:window.clearTimeout,
    CustomEvent:class{constructor(type,value){this.type=type;this.detail=value.detail;}}};
  vm.runInNewContext(maps,context);
  const mount=async()=>{
    window.DartGoogleMaps.destroyRepresentatives();dialog.open=true;
    await window.DartGoogleMaps.attachRepresentatives([{id:'synthetic',latitude:30.05,longitude:31.25,
      courierLocation:{lat:30.02,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()}}]);
  };
  dialog.open=true;const beforeClosedLoad=mapCount;const closing=window.DartGoogleMaps.attachRepresentatives([{id:'synthetic',latitude:30.05,longitude:31.25}]);dialog.open=false;await closing;assert.equal(mapCount,beforeClosedLoad,'SDK completion after exit cannot construct a hidden map');
  await mount();
  const beforeStartupGps=cameraWrites;
  for(let i=1;i<=20;i++) {
    advance(250);
    window.DartGoogleMaps.updateRepresentativeLocation({lat:30.02+i/100000,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()});
  }
  assert.equal(cameraWrites,beforeStartupGps,'continuous GPS must not move the camera while first tiles load');
  advance(1000);assert.equal(node.dataset.mapRenderer,'VECTOR','slow initial streets must keep vector');
  latestMap.events.tilesloaded();assert.equal(latestMap.tilt,0);assert.equal(latestMap.heading,90);
  const healthyCount=mapCount;advance(60000);assert.equal(mapCount,healthyCount);
  const beforeBurst=cameraWrites;
  for(let i=1;i<=20;i++) {
    advance(16);
    window.DartGoogleMaps.updateRepresentativeLocation({lat:30.03+i/100000,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()});
  }
  advance(1200);
  assert(cameraWrites-beforeBurst<=4,'burst GPS must coalesce camera movement instead of moving on every frame');
  assert.equal(window.DartGoogleMaps.getRepresentativeDiagnostics()[0].cameraUpdates,cameraWrites);
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.04,lng:31.25,heading:349.9,speed:2,updatedAt:new Clock(time).toISOString()});
  advance(1200);
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.04,lng:31.25,heading:350,speed:2,updatedAt:new Clock(time).toISOString()});
  advance(1200);assert.equal(latestMap.heading,350,'final heading below the coalescing threshold must still reach the camera');
  document.hidden=true;callbacks.get('visibilitychange')();const beforeHidden=cameraWrites;
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.04,lng:31.25,heading:80,speed:2,updatedAt:new Clock(time).toISOString()});
  assert.equal(cameraWrites,beforeHidden);document.hidden=false;callbacks.get('visibilitychange')();
  assert.equal(latestMap.heading,80,'returning to a visible tab applies the latest GPS without waiting for movement');
  await mount();latestMap.events.tilesloaded();latestMap.ready=false;
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.041,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()});
  const cachedCount=mapCount;advance(35000);assert.equal(mapCount,cachedCount,'cached camera movement without a tilesloaded event is not a rendering outage');
  latestMap.events.tilesloaded();assert.equal(node.dataset.mapState,'ready');
  await mount();dialog.open=false;const hiddenCount=mapCount;advance(90000);
  assert.equal(mapCount,hiddenCount,'closed cached maps must not trigger a raster downgrade');
  dialog.open=true;latestMap.events.tilesloaded();assert.equal(latestMap.tilt,0);
  latestMap.heading=130;latestMap.events.heading_changed();
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()});
  assert.equal(latestMap.heading,130,'manual rotation survives the next GPS reading');
  advance(8000);assert.equal(latestMap.heading,130,'manual direction remains until the courier chooses to recenter');
  window.DartGoogleMaps.setRepresentativeFollow(true);
  assert.equal(latestMap.heading,90,'explicit recenter resumes directional follow');
  const info=window.DartGoogleMaps.getRepresentativeDiagnostics()[0];
  assert.equal(info.actualRenderer,'VECTOR');assert.equal('orderId' in info,false);assert.equal('location' in info,false);
  await mount();const timeoutCount=mapCount,switches=nativeSwitches;advance(35000);
  assert.equal(node.dataset.mapRenderer,'RASTER');assert.equal(mapCount,timeoutCount+1,'a stalled WebGL surface is replaced once with an independent image-tile map');
  assert.equal(nativeSwitches,switches,'do not attempt to repair the failed WebGL surface in place');
  assert.equal(node.dataset.mapState,'error');assert.equal(node.dataset.mapFallbackReason,'vector-load-deadline');
  assert.equal(window.DartGoogleMaps.getRepresentativeDiagnostics()[0].loadingIssue,'streets-timeout');
  latestMap.events.tilesloaded();assert.equal(node.dataset.mapState,'ready');assert.equal(latestMap.tilt,0);
  assert.equal(mapCount,timeoutCount+1,'late streets recover the same replacement map after timeout');
  chooseRaster=true;await mount();const selectedCount=mapCount;
  assert.equal(node.dataset.mapRenderer,'RASTER','actual rendering type must be recorded before all streets load');
  latestMap.events.tilesloaded();advance(30000);assert.equal(mapCount,selectedCount);
  assert.equal(node.dataset.mapFallbackReason,'google-selected-raster');chooseRaster=false;
  // Road geometry may arrive while the Maps loader is still attaching its map.
  window.DartGoogleMaps.destroyRepresentatives();
  document.dispatchEvent({type:'dart:rep-road-route',detail:{orderId:'synthetic',geometry:[[30.02,31.25],[30.05,31.25]]}});
  await window.DartGoogleMaps.attachRepresentatives([{id:'synthetic',latitude:30.05,longitude:31.25}]);
  assert.equal(window.__routePath.length,2,'parallel road geometry must survive mounting');
  delete window.DART_REP_LAST_LOCATION;window.DartGoogleMaps.destroyRepresentatives();
  await window.DartGoogleMaps.attachRepresentatives([{id:'synthetic',latitude:30.05,longitude:31.25}]);
  latestMap.events.tilesloaded();assert.equal(latestMap.tilt,0,'flat camera remains flat even before the first GPS fix');
  window.DartGoogleMaps.destroyRepresentatives();assert.equal(timers.size,0);
  const requests=[];
  google.maps.importLibrary=async()=>({Route:{computeRoutes:async options=>{
    requests.push(options);return {routes:[{path:[{lat:30,lng:31},{lat:30.01,lng:31.01}],distanceMeters:1500,durationMillis:180000,
      legs:[{steps:[{instructions:'Google turn',maneuver:'TURN_RIGHT',startLocation:{lat:30,lng:31},endLocation:{lat:30.01,lng:31.01}}]}],warnings:[]}]};
  }}});
  const origin={lat:30,lng:31},destination={lat:30.01,lng:31.01};
  const driving=await window.DartGoogleMaps.computeRoute(origin,destination,'DRIVING');
  assert.equal(requests[0].routingPreference,'TRAFFIC_AWARE_OPTIMAL');assert.equal(driving.steps[0].instruction,'Google turn');
  assert.equal(driving.distanceMeters,1500);assert.equal(driving.durationMillis,180000);
  const walking=await window.DartGoogleMaps.computeRoute(origin,destination,'WALKING');
  assert.equal(requests[1].travelMode,'WALKING');assert.equal('routingPreference' in requests[1],false);
  assert(walking.warnings.some(w=>w.includes('المشي')),'Google walking safety warning is displayed');
  assert.deepEqual(requests[1].origin,origin);assert.deepEqual(requests[1].destination,destination);

  console.log('PASS renderer lifecycle: delayed vector readiness, closed-dialog timer pause, manual rotation, flat heading-up follow, bounded independent image-tile recovery, actual Google raster selection, parallel route retention and location-free diagnostics');
})().catch(error=>{console.error(error);process.exitCode=1});
