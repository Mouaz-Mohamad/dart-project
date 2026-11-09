// Separate manual Waiting form; all validation/stock/WhatsApp authority stays server-side.
(function(root){
"use strict";
const $=(id)=>document.getElementById(id);
const permitted=()=>root.DartAdminAccess?.can?.("waiting.create")===true;
const api=(path,options={})=>root.DartAdminApi.request(path,options);
let models=[],customers=[],timer=0;
function fill(id,list,label){const el=$(id);if(!el)return;el.replaceChildren(new Option(label,""));list.forEach(o=>el.add(new Option(o.label,o.value)))}
function variants(){
 const model=models.find(m=>m.id===$("manual-wait-model").value);
 fill("manual-wait-color",(model?.colors||[]).map(v=>({label:v,value:v})),"Select color");
 fill("manual-wait-size",(model?.sizes||[]).map(v=>({label:v,value:v})),"Select size");
}
function error(message){const el=$("manual-wait-error");el.textContent=message?.message||String(message);el.hidden=false}
async function fetchOptions(search=""){
 const result=await api("/api/v1/admin/waiting/create-options?search="+encodeURIComponent(search));
 models=Array.isArray(result.models)?result.models:[];
 customers=Array.isArray(result.customers)?result.customers:[];
 if(!$("manual-wait-model").options.length)fill("manual-wait-model",models.map(m=>({label:m.name+" · "+m.id,value:m.id})),"Select model");
 fill("manual-wait-customer",customers.map(c=>({label:c.name+" · "+c.code+" · "+c.phone,value:c.id})),"Select customer");
}
function changeMode(){
 const existing=$("manual-wait-existing").checked;
 $("manual-wait-existing-area").hidden=!existing;
 $("manual-wait-new-area").hidden=existing;
 $("manual-wait-customer").required=existing;
 $("manual-wait-name").required=!existing;
 $("manual-wait-phone").required=!existing;
}
async function submit(event){
 event.preventDefault();
 const form=event.currentTarget,btn=form.querySelector('button[type="submit"]');
 const existing=$("manual-wait-existing").checked;
 if(existing&&!$("manual-wait-customer").value)return error("Please select a customer");
 const body={
   modelId:$("manual-wait-model").value,color:$("manual-wait-color").value,size:$("manual-wait-size").value,
   notes:$("manual-wait-notes").value.trim(),consentConfirmed:$("manual-wait-consent").checked
 };
 if(existing)body.customerUserId=$("manual-wait-customer").value;
 else{body.customerName=$("manual-wait-name").value.trim();body.phone=$("manual-wait-phone").value.trim()}
 btn.disabled=true;$("manual-wait-error").hidden=true;
 try{
   await api("/api/v1/admin/waiting",{method:"POST",body});
   $("manual-wait-dialog").close();
   await root.DartWaitingAdmin?.hydrate?.(true);
 }catch(e){error(e)}
 finally{btn.disabled=false}
}
async function openForm(){
 if(!permitted())return;
 let dialog=$("manual-wait-dialog");
 if(!dialog){
 dialog=document.createElement("dialog");
 dialog.id="manual-wait-dialog";dialog.className="dart-waiting-dialog dart-waiting-manual-dialog";
 dialog.innerHTML='<form id="manual-wait-form">'+
 '<header class="dart-waiting-dialog-head"><h3>Add Reservation</h3><button type="button" class="dart-waiting-dialog-close" aria-label="Close">×</button></header>'+
 '<div class="dart-waiting-dialog-body"><p>One out-of-stock item · FIFO by registration time · WhatsApp when exact color and size return.</p>'+
 '<fieldset class="manual-wait-choice"><legend>Customer</legend><label><input id="manual-wait-existing" type="radio" name="manual-wait-mode" checked> Registered</label><label><input id="manual-wait-new" type="radio" name="manual-wait-mode"> New customer</label></fieldset>'+
 '<section id="manual-wait-existing-area"><label for="manual-wait-search">Search customer</label><input type="search" id="manual-wait-search" placeholder="Name, code or WhatsApp"><label for="manual-wait-customer">Customer</label><select id="manual-wait-customer" required></select></section>'+
 '<section id="manual-wait-new-area" hidden><label for="manual-wait-name">Full name</label><input id="manual-wait-name" maxlength="160"><label for="manual-wait-phone">WhatsApp phone</label><input id="manual-wait-phone" type="tel" maxlength="30" placeholder="01xxxxxxxxx"></section>'+
 '<label for="manual-wait-model">Model</label><select id="manual-wait-model" required></select>'+
 '<div class="manual-wait-pair"><div><label for="manual-wait-color">Color</label><select id="manual-wait-color" required></select></div><div><label for="manual-wait-size">Size</label><select id="manual-wait-size" required></select></div></div>'+
 '<label for="manual-wait-notes">Notes (optional)</label><textarea id="manual-wait-notes" rows="2" maxlength="500"></textarea>'+
 '<label class="manual-wait-consent"><input id="manual-wait-consent" type="checkbox" required> The customer specifically asked Dart for a WhatsApp alert when this exact item becomes available.</label>'+
 '<p id="manual-wait-error" role="alert" hidden></p><button type="submit" class="manual-wait-submit">Add to Waiting</button></div></form>';
 document.body.appendChild(dialog);
 dialog.querySelector(".dart-waiting-dialog-close").addEventListener("click",()=>dialog.close());
 dialog.querySelectorAll('input[name="manual-wait-mode"]').forEach(e=>e.addEventListener("change",changeMode));
 $("manual-wait-model").addEventListener("change",variants);
 $("manual-wait-search").addEventListener("input",event=>{
   clearTimeout(timer);timer=setTimeout(()=>fetchOptions(event.target.value).catch(error),300);
 });
 $("manual-wait-form").addEventListener("submit",submit);
 }
 $("manual-wait-form").reset();
 $("manual-wait-model").replaceChildren();
 $("manual-wait-error").hidden=true;
 models=[];customers=[];changeMode();dialog.showModal();
 try{await fetchOptions()}catch(e){error(e)}
}
function refreshPermission(){const btn=$("waiting-add-manual-btn");if(btn)btn.hidden=!permitted()}
document.addEventListener("click",event=>{if(event.target.closest("#waiting-add-manual-btn"))void openForm()});
root.addEventListener("dart:admin-authenticated",refreshPermission);
document.addEventListener("DOMContentLoaded",refreshPermission);
})(typeof window!=="undefined"?window:globalThis);
