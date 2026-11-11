// Real sensor adapter, synthetic events and identity; no Google/GPS/network requests.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(permission) {
  let now = 1800000000000;
  const listeners = new Map(), events = [], dialog = {open:true};
  const document = {hidden:false,getElementById:()=>dialog,
    addEventListener:(type,fn)=>listeners.set('document:'+type,fn),dispatchEvent:e=>events.push(e)};
  const window = {screen:{orientation:{angle:0}},DeviceOrientationEvent:permission ? {requestPermission:permission} : {},
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  class Clock extends Date {static now(){return now;}}
  vm.runInNewContext(fs.readFileSync('Js/dart-rep-compass.js','utf8'),{window,document,Date:Clock,
    CustomEvent:class{constructor(type,{detail}){Object.assign(this,{type,detail});}}});
  return {window,document,dialog,listeners,events,api:window.DartRepCompass,
    emit(values){now+=100;listeners.get(values.type||'deviceorientation')?.(values);},advance(ms){now+=ms;}};
}
(async()=>{
  let f=fixture();await f.api.enable();
  f.emit({alpha:90,absolute:false});assert.equal(f.api.heading,null,'relative alpha must not invent north');
  f.emit({alpha:90,absolute:true});assert.equal(f.api.heading,270);
  f.window.screen.orientation.angle=90;f.emit({alpha:90,absolute:true});assert.equal(f.api.heading,0,'landscape accounts for screen orientation');
  f.window.screen.orientation.angle=0;f.emit({webkitCompassHeading:123,webkitCompassAccuracy:10});assert.equal(f.api.heading,123);
  f.emit({webkitCompassHeading:270,webkitCompassAccuracy:70});assert.equal(f.api.heading,123,'inaccurate compass cannot overwrite accepted heading');
  assert.equal(f.events.at(-1).detail.state,'calibrate');
  f.advance(10001);assert.equal(f.api.heading,null,'stale readings fall back to GPS');
  f.document.hidden=true;f.listeners.get('document:visibilitychange')();assert(!f.listeners.has('deviceorientation'));
  f.document.hidden=false;f.listeners.get('document:visibilitychange')();assert(f.listeners.has('deviceorientation'));
  f.api.pause();assert.equal(f.api.heading,null);assert(!f.listeners.has('deviceorientationabsolute'));
  let finish,asked=false;f=fixture(()=>{asked=true;return new Promise(resolve=>{finish=resolve;});});
  const pending=f.api.enable();assert(asked,'permission must be requested synchronously during the user gesture');
  f.dialog.open=false;f.api.pause();finish('granted');await pending;
  assert(!f.listeners.has('deviceorientation'),'late grant after exit/logout must not start background sensors');
  f.api.resume();assert(!f.listeners.has('deviceorientation'),'shared Maps visibility handlers cannot resume a closed navigation compass');
  f.dialog.open=true;f.api.resume();assert(f.listeners.has('deviceorientation'));f.api.pause();
  f=fixture(async()=> 'denied');assert.equal(await f.api.enable(),false);assert.equal(f.events.at(-1).detail.state,'denied');
  f=fixture();delete f.window.DeviceOrientationEvent;assert.equal(await f.api.enable(),false);assert.equal(f.events.at(-1).detail.state,'unavailable');
  console.log('PASS compass: absolute north, relative rejection, screen orientation, accuracy/staleness, user gesture, denied/unavailable, visibility/exit cleanup and late permission isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
