import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { expect, it } from "vitest";

it("hydrates and saves independent WhatsApp consents, then clears them on sign-out",async()=>{
  const source=await readFile(new URL("../../Js/dart-whatsapp-preferences.js",import.meta.url),"utf8");
  const birthday={checked:false,disabled:true}, review={checked:false,disabled:true}, button={disabled:true}, status={textContent:""};
  const events: Record<string,()=>void>={}, calls: Array<{path:string;options?:{body:Record<string,unknown>}}> = [];
  let submit: ((event:{preventDefault():void})=>Promise<void>)|undefined, signedIn=true;
  const form={elements:{birthdayMarketing:birthday,postDeliveryReview:review},querySelector:(selector:string)=>selector==="button"?button:status,
    addEventListener:(_name:string,callback:typeof submit)=>{submit=callback;}};
  const response={birthdayMarketing:false,postDeliveryReview:true,consentVersion:"birthday-whatsapp-v1",reviewConsentVersion:"post-delivery-whatsapp-v1"};
  const window={DartPlatform:{currentUser:()=>signedIn?{id:"synthetic"}:null},
    DartApi:{request:async(path:string,options?:{body:Record<string,unknown>})=>{calls.push({path,...(options?{options}:{})});return {...response,...options?.body};}},
    addEventListener:(name:string,callback:()=>void)=>{events[name]=callback;}};
  vm.runInNewContext(source,{window,document:{readyState:"complete",getElementById:()=>form}});
  await new Promise(resolve=>setImmediate(resolve));
  expect(birthday.checked).toBe(false);expect(review.checked).toBe(true);expect(button.disabled).toBe(false);
  review.checked=false;birthday.checked=true;await submit!({preventDefault(){}});
  expect(calls[1]!.options!.body).toEqual({birthdayMarketing:true,postDeliveryReview:false,
    consentVersion:"birthday-whatsapp-v1",reviewConsentVersion:"post-delivery-whatsapp-v1"});
  expect(status.textContent).toBe("Preference saved.");
  signedIn=false;events["dart:customer-session-changed"]!();
  expect(birthday.checked).toBe(false);expect(review.checked).toBe(false);expect(button.disabled).toBe(true);
  expect(status.textContent).toContain("Sign in");
});
