// Synthetic retained navigation and geofence checks; never contacts Google or production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {hidden:true, textContent:'', dataset:{}, open:false,
    setAttribute(){}, showModal(){this.open=true}, close(){this.open=false}});
  return elements.get(id);
};
let mounts = 0, destroys = 0, routes = 0, pipClosed = 0;
const window = {addEventListener(){}, DartApi:{isConfigured:true,request(){}}, DartGoogleMaps:{
  attachRepresentatives:async()=>{mounts++}, destroyRepresentatives:()=>{destroys++},
  computeRoute:async()=>{routes++; return {geometry:[],warnings:[],steps:[{instruction:'Turn right',start:{lat:30,lng:31},end:{lat:30.01,lng:31}}]}}
},documentPictureInPicture:{window:{close(){pipClosed++}}}};
const document = {addEventListener(){},dispatchEvent(){},getElementById:element,querySelectorAll:()=>[],
  body:{classList:{add(){},remove(){}}}};
const sessionStorage = {getItem:()=>null,removeItem(){}};
const source = fs.readFileSync('Js/dart-rep.js','utf8').replace('  window.DartRepPortal = {', `
  window.testNavigation = {openNavigation, closeNavigation, stopNavigation, updateDeliveryControls,
    seed(order){apiRepresentative={id:'rep'};apiWork={orders:[order],returns:[]};},
    entry(){return deliveryMaps.get(navigationOrderId)}};
  window.DartRepPortal = {`);
vm.runInNewContext(source,{window,document,sessionStorage,location:{protocol:'https:',hostname:'example.test'},
  console,setTimeout,clearTimeout,CustomEvent:class{},Date,Math,JSON,Map,Set});
(async()=>{
  const order = {id:'synthetic',status:'Representative On The Way',deliveryStartedAt:'yes',latitude:30.01,longitude:31,
    courierLocation:{lat:30,lng:31,updatedAt:new Date().toISOString()}};
  const portal = window.DartRepPortal, nav = window.testNavigation;
  const at = metres => ({...order,courierLocation:{lat:30.01-metres/111195,lng:31,updatedAt:new Date().toISOString()}});
  assert.equal(portal.deliveryProximity(at(499)).ok,true);
  assert.equal(portal.deliveryProximity(at(501)).ok,false);
  assert.equal(portal.deliveryProximity({...at(100),courierLocation:{...at(100).courierLocation,updatedAt:'2000-01-01'}}).ok,false);
  assert.equal(portal.deliveryProximity({...at(100),latitude:null}).ok,false);
  assert.equal(portal.deliveryProximity({...at(750),requestType:'Return'}).ok,true,'pickup radius preserved');
  nav.seed(order); await nav.openNavigation(order);
  await new Promise(resolve=>setTimeout(resolve,0));
  const entry=nav.entry(); assert.equal(mounts,1); assert.equal(routes,1);
  nav.closeNavigation(); assert.equal(destroys,0); assert.equal(element('repNavigationResume').hidden,false);
  await nav.openNavigation(order); assert.equal(mounts,1); assert.equal(routes,1);assert.equal(nav.entry(),entry);
  assert.match(element('repNavigationInstruction').textContent,/Turn right/);
  nav.closeNavigation();nav.seed({...order,status:'Delivered'});nav.updateDeliveryControls();
  assert.equal(destroys,1);assert.equal(nav.entry(),undefined);assert.equal(element('repNavigationResume').hidden,true);
  assert.equal(pipClosed,0);
  console.log('PASS courier navigation: 499/501m gate, stale/missing GPS, unchanged pickup radius, retained map/route on exit/reopen and cleanup after completion');
})().catch(error=>{console.error(error);process.exitCode=1});
