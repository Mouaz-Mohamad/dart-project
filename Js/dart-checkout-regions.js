// DART | Bilingual address suggestions. This does NOT replace verified map/geocoder checks.
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  function init(){
    const form=$("checkoutForm"),area=$("area-input"),governorate=$("governorate-select");
    if(!form||!area||!governorate)return;
    const container=document.createElement("div");
    container.className="dart-checkout-region-helper";
    const title=document.createElement("p");
    title.textContent="اقتراحات المدن والمناطق · City & area suggestions";
    const help=document.createElement("small");
    help.textContent="الاختيار من القائمة يقلل الأخطاء. لازم تتأكد من موقع العنوان بالخريطة قبل الطلب.";
    const search=document.createElement("input");
    search.type="search";search.placeholder="ابحث عن مدينة / Search city";search.setAttribute("aria-label","Search delivery city");
    const city=document.createElement("select");city.setAttribute("aria-label","Select city");
    const district=document.createElement("select");district.setAttribute("aria-label","Select district");
    const status=document.createElement("small");status.setAttribute("role","status");
    container.append(title,help,search,city,district,status);
    area.parentElement?.append(container);
    let catalog=[],selected=null;
    function norm(text){return String(text||"").trim().toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g,"")
      .replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/[\s_-]+/g,"");}
    function option(value,text){const el=document.createElement("option");el.value=value;el.textContent=text;return el;}
    function renderCities(){
      const gov=catalog.find(g=>g.id===governorate.value);
      const query=norm(search.value);
      const found=gov?.cities.filter(c=>!query||norm(c.ar).includes(query)||norm(c.en).includes(query))||[];
      const before=city.value;
      city.replaceChildren(option("","اختر المدينة / Choose city"));
      for(const c of found)city.append(option(c.id,c.ar+" / "+c.en));
      if(found.some(c=>c.id===before))city.value=before;
      renderDistricts();
      status.textContent=gov?"اختار مدينة، أو استخدم الخريطة للبحث عن عنوان آخر.":"اختر المحافظة أولًا.";
    }
    function renderDistricts(){
      const gov=catalog.find(g=>g.id===governorate.value);
      selected=gov?.cities.find(c=>c.id===city.value)||null;
      district.replaceChildren(option("","كل المدينة / Choose neighborhood"));
      for(const a of selected?.areas||[])district.append(option(a.id,a.ar+" / "+a.en));
      district.disabled=!selected?.areas?.length;
    }
    function fillArea(){
      if(!selected)return;
      const place=selected.areas.find(a=>a.id===district.value);
      const label=selected.en+(place?", "+place.en:"");
      if(area.value===label)return;
      area.value=label;
      // Explicit user change invalidates any previous verified pin via the existing address controller.
      area.dispatchEvent(new Event("input",{bubbles:true}));
      area.dispatchEvent(new Event("change",{bubbles:true}));
    }
    governorate.addEventListener("change",()=>{
      search.value="";city.value="";renderCities();
    });
    search.addEventListener("input",renderCities);
    city.addEventListener("change",()=>{renderDistricts();fillArea()});
    district.addEventListener("change",fillArea);
    (async()=>{
      try{
        const base=String(window.DART_API_BASE_URL||location.origin).replace(/\/$/,"");
        const response=await fetch(base+"/api/v1/shipping/coverage-catalog");
        if(!response.ok)throw Error("Could not load city suggestions");
        const payload=await response.json();
        if(!Array.isArray(payload.governorates)||payload.governorates.length!==27)throw Error("Incomplete city catalog");
        catalog=payload.governorates;renderCities();
      }catch(error){
        status.textContent="تعذر تحميل الاقتراحات؛ استخدم البحث على الخريطة.";
        city.disabled=true;district.disabled=true;search.disabled=true;
      }
    })();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
