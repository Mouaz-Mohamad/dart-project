(function () {
  "use strict";
  const form=document.getElementById("birthdayWhatsappPreference");
  if(!form)return;
  const checkbox=form.elements.birthdayMarketing,submit=form.querySelector("button"),status=form.querySelector("[role='status']");
  let generation=0,version="",saving=false;
  async function hydrate(){
    const current=++generation;
    checkbox.checked=false;checkbox.disabled=true;submit.disabled=true;
    if(!window.DartPlatform?.currentUser?.()){status.textContent="Sign in to manage your preference.";return;}
    try{
      const result=await window.DartApi.request("/api/v1/me/preferences/whatsapp");
      if(current!==generation)return;
      checkbox.checked=result.birthdayMarketing===true;version=result.consentVersion;
      checkbox.disabled=false;submit.disabled=false;status.textContent="";
    }catch(error){if(current===generation)status.textContent=error.message || "Preference unavailable. Reload to retry.";}
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(saving || checkbox.disabled)return;
    const current=generation;saving=true;submit.disabled=true;checkbox.disabled=true;
    try{
      const result=await window.DartApi.request("/api/v1/me/preferences/whatsapp",{method:"PUT",body:{birthdayMarketing:checkbox.checked,consentVersion:version}});
      if(current!==generation)return;
      checkbox.checked=result.birthdayMarketing===true;status.textContent="Preference saved.";
    }catch(error){if(current===generation)status.textContent=error.message || "Preference was not saved. Please retry.";}
    finally{saving=false;if(current===generation){submit.disabled=false;checkbox.disabled=false;}}
  });
  window.addEventListener("dart:customer-session-changed",()=>void hydrate());
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void hydrate(),{once:true});else void hydrate();
})();
