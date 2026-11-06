/* DART Eye | Owner-controlled loyalty switch. All records remain available. */
(function(){
  "use strict";
  function init(){
    const form=document.getElementById("settings-dart-card-switch-form");
    const checkbox=document.getElementById("settings-dart-card-enabled");
    const status=document.getElementById("settings-dart-card-switch-status");
    if(!form||!checkbox||!status||!window.DartSiteSettings)return;
    let dirty=false,saving=false;
    function paint(settings=window.DartSiteSettings.get()){
      const on=settings.dartCardEnabled===true;
      if(!dirty&&!saving)checkbox.checked=on;
      const notice=document.getElementById("dart-card-paused-notice");
      if(notice)notice.hidden=on;
      const add=document.getElementById("openCardBenefitBtn");
      if(add){add.hidden=!on;add.disabled=!on;}
      const cardForm=document.getElementById("card-form");
      if(cardForm)cardForm.querySelectorAll("button,input,select").forEach(node=>{node.disabled=!on;});
    }
    form.addEventListener("change",()=>{dirty=true;});
    window.addEventListener("dart:site-settings-changed",event=>paint(event.detail));
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(saving)return;
      if(window.DartAdminAccess?.can?.("settings.manage")!==true){
        status.textContent="Insufficient permissions.";return;
      }
      saving=true;status.textContent="Saving…";
      const desired=checkbox.checked,button=form.querySelector('[type="submit"]');
      if(button)button.disabled=true;
      try{
        const current=await window.DartSiteSettings.hydrate(true);
        const result=await window.DartSiteSettings.sync({...current,dartCardEnabled:desired});
        dirty=false;delete form.dataset.dirty;
        form.querySelector(".dart-settings-draft-note")?.remove();
        status.textContent=result.dartCardEnabled?"Dart Card enabled.":"Dart Card paused and hidden.";
        paint(result);
      }catch(e){status.textContent=e.message||"Save failed.";}
      finally{saving=false;if(button)button.disabled=false;}
    });
    paint();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
