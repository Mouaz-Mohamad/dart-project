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
await page.addScriptTag({content:fs.readFileSync(path.join(root,"Js/dart-checkout-stability.js"),"utf8")});
await page.evaluate(()=>{document.getElementById("checkoutView").style.display="block";document.getElementById("cartView").style.display="none";});
const details=page.locator("#checkout-extra-details"),summary=details.locator("summary");
for(const width of [320,390,768,1440]){
await page.setViewportSize({width,height:844});
assert.equal(await details.evaluate(el=>el.open),false,"extra details start collapsed");
assert.deepEqual(await page.locator("#checkoutForm > .form-group input:visible").evaluateAll(nodes=>nodes.map(el=>el.id)),
["checkout-name","checkout-phone1","checkout-phone2","checkout-building","checkout-floor"]);
assert.equal(await page.locator("#checkout-email").isVisible(),false);
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
for(const [id,value] of [["checkout-name","Synthetic customer"],["checkout-phone1","01000000000"],["checkout-building","21"],["checkout-floor","3"]])
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
assert.equal(await details.evaluate(el=>el.open),true,"requestSubmit reveals an invalid collapsed email");
assert.equal(await page.evaluate(()=>document.activeElement.id),"checkout-email");
await page.locator("#checkout-email").fill("synthetic@example.test");
await page.locator("#checkout-notes").fill("Synthetic delivery note");await summary.click();
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
// The disclosure also works if scripts fail to load.
await page.reload();
await page.evaluate(()=>document.getElementById("checkoutView").style.display="block");
await summary.click();assert.equal(await details.evaluate(el=>el.open),true);
await summary.click();assert.equal(await details.evaluate(el=>el.open),false);
console.log("PASS taller responsive map, five primary fields, native keyboard/no-JS disclosure, hidden-field validation/focus, preserved form data, offline manual fallback and coverage guards");
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
