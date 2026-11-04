// DART | Read-only official-selection UI. Region names/IDs come from Dart's own server.
// Never accept arbitrary typed city/area names as persisted coverage.
(() => {
  "use strict";
  const normalize = text => String(text || "").trim().toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[\s_\-]+/g, "");
  const fuzzy = (label, query) => {
    const a = normalize(label), b = normalize(query);
    if (!b) return true;
    if (a.includes(b)) return true;
    if (b.length < 4) return false;
    // Allow one omitted/incorrect character at the beginning of a name.
    const word = a.slice(0, b.length + 1);
    for (const s of [word.slice(0,b.length),word.slice(0,b.length-1)]) {
      if (!s) continue;
      let edits = Math.abs(s.length-b.length);
      const size = Math.min(s.length,b.length);
      for(let i=0;i<size;i++)if(s[i]!==b[i])edits++;
      if(edits<=1)return true;
    }
    return false;
  };
  const node = (tag,css,text) => {
    const el=document.createElement(tag);
    if (css) el.className=css;
    if (text!==undefined) el.textContent=text;
    return el;
  };
  const check = (name,checked,onChange) => {
    const label=node("label","dart-coverage-check");
    const input=node("input"); input.type="checkbox"; input.checked=checked;
    input.setAttribute("aria-label",name);
    input.addEventListener("click",event=>event.stopPropagation());
    input.addEventListener("change",()=>onChange(input.checked));
    label.append(input,node("span","",name));
    label.addEventListener("click",event=>event.stopPropagation());
    return label;
  };
  function create(host) {
    if(!host)return null;
    let catalog=[], coverage={}, filtering="all";
    const expanded=new Set(), search=node("input","dart-coverage-search");
    search.type="search";search.placeholder="ابحث عن محافظة أو مدينة أو منطقة / Search";
    search.setAttribute("aria-label","ابحث في مناطق التوصيل");
    const controls=node("div","dart-coverage-controls");
    const summary=node("p","dart-coverage-summary");
    const list=node("div","dart-coverage-list");
    const note=node("p","dart-coverage-note",
      "تفعيل محافظة كاملة يشمل جميع مدنها. يمكن تخصيص مدن أو مناطق من القائمة المُراجعة، ولن تُقبل أسماء مكتوبة عشوائيًا.");
    controls.append(search);
    const addButton=(title,action)=>{
      const button=node("button","dart-coverage-filter",title);
      button.type="button";button.addEventListener("click",action);controls.append(button);
      return button;
    };
    addButton("الكل",()=>{filtering="all";render()});
    addButton("المحدد فقط",()=>{filtering="selected";render()});
    addButton("غير المحدد",()=>{filtering="unselected";render()});
    addButton("تحديد 27 محافظة",()=>{coverage=Object.fromEntries(catalog.map(g=>[g.id,{all:true,cities:{}}]));render()});
    addButton("مسح التحديد",()=>{coverage={};render()});
    host.replaceChildren(controls,summary,list,note);
    search.addEventListener("input",render);
    function render(){
      const query=search.value;
      const count=Object.keys(coverage).length;
      summary.textContent=`المحافظات المحددة: ${count} من ${catalog.length} · اختر الكل أو خصص مدينة أو منطقة`;
      list.replaceChildren();
      for(const gov of catalog){
        const current=coverage[gov.id];
        if(filtering==="selected"&&!current || filtering==="unselected"&&current)continue;
        const hitGov=fuzzy(gov.ar,query)||fuzzy(gov.en,query);
        const matchingCities=gov.cities.filter(c=>
          hitGov||fuzzy(c.ar,query)||fuzzy(c.en,query)||
          c.areas.some(a=>fuzzy(a.ar,query)||fuzzy(a.en,query)));
        if(query&&!hitGov&&!matchingCities.length)continue;
        const details=node("details","dart-coverage-gov");
        const key="g:"+gov.id;
        details.open=expanded.has(key)||Boolean(query);
        details.addEventListener("toggle",()=>{
          if(details.open)expanded.add(key);else expanded.delete(key);
        });
        const head=node("summary","dart-coverage-gov-head");
        head.append(check(gov.ar+" / "+gov.en,Boolean(current),checked=>{
          if(checked)coverage[gov.id]={all:true,cities:{}};else delete coverage[gov.id];
          render();
        }));
        if(current){
          const mode=node("button","dart-coverage-mode",current.all?"تخصيص المدن":"كل المحافظة");
          mode.type="button";mode.onclick=event=>{
            event.preventDefault();event.stopPropagation();
            coverage[gov.id]=current.all?{all:false,cities:{}}:{all:true,cities:{}};
            expanded.add(key);render();
          };head.append(mode);
        }
        details.append(head);
        if(current&&!current.all){
          if(!gov.cities.length)details.append(node("p","dart-coverage-help","لا توجد مدن مفهرسة. استخدم كل المحافظة."));
          for(const city of matchingCities){
            const cityKey="c:"+gov.id+":"+city.id;
            const picked=coverage[gov.id].cities[city.id];
            const cityBox=node("div","dart-coverage-city");
            const cityHeader=node("div","dart-coverage-city-head");
            cityHeader.append(check(city.ar+" / "+city.en,Boolean(picked),checked=>{
              if(checked)coverage[gov.id].cities[city.id]={all:true,areas:[]};
              else delete coverage[gov.id].cities[city.id];
              expanded.add(key);render();
            }));
            if(picked&&city.areas.length){
              const cityMode=node("button","dart-coverage-mode",picked.all?"تخصيص المناطق":"كل المدينة");
              cityMode.type="button";cityMode.onclick=()=>{
                coverage[gov.id].cities[city.id]=picked.all?{all:false,areas:[]}:{all:true,areas:[]};
                expanded.add(key);expanded.add(cityKey);render();
              };cityHeader.append(cityMode);
            }
            cityBox.append(cityHeader);
            if(picked&&!picked.all){
              if(!city.areas.length)cityBox.append(node("small","dart-coverage-help","لا توجد مناطق مفهرسة؛ اختر كل المدينة."));
              for(const area of city.areas.filter(a=>!query||hitGov||fuzzy(city.ar,query)||fuzzy(city.en,query)||
                fuzzy(area.ar,query)||fuzzy(area.en,query))){
                cityBox.append(check(area.ar+" / "+area.en,picked.areas.includes(area.id),checked=>{
                  const group=coverage[gov.id].cities[city.id];
                  group.areas=checked?[...new Set([...group.areas,area.id])]:group.areas.filter(id=>id!==area.id);
                  expanded.add(key);expanded.add(cityKey);render();
                }));
              }
            }
            details.append(cityBox);
          }
        }
        list.append(details);
      }
      if(!list.children.length)list.append(node("p","dart-coverage-empty","لا توجد نتائج؛ جرب اسمًا آخر."));
    }
    function setCoverage(saved,legacy=[]){
      if(saved&&typeof saved==="object"&&!Array.isArray(saved)){
        coverage=JSON.parse(JSON.stringify(saved));render();return [];
      }
      const available=new Map(catalog.map(g=>[normalize(g.id),g.id]));
      const matched=legacy.map(x=>available.get(normalize(x))).filter(Boolean);
      const unknown=legacy.filter(x=>!available.has(normalize(x)));
      // Old blank list meant unrestricted. Represent it explicitly so saving never changes behavior silently.
      coverage=Object.fromEntries((legacy.length?matched:catalog.map(g=>g.id))
        .map(id=>[id,{all:true,cities:{}}]));
      render();return unknown;
    }
    function getCoverage(){
      const cloned=JSON.parse(JSON.stringify(coverage));
      if(!Object.keys(cloned).length)throw Error("اختر محافظة واحدة على الأقل.");
      for(const governorate of Object.values(cloned)){
        if(!governorate.all&&!Object.keys(governorate.cities).length)
          throw Error("كل محافظة مخصصة يجب أن تحتوي على مدينة واحدة على الأقل.");
        for(const city of Object.values(governorate.cities)){
          if(!city.all&&!city.areas.length)
            throw Error("كل مدينة مخصصة يجب أن تحتوي على منطقة واحدة على الأقل.");
        }
      }
      return cloned;
    }
    const ready = (async()=>{
      const response=await fetch(`${String(window.DART_API_BASE_URL||location.origin).replace(/\/$/,"")}/api/v1/shipping/coverage-catalog`);
      if(!response.ok)throw Error("تعذر تحميل قائمة المحافظات؛ لا يمكن حفظ التغطية.");
      const body=await response.json();
      if(!Array.isArray(body.governorates)||body.governorates.length!==27)throw Error("Incomplete coverage catalog");
      catalog=body.governorates;render();
    })();
    render();
    return Object.freeze({ready,setCoverage,getCoverage,refresh:render});
  }
  window.DartCoveragePicker=Object.freeze({create,normalize});
})();
