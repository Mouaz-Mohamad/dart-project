// DART CODE GUIDE | Js/dart-product-button-state.js
// Single Buy/Waiting action controller for the product modal.
(function(root){
"use strict";
let rememberedSize="",observer=null,purchaseBusy=false,waitingBusy=false,reservedKey="",restoringSize=false;
const $=id=>root.document?.getElementById?.(id)||null;
const product=()=>typeof activeProduct==="undefined"?null:activeProduct;
const rawSize=()=>typeof selectedSize==="undefined"?null:selectedSize;
const color=()=>typeof selectedColor==="undefined"?null:selectedColor;
const quantity=()=>Math.max(1,Number(typeof modalQuantity==="undefined"?1:modalQuantity)||1);
const key=(p,s,c)=>[p?.id||"",s||"",c||""].join("::");
const waitEnabled=()=>root.DartSiteSettings?.get?.().waiting?.enabled!==false;
const available=(p,s,c)=>!p||!s||!c||typeof getAvailableStock!=="function"?0:Math.max(0,Number(getAvailableStock(p,s,c))||0);
const toast=m=>{if(typeof showToast==="function")showToast(m)};
const status=(m,s="")=>{if(typeof setProductOptionStatus==="function")setProductOptionStatus(m,s)};
const modal=()=>$("SectionModel");
function ensureStyle(){const d=root.document;if(!d?.head||!d.createElement||d.getElementById?.("dart-product-action-style"))return;const s=d.createElement("style");s.id="dart-product-action-style";s.textContent='#SectionModel #modalBuyBtn[data-dart-action="waiting"]{background:#2563eb!important;background-color:#2563eb!important;border-color:#2563eb!important;color:#fff!important}';d.head.appendChild(s)}
function rememberedSizeButton(){if(!rememberedSize)return null;return Array.from(modal()?.querySelectorAll?.(".size-btn")||[]).find(n=>String(n.dataset?.size||"")===rememberedSize)||null}
function size(){return rawSize()||(rememberedSizeButton()?rememberedSize:null)}
function decide({hasColor,hasSize,stock,waitingEnabled}){const hasVariant=!!(hasColor&&hasSize),showWaiting=!!(waitingEnabled&&hasVariant&&Number(stock)<=0);return Object.freeze({hasVariant,showWaiting,showBuy:!showWaiting})}
function sync(){
 ensureStyle();const p=product(),s=size(),c=color(),hasVariant=!!(p&&s&&c),stock=hasVariant?available(p,s,c):0,state=decide({hasColor:!!c,hasSize:!!s,stock,waitingEnabled:waitEnabled()}),buy=$("modalBuyBtn"),legacy=$("modalWaitBtn"),reserved=state.showWaiting&&key(p,s,c)===reservedKey;
 if(buy){
  buy.hidden=false;buy.dataset.dartAction=state.showWaiting?"waiting":"buy";
  if(state.showWaiting){buy.style?.setProperty?.("--bragnte","#2563eb");buy.disabled=waitingBusy||reserved;buy.textContent=waitingBusy?"Reserving…":reserved?"Reserved in Waiting":"Waiting";waitingBusy?buy.setAttribute?.("aria-busy","true"):buy.removeAttribute?.("aria-busy");buy.setAttribute?.("aria-label",reserved?"Reserved in Waiting":"Join Waiting for this size and color")}
  else{buy.style?.removeProperty?.("--bragnte");buy.disabled=purchaseBusy||!state.hasVariant||stock<=0;buy.textContent=purchaseBusy?"Adding…":"Buy";purchaseBusy?buy.setAttribute?.("aria-busy","true"):buy.removeAttribute?.("aria-busy");buy.setAttribute?.("aria-label","Buy selected product")}
 }
 if(legacy){legacy.hidden=true;legacy.disabled=true;legacy.setAttribute?.("aria-hidden","true");legacy.dataset.modelId=p?.id||"";legacy.dataset.size=s||"";legacy.dataset.color=c||""}
 const row=$("modalQtyControl")?.closest?.(".modal-qty-row");if(row)row.hidden=state.showWaiting;
 return{product:p,size:s,color:c,stock,...state};
}
function restoreSize(){const m=modal(),b=rememberedSizeButton();if(restoringSize||!m||!b||!color()||rawSize())return false;restoringSize=true;try{if(typeof selectedSize!=="undefined")selectedSize=rememberedSize;Array.from(m.querySelectorAll?.(".size-btn")||[]).forEach(n=>{const a=n===b;n.classList?.toggle?.("active",a);n.setAttribute?.("aria-pressed",String(a))});b.click?.()}finally{restoringSize=false}return true}
const settle=()=>root.queueMicrotask?.(()=>{restoreSize();sync()});
async function handleBuy(){
 if(purchaseBusy)return false;const state=sync(),{product:p,size:s,color:c,stock,hasVariant}=state;
 if(!p||!hasVariant){const m=!s?"Choose a size first.":"Choose a color first.";status(m,"error");toast(m);return false}
 if(stock<=0){status("This option is unavailable. Use Waiting to reserve it.","info");sync();return false}
 if(typeof cartData==="undefined"||!Array.isArray(cartData)){toast("Cart is not ready yet. Please try again.");return false}
 const qty=quantity(),existing=cartData.find(line=>String(line.id)===String(p.id)&&String(line.size)===String(s)&&String(line.color)===String(c)),total=Number(existing?.quantity||0)+qty;
 if(total>stock){status("Adjust the quantity using the quantity selector before buying.","error");toast("Adjust the quantity with the quantity selector.");return false}
 purchaseBusy=true;const buy=$("modalBuyBtn");if(buy){buy.disabled=true;buy.textContent="Adding…";buy.setAttribute?.("aria-busy","true")}
 try{if(existing)existing.quantity=total;else cartData.push({id:p.id,title:p.title,price:p.price,size:s,color:c,quantity:qty,image:root.DartCatalog?.cover?.(root.DartCatalog?.model?.(p.id),c)||p.images?.[0]||p.image||""});if(typeof cacheFastCartSnapshot==="function")cacheFastCartSnapshot(cartData);if(typeof renderCart==="function")renderCart();if(typeof updateCartCount==="function")updateCartCount();if(typeof persistCartReservation!=="function")throw new Error("Cart reservation service is unavailable.");if(!await persistCartReservation()){if(typeof renderCart==="function")renderCart();return false}toast("تم إضافة المنتج إلى السلة بنجاح!");if(typeof showCartBanner==="function")showCartBanner(p.title);if(typeof closeProductModal==="function")closeProductModal();if(typeof renderCart==="function")renderCart();return true}
 catch(error){toast(error?.message||"تعذر حجز القطعة. حاول مرة أخرى.");return false}
 finally{purchaseBusy=false;if(modal()?.style?.display==="flex")sync()}
}
async function handleWaiting(){
 if(waitingBusy)return false;restoreSize();const state=sync(),{product:p,size:s,color:c,stock,hasVariant,showWaiting}=state;
 if(!p||!hasVariant){toast("Choose the size and color you want first.");return false}
 if(stock>0||!showWaiting){status("This option is available now. Use Buy instead.","success");sync();return false}
 if(!root.DartPlatform?.currentUser?.()){root.sessionStorage?.setItem?.("dart_internal_navigation","1");const next=root.location?.pathname?.split("/").pop()||"products.html";root.location?.assign?.(`Sign Up modern.html?next=${encodeURIComponent(next)}`);return false}
 waitingBusy=true;sync();
 try{await root.DartPlatform.joinWaiting(String(p.id),String(s),String(c));reservedKey=key(p,s,c);const m=`تم تسجيل حجز القطعة في Waiting: ${p.title} — المقاس: ${s} — اللون: ${c}.`;status(m,"success");toast(m);return true}
 catch(error){if(error?.code==="WAITING_ALREADY_EXISTS"){reservedKey=key(p,s,c);const m=`حجز ${p.title} — ${s} — ${c} موجود بالفعل في Waiting.`;status(m,"info");toast(m);return true}if(error?.code==="STOCK_AVAILABLE"){status("The item became available now. Use Buy instead.","success");toast("القطعة أصبحت متاحة الآن. استخدم Buy لإضافتها للسلة.");root.DartStorefront?.refresh?.();return false}toast(error?.message||"تعذر تسجيل حجز Waiting.");return false}
 finally{waitingBusy=false;sync()}
}
const stop=e=>{e.preventDefault?.();e.stopImmediatePropagation?.()};
root.document?.addEventListener?.("click",e=>{const t=e.target;if(!t?.closest)return;if(t.closest("#modalBuyBtn")){stop(e);const state=sync(),action=state.showWaiting?handleWaiting:handleBuy;void action().catch(error=>{console.error("Dart product action failed",error);purchaseBusy=waitingBusy=false;sync()});return}if(t.closest("#modalWaitBtn")){stop(e);void handleWaiting().catch(error=>{console.error("Dart Waiting action failed",error);waitingBusy=false;sync()});return}if(t.closest(".product-card, .cart-btn")){rememberedSize="";settle();return}const b=t.closest("#SectionModel .size-btn");if(b){rememberedSize=String(b.dataset?.size||"");settle();return}if(t.closest("#SectionModel .color-btn"))settle()},true);
function bind(){ensureStyle();const m=modal();if(!m||typeof root.MutationObserver!=="function"||observer){sync();return}observer=new root.MutationObserver(()=>{if(m.style?.display==="flex"){restoreSize();sync()}});observer.observe(m,{subtree:true,attributes:true,attributeFilter:["class","style"]});sync()}
if(root.document?.readyState==="loading")root.document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
["dart:catalog-hydrated","dart:data-changed","dart:site-settings-changed"].forEach(n=>root.addEventListener?.(n,settle));
root.DartProductButtonState=Object.freeze({decide,sync,handleBuy,handleWaiting,__resetForTests(){rememberedSize=reservedKey="";purchaseBusy=waitingBusy=restoringSize=false}});
})(typeof window!=="undefined"?window:globalThis);
