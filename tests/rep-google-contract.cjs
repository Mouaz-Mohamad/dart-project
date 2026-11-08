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
assert.match(courier,/Manual address/);
assert.match(maps,/Route.computeRoutes/);
assert.doesNotMatch(courier,/router\.project-osrm\.org/);
assert.match(rep,/id="repNavigationDialog"/);
assert.match(maps,/loadMaps/);
assert.match(courier,/addressSource !== "manual"/);
assert.match(courier,/Manual address: no verified customer pin/);
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
  let time = 1800000000000, nextTimer = 0, mapCount = 0, latestMap, blank = true;
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
  const document={hidden:false,querySelectorAll:()=>[node],createElement:()=>({addEventListener(){}}),
    addEventListener(type,fn){callbacks.set(type,fn)},dispatchEvent(event){callbacks.get(event.type)?.(event)}};
  class Clock extends Date { static now(){return time;} }
  const google={maps:{Map:class{
    constructor(_el,options){mapCount++;latestMap=this;this.options=options;this.heading=options.heading;this.tilt=options.tilt;this.events={};
      if(!blank)later(()=>this.events.tilesloaded?.(),0);}
    addListener(type,fn){this.events[type]=fn;}getRenderingType(){return this.options.renderingType;}
    getHeading(){return this.heading;}getTilt(){return this.tilt;}setCenter(){}setZoom(){}
    moveCamera(value){this.heading=value.heading;this.tilt=value.tilt;this.events.heading_changed?.();}
  },Marker:class{setMap(){}setPosition(){}setIcon(){}},Polyline:class{setMap(){}setPath(){}},Point:class{},
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
  await mount();advance(11000);assert.equal(node.dataset.mapRenderer,'VECTOR','slow initial streets must keep vector');
  latestMap.events.tilesloaded();assert.equal(latestMap.tilt,60);assert.equal(latestMap.heading,90);
  const healthyCount=mapCount;advance(60000);assert.equal(mapCount,healthyCount);
  await mount();dialog.open=false;const hiddenCount=mapCount;advance(90000);
  assert.equal(mapCount,hiddenCount,'closed cached maps must not trigger a raster downgrade');
  dialog.open=true;latestMap.events.tilesloaded();assert.equal(latestMap.tilt,60);
  latestMap.heading=130;latestMap.events.heading_changed();
  window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.25,heading:90,speed:2,updatedAt:new Clock(time).toISOString()});
  assert.equal(latestMap.heading,130,'manual rotation survives the next GPS reading');
  advance(8000);assert.equal(latestMap.heading,90,'navigation follow resumes without another control');
  const info=window.DartGoogleMaps.getRepresentativeDiagnostics()[0];
  assert.equal(info.actualRenderer,'VECTOR');assert.equal('orderId' in info,false);assert.equal('location' in info,false);
  await mount();advance(30000);assert.equal(node.dataset.mapRenderer,'RASTER');
  assert.equal(node.dataset.mapFallbackReason,'visible-tile-timeout');
  latestMap.events.tilesloaded();const fallbackCount=mapCount;advance(60000);assert.equal(mapCount,fallbackCount);
  window.DartGoogleMaps.destroyRepresentatives();assert.equal(timers.size,0);
  console.log('PASS renderer lifecycle: delayed vector readiness, closed-dialog timer pause, manual rotation, 60-degree follow, bounded raster recovery and location-free diagnostics');
})().catch(error=>{console.error(error);process.exitCode=1});
