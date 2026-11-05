// DART | load shipping management only on Orders/Shipping, never on every dashboard view.
// The small facade also ensures dispatch waits for the carrier module before opening the selector.
(() => {
  "use strict";
  const fallback=[{id:"dart",name:"Dart Delivery",active:true,governorates:[]}];
  let task=null;
  function inject(path){
    return new Promise((resolve,reject)=>{
      const script=document.createElement("script");script.src=path;
      script.onload=resolve;script.onerror=()=>reject(new Error("Could not load Shipping Companies"));
      document.head.append(script);
    });
  }
  function loaded(){
    if(task)return task;
    task=inject("dart-coverage-picker.js").then(()=>inject("dart-shipping.js?v=20261105-shipping-tabs-1"))
      .then(()=>window.DartShipping)
      .catch(error=>{task=null;throw error;});
    return task;
  }
  window.DartShipping=Object.freeze({
    loadCompanies: async()=>{await loaded();return window.DartShipping.loadCompanies();},
    companies:()=>fallback,
    renderShipments:()=>{void loaded().then(x=>x.renderShipments()).catch(()=>{});},
  });
  function activate(event){
    const tab=event.target?.closest?.('[data-target="shipping"]');
    if(!tab)return;
    void loaded().then(async manager=>{
      await manager.loadCompanies();
      manager.renderShipments();
    }).catch(error=>window.DartDialog?.alert?.(error.message));
  }
  document.addEventListener("click",activate);
  document.addEventListener("DOMContentLoaded",()=>{
    if(document.querySelector(".dashboard-section.active-section")?.id==="shipping")activate({
      target:document.querySelector('[data-target="shipping"]'),
    });
  });
})();
