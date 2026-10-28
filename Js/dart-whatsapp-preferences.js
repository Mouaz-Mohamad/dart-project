(function () {
  "use strict";
  const form=document.getElementById("birthdayWhatsappPreference");
  if(!form)return;
  const checkbox=form.elements.birthdayMarketing,review=form.elements.postDeliveryReview,submit=form.querySelector("button"),status=form.querySelector("[role='status']");
  let generation=0,version="",reviewVersion="",saving=false;
  async function hydrate(){
    const current=++generation;
    checkbox.checked=false;checkbox.disabled=true;review.checked=false;review.disabled=true;submit.disabled=true;
    if(!window.DartPlatform?.currentUser?.()){status.textContent="Sign in to manage your preference.";return;}
    try{
      const result=await window.DartApi.request("/api/v1/me/preferences/whatsapp");
      if(current!==generation)return;
      checkbox.checked=result.birthdayMarketing===true;version=result.consentVersion;
      review.checked=result.postDeliveryReview===true;reviewVersion=result.reviewConsentVersion;
      checkbox.disabled=false;review.disabled=false;submit.disabled=false;status.textContent="";
    }catch(error){if(current===generation)status.textContent=error.message || "Preference unavailable. Reload to retry.";}
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(saving || checkbox.disabled)return;
    const current=generation;saving=true;submit.disabled=true;checkbox.disabled=true;review.disabled=true;
    try{
      const result=await window.DartApi.request("/api/v1/me/preferences/whatsapp",{method:"PUT",body:{birthdayMarketing:checkbox.checked,consentVersion:version,postDeliveryReview:review.checked,reviewConsentVersion:reviewVersion}});
      if(current!==generation)return;
      checkbox.checked=result.birthdayMarketing===true;review.checked=result.postDeliveryReview===true;status.textContent="Preference saved.";
    }catch(error){if(current===generation)status.textContent=error.message || "Preference was not saved. Please retry.";}
    finally{saving=false;if(current===generation){submit.disabled=false;checkbox.disabled=false;review.disabled=false;}}
  });
  window.addEventListener("dart:customer-session-changed",()=>void hydrate());
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void hydrate(),{once:true});else void hydrate();
})();
