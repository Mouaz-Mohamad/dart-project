// Synthetic browser regression: no production customers, orders, inventory or Google billing.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http");
const { chromium } = require("playwright");
const mockGoogle = `
window.DART_GOOGLE_MAPS_BROWSER_KEY = 'synthetic-browser-key';
window.__geocodes = []; window.__routes = 0; window.__maps = 0; window.__markers = [];
window.__lookup = (lat=30.05,lng=31.25) => ({formatted_address:'Test street, Cairo, Egypt',
address_components:[{types:['country'],short_name:'EG',long_name:'Egypt'},
{types:['administrative_area_level_1'],long_name:'Cairo Governorate'},
{types:['sublocality'],long_name:'Test district'}, {types:['route'],long_name:'Test street'}],
geometry:{location:{lat:()=>lat,lng:()=>lng}}});
window.google={maps:{
Map:class {constructor(el){window.__maps++; el.textContent='Synthetic Google Map';this.events={};window.__map=this;} addListener(n,fn){this.events[n]=fn} panTo(){} setZoom(){} setCenter(){} fitBounds(){}},
Marker:class {constructor(options){this.options=options;this.events={};window.__markers.push(this)}setMap(){}setPosition(){}addListener(n,fn){this.events[n]=fn}},
Polyline:class{setMap(){}setPath(path){window.__path=path}},LatLngBounds:class{extend(){}},event:{clearInstanceListeners(){}},
Geocoder:class{geocode(request,callback){window.__geocodes.push({request,callback});if(!window.__delayGeocode)callback([window.__lookup()], 'OK')}},
importLibrary:async()=>({Route:{computeRoutes:async request=>{window.__routes++; window.__routeRequest=request; if(window.__routeFailure) throw Error('unavailable');
return {routes:[{path:[{lat:30.02,lng:31.25},{lat:30.05,lng:31.25}],warnings:[],
legs:[{steps:[{instructions:'Continue on Test road',maneuver:'STRAIGHT',startLocation:{lat:30.02,lng:31.25},endLocation:{lat:30.04,lng:31.25},path:[{lat:30.02,lng:31.25},{lat:30.04,lng:31.25}]},
{instructions:'Turn right onto Test street',maneuver:'TURN_RIGHT',startLocation:{lat:30.04,lng:31.25},endLocation:{lat:30.05,lng:31.25},path:[{lat:30.04,lng:31.25},{lat:30.05,lng:31.25}]}]}],distanceMeters:3500,durationMillis:300000}]};}}})}};
`;
const repHtml = fs.readFileSync("rep.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const checkoutHtml = fs.readFileSync("cart-checkout.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://fixture").pathname;
  if (pathname.startsWith("/Js/") || pathname.startsWith("/CSS/")) {
    res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : "text/css");
    return res.end(fs.readFileSync(pathname.slice(1)));
  }
  if (pathname === "/api/v1/shipping/validate-point") {res.setHeader("Content-Type", "application/json");return res.end('{"valid":true}');}
  res.setHeader("Content-Type", "text/html");res.end(pathname === "/rep.html" ? repHtml : checkoutHtml);
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:["--no-sandbox","--disable-dev-shm-usage"]});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}}), errors=[];
    page.on("pageerror", error=>errors.push(error.message));
    await page.route(/https:\/\//, route=>route.abort());
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin+"/cart-checkout.html");
    await page.addScriptTag({content:mockGoogle});
    await page.evaluate(()=>{
      window.DartShippingAvailability={ready:true,canonical:()=>"Cairo",isAddressCovered:()=>true};
      document.getElementById("checkoutView").style.display="block";
    });
    await page.addScriptTag({path:"Js/dart-google-maps.js"});
    await page.addScriptTag({path:"Js/dart-checkout-google.js"});
    await page.waitForFunction(()=>window.dartCheckoutAddress && window.__maps===1);
    await page.evaluate(()=>{document.getElementById("checkout-building").value="10";document.getElementById("checkout-floor").value="2"});
    await page.locator("#address-input").fill("Test address"); await page.locator("#dart-google-search").click();
    await page.waitForFunction(()=>document.getElementById("checkoutForm").dataset.dartAddressSource==="map");
    assert.equal(await page.locator("#street-input").inputValue(),"Test street");
    assert.equal(await page.locator("#area-input").inputValue(),"Test district");
    assert.equal(await page.locator("#lat-input").inputValue(),"30.0500000");
    await page.locator("#checkout-building").fill("12");
    await page.locator("#checkout-floor").fill("3");
    assert.equal(await page.locator("#lat-input").inputValue(),"30.0500000","building/floor edits must preserve the chosen pin");
    await page.evaluate(()=>{const field=document.getElementById("area-input");field.dataset.dartCoverageUpdate="1";field.value="Coverage district";field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new Event("change",{bubbles:true}));delete field.dataset.dartCoverageUpdate});
    assert.equal(await page.locator("#lat-input").inputValue(),"30.0500000","coverage selector labels supplement the verified pin");
    // A late address result cannot replace a newer pin or a manual edit.
    await page.evaluate(()=>{window.__delayGeocode=true});
    await page.locator("#address-input").fill("Old query");await page.locator("#dart-google-search").click();
    await page.waitForFunction(()=>window.__geocodes.length===2);
    await page.evaluate(()=>{window.__delayGeocode=false;window.__map.events.click({latLng:{lat:()=>30.06,lng:()=>31.26}})});
    await page.waitForFunction(()=>document.getElementById("lat-input").value==="30.0600000");
    await page.evaluate(()=>window.__geocodes[1].callback([window.__lookup(31,32)],"OK"));
    assert.equal(await page.locator("#lat-input").inputValue(),"30.0600000");
    await page.locator("#street-input").fill("Manual correction");
    assert.equal(await page.locator("#lat-input").inputValue(),"");
    assert.equal(await page.evaluate(()=>window.dartCheckoutAddress.validate().source),"manual");
    // Late Google authentication failures replace the broken viewport and clear its pin.
    await page.evaluate(()=>{document.dispatchEvent(new CustomEvent("dart:google-maps-error",{detail:{message:"Synthetic authorization failure"}}))});
    assert.match(await page.locator("#dart-checkout-google-map").textContent(),/authorization failure/);
    await page.goto(origin+"/rep.html");
    await page.addScriptTag({content:mockGoogle});
    await page.addScriptTag({path:"Js/dart-google-maps.js"});
    await page.evaluate(()=>{
      window.__order={id:"synthetic-1",orderId:"TEST-1",status:"Out With Representative",clientName:"Synthetic customer",phone1:"",latitude:30.05,longitude:31.25,addressSource:"map",priceSnapshot:[],finalAmount:640};
      window.__gps={latitude:30.02,longitude:31.25,accuracy:5};
      Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(ok){ok({coords:window.__gps})},watchPosition(ok){window.__watch=ok;return 1},clearWatch(){}}});
      window.__actions=[];window.__confirm=true;window.__prompts=[];

      window.DartState={formatMoney:v=>String(v)};
      window.DartApi={isConfigured:true,request:async(path,options)=>{
        if(path.endsWith("/me"))return {user:{id:"rep-test",code:"Rep-test",name:"Synthetic",phones:[],status:"active"}};
        if(path.endsWith("/work"))return {orders:window.__order.status==="Delivered"?[]:[structuredClone(window.__order)],returns:[]};
        if(path.endsWith("/location"))return {updatedAt:new Date().toISOString()};
        if(path.endsWith("/action")){window.__actions.push(options.body.action);window.__order.status=options.body.action==="delivered"?"Delivered":"Representative On The Way";window.__order.deliveryStartedAt=new Date().toISOString();return {}};
        throw Error('Unexpected synthetic endpoint '+path);
      }};
    });
    await page.addScriptTag({path:"Js/dart-dialog.js"});
    await page.addScriptTag({path:"Js/dart-rep.js"});
    await page.evaluate(()=>document.dispatchEvent(new Event("DOMContentLoaded")));
    await page.locator('[data-action="start"]').click();
    await page.waitForFunction(()=>document.getElementById("repNavigationDialog").open && window.__routes===1);
    const sizes=await page.evaluate(()=>({dialog:document.getElementById("repNavigationDialog").getBoundingClientRect().height,map:document.getElementById("repNavigationMap").getBoundingClientRect().height,height:innerHeight}));
    assert.equal(sizes.dialog,sizes.height);assert(Math.abs(sizes.map/sizes.height-.7)<.005);
    assert.equal(await page.locator("#repOrdersList [data-rep-live-map]").count(),0);
    assert.equal(await page.locator("#repNavigationComplete").isVisible(),false);
    assert.match(await page.locator("#repNavigationInstruction").textContent(),/Test road|Test street/);
    await page.locator("#repNavigationExit").click();
    await page.evaluate(()=>{window.__routeFailure=true});
    await page.locator('[data-action="navigate"]').click();
    await page.locator("#repNavigationRetry").waitFor({state:"visible"});
    assert.match(await page.locator("#repNavigationInstruction").textContent(),/directions unavailable/);
    await page.evaluate(()=>{window.__routeFailure=false});
    await page.locator("#repNavigationRetry").click();
    await page.waitForFunction(()=>document.getElementById("repNavigationRetry").hidden && window.__routes===3);

    // Closing the window is UI-only, then reopening still shows the active delivery.
    await page.locator("#repNavigationExit").click();assert.deepEqual(await page.evaluate(()=>window.__actions),["start"]);
    await page.locator('[data-action="navigate"]').click();
    await page.waitForFunction(()=>window.__routes===4);
    await page.evaluate(()=>{window.__gps.latitude=30.045;window.__watch({coords:window.__gps})});
    // The real portal throttle is time-based; trigger a new accepted reading after its second elapses.
    await page.waitForTimeout(1100);
    await page.evaluate(()=>window.__watch({coords:window.__gps}));
    await page.waitForFunction(()=>!document.getElementById("repNavigationComplete").hidden);
    assert.equal(await page.locator('[data-action="complete"]').isVisible(),true);
    await page.locator("#repNavigationComplete").click();
    await page.locator("#repNavigationDialog .dart-dialog-layer").waitFor({state:"visible"});
    assert.match(await page.locator("#dart-dialog-message").textContent(),/received.*collected 640/);
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__actions),["start"]);
    await page.locator("#repNavigationComplete").click();
    await page.locator(".dart-dialog-button.is-primary").click();
    await page.waitForFunction(()=>window.__actions.includes("delivered") && !document.getElementById("repNavigationDialog").open);
    assert.deepEqual(errors,[]);
    console.log("PASS Google checkout forward/reverse lookup, stale search, manual invalidation, auth error; courier 70% map, exit/reopen, live 1km button, cash confirmation and completion");
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
