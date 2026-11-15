"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,"..");
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
const page=await browser.newPage(),errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/*",route=>{
const url=new URL(route.request().url());
if(url.hostname!=="localhost")return route.abort();
const file=decodeURIComponent(url.pathname).slice(1)||"cart-checkout.html";
if(file.includes("..")||!fs.existsSync(path.join(root,file)))return route.fulfill({status:404,body:""});
const type=file.endsWith(".css")?"text/css":file.endsWith(".html")?"text/html":"application/octet-stream";
let body=fs.readFileSync(path.join(root,file));
if(file.endsWith(".html"))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
return route.fulfill({contentType:type,body});
});
await page.goto("http://localhost/cart-checkout.html");
await page.evaluate(()=>{
window.DART_GOOGLE_MAPS_BROWSER_KEY="";
window.DartShippingAvailability={ready:true,isAddressCovered:addr=>addr.governorate==="Cairo"};
window.DartState={read:()=>null};
});
await page.addScriptTag({content:fs.readFileSync(path.join(root,"Js/dart-checkout-google.js"),"utf8")});
await page.addScriptTag({content:fs.readFileSync(path.join(root,"Js/dart-auth-birthday.js"),"utf8")});
await page.addScriptTag({content:fs.readFileSync(path.join(root,"Js/dart-checkout-stability.js"),"utf8")});
await page.evaluate(()=>{document.getElementById("checkoutView").style.display="block";document.getElementById("cartView").style.display="none";});
const details=page.locator("#checkout-extra-details"),summary=details.locator("summary");
for(const width of [320,390,768,1440]){
await page.setViewportSize({width,height:844});
assert.equal(await details.evaluate(el=>el.open),false,"extra details start collapsed");
assert.deepEqual(await page.locator("#checkoutForm > .form-group input:visible").evaluateAll(nodes=>nodes.map(el=>el.id)),
["checkout-name","checkout-phone1","checkout-email","checkout-phone2","checkout-building","checkout-floor"]);
const picker=await page.locator(".dart-birthday-selects").boundingBox();
assert(picker.x>=0&&picker.x+picker.width<=width,"birthday selectors fit the viewport");
for(const select of await page.locator(".dart-birthday-selects select").all()){
const box=await select.boundingBox();assert(box.height>=44&&box.width>60,"birthday controls remain usable on mobile");
}
assert.equal(await page.locator("#checkout-email").isVisible(),true);
assert.equal(await page.locator("#checkout-notes").isVisible(),false);
assert.equal(await page.locator("#area-input").isVisible(),false);
const map=await page.locator("#dart-checkout-google-map").boundingBox();
assert(Math.abs(map.height-844*.65)<2,"map uses 65% of the stable screen height on mobile and desktop");
assert(map.x>=0&&map.x+map.width<=width,"map fits the viewport");
}
await page.setViewportSize({width:390,height:844});
await summary.focus();await summary.press("Enter");
assert.equal(await details.evaluate(el=>el.open),true,"keyboard opens native disclosure");
await summary.press("Space");
assert.equal(await details.evaluate(el=>el.open),false,"keyboard closes native disclosure");
await page.evaluate(()=>document.getElementById("checkoutForm").addEventListener("submit",event=>event.preventDefault()));
// Account data can arrive after the shared birthday picker initializes.
await page.evaluate(()=>{const value=document.getElementById("checkout-birthday");value.value="2000-09-02";value.dispatchEvent(new Event("change",{bubbles:true}));});
assert.equal(await page.locator("#dartBirthDay").inputValue(),"2");
assert.equal(await page.locator("#dartBirthMonth").inputValue(),"9");
assert.equal(await page.locator("#dartBirthYear").inputValue(),"2000");
await page.locator("#dartBirthMonth").selectOption("2");await page.locator("#dartBirthDay").selectOption("29");
assert.equal(await page.locator("#checkout-birthday").inputValue(),"2000-02-29");
await page.locator("#dartBirthYear").selectOption("2001");
assert.equal(await page.locator("#dartBirthDay").inputValue(),"","a non-leap year clears February 29");
assert.equal(await page.locator("#checkout-birthday").inputValue(),"");
await page.locator("#dartBirthYear").selectOption(String(new Date().getFullYear()));
await page.locator("#dartBirthMonth").selectOption("12");await page.locator("#dartBirthDay").selectOption("31");
if(new Date().getMonth()<11||new Date().getDate()<31){
assert.equal(await page.locator("#dartBirthYear").evaluate(el=>el.validity.customError),true);
assert.equal(await page.locator("#checkout-birthday").inputValue(),"","future birthdays never produce an ISO value");
}
await page.evaluate(()=>document.getElementById("checkoutForm").reset());
await page.waitForFunction(()=>document.getElementById("dartBirthYear").value==="");
assert.equal(await page.locator("#checkout-birthday").inputValue(),"","reset clears both selectors and submitted date");
await page.locator("#dartBirthYear").selectOption("2000");
await page.locator("#dartBirthMonth").selectOption("9");await page.locator("#dartBirthDay").selectOption("2");
assert.equal(await page.evaluate(()=>new FormData(document.getElementById("checkoutForm")).get("birthday")),"2000-09-02");
for(const [id,value] of [["checkout-name","Synthetic customer"],["checkout-phone1","01000000000"],["checkout-email","synthetic@example.test"],["checkout-building","21"],["checkout-floor","3"]])
await page.locator("#"+id).fill(value);
if(process.env.DART_CHECKOUT_SCREENSHOT)await page.locator("#checkoutForm").screenshot({path:process.env.DART_CHECKOUT_SCREENSHOT});
await page.locator("#checkoutForm button[type=submit]").click();
assert.equal(await details.evaluate(el=>el.open),true,"missing required address fields reveal details before native focus");
assert.equal(await page.evaluate(()=>document.activeElement.id),"area-input");
assert.equal(await page.locator("#dart-checkout-google-map").count(),1);
await page.locator("#dart-checkout-google-map > p").filter({hasText:"Google Maps is unavailable"}).waitFor();
assert.equal(await page.evaluate(()=>{
const message=document.querySelector("#dart-checkout-google-map > p"),range=document.createRange();
range.selectNodeContents(message);
return range.getBoundingClientRect().top>document.querySelector(".dart-map-search-bar").getBoundingClientRect().bottom;
}),true,"map error text must remain visible below the floating search bar");
for(const [id,value] of [["area-input","Nasr City"],["street-input","Example St"],["checkout-building","21"],["checkout-floor","3"]])
await page.locator("#"+id).fill(value);
assert.equal(await page.evaluate(()=>dartCheckoutAddress.validate().ok),true,"manual delivery fallback works without Google");
await page.locator("#checkout-email").fill("not-an-email");await summary.click();
await page.evaluate(()=>document.getElementById("checkoutForm").requestSubmit());
assert.equal(await details.evaluate(el=>el.open),false,"invalid email is visible without expanding address details");
assert.equal(await page.evaluate(()=>document.activeElement.id),"checkout-email");
await page.locator("#checkout-email").fill("synthetic@example.test");
await summary.click();await page.locator("#checkout-notes").fill("Synthetic delivery note");await summary.click();
assert.equal(await page.evaluate(()=>new FormData(document.getElementById("checkoutForm")).get("street")),"Example St","collapsed fields are still submitted");
assert.equal(await page.evaluate(()=>new FormData(document.getElementById("checkoutForm")).get("delivery_notes")),"Synthetic delivery note","closing details preserves optional values");
await page.evaluate(()=>document.getElementById("checkoutForm").requestSubmit());
assert.equal(await details.evaluate(el=>el.open),false,"valid collapsed fields do not force extra details open on submit");
await summary.click();
const snapshot=await page.evaluate(()=>dartCheckoutAddress.snapshot());
await page.locator("#street-input").fill("Other road");
assert.equal(await page.evaluate(old=>dartCheckoutAddress.isCurrentSnapshot(old),snapshot),false);
await page.locator("#governorate-select").selectOption("Giza");
assert.equal(await page.evaluate(()=>dartCheckoutAddress.validate().ok),false);
await summary.click();
await page.evaluate(()=>document.getElementById("checkoutForm").requestSubmit());
assert.equal(await details.evaluate(el=>el.open),true,"custom shipping failure reveals the coverage controls");
assert.deepEqual(errors,[]);
// Render against the real checkout form after late session hydration, then send
// synthetic orders through the production checkout function without network I/O.
await page.evaluate(()=>{
window.fixtureCustomer=null;
window.currentUser=()=>window.fixtureCustomer;
window.DartPlatform={currentUser:window.currentUser};
window.displayPhone=value=>String(value||"").replace(/^\+20/,"0");
});
await page.evaluate(()=>window.dispatchEvent(new Event("dart:customer-session-changed")));
const contactIds=["checkout-name","checkout-phone1","checkout-email","checkout-birthday","checkout-phone2"];
const setCustomer=customer=>page.evaluate(user=>{
window.fixtureCustomer=user;
window.dispatchEvent(new Event("dart:customer-session-changed"));
},customer);
const customer={id:"synthetic-account",name:"Saved customer",phone1:"+201000000001",phone2:"+201000000002",email:"saved@example.test",birthday:"2000-09-02"};
await setCustomer(customer);
for(const id of contactIds){
assert.equal(await page.locator("#"+id).isVisible(),false,"saved contact fields are hidden");
assert.equal(await page.locator("#"+id).isDisabled(),true,"hidden contact does not participate in native validation");
}
assert.equal(await page.locator(".dart-birthday-field").isVisible(),false);
assert.equal(await page.locator("#dartBirthYear").isDisabled(),true);
assert.equal(await page.locator("[data-checkout-guest]:visible").count(),0);
assert.equal(await page.locator("#checkout-phone1").inputValue(),"01000000001");
for(const width of [320,390,768,1440]){
await page.setViewportSize({width,height:844});
assert.deepEqual(await page.locator("#checkoutForm > .form-group input:visible").evaluateAll(nodes=>nodes.map(el=>el.id)),
["checkout-building","checkout-floor"],"signed-in customer only fills the delivery address");
}
await page.evaluate(()=>document.getElementById("checkoutForm").reset());
await page.waitForFunction(()=>document.getElementById("checkout-name").value==="Saved customer");
assert.equal(await page.locator("#dartBirthYear").isDisabled(),true,"reset keeps signed-in mode");
await setCustomer({id:"incomplete-account",name:"",phone1:"",email:"",birthday:""});
assert.equal(await page.locator("#checkout-name").isVisible(),true);
assert.equal(await page.locator("#checkout-phone1").isVisible(),true);
assert.equal(await page.locator("#checkout-email").isDisabled(),true,"email is optional for an existing account");
assert.equal(await page.locator("#dartBirthYear").isDisabled(),true,"missing birthday never blocks an existing account");
assert.equal(await page.locator("#checkout-name").inputValue(),"","switching accounts clears previous contact");
await page.locator("#checkout-name").fill("Completed name");
await page.locator("#checkout-phone1").fill("01000000003");
await setCustomer({id:"incomplete-account",name:"",phone1:""});
assert.equal(await page.locator("#checkout-name").inputValue(),"Completed name","session refresh preserves missing-contact edits");
await setCustomer(customer);
await page.evaluate(()=>{
Object.assign(window,{
API_BASE:"https://synthetic.test",CART_RESERVATION_ID:"synthetic-checkout",cartData:[{id:"M1",color:"Black",size:"M",quantity:1}],
cleanupCartReservations:async()=>{},write:()=>{},uid:()=>"synthetic-next",setCartReservationId:()=>{},
saveCustomerAddress:()=>{},hydrateCustomerCommerce:()=>{},fixtureRequests:[],
apiRequest:async(url,options)=>{
if(url.includes("/quote"))return {lines:[{modelId:"M1",color:"Black",size:"M"}],fingerprint:"a".repeat(64),totalMinor:50000};
window.fixtureRequests.push({url,body:options.body});return {order:{orderId:"K-SYNTHETIC"}};
}
});
Object.assign(window.DartShippingAvailability,{load:async()=>{},canonical:value=>value,isGovernorateOpen:()=>true});
for(const [name,value] of Object.entries({governorate:"Cairo",area:"Nasr City",street:"Example St",building:"21",floor:"3"})){
const field=document.getElementById("checkoutForm").elements.namedItem(name);field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));
}
});
await page.addScriptTag({content:fs.readFileSync(path.join(root,"src/storefront/platform/checkout.js"),"utf8")});
assert.equal(await page.evaluate(()=>document.getElementById("checkoutForm").checkValidity()),true,"address-only form passes native validation");
await page.evaluate(async()=>{
// Hidden/autofilled contact cannot replace the saved identity in the order.
document.getElementById("checkout-name").value="Stale guest";
document.getElementById("checkout-email").value="stale@example.test";
await checkout(document.getElementById("checkoutForm"));
});
let request=await page.evaluate(()=>window.fixtureRequests.at(-1));
assert.equal(request.url,"/api/v1/orders");
assert.deepEqual(request.body.contact,{name:"Saved customer",phone1:"01000000001",phone2:"01000000002",email:"saved@example.test",birthday:"2000-09-02"});
assert.equal(request.body.address.street,"Example St");
await setCustomer({id:"incomplete-account",name:"",phone1:""});
await page.locator("#checkout-name").fill("Completed name");await page.locator("#checkout-phone1").fill("01000000003");
await page.evaluate(async()=>{cartData=[{id:"M1",color:"Black",size:"M",quantity:1}];await checkout(document.getElementById("checkoutForm"));});
request=await page.evaluate(()=>window.fixtureRequests.at(-1));
assert.deepEqual(request.body.contact,{name:"Completed name",phone1:"01000000003",email:""});
await setCustomer(null);
for(const id of contactIds.filter(id=>id!=="checkout-birthday")){
assert.equal(await page.locator("#"+id).isVisible(),true,"logout restores guest fields");
assert.equal(await page.locator("#"+id).inputValue(),"","logout removes private contact");
}
assert.equal(await page.locator("[data-checkout-guest]:visible").count(),2);
assert.equal(await page.locator("#dartBirthYear").isEnabled(),true);
assert.equal(await page.locator("#checkout-email").getAttribute("required"),"");
assert.equal(await page.evaluate(()=>document.getElementById("checkoutForm").checkValidity()),false,"guest must still provide contact and birthday");
for(const [id,value] of [["checkout-name","Guest customer"],["checkout-phone1","01000000004"],["checkout-email","guest@example.test"]])await page.locator("#"+id).fill(value);
await page.locator("#dartBirthYear").selectOption("2001");await page.locator("#dartBirthMonth").selectOption("9");await page.locator("#dartBirthDay").selectOption("2");
assert.equal(await page.evaluate(()=>document.getElementById("checkoutForm").checkValidity()),true);
await page.evaluate(async()=>{cartData=[{id:"M1",color:"Black",size:"M",quantity:1}];await checkout(document.getElementById("checkoutForm"));});
request=await page.evaluate(()=>window.fixtureRequests.at(-1));
assert.equal(request.url,"/api/v1/guest/orders");
assert.deepEqual(request.body.contact,{name:"Guest customer",phone1:"01000000004",email:"guest@example.test",birthday:"2001-09-02"});
assert.deepEqual(errors,[]);
// The disclosure also works if scripts fail to load.
await page.reload();
await page.evaluate(()=>document.getElementById("checkoutView").style.display="block");
await summary.click();assert.equal(await details.evaluate(el=>el.open),true);
await summary.click();assert.equal(await details.evaluate(el=>el.open),false);
console.log("PASS guest/signed-in/incomplete-account checkout, responsive address-only form, late session changes, logout/reset/privacy, saved contact in API payloads, birthday selectors, map, manual fallback and coverage guards");
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
