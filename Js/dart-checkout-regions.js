// DART | Checkout location selector, powered by public read-only coverage policy.
// Company settings are saved only through Staff API; the browser never grants delivery access.
(() => {
"use strict";
const $=id=>document.getElementById(id);
const norm=value=>String(value||"").trim().toLowerCase()
.replace(/[\u064b-\u065f\u0670\u0640]/g,"").replace(/[أإآ]/g,"ا").replace(/ة/g,"ه")
.replace(/[\s_-]+/g,"");
const defaults=new Set(["Cairo","Giza"]);
let regions=[
{id:"Cairo",en:"Cairo",ar:"القاهرة",cities:[]},
{id:"Giza",en:"Giza",ar:"الجيزة",cities:[]}
], companies=[],ready=false;
let activePromise=null;
const canonical=value=>{
const v=norm(value);
const known=regions.find(x=>[x.id,x.en,x.ar,"محافظة "+x.ar,x.id+" governorate"]
.some(label=>norm(label)===v));
if(known)return known.id;
if(["cairo","cairogovernorate","alqahirah","القاهرة","محافظهالقاهرة"].includes(v))return "Cairo";
if(["giza","gizagovernorate","aljizah","الجيزة","محافظهالجيزة"].includes(v))return "Giza";
return "";
};
function coveredBy(company,gov,city,area){
const selected=company.coverage?.[gov];
if(!selected)return false;
if(selected.all)return true;
if(!city)return false;
const match=selected.cities?.[city];
if(!match)return false;
return Boolean(match.all||(area&&match.areas?.includes(area)));
}
const isGovernorateOpen=value=>{
const id=canonical(value);
return defaults.has(id)||regions.some(x=>x.id===id);
};
function availableCompanies({governorate,city,coverageArea}={}){
const gov=canonical(governorate);
if(!gov)return [];
const selected=companies.filter(x=>coveredBy(x,gov,city,coverageArea));
if(defaults.has(gov))selected.unshift({id:"dart",name:"Dart Delivery"});
return selected;
}
function isAddressCovered(addr){
const g=canonical(addr?.governorate);
if(!g)return false;
return availableCompanies({governorate:g,city:addr.city,coverageArea:addr.coverageArea}).length>0;
}
async function load(){
if(activePromise)return activePromise;
activePromise=(async()=>{
const base=String(window.DART_API_BASE_URL||location.origin).replace(/\/$/,"");
const response=await fetch(base+"/api/v1/shipping/checkout-coverage",{cache:"no-store"});
if(!response.ok)throw Error("Delivery coverage temporarily unavailable");
const data=await response.json();
if(!Array.isArray(data.governorates))throw Error("Invalid region catalog");
const received=data.governorates.filter(x=>typeof x.id==="string"&&Array.isArray(x.cities));
if(!received.some(x=>x.id==="Cairo")||!received.some(x=>x.id==="Giza"))throw Error("Missing local delivery regions");
regions=received;
companies=Array.isArray(data.companies)?data.companies:[];
ready=true;
window.dispatchEvent(new Event("dart:shipping-coverage-loaded"));
})().catch(error=>{activePromise=null;throw error});
return activePromise;
}
window.DartShippingAvailability=Object.freeze({
load,canonical,isGovernorateOpen,isAddressCovered,availableCompanies,
get ready(){return ready},
});
function init(){
const form=$("checkoutForm"),governorate=$("governorate-select"),area=$("area-input");
if(!form||!governorate||!area)return;
const helper=document.createElement("div");helper.className="dart-checkout-region-helper";
const caption=document.createElement("p");
caption.textContent="المحافظة ← المدينة ← المنطقة / Delivery coverage";
const intro=document.createElement("small");
intro.textContent="التوصيل متاح فقط في الأماكن المغطاة. اختار المدينة والمنطقة إن لزم، ثم أكد موقعك على الخريطة.";
const search=document.createElement("input");search.type="search";
search.placeholder="ابحث عن مدينة أو منطقة · Search";search.setAttribute("aria-label","Search delivery districts");
const city=document.createElement("select");city.name="city";city.id="checkout-city";
city.setAttribute("aria-label","Delivery city");
const district=document.createElement("select");district.name="coverageArea";district.id="checkout-coverage-area";
district.setAttribute("aria-label","Delivery neighborhood");
const status=document.createElement("small");status.setAttribute("role","status");
helper.append(caption,intro,search,city,district,status);area.parentElement?.append(helper);
const option=(value,text)=>{const o=document.createElement("option");o.value=value;o.textContent=text;return o};
let selected=null;
function governorateOptions(){
const previous=governorate.value;
governorate.replaceChildren(option("","اختر المحافظة / Choose governorate"));
for(const region of regions)governorate.append(option(region.id,region.ar+" / "+region.en));
if(regions.some(g=>g.id===previous))governorate.value=previous;
else governorate.value="Cairo";
renderCities();
}
function filtered(c,query){
const search=norm(query);
return !search||[c.en,c.ar,...c.areas.flatMap(a=>[a.en,a.ar])]
.some(label=>norm(label).includes(search));
}
function renderCities(){
const province=regions.find(g=>g.id===governorate.value);
const previous=city.value;
city.replaceChildren(option("","اختر المدينة / Choose city"));
const visible=province?.cities?.filter(c=>filtered(c,search.value))||[];
for(const c of visible)city.append(option(c.id,c.ar+" / "+c.en));
if(visible.some(c=>c.id===previous))city.value=previous;
else city.value="";
selected=province?.cities.find(c=>c.id===city.value)||null;
renderDistricts();
syncStatus();
}
function renderDistricts(){
const previous=district.value;
selected=regions.find(g=>g.id===governorate.value)?.cities
.find(c=>c.id===city.value)||null;
district.replaceChildren(option("","كل المدينة / Choose neighborhood"));
for(const item of selected?.areas||[])district.append(option(item.id,item.ar+" / "+item.en));
if(selected?.areas.some(a=>a.id===previous))district.value=previous;
else district.value="";
district.disabled=!selected?.areas?.length;
syncStatus();
}
function syncStatus(){
const opts=availableCompanies({governorate:governorate.value,city:city.value,coverageArea:district.value});
status.textContent=opts.length?
"متاح التوصيل عبر: "+opts.map(c=>c.name).join("، "):
"المكان ده غير مغطى بالكامل؛ اختار مدينة/منطقة أخرى أو فعّل شركة شحن تغطيه.";
status.dataset.dartCoverageState=opts.length?"available":"unavailable";
}
function fillArea(){
if(!selected)return;
const zone=selected.areas.find(x=>x.id===district.value);
const next=selected.en+(zone?", "+zone.en:"");
area.value=next;
// A new manual address never inherits coordinates from an old verified pin.
area.dispatchEvent(new Event("input",{bubbles:true}));
area.dispatchEvent(new Event("change",{bubbles:true}));
}
governorate.addEventListener("change",()=>{city.value="";district.value="";search.value="";renderCities()});
search.addEventListener("input",renderCities);
city.addEventListener("change",()=>{renderDistricts();fillArea()});
district.addEventListener("change",()=>{fillArea();syncStatus()});
// Map reverse-geocoding may change the governorate; update city suggestions, not the verified pin.
form.addEventListener("dart:address-selected",()=>{renderCities()});
governorateOptions();
void load().then(()=>{
governorateOptions();
const note=document.querySelector(".dart-delivery-zone-note");
if(note&&regions.length>2)note.textContent="Delivery areas depend on available shipping companies. Cairo & Giza retain Dart delivery.";
}).catch(()=>{
status.textContent="تعذر تحديث تغطية شركات الشحن؛ التوصيل متاح بالقاهرة والجيزة فقط.";
// Fail closed for any newly configured location while offline.
regions=regions.filter(x=>defaults.has(x.id));companies=[];governorateOptions();
});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
