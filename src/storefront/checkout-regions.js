// DART | Checkout location selector, powered by public read-only coverage policy.
// Company settings are saved only through Staff API; the browser never grants delivery access.
(() => {
"use strict";
const $=id=>document.getElementById(id);
const pickup=Boolean($("returnRequestForm"));
const norm=value=>String(value||"").trim().toLowerCase()
.replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,"")
.replace(/[\u064b-\u065f\u0670\u0640]/g,"").replace(/[أإآ]/g,"ا").replace(/ة/g,"ه")
.replace(/[\s_-]+/g,"");

let regions=[
{id:"Cairo",en:"Cairo",ar:"القاهرة",cities:[]},
{id:"Giza",en:"Giza",ar:"الجيزة",cities:[]}
], companies=[],ready=false;
let activePromise=null;
const canonical=value=>{
const v=norm(value).replace(/^(?:محافظه|governorateof|governorate)/,"").replace(/(?:محافظه|governorate)$/,"");
const known=regions.find(x=>[x.id,x.en,x.ar]
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
return ready&&regions.some(x=>x.id===id&&x.available===true);
};
function availableCompanies({governorate,city,coverageArea}={}){
const gov=canonical(governorate);
if(!gov||!isGovernorateOpen(gov))return [];
const selected=companies.filter(x=>coveredBy(x,gov,city,coverageArea));
if(regions.find(x=>x.id===gov)?.carriers?.includes("dart"))selected.unshift({id:"dart",name:"Dart Delivery"});
return selected;
}
function isAddressCovered(addr){
const g=canonical(addr?.governorate);
if(!g)return false;
return availableCompanies({governorate:g,city:addr.city,coverageArea:addr.coverageArea}).length>0;
}
async function load({force=false}={}){
if(activePromise)return activePromise;
if(ready&&!force)return;
ready=false;
const task=(async()=>{
const base=String(window.DART_API_BASE_URL||location.origin).replace(/\/$/,"");
const endpoint=pickup?"coverage-catalog":"checkout-coverage";
const response=await fetch(base+"/api/v1/shipping/"+endpoint,{cache:"no-store"});
if(!response.ok)throw Error("Delivery coverage temporarily unavailable");
const data=await response.json();
if(!Array.isArray(data.governorates))throw Error("Invalid region catalog");
const received=data.governorates.filter(x=>typeof x.id==="string"&&Array.isArray(x.cities));
if(received.length!==27)throw Error("Incomplete delivery regions");
// A purchased item's return must not depend on today's checkout carrier settings.
regions=pickup?received.map(region=>({...region,available:true})):received;
companies=Array.isArray(data.companies)?data.companies:[];
ready=true;
window.dispatchEvent(new Event("dart:shipping-coverage-loaded"));
})();
activePromise=task;
try{return await task;}
catch(error){ready=false;throw error;}
finally{if(activePromise===task)activePromise=null;}
}
window.DartShippingAvailability=Object.freeze({
load,canonical,isGovernorateOpen,isAddressCovered,availableCompanies,
get ready(){return ready},
});
function init(){
if(pickup){
const governorate=$("return-governorate"),status=$("return-address-status");
const refresh=()=>{
const previous=governorate.value;
governorate.replaceChildren();
for(const region of regions){const option=document.createElement("option");
option.value=region.id;option.textContent=region.ar+" / "+region.en;governorate.append(option);}
governorate.value=regions.some(region=>region.id===previous)?previous:"Cairo";
};
const retry=document.createElement("button");retry.type="button";retry.textContent="Retry Pickup Regions";
const reload=async()=>{retry.disabled=true;try{await load({force:true});refresh();retry.remove();
status.textContent="Select an Egypt pickup pin or enter the complete pickup address.";
}catch{status.textContent="Pickup regions could not be loaded. Retry before verifying your address.";
status.after(retry);}finally{retry.disabled=false;}};
retry.addEventListener("click",()=>void reload());
void reload();return;
}
const form=$("checkoutForm"),governorate=$("governorate-select"),area=$("area-input");
if(!form||!governorate||!area)return;
const helper=document.createElement("div");helper.className="dart-checkout-region-helper";
const caption=document.createElement("p");
caption.textContent="المحافظة ← المدينة ← المنطقة / Delivery coverage";
const intro=document.createElement("small");
intro.textContent="التوصيل متاح فقط في الأماكن المغطاة. اختار المدينة والمنطقة إن لزم، ثم أكمل عنوان التوصيل.";
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
"للأسف، التوصيل مش متاح للمنطقة دي حاليًا. اختار عنوانًا آخر.";
status.dataset.dartCoverageState=opts.length?"available":"unavailable";
}
function fillArea(){
if(!selected)return;
const zone=selected.areas.find(x=>x.id===district.value);
const next=selected.en+(zone?", "+zone.en:"");
area.value=next;
// Coverage labels supplement a pin; they do not move the physical location.
area.dataset.dartCoverageUpdate="1";
try{
area.dispatchEvent(new Event("input",{bubbles:true}));
area.dispatchEvent(new Event("change",{bubbles:true}));
}finally{delete area.dataset.dartCoverageUpdate;}
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
if(note&&regions.length>2)note.textContent="التوصيل حسب المحافظة وتغطية شركات الشحن المتاحة.";
}).catch(()=>{
status.textContent="تعذر التحقق من مناطق التوصيل. أعد المحاولة قبل تأكيد الطلب.";
const retry=document.createElement("button");retry.type="button";retry.textContent="Retry Delivery Coverage";
retry.addEventListener("click",()=>{retry.disabled=true;void load({force:true}).then(()=>{governorateOptions();retry.remove();})
.catch(()=>{retry.disabled=false;status.textContent="تعذر التحقق من مناطق التوصيل. حاول مجددًا.";});});
helper.append(retry);
// Fail closed for any newly configured location while offline.
ready=false;companies=[];
});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
