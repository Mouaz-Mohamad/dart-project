// DART | Homepage and Products merchandising settings, server-authoritative.
(function(root){
  "use strict";
  const $=id=>document.getElementById(id);
  const form=$("settings-storefront-products-form");
  if(!form)return;
  const selectedList=$("settings-best-selected");
  const availableList=$("settings-best-available");
  const search=$("settings-best-search");
  const status=$("settings-storefront-products-status");
  const helper=root.DartStorefrontProducts;
  let selected=[],dirty=false,saving=false;

  const settings=()=>helper.normalize(root.DartSiteSettings?.get?.());
  const models=()=>((root.DartCatalog?.models?.()||[])
    .filter(row=>row&&row.active!==false&&!row.isDeleted&&!row.isArchived)
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),["ar","en"])));
  const byId=()=>new Map(models().map(row=>[String(row.modelId),row]));
  function report(message,error=false){
    status.textContent=message;
    status.dataset.state=error?"error":"success";
  }
  function draw(){
    const lookup=byId();
    selectedList.replaceChildren();
    for(const [index,id] of selected.entries()){
      const row=lookup.get(id);
      const item=document.createElement("li");
      const name=document.createElement("span");
      name.textContent=(row?.name||"Unavailable model")+" ("+id+")";
      const controls=document.createElement("div");
      for(const [action,label,disabled] of [["up","↑",index===0],["down","↓",index===selected.length-1],["remove","Remove",false]]){
        const button=document.createElement("button");
        button.type="button";button.dataset.action=action;button.dataset.index=String(index);
        button.className="dart-settings-secondary";button.textContent=label;button.disabled=disabled;
        controls.appendChild(button);
      }
      item.append(name,controls);selectedList.appendChild(item);
    }
    if(!selected.length){
      const empty=document.createElement("li");empty.textContent="No models selected. Best Products will stay empty until you add models.";
      selectedList.appendChild(empty);
    }
    const query=search.value.trim().toLocaleLowerCase();
    availableList.replaceChildren();
    for(const row of models().filter(row=>{
      const code=String(row.modelId||"");
      return !selected.includes(code)&&(!query||String(row.name||"").toLocaleLowerCase().includes(query)||code.toLocaleLowerCase().includes(query));
    }).slice(0,100)){
      const entry=document.createElement("li");
      const title=document.createElement("span");title.textContent=String(row.name||"")+" — "+String(row.modelId||"");
      const button=document.createElement("button");
      button.type="button";button.dataset.addModel=String(row.modelId);button.className="dart-settings-secondary";button.textContent="Add";
      button.disabled=selected.length>=100;
      entry.append(title,button);availableList.appendChild(entry);
    }
    $("settings-best-count").max=String(Math.max(100,selected.length));
    $("settings-best-selected-count").textContent=String(selected.length)+" models selected";
  }
  function load(force=false){
    if(dirty&&!force)return;
    const rule=settings();
    selected=[...rule.bestModelIds];
    $("settings-products-first-count").value=String(rule.productsFirstGroupCount);
    $("settings-home-newest-count").value=String(rule.homeNewestCount);
    $("settings-best-count").value=String(rule.bestProductsLimit);
    dirty=false;draw();
  }
  search.addEventListener("input",draw);
  availableList.addEventListener("click",event=>{
    const button=event.target.closest("button[data-add-model]");
    if(!button)return;
    const id=button.dataset.addModel;
    if(id&&!selected.includes(id)&&selected.length<100){selected.push(id);dirty=true;draw();}
  });
  selectedList.addEventListener("click",event=>{
    const button=event.target.closest("button[data-action]");
    if(!button)return;
    const i=Number(button.dataset.index);
    if(!Number.isInteger(i)||i<0||i>=selected.length)return;
    const action=button.dataset.action;
    if(action==="remove")selected.splice(i,1);
    else if(action==="up"&&i>0)[selected[i-1],selected[i]]=[selected[i],selected[i-1]];
    else if(action==="down"&&i<selected.length-1)[selected[i+1],selected[i]]=[selected[i],selected[i+1]];
    dirty=true;draw();
  });
  form.addEventListener("input",event=>{if(event.target!==search)dirty=true;});
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(saving)return;
    if(root.DartAdminAccess?.can?.("settings.manage")!==true){
      report("You need Settings permission to save.",true);return;
    }
    const first=Number($("settings-products-first-count").value);
    const newest=Number($("settings-home-newest-count").value);
    const bestLimit=Number($("settings-best-count").value);
    if(![first,newest,bestLimit].every(v=>Number.isInteger(v)&&v>=0&&v<=300)||bestLimit>100){
      report("Enter valid whole numbers (0–300, Best Products 0–100).",true);return;
    }
    saving=true;
    const save=$("settings-storefront-products-save");
    save.disabled=true;report("Saving storefront products...");
    try{
      if(!root.DartSiteSettings.ready)await root.DartSiteSettings.hydrate(true);
      const current=root.DartSiteSettings.get();
      const next={...current,storefrontProducts:{
        productsFirstGroupCount:first,homeNewestCount:newest,bestProductsLimit:bestLimit,bestModelIds:[...selected]
      }};
      await root.DartSiteSettings.sync(next);
      dirty=false;load(true);
      report("Saved. Best Products is now shared across Home and Products.");
    }catch(error){
      report(error?.status===409?"Settings changed on another device. Reload settings and retry.":(error?.message||"Unable to save settings."),true);
    }finally{saving=false;save.disabled=false;}
  });
  root.addEventListener("dart:site-settings-changed",()=>load());
  root.addEventListener("dart:catalog-hydrated",draw);
  root.addEventListener("dart:catalog-synced",draw);
  root.addEventListener("dart:admin-authenticated",async()=>{
    try{await root.DartSiteSettings?.hydrate?.(true);load();}catch(error){report("Unable to load saved settings.",true);}
  });
  load();
})(window);
