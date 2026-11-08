// Synthetic browser regression: no production customers, orders, inventory or Google billing.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http");
const { chromium } = require("playwright");
const mockGoogle = `
window.DART_GOOGLE_MAPS_BROWSER_KEY = 'synthetic-browser-key';
window.__geocodes = []; window.__routes = 0; window.__maps = 0; window.__markers = [];window.__panCalls=[];window.__mapHistory=[];
window.__autocompleteRequests=[];window.__pendingSuggestions=[];window.__placeDetails=[];
window.__suggestions = text => ({suggestions:[{placePrediction:{mainText:text+' building',secondaryText:'Test district, Cairo',text:text+' building, Cairo',toPlace:()=>({location:{lat:()=>30.05,lng:()=>31.25},fetchFields:async request=>{window.__placeDetails.push(request);if(window.__delayDetails)await new Promise(resolve=>{window.__finishDetails=resolve})}})}}]});
window.__lookup = (lat=30.05,lng=31.25) => ({formatted_address:'Test street, Cairo, Egypt',
address_components:[{types:['country'],short_name:'EG',long_name:'Egypt'},
{types:['administrative_area_level_1'],long_name:'\u202bمحافظة القاهرة\u202c',short_name:'القاهرة'},
{types:['sublocality'],long_name:'Test district'}, {types:['route'],long_name:'Test street'}],
geometry:{location:{lat:()=>lat,lng:()=>lng}}});
window.google={maps:{
Map:class {constructor(el,options){window.__maps++;window.__mapHistory.push(this);this.options=options;this.events={};this.heading=options.heading||0;this.renderingType=options.renderingType||'RASTER';
if(window.__throwVector && this.renderingType==='VECTOR')throw Error('Synthetic WebGL initialization failure');
el.textContent='Synthetic Google Map';window.__map=this;
if(!(this.renderingType==='VECTOR'?window.__blankVector:window.__blankRaster))setTimeout(()=>this.events.tilesloaded?.(),0);
} addListener(n,fn){this.events[n]=fn} panTo(location){window.__panCalls.push(location)} setZoom(zoom){this.zoom=zoom} setCenter(location){window.__panCalls.push(location)} fitBounds(){} getRenderingType(){return this.renderingType} getHeading(){return this.heading} moveCamera(options){this.heading=options.heading;this.tilt=options.tilt;window.__panCalls.push(options.center)}},
Marker:class {constructor(options){this.options=options;this.events={};window.__markers.push(this)}setMap(){}setPosition(position){this.options.position=position}setIcon(icon){this.options.icon=icon}addListener(n,fn){this.events[n]=fn}},
Point:class{constructor(x,y){this.x=x;this.y=y}},Polyline:class{constructor(options){window.__polyline=options}setMap(){}setPath(path){window.__path=path}},LatLngBounds:class{extend(){}},event:{clearInstanceListeners(map){map.events={}}},
Geocoder:class{geocode(request,callback){window.__geocodes.push({request,callback});if(!window.__delayGeocode)callback([window.__lookup()], 'OK')}},
importLibrary:async name=>name==='places'?{AutocompleteSessionToken:class{},AutocompleteSuggestion:{fetchAutocompleteSuggestions:async request=>{
window.__autocompleteRequests.push(request);if(window.__autocompleteFailure)throw Error('Unavailable');
if(window.__deferSuggestions)return new Promise(resolve=>window.__pendingSuggestions.push({input:request.input,resolve}));return window.__suggestions(request.input);
}}}:({Route:{computeRoutes:async request=>{window.__routes++; window.__routeRequest=request; if(window.__routeFailure) throw Error('unavailable');
return {routes:[{path:[{lat:30.02,lng:31.25},{lat:30.05,lng:31.25}],warnings:[],
legs:[{steps:[{instructions:'Continue on Test road',maneuver:'STRAIGHT',startLocation:{lat:30.02,lng:31.25},endLocation:{lat:30.04,lng:31.25},path:[{lat:30.02,lng:31.25},{lat:30.04,lng:31.25}]},
{instructions:'Turn right onto Test street',maneuver:'TURN_RIGHT',startLocation:{lat:30.04,lng:31.25},endLocation:{lat:30.05,lng:31.25},path:[{lat:30.04,lng:31.25},{lat:30.05,lng:31.25}]}]}],distanceMeters:3500,durationMillis:300000}]};}}})}};
`;
const repHtml = fs.readFileSync("rep.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const checkoutHtml = fs.readFileSync("cart-checkout.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const productionCsp = JSON.parse(fs.readFileSync("vercel.json", "utf8")).headers
  .find(row=>row.source==="/(.*)").headers.find(row=>row.key==="Content-Security-Policy").value;
const cspWorkerProbe = `
try { new Function('return 1')(); document.body.dataset.dynamicCode='allowed'; }
catch { document.body.dataset.dynamicCode='blocked'; }
const source=URL.createObjectURL(new Blob(['self.postMessage("worker-ready")'],{type:'text/javascript'}));
try {
  const worker=new Worker(source);
  worker.onmessage=event=>{document.body.dataset.worker=event.data;worker.terminate();URL.revokeObjectURL(source)};
  worker.onerror=()=>{document.body.dataset.worker='blocked';worker.terminate();URL.revokeObjectURL(source)};
} catch { document.body.dataset.worker='blocked';URL.revokeObjectURL(source); }
`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://fixture").pathname;
  if (pathname==="/Js/__maps-csp-probe.js") {
    res.setHeader("Content-Type","text/javascript"); return res.end(cspWorkerProbe);
  }
  if (pathname==="/__maps-csp-before.html" || pathname==="/__maps-csp-after.html") {
    res.setHeader("Content-Type","text/html");
    res.setHeader("Content-Security-Policy",pathname.includes("before") ? productionCsp.replace(/worker-src[^;]*/,"worker-src 'self'") : productionCsp);
    return res.end('<!doctype html><html><body><script>document.body.dataset.inline="allowed"</script><script src="/Js/__maps-csp-probe.js"></script></body></html>');
  }
  if (pathname.startsWith("/Js/") || pathname.startsWith("/CSS/")) {
    res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : "text/css");
    return res.end(fs.readFileSync(pathname.slice(1)));
  }
  if (pathname === "/api/v1/shipping/checkout-coverage") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({governorates:Array.from({length:27},(_,i)=>({id:i===0?"Cairo":i===1?"Giza":`Synthetic-${i}`,en:i===0?"Cairo":"Other",ar:i===0?"القاهرة":"أخرى",available:true,carriers:["dart"],cities:[]})),companies:[]}));
  }
  if (pathname === "/api/v1/shipping/validate-point") {res.setHeader("Content-Type", "application/json");return res.end('{"valid":true}');}
  res.setHeader("Content-Type", "text/html");res.end(pathname === "/rep.html" ? repHtml : checkoutHtml);
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:["--no-sandbox","--disable-dev-shm-usage"]});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,colorScheme:"dark"}), errors=[];
    page.on("pageerror", error=>errors.push(error.message));
    await page.route(/https:\/\//, route=>route.abort());
    const origin=`http://127.0.0.1:${server.address().port}`;
    // Use the real deployment CSP: the former worker policy reproduces the vector bootstrap failure.
    await page.goto(origin+"/__maps-csp-before.html");
    await page.waitForFunction(()=>Boolean(document.body.dataset.worker));
    assert.equal(await page.locator("body").getAttribute("data-worker"),"blocked");
    await page.goto(origin+"/__maps-csp-after.html");
    await page.waitForFunction(()=>Boolean(document.body.dataset.worker));
    assert.equal(await page.locator("body").getAttribute("data-worker"),"worker-ready","production CSP must permit the blob workers needed by vector Maps");
    assert.equal(await page.locator("body").getAttribute("data-dynamic-code"),"blocked","dynamic code execution stays disabled");
    assert.equal(await page.locator("body").getAttribute("data-inline"),null,"unapproved inline scripts stay disabled");
    console.log("PASS real production CSP: old policy blocks vector-map blob workers; corrected policy starts them while inline/dynamic scripts remain blocked");
    await page.goto(origin+"/cart-checkout.html");
    await page.addScriptTag({content:mockGoogle});
    await page.evaluate(()=>{
      document.getElementById("checkoutView").style.display="block";
    });
    await page.addScriptTag({path:"Js/dart-google-maps.js"});
    await page.addScriptTag({path:"Js/dart-checkout-regions.js"});
    await page.waitForFunction(()=>window.DartShippingAvailability?.ready);
    await page.addScriptTag({path:"Js/dart-checkout-google.js"});
    await page.addScriptTag({path:"Js/dart-checkout-places.js"});
    await page.waitForFunction(()=>window.dartCheckoutAddress && window.__maps===1);
    assert.equal(await page.evaluate(()=>window.__map.options.colorScheme),"LIGHT","checkout map must stay light on a dark-mode device");
    assert.equal(await page.evaluate(()=>window.__map.options.mapTypeId),"roadmap");
    assert.equal(await page.evaluate(()=>window.__map.options.gestureHandling),"cooperative","the map must not trap checkout page scrolling");
    assert.equal(await page.locator(".dart-checkout-map-card").evaluate(el=>getComputedStyle(el).colorScheme),"light");
    assert.equal(await page.locator("#checkout-extra-details").evaluate(el=>el.open),false);
    await page.evaluate(()=>{document.getElementById("checkout-building").value="10";document.getElementById("checkout-floor").value="2"});
    await page.locator("#address-input").fill("Test address"); await page.locator("#dart-google-search").click();
    await page.waitForFunction(()=>document.getElementById("checkoutForm").dataset.dartAddressSource==="map");
    assert.equal(await page.locator("#street-input").inputValue(),"Test street");
    assert.equal(await page.locator("#area-input").inputValue(),"Test district");
    assert.equal(await page.locator("#lat-input").inputValue(),"30.0500000");
    assert.equal(await page.locator("#checkout-extra-details").evaluate(el=>el.open),false,"Google populates address fields while extra details stay collapsed");
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
    await page.locator("#checkout-extra-details summary").click();
    await page.locator("#street-input").fill("Manual correction");
    await page.locator("#checkout-extra-details summary").click();
    assert.equal(await page.locator("#lat-input").inputValue(),"");
    assert.equal(await page.evaluate(()=>window.dartCheckoutAddress.validate().source),"manual");
    // Type-ahead uses Places, then reuses reverse lookup and server pin verification.
    await page.locator("#address-input").fill("Panorama");
    await page.locator(".dart-address-prediction").waitFor({state:"visible"});
    assert.match(await page.locator(".dart-address-prediction").textContent(),/Panorama building/);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      await page.locator(".dart-address-prediction").scrollIntoViewIfNeeded();
      const boxes=await page.evaluate(()=>{
        const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}};
        const map=box("#dart-checkout-google-map"),search=box(".dart-map-search-bar"),suggestions=box(".dart-address-predictions"),locate=box("#dart-google-current-location");
        const option=document.querySelector(".dart-address-prediction").getBoundingClientRect();
        return {map,search,suggestions,locate,hit:Boolean(document.elementFromPoint(option.left+option.width/2,option.top+option.height/2)?.closest(".dart-address-prediction"))};
      });
      assert(boxes.map.height>=400,`checkout map remains usable at ${width}px`);
      assert(boxes.search.top>=boxes.map.top && boxes.search.bottom<boxes.map.bottom,"search floats at the top of the map");
      assert(boxes.search.left>=boxes.map.left && boxes.search.right<=boxes.map.right,"search fits inside the map");
      assert(boxes.suggestions.top>=boxes.search.bottom && boxes.suggestions.bottom<=boxes.map.bottom,"suggestions open beneath search and stay within the map");
      assert(boxes.locate.bottom<=boxes.map.bottom-24,"location button leaves Google attribution visible");
      assert(boxes.hit,`suggestions must receive pointer events above the map at ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.DART_CHECKOUT_SCREENSHOT)await page.locator(".dart-checkout-map-card").screenshot({path:process.env.DART_CHECKOUT_SCREENSHOT});
    assert.equal(await page.evaluate(()=>window.__autocompleteRequests.at(-1).includedRegionCodes[0]),"eg");
    await page.evaluate(()=>{window.__firstToken=window.__autocompleteRequests.at(-1).sessionToken});
    await page.evaluate(()=>{window.__delayDetails=true});
    await page.locator(".dart-address-prediction").tap();
    await page.waitForFunction(()=>Boolean(window.__finishDetails));
    assert.equal(await page.evaluate(()=>window.dartCheckoutAddress.validate().ok),false,"checkout must wait for the selected Place details and verified pin");
    await page.evaluate(()=>{window.__delayDetails=false;window.__finishDetails()});
    await page.waitForFunction(()=>document.getElementById("checkoutForm").dataset.dartAddressSource==="map");
    assert.equal(await page.locator("#street-input").inputValue(),"Test street");
    assert.deepEqual(await page.evaluate(()=>window.__placeDetails[0].fields),["location"]);
    await page.locator("#address-input").fill("Panorama B");
    await page.locator(".dart-address-prediction").waitFor({state:"visible"});
    assert.equal(await page.evaluate(()=>window.__firstToken!==window.__autocompleteRequests.at(-1).sessionToken),true,"selection must end the billing session");
    const beforeKeyboard=await page.evaluate(()=>window.__geocodes.filter(r=>r.request.address).length);
    await page.locator("#address-input").press("ArrowDown");
    await page.locator("#address-input").press("Enter");
    await page.waitForFunction(()=>document.getElementById("checkoutForm").dataset.dartAddressSource==="map");
    assert.equal(await page.evaluate(()=>window.__geocodes.filter(r=>r.request.address).length),beforeKeyboard,"Enter selects a suggestion without starting the old Search handler");
    await page.evaluate(()=>{window.__deferSuggestions=true});
    await page.locator("#address-input").fill("Older query");
    await page.waitForFunction(()=>window.__pendingSuggestions.length===1);
    await page.locator("#address-input").fill("Newer query");
    await page.waitForFunction(()=>window.__pendingSuggestions.length===2);
    await page.evaluate(()=>{window.__pendingSuggestions[1].resolve(window.__suggestions('Newer query'));window.__pendingSuggestions[0].resolve(window.__suggestions('Older query'));window.__deferSuggestions=false});
    await page.locator(".dart-address-prediction").waitFor({state:"visible"});
    assert.match(await page.locator(".dart-address-prediction").textContent(),/Newer query/);
    await page.locator("#address-input").press("Escape");
    assert.equal(await page.locator(".dart-address-predictions").isVisible(),false);
    await page.evaluate(()=>{window.__suggestions=()=>({suggestions:[]})});
    await page.locator("#address-input").fill("No matching place");
    await page.getByText("No matching suggestions. Add a street or district, or use Search.",{exact:true}).waitFor({state:"visible"});
    await page.locator("#address-input").press("Escape");
    assert.equal(await page.locator(".dart-address-predictions").isVisible(),false);
    await page.evaluate(()=>{window.__autocompleteFailure=true});
    await page.locator("#address-input").fill("Unavailable query");
    await page.getByText("Google suggestions are temporarily unavailable. Use Search or choose a point on the map.",{exact:true}).waitFor({state:"visible"});
    await page.locator("#dart-google-search").click();
    await page.waitForFunction(()=>document.getElementById("checkoutForm").dataset.dartAddressSource==="map");
    assert.equal(await page.locator(".dart-address-predictions").isVisible(),false);
    // Late Google authentication failures replace the broken viewport and clear its pin.
    await page.evaluate(()=>{document.dispatchEvent(new CustomEvent("dart:google-maps-error",{detail:{message:"Synthetic authorization failure"}}))});
    assert.match(await page.locator("#dart-checkout-google-map").textContent(),/authorization failure/);
    await page.goto(origin+"/rep.html");
    await page.addScriptTag({content:mockGoogle});
    await page.addScriptTag({path:"Js/dart-google-maps.js"});
    await page.evaluate(()=>{
      window.__order={id:"synthetic-1",orderId:"TEST-1",status:"Out With Representative",clientName:"Synthetic customer",phone1:"",latitude:30.05,longitude:31.25,addressSource:"map",priceSnapshot:[],finalAmount:640};
      window.__gps={latitude:30.02,longitude:31.25,accuracy:5,heading:90,speed:2};
      Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(ok){ok({coords:window.__gps})},watchPosition(ok){window.__watch=ok;return 1},clearWatch(){}}});
      window.__actions=[];window.__confirm=true;window.__prompts=[];

      window.DartState={formatMoney:v=>String(v)};
      window.DartApi={isConfigured:true,request:async(path,options)=>{
        if(path.endsWith("/me"))return {user:{id:"rep-test",code:"Rep-test",name:"Synthetic",phones:[],status:"active"}};
        if(path.endsWith("/work"))return {orders:window.__order.status==="Delivered"?[]:[structuredClone(window.__order)],returns:[]};
        if(path.endsWith("/location")){if(window.__delayLocation)await new Promise(resolve=>{window.__finishLocation=resolve});return {updatedAt:new Date().toISOString()}};
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
    assert.equal(await page.locator(".dart-rep-navigation-banner").count(),0);
    assert.equal(await page.locator("#repNavigationStatus").textContent(),"");
    assert.equal(await page.evaluate(()=>window.__polyline.strokeColor),"#1a73e8");
    assert.equal(await page.evaluate(()=>window.__path.length),2);
    assert.equal(await page.evaluate(()=>window.__map.options.renderingType),"VECTOR");
    await page.waitForFunction(()=>window.__map.tilt===60);
    assert.equal(await page.evaluate(()=>window.__map.tilt),60);
    assert.equal(await page.evaluate(()=>window.__map.heading),90);
    assert.equal(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.icon.rotation),0,"the navigation arrow faces ahead while the vector camera rotates with travel");
    assert.equal(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.icon.fillColor),"#1a73e8");
    assert.equal(await page.evaluate(()=>window.__map.zoom),17);
    // Unknown headings must not coerce null to north; stationary noise must not rotate the arrow.
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.02,lng:31.25,accuracy:5,heading:270,speed:0,updatedAt:new Date().toISOString()}));
    assert.equal(await page.evaluate(()=>window.__map.heading),90);
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.25,accuracy:5,heading:null,speed:null,updatedAt:new Date().toISOString()}));
    await page.waitForFunction(()=>window.__panCalls.at(-1).lat>30.02 && window.__panCalls.at(-1).lat<30.021);
    assert.equal(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lat<30.021),true,"position interpolates through intermediate frames instead of jumping");
    await page.waitForFunction(()=>window.__panCalls.at(-1).lat===30.021);
    assert(Math.abs(await page.evaluate(()=>window.__map.heading))<.01,"missing heading uses actual northbound movement");
    assert(Math.abs(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.icon.rotation))<.01,"missing heading uses actual northbound movement");
    assert.equal(await page.evaluate(()=>window.__panCalls.at(-1).lat),30.021);
    await page.evaluate(()=>{window.__panBefore=window.__panCalls.length;window.__map.events.dragstart()});
    await page.getByRole("button",{name:"Follow my location",exact:true}).waitFor();
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.251,accuracy:5,heading:null,updatedAt:new Date().toISOString()}));
    await page.waitForFunction(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lng===31.251);
    assert.equal(await page.evaluate(()=>window.__panCalls.length===window.__panBefore),true,"dragging pauses follow while the marker keeps moving");
    assert(Math.abs(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.icon.rotation)-90)<.01);
    await page.getByRole("button",{name:"Follow my location",exact:true}).click();
    assert.equal(await page.locator("#repNavigationFollow").getAttribute("aria-pressed"),"true");
    assert.equal(await page.evaluate(()=>window.__panCalls.at(-1).lng),31.251);
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:31,lng:32,heading:180,updatedAt:new Date(Date.now()-180000).toISOString()}));
    assert.equal(await page.evaluate(()=>window.__panCalls.at(-1).lng),31.251,"stale GPS does not move the live arrow or camera");
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.251,heading:350,speed:2,updatedAt:new Date().toISOString()}));
    await page.waitForFunction(()=>window.__map.heading===350);
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.021,lng:31.251,heading:10,speed:2,updatedAt:new Date().toISOString()}));
    await page.waitForFunction(()=>window.__map.heading!==350 && window.__map.heading!==10);
    assert.equal(await page.evaluate(()=>window.__map.heading>350 || window.__map.heading<10),true,"camera crosses north by the shortest turn");
    await page.waitForFunction(()=>window.__map.heading===10);
    // Devices without a vector renderer retain a working flat map and correctly oriented marker.
    await page.locator('#repNavigationStandard').click();
    await page.waitForFunction(()=>document.getElementById('repNavigationMap').dataset.mapRenderer==='RASTER' && document.getElementById('repNavigationMap').dataset.mapState==='ready');
    assert.equal(await page.locator('#repNavigationStandard').isDisabled(),true,"a ready standard map cannot be remounted by duplicate clicks");
    assert.equal(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.icon.rotation),10);
    await page.emulateMedia({reducedMotion:"reduce"});
    const reducedPosition=await page.evaluate(()=>{
      window.DartGoogleMaps.updateRepresentativeLocation({lat:30.0211,lng:31.251,heading:180,speed:2,updatedAt:new Date().toISOString()});
      return window.__markers.findLast(m=>m.options.title==='You').options.position.lat;
    });
    assert.equal(reducedPosition,30.0211,"reduced-motion preference displays the real fix without interpolation");
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.setViewportSize({width:1280,height:900});
    assert.equal(await page.locator("#repNavigationMap").evaluate(el=>el.getBoundingClientRect().height),630);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.0212,lng:31.251,heading:270,speed:2,updatedAt:new Date().toISOString()}));
    await page.locator("#repNavigationExit").click();
    const stoppedFrames=await page.evaluate(()=>window.__panCalls.length);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.__panCalls.length),stoppedFrames,"closing cancels camera animation");
    await page.evaluate(()=>{window.__routeFailure=true});
    await page.locator('[data-action="navigate"]').click();
    await page.locator("#repNavigationRetry").waitFor({state:"visible"});
    assert.match(await page.locator("#repNavigationStatus").textContent(),/directions unavailable/);
    await page.evaluate(()=>{window.__routeFailure=false});
    await page.locator("#repNavigationRetry").click();
    await page.waitForFunction(()=>document.getElementById("repNavigationRetry").hidden && window.__routes===3);

    // Closing the window is UI-only, then reopening still shows the active delivery.
    await page.locator("#repNavigationExit").click();assert.deepEqual(await page.evaluate(()=>window.__actions),["start"]);
    await page.locator('[data-action="navigate"]').click();
    await page.waitForFunction(()=>window.__routes===4);
    // Visual fixes must not wait for the API or unlock server-backed delivery confirmation.
    await page.waitForTimeout(1100);
    await page.evaluate(()=>{window.__delayLocation=true;window.__gps.latitude=30.045;window.__watch({coords:window.__gps,timestamp:Date.now()})});
    await page.waitForFunction(()=>Boolean(window.__finishLocation));
    await page.waitForFunction(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lat===30.045);
    assert.equal(await page.locator("#repNavigationComplete").isVisible(),false,"visual GPS cannot unlock completion before server acknowledgement");
    // A newer, throttled GPS fix still updates the visual arrow without an extra server write.
    await page.evaluate(()=>{window.__gps.latitude=30.0452;window.__watch({coords:window.__gps,timestamp:Date.now()})});
    await page.waitForFunction(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lat===30.0452);
    await page.evaluate(()=>{window.__delayLocation=false;window.__finishLocation()});
    await page.waitForFunction(()=>!document.getElementById("repNavigationComplete").hidden);
    assert.equal(await page.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lat),30.0452,"older server acknowledgement must not roll back a newer visual fix");
    assert.equal(await page.locator('[data-action="complete"]').isVisible(),true);
    await page.locator("#repNavigationComplete").click();
    await page.locator("#repNavigationDialog .dart-dialog-layer").waitFor({state:"visible"});
    assert.match(await page.locator("#dart-dialog-message").textContent(),/received.*collected 640/);
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__actions),["start"]);
    await page.locator("#repNavigationComplete").click();
    await page.locator(".dart-dialog-button.is-primary").click();
    await page.waitForFunction(()=>window.__actions.includes("delivered") && !document.getElementById("repNavigationDialog").open);
    // Isolated tile lifecycle: marker creation is not proof that the base map rendered.
    const recovery = await browser.newPage({viewport:{width:390,height:844}});
    await recovery.route(/https:\/\//, route=>route.abort());
    await recovery.goto(origin+"/rep.html");
    await recovery.addScriptTag({content:mockGoogle});
    await recovery.addScriptTag({path:"Js/dart-google-maps.js"});
    await recovery.clock.install();
    const mountRecovery=async flags=>{
      await recovery.evaluate(async flags=>{
        window.DartGoogleMaps.destroyRepresentatives();
        window.__blankVector=Boolean(flags.vector);window.__blankRaster=Boolean(flags.raster);window.__throwVector=Boolean(flags.throwVector);
        window.DART_REP_LAST_LOCATION={lat:30.02,lng:31.25,heading:90,speed:2,updatedAt:new Date().toISOString()};
        const dialog=document.getElementById('repNavigationDialog');if(!dialog.open)dialog.showModal();
        const host=document.getElementById('repNavigationMap');host.dataset.repLiveMap='';host.dataset.orderId='recovery';
        await window.DartGoogleMaps.attachRepresentatives([{id:'recovery',latitude:30.05,longitude:31.25}]);
        document.dispatchEvent(new CustomEvent('dart:rep-road-route',{detail:{orderId:'recovery',geometry:[[30.02,31.25],[30.05,31.25]]}}));
      },flags);
    };
    await mountRecovery({});await recovery.clock.runFor(10);
    const healthyCount=await recovery.evaluate(()=>window.__maps);
    await recovery.clock.fastForward(20000);
    assert.equal(await recovery.evaluate(()=>window.__maps),healthyCount,"loaded vector maps never downgrade on a timer");
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-state'),'ready');

    await mountRecovery({vector:true});
    await recovery.evaluate(()=>{window.__lateVectorTiles=window.__map.events.tilesloaded});
    await recovery.clock.fastForward(10001);await recovery.clock.runFor(10);
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-renderer'),'RASTER');
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-state'),'ready');
    assert.equal(await recovery.evaluate(()=>window.__polyline.path.length),2,"switching renderers retains the road route");
    assert.deepEqual(await recovery.evaluate(()=>window.__markers.findLast(m=>m.options.title==='Customer destination').options.position),{lat:30.05,lng:31.25});
    await recovery.evaluate(()=>window.__lateVectorTiles());
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-renderer'),'RASTER',"late retired vector callbacks cannot replace the recovered map");
    await recovery.evaluate(()=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.0202,lng:31.25,heading:90,speed:2,updatedAt:new Date().toISOString()}));
    await recovery.clock.runFor(1100);
    assert.equal(await recovery.evaluate(()=>window.__markers.findLast(m=>m.options.title==='You').options.position.lat),30.0202,"GPS tracking continues on the recovered map");

    await mountRecovery({});await recovery.clock.runFor(10);
    await recovery.evaluate(()=>document.querySelector('#repNavigationMap .dart-google-map-overlay').dispatchEvent(new Event('webglcontextlost')));
    await recovery.clock.runFor(10);
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-renderer'),'RASTER',"WebGL context loss immediately recovers to a standard map");

    await mountRecovery({throwVector:true});await recovery.clock.runFor(10);
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-renderer'),'RASTER',"vector constructor failure has a bounded fallback");
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-state'),'ready');

    await mountRecovery({vector:true,raster:true});
    await recovery.clock.fastForward(10001);await recovery.clock.fastForward(10001);
    assert.equal(await recovery.locator('#repNavigationMap').getAttribute('data-map-state'),'error');
    assert.match(await recovery.locator('#repNavigationMap').textContent(),/streets could not load.*retry Google Maps/);
    const failedCount=await recovery.evaluate(()=>window.__maps);
    await recovery.clock.fastForward(30000);
    assert.equal(await recovery.evaluate(()=>window.__maps),failedCount,"a complete tile outage never loops through new maps");

    await mountRecovery({vector:true});
    await recovery.evaluate(()=>{document.getElementById('repNavigationDialog').close();window.DartGoogleMaps.destroyRepresentatives()});
    const closedCount=await recovery.evaluate(()=>window.__maps);
    await recovery.clock.fastForward(20000);
    assert.equal(await recovery.evaluate(()=>window.__maps),closedCount,"closing cancels pending recovery");
    await recovery.close();
    assert.deepEqual(errors,[]);
    console.log("PASS simulated tile failures: vector stall, constructor failure and context loss recover once; path/pins/GPS preserved; healthy vectors retained; complete outages visible; late/closed callbacks ignored. Google checkout/Places regressions; courier vector 60-degree camera, heading-up arrow, interpolated motion, shortest turns, pause/recenter and cleanup; visual GPS before delayed API acknowledgement without unlocking delivery or rolling back newer fixes; 70% map, retry, exit/reopen, 1km gate and cash confirmation");
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
