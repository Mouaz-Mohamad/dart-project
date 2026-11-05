// DART | Shipping Companies panel (manual carrier tracking, no API integration).
(() => {
 "use strict";
 const $=id=>document.getElementById(id);
 const message=text=>window.DartDialog?.alert?.(text);
 const api=(path,options)=>window.DartAdminApi.request(path,options);
 let version=0,companies=[{id:"dart",name:"Dart Delivery",active:true,trackingUrl:"",governorates:[]}];
 let coveragePicker=null;
 async function loadCompanies(){
   const payload=await api("/api/v1/admin/shipping/companies");
   if(coveragePicker)await coveragePicker.ready;
   version=Number(payload.version);companies=payload.companies||companies;renderCompanies();
   return companies;
 }
 function renderCompanies(){
   const box=$("shipping-companies-list");if(!box)return;box.replaceChildren();
   for(const company of companies.filter(row=>row.id!=="dart")){
     const el=document.createElement("div"),name=document.createElement("span"),edit=document.createElement("button");
     name.textContent=company.name+" · "+(company.active?"Active":"Inactive")+" · ";
     edit.type="button";edit.textContent="Edit";
     edit.onclick=()=>{
       $("shipping-company-id").value=company.id;$("shipping-company-name").value=company.name;
       $("shipping-company-url").value=company.trackingUrl;$("shipping-company-active").checked=company.active;
       $("shipping-company-checkout-enabled").checked=company.checkoutEnabled===true;
       const unknown=coveragePicker?.setCoverage(company.coverage,company.governorates||[])||[];
       $("shipping-coverage-warning").textContent=unknown.length?
          "Unrecognized old governorates: "+unknown.join(", ")+". Review coverage before saving.":"";
       $("shipping-company-form").scrollIntoView({behavior:"smooth",block:"nearest"});
     };
     el.append(name,edit);box.append(el);
   }
 }
 function renderShipments(){
   const box=$("shipping-orders-list");if(!box)return;box.replaceChildren();
   const orders=(window.DartOrdersApi?.read?.()||[]).filter(o=>o.deliveryShipment?.type==="external"&&!o.isDeleted);
   if(!orders.length){box.textContent="No external shipments yet.";return;}
   for(const o of orders){
     const s=o.deliveryShipment;
     const row=document.createElement("article");row.className="dart-shipping-row";
     const label=document.createElement("div"),copy=document.createElement("button"),edit=document.createElement("button");
     label.textContent=(o.orderId||o.id)+" · "+s.companyName+" · "+o.status+" · "+s.trackingNumber;
     copy.type="button";copy.textContent="Copy Code";
     copy.onclick=()=>navigator.clipboard?.writeText(String(s.trackingNumber||"")).then(()=>window.DartDashboardUI?.notify?.("Copied")).catch(()=>message("Copy unavailable"));
     edit.type="button";edit.textContent="Correct (Owner only)";
     edit.onclick=async()=>{
       const companyId=await window.DartDialog.prompt("External company ID:",s.companyId);if(companyId===null)return;
       const trackingNumber=await window.DartDialog.prompt("Tracking number:",s.trackingNumber);if(trackingNumber===null)return;
       if(!companies.some(c=>c.id===companyId&&c.id!=="dart"&&c.active)){message("Choose an active external company");return;}
       edit.disabled=true;
       try{await window.DartOrdersApi.correctShipment(o.orderId||o.id,{expectedVersion:Number(o.version),companyId,trackingNumber:trackingNumber.trim()});
         renderShipments();}catch(error){message(error.message||"Correction failed");}finally{edit.disabled=false;}
     };
     row.append(label,copy,edit);
     if(o.status==="Out With Representative" && s.status==="Handed Over"){
       const returned=document.createElement("button");returned.type="button";returned.textContent="Parcel Returned to Dart";
       returned.onclick=async()=>{
         const ok=await window.DartDialog.confirm("Confirm the parcel is physically back at Dart. It will still require inspection.");
         if(!ok)return;
         const reason=await window.DartDialog.prompt("Reason for return:","Customer refused delivery");
         if(reason===null||String(reason).trim().length<3)return;
         returned.disabled=true;
         try{await window.DartOrdersApi.shipmentReturned(o.orderId||o.id,
           {expectedVersion:Number(o.version),reason:String(reason).trim()});renderShipments();}
         catch(e){message(e.message||"Return could not be recorded");}finally{returned.disabled=false;}
       };row.append(returned);
     }
     if(o.status==="Out With Representative" && s.status==="Returned to Sender"){
       const inspect=document.createElement("button");inspect.type="button";inspect.textContent="Send to Return Inspection";
       inspect.onclick=async()=>{
         if(!await window.DartDialog.confirm("Mark Refused and move items to Return Inspection?"))return;
         inspect.disabled=true;
         try{await window.DartOrdersApi.workflow(o.orderId||o.id,{expectedStatus:o.status,target:"Refused",
           reason:String(s.returnReason||"Returned from carrier")});renderShipments();}
         catch(e){message(e.message||"Could not begin inspection");}finally{inspect.disabled=false;}
       };row.append(inspect);
     }
     box.append(row);
   }
 }
 function reset(){
   $("shipping-company-form")?.reset();$("shipping-company-id").value="";
   $("shipping-company-checkout-enabled").checked=false;
   $("shipping-coverage-warning").textContent="";
   coveragePicker?.setCoverage({},[]);
 }
 async function save(event){
   event.preventDefault();
   const id=$("shipping-company-id").value||"carrier-"+Date.now().toString(36);
   if(!coveragePicker){message("Coverage selector unavailable. Please reload.");return;}
   let coverage;
   try{await coveragePicker.ready;coverage=coveragePicker.getCoverage();}
   catch(error){message(error.message||"Select a valid coverage");return;}
   if($("shipping-coverage-warning").textContent){message("Review unknown legacy regions before saving.");return;}
   const company={id,name:$("shipping-company-name").value.trim(),trackingUrl:$("shipping-company-url").value.trim(),
    active:$("shipping-company-active").checked,
    checkoutEnabled:$("shipping-company-checkout-enabled").checked,
    governorates:Object.keys(coverage),coverage};
   const next=[...companies.filter(c=>c.id!=="dart"&&c.id!==id),company];
   const button=event.target.querySelector('[type="submit"]');button.disabled=true;
   try{const r=await api("/api/v1/admin/shipping/companies",{method:"PUT",body:{expectedVersion:version,companies:next}});
     version=Number(r.version);companies=r.companies;reset();renderCompanies();
   }catch(error){message(error.message||"Unable to save company");}finally{button.disabled=false;}
 }
 function init(){
   coveragePicker=window.DartCoveragePicker?.create?.($("shipping-coverage-picker"))||null;
   if(coveragePicker){
     coveragePicker.ready.then(()=>coveragePicker.setCoverage({},[]))
       .catch(error=>{$("shipping-coverage-warning").textContent=error.message;});
   }
   $("shipping-company-form")?.addEventListener("submit",save);
   $("shipping-company-cancel")?.addEventListener("click",reset);
   $("shipping-refresh")?.addEventListener("click",()=>{
     void window.DartOrdersApi?.hydrate?.(true).then(renderShipments);
     void loadCompanies().catch(error=>message(error.message));
   });
   document.querySelectorAll('[data-target="shipping"]').forEach(el=>el.addEventListener("click",()=>{
     void loadCompanies().then(renderShipments).catch(error=>message(error.message));
   }));
   window.addEventListener("dart:admin-logged-out",()=>{version=0;companies=companies.slice(0,1);$("shipping-companies-list")?.replaceChildren();$("shipping-orders-list")?.replaceChildren();});
   window.addEventListener("dart:order-command-confirmed",renderShipments);
 }
 window.DartShipping=Object.freeze({loadCompanies,companies:()=>companies.slice(),renderShipments});
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
