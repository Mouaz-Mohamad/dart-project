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
await page.evaluate(()=>{document.getElementById("checkoutView").style.display="block";document.getElementById("cartView").style.display="none";});
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
const snapshot=await page.evaluate(()=>dartCheckoutAddress.snapshot());
await page.locator("#street-input").fill("Other road");
assert.equal(await page.evaluate(old=>dartCheckoutAddress.isCurrentSnapshot(old),snapshot),false);
await page.locator("#governorate-select").selectOption("Giza");
assert.equal(await page.evaluate(()=>dartCheckoutAddress.validate().ok),false);
assert.deepEqual(errors,[]);
console.log("PASS Google checkout viewport, offline manual fallback, coverage guards");
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
