// DART CODE GUIDE | Js/dart-dialog.js
// الغرض: رسائل Dart الموحّدة بدل alert/confirm/prompt الأصلية للمتصفح، بدون تغيير رسائل الـToast/Checkout الحالية.
(function installDartDialog(root) {
  "use strict";
  if (root.DartDialog?.version) return;

  const queue = [];
  let active = null;
  let styleInstalled = false;

  const COLORS = Object.freeze({ burgundy: "#AB012B", ink: "#151515", muted: "#667085", offWhite: "#FBF8F4" });

  function installStyle() {
    if (styleInstalled || document.getElementById("dart-dialog-style")) return;
    styleInstalled = true;
    const style = document.createElement("style");
    style.id = "dart-dialog-style";
    style.textContent = `
      .dart-dialog-layer{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:18px;background:rgba(8,18,18,.62);backdrop-filter:blur(4px);font-family:"Readex Pro",Arial,sans-serif}
      .dart-dialog-card{width:min(430px,100%);max-height:min(78vh,680px);overflow:auto;background:${COLORS.offWhite};border:1px solid rgba(171,1,43,.18);border-radius:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:22px;color:${COLORS.ink};animation:dartDialogIn .16s ease-out}
      .dart-dialog-card[dir="rtl"]{text-align:right}.dart-dialog-card[dir="ltr"]{text-align:left}
      .dart-dialog-brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
      .dart-dialog-brand strong{font-size:20px;line-height:1;color:${COLORS.burgundy};letter-spacing:.01em}
      .dart-dialog-mark{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(171,1,43,.1);color:${COLORS.burgundy};font-weight:900}
      .dart-dialog-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.75;color:#2f3337;margin:0}
      .dart-dialog-input{width:100%;box-sizing:border-box;margin-top:16px;border:1px solid #d7d1ca;border-radius:12px;background:#fff;color:${COLORS.ink};padding:12px 13px;font:inherit;outline:none}
      .dart-dialog-input:focus{border-color:${COLORS.burgundy};box-shadow:0 0 0 3px rgba(171,1,43,.1)}
      .dart-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;flex-wrap:wrap}
      .dart-dialog-card[dir="rtl"] .dart-dialog-actions{justify-content:flex-start}
      .dart-dialog-button{min-width:96px;min-height:42px;border-radius:11px;border:1px solid #d7d1ca;background:#fff;color:#222;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer}
      .dart-dialog-button:hover{border-color:${COLORS.burgundy};color:${COLORS.burgundy}}
      .dart-dialog-button.is-primary{background:${COLORS.burgundy};border-color:${COLORS.burgundy};color:#fff}
      .dart-dialog-button.is-primary:hover{filter:brightness(.94);color:#fff}
      @keyframes dartDialogIn{from{transform:translateY(8px) scale(.985);opacity:.3}to{transform:none;opacity:1}}
      @media(max-width:520px){.dart-dialog-layer{padding:12px;align-items:end}.dart-dialog-card{border-radius:24px 24px 18px 18px;padding:20px 18px 18px}.dart-dialog-actions{display:grid;grid-template-columns:1fr 1fr}.dart-dialog-actions .dart-dialog-button:only-child{grid-column:1/-1}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function containsArabic(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function waitForBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  function labels(mode, rtl) {
    if (rtl) return { ok: mode === "alert" ? "حسنًا" : "تأكيد", cancel: "إلغاء" };
    return { ok: mode === "alert" ? "OK" : "Confirm", cancel: "Cancel" };
  }

  async function pump() {
    if (active || !queue.length) return;
    await waitForBody();
    if (active || !queue.length) return;
    active = queue.shift();
    installStyle();

    const { mode, message, defaultValue, options } = active.request;
    const rtl = containsArabic(message) || containsArabic(options?.title);
    const copy = labels(mode, rtl);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const layer = document.createElement("div");
    layer.className = "dart-dialog-layer";
    layer.setAttribute("role", "presentation");

    const card = document.createElement("section");
    card.className = "dart-dialog-card";
    card.dir = rtl ? "rtl" : "ltr";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "dart-dialog-title");
    card.setAttribute("aria-describedby", "dart-dialog-message");

    const brand = document.createElement("div");
    brand.className = "dart-dialog-brand";
    const title = document.createElement("strong");
    title.id = "dart-dialog-title";
    title.textContent = String(options?.title || "Dart");
    const mark = document.createElement("span");
    mark.className = "dart-dialog-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = mode === "alert" ? "!" : "✓";
    brand.append(title, mark);

    const body = document.createElement("p");
    body.id = "dart-dialog-message";
    body.className = "dart-dialog-message";
    body.textContent = String(message ?? "");

    let input = null;
    if (mode === "prompt") {
      input = document.createElement("input");
      input.className = "dart-dialog-input";
      input.type = options?.inputType === "password" ? "password" : "text";
      input.value = String(defaultValue ?? "");
      input.autocomplete = options?.autocomplete || "off";
      input.maxLength = Number.isFinite(Number(options?.maxLength)) ? Number(options.maxLength) : 500;
    }

    const actions = document.createElement("div");
    actions.className = "dart-dialog-actions";
    let cancel = null;
    if (mode !== "alert") {
      cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "dart-dialog-button";
      cancel.textContent = String(options?.cancelText || copy.cancel);
      actions.appendChild(cancel);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "dart-dialog-button is-primary";
    ok.textContent = String(options?.confirmText || copy.ok);
    actions.appendChild(ok);

    card.append(brand, body);
    if (input) card.appendChild(input);
    card.appendChild(actions);
    layer.appendChild(card);
    // Native modal dialogs make body siblings inert; keep confirmation inside the active dialog.
    const parentDialog = document.querySelector("dialog[open]");
    (parentDialog || document.body).appendChild(layer);
    const onParentClose = () => finish(mode === "confirm" ? false : mode === "prompt" ? null : true);
    parentDialog?.addEventListener("close", onParentClose, { once: true });

    function finish(value) {
      if (!layer.isConnected) return;
      parentDialog?.removeEventListener("close", onParentClose);
      document.removeEventListener("keydown", onKeyDown, true);
      layer.remove();
      const resolve = active?.resolve;
      active = null;
      try { previousFocus?.focus?.({ preventScroll: true }); } catch {}
      resolve?.(value);
      void pump();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(mode === "confirm" ? false : mode === "prompt" ? null : true);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finish(mode === "prompt" ? input.value : true);
      }
    }

    ok.addEventListener("click", () => finish(mode === "prompt" ? input.value : true));
    cancel?.addEventListener("click", () => finish(mode === "confirm" ? false : null));
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => (input || ok).focus());
  }

  function enqueue(mode, message, defaultValue, options) {
    return new Promise((resolve) => {
      queue.push({ request: { mode, message, defaultValue, options: options || {} }, resolve });
      void pump();
    });
  }

  function showAlert(message, options) {
    void enqueue("alert", message, "", options);
    return undefined;
  }

  function showConfirm(message, options) {
    return enqueue("confirm", message, "", options);
  }

  function showPrompt(message, defaultValue = "", options) {
    return enqueue("prompt", message, defaultValue, options);
  }

  root.DartDialog = Object.freeze({
    version: "1.0.0",
    alert: showAlert,
    confirm: showConfirm,
    prompt: showPrompt,
  });
})(window);

// Product links are needed anywhere the shared storefront product modal exists,
// including Home, Products and Best Products. Versioned URLs force old tabs/caches
// to fetch the current routing code after a normal page reload.
(function loadDartProductRouting(root) {
  if (
    !document.getElementById("SectionModel") &&
    !document.getElementById("product-modal-host")
  )
    return;

  function addScript(src, marker) {
    if (document.querySelector(`script[data-${marker}="1"]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset[marker] = "1";
    (document.head || document.documentElement).appendChild(script);
  }

  addScript("/Js/dart-product-links.js?v=custom-domain-v3", "dartProductLinks");
  addScript("/Js/dart-product-route-fix.js?v=1.1", "dartProductRouteFix");
})(window);

// DART OVERLAY COORDINATOR | UI-only scroll locks and history steps.
(function installDartOverlayControls(root){
"use strict";
if(!root.document||root.DartOverlayControls)return;
const doc=root.document, watched=new Map(),locks=new Set();
const selector=".modal,.dart-dialog-layer,dialog,#SectionModel,#dartSetModal,#dartPasswordResetDialog,#dartProfileRecordDetailModal,.dart-admin-set-modal";
let index=0,swipe=null,menuTouch=null,bridged=false;
function updateLock(){
const active=locks.size>0;
doc.documentElement.classList.toggle("dart-overlay-scroll-locked",active);
doc.body?.classList.toggle("dart-overlay-scroll-locked",active);
}
function lock(id){if(!locks.has(id)){locks.add(id);updateLock();}}
function unlock(id){if(locks.delete(id))updateLock();}
function menu(){return doc.querySelector(".side-menu");}
function menuOpen(){return !!menu()?.classList.contains("active");}
function syncMenu(){
if(menuOpen())lock("nav-menu");else unlock("nav-menu");
doc.querySelector(".icon-menu")?.setAttribute("aria-expanded",String(menuOpen()));
menu()?.setAttribute("aria-hidden",String(!menuOpen()));
}
function visuallyCloseMenu(){
menu()?.classList.remove("active");
doc.querySelector(".menu-facke")?.classList.remove("active");
doc.body?.classList.remove("menu-open");
syncMenu();
}
function closeMenu(){
if(!menuOpen())return;
visuallyCloseMenu();
if(root.history.state?.dartMenuOpen)root.history.back();
}
function activeDetail(){
const el=doc.getElementById("dartProfileRecordDetailModal");
return el&&!el.hidden?el:null;
}
function closeDetail(){activeDetail()?.querySelector("[data-detail-close]")?.click();}
function adminTop(){
return [...doc.querySelectorAll(".modal.active")].filter(el=>el.style.display!=="none").at(-1)||null;
}
function overlayVisible(node){
if(!node.isConnected)return false;
if(node.matches(".dart-dialog-layer"))return true;
if(node.matches("dialog"))return node.open;
if(node.matches(".modal"))return node.classList.contains("active")&&node.style.display!=="none";
if(node.id==="SectionModel")return node.style.display==="flex";
return !node.hidden;
}
function watch(node){
if(watched.has(node))return;
const key="overlay:"+ ++index;
const refresh=()=>overlayVisible(node)?lock(key):unlock(key);
const observer=new MutationObserver(refresh);
observer.observe(node,{attributes:true,attributeFilter:["class","style","open","hidden"]});
watched.set(node,{observer,key});refresh();
}
function scan(node){
if(node.nodeType!==1&&node.nodeType!==9)return;
if(node.matches?.(selector))watch(node);
node.querySelectorAll?.(selector).forEach(watch);
}
function tidy(){
for(const [node,record] of watched)if(!node.isConnected){
record.observer.disconnect();unlock(record.key);watched.delete(node);
}
}
function bridgeAdmin(){
if(bridged||!doc.querySelector(".dashboard-section"))return;
const open=root.openModal,close=root.closeModal;
if(typeof open!=="function"||typeof close!=="function")return;
bridged=true;
root.openModal=function(modal){
if(!modal)return;
const wasOpen=modal.classList.contains("active"),value=open.apply(this,arguments);
if(!wasOpen&&modal.classList.contains("active")&&modal.id)
root.history.pushState({...root.history.state,dartAdminModal:modal.id},"",root.location.href);
return value;
};
root.closeModal=function(modal,opts){
if(!modal?.classList.contains("active"))return;
const value=close.call(this,modal);
if(!modal.classList.contains("active")&&!opts?.fromHistory&&root.history.state?.dartAdminModal===modal.id)
root.history.back();
return value;
};
}
function onClick(event){
const target=event.target;
if(!(target instanceof Element))return;
if(target.closest(".icon-menu")){
if(menuOpen()){if(root.history.state?.dartMenuOpen)root.history.back();}
else if(!root.history.state?.dartMenuOpen)
root.history.pushState({...root.history.state,dartMenuOpen:true},"",root.location.href);
return;
}
if(menuOpen()&&!target.closest(".side-menu")&&root.history.state?.dartMenuOpen)root.history.back();
if(menuOpen()&&target.closest(".side-menu a[href]"))visuallyCloseMenu();
const opener=target.closest("[data-dart-profile-record-open]");
if(opener&&!activeDetail()&&!root.history.state?.dartProfileDetailKey){
const key=opener.dataset.dartProfileRecordOpen;
if(key)root.history.pushState({...root.history.state,dartProfileDetailKey:key},"",root.location.href);
}
const detail=activeDetail();
if(detail&&(target===detail||target.closest("[data-detail-close],[data-waiting-action]"))&&root.history.state?.dartProfileDetailKey)
root.history.back();
}
function popState(){
const detail=activeDetail(),key=root.history.state?.dartProfileDetailKey;
if(detail&&!key)closeDetail();
else if(!detail&&key){
const opener=[...doc.querySelectorAll("[data-dart-profile-record-open]")].find(el=>el.dataset.dartProfileRecordOpen===key);
opener?.click();
}
const admin=adminTop();
if(admin&&root.history.state?.dartAdminModal!==admin.id){
if(admin.id==="dart-finance-modal")admin.querySelector(".dart-finance-modal-close")?.click();
else root.closeModal?.(admin,{fromHistory:true});
}
if(root.history.state?.dartMenuOpen){
menu()?.classList.add("active");
doc.querySelector(".menu-facke")?.classList.add("active");
doc.body?.classList.add("menu-open");
syncMenu();
}else visuallyCloseMenu();
}
function topDialog(){
return doc.querySelector(".dart-dialog-layer")||activeDetail()||adminTop()||
doc.querySelector("#dartSetImagePreview[open],#dartSetModal:not([hidden])")||null;
}
function keyboard(event){
if(event.key==="Tab"){
const top=topDialog();if(!top||top.matches("dialog"))return;
const items=[...top.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
.filter(el=>!el.hidden&&!el.closest("[hidden]")&&el.getClientRects().length);
if(!items.length)return;
if(event.shiftKey&&(doc.activeElement===items[0]||!top.contains(doc.activeElement))){event.preventDefault();items.at(-1).focus();}
else if(!event.shiftKey&&(doc.activeElement===items.at(-1)||!top.contains(doc.activeElement))){event.preventDefault();items[0].focus();}
return;
}
if(event.key!=="Escape"||event.defaultPrevented||doc.querySelector(".dart-dialog-layer"))return;
if(activeDetail()){
event.preventDefault();event.stopImmediatePropagation();closeDetail();return;
}
if(menuOpen()){
event.preventDefault();event.stopImmediatePropagation();closeMenu();return;
}
const admin=adminTop();
if(admin){
if(admin.id==="dart-finance-modal")return;
event.preventDefault();event.stopImmediatePropagation();root.closeModal?.(admin);return;
}
const sets=doc.querySelector(".dart-admin-set-modal:not([hidden])");
if(sets){const close=sets.querySelector("[data-settings-close],[data-set-close],.dart-admin-set-close");if(close){event.preventDefault();close.click();}}
}
function startTouch(event){
const t=event.touches?.[0];if(!t)return;
const detail=activeDetail();
const interactive=event.target.closest?.('input,textarea,select,button,a[href],[contenteditable="true"],[role="slider"]');
swipe=detail?.contains(event.target)&&!interactive?{x:t.clientX,y:t.clientY,top:detail.querySelector(".serial-result-card")?.scrollTop||0}:null;
menuTouch=menuOpen()&&!event.target.closest?.(".side-menu")?{x:t.clientX,y:t.clientY}:null;
}
function moveTouch(event){
if(!menuTouch||!menuOpen())return;
const t=event.touches?.[0];if(!t)return;
if(Math.abs(t.clientX-menuTouch.x)+Math.abs(t.clientY-menuTouch.y)>15){
event.preventDefault();closeMenu();menuTouch=null;
}
}
function endTouch(event){
const t=event.changedTouches?.[0];
if(t&&swipe&&activeDetail()){
const dx=t.clientX-swipe.x,dy=t.clientY-swipe.y;
if((dx>110&&Math.abs(dy)<65)||(dy>120&&Math.abs(dx)<65&&swipe.top<=1&&swipe.y<160))closeDetail();
}
swipe=null;menuTouch=null;
}
function scrollOutside(event){
if(menuOpen()&&!event.target.closest?.(".side-menu")){event.preventDefault();closeMenu();}
}
function install(){
const style=doc.createElement("style");
style.id="dart-overlay-controls-style";
style.textContent="html.dart-overlay-scroll-locked,body.dart-overlay-scroll-locked{overflow:hidden!important;overscroll-behavior:none!important}.side-menu.active,.modal.active .modal-content,#dartProfileRecordDetailModal:not([hidden]) .serial-result-card,.dart-dialog-card{overscroll-behavior:contain}.side-menu.active{overflow-y:auto;-webkit-overflow-scrolling:touch}";
if(!doc.getElementById(style.id))(doc.head||doc.documentElement).appendChild(style);
scan(doc);bridgeAdmin();syncMenu();
const added=new MutationObserver(mutations=>{
let removed=false;
for(const m of mutations){for(const node of m.addedNodes)scan(node);if(m.removedNodes.length)removed=true;}
if(removed)tidy();if(!bridged)bridgeAdmin();
});
added.observe(doc.body,{childList:true,subtree:true});
new MutationObserver(syncMenu).observe(doc.body,{attributes:true,attributeFilter:["class"]});
doc.addEventListener("click",onClick,true);
doc.addEventListener("keydown",keyboard,true);
doc.addEventListener("touchstart",startTouch,{passive:true,capture:true});
doc.addEventListener("touchmove",moveTouch,{passive:false,capture:true});
doc.addEventListener("touchend",endTouch,{passive:true,capture:true});
doc.addEventListener("wheel",scrollOutside,{passive:false,capture:true});
root.addEventListener("popstate",popState);
root.addEventListener("pagehide",visuallyCloseMenu);
root.addEventListener("pageshow",()=>{scan(doc);syncMenu();});
}
root.DartOverlayControls=Object.freeze({lock,unlock,closeMenu});
if(doc.readyState==="loading")doc.addEventListener("DOMContentLoaded",install,{once:true});else install();
})(window);
