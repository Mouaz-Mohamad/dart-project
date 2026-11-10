// DART CODE GUIDE | Eye/dart-whatsapp-analytics.js
// Read-only Meta WhatsApp analytics, staff permission gated and backed by Neon.
(() => {
  "use strict";
  const labels = {
    ORDER_WHATSAPP_CONFIRMATION:"تأكيد الأوردر",
    ORDER_WHATSAPP_ACK:"الرد على التأكيد (رسالة نصية)",
    ORDER_WHATSAPP_DISPATCHED:"خروج الأوردر للتوصيل",
    CUSTOMER_POST_DELIVERY_REVIEW:"الفيدباك بعد التسليم",
    CUSTOMER_BIRTHDAY_MESSAGE:"عيد الميلاد",
    WAITLIST_WHATSAPP_RESTOCK:"توفر القطعة المحجوزة",
  };
  const states={all:"الكل",delivered:"وصلت",read:"مقروءة",pending:"معلقة",sent:"بانتظار Meta",failed:"فشلت",attention:"تحتاج مراجعة",suppressed:"لم تُرسل"};
  const keys=["total","delivered","read","pending","sent","failed","attention","suppressed"];
  const statusKey={total:"all",delivered:"delivered",read:"read",pending:"pending",sent:"sent",failed:"failed",attention:"attention",suppressed:"suppressed"};
  const number=(value)=>Number(value||0).toLocaleString("en-US");
  const canRead=()=>window.DartAdminAccess?.can?.("messaging.read")===true;
  const escapeDate=(value)=>{if(!value)return "—";const date=new Date(value);return Number.isFinite(date.getTime())?
    new Intl.DateTimeFormat("ar-EG",{timeZone:"Africa/Cairo",dateStyle:"short",timeStyle:"short"}).format(date):"—";};
  const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el;};
  function init(){
    const section=document.getElementById("whatsapp");
    const rows=document.getElementById("dart-wa-templates");
    const period=document.getElementById("dart-wa-period");
    const feedback=document.getElementById("dart-wa-feedback");
    const dialog=document.getElementById("dart-wa-dialog");
    const detailBody=document.getElementById("dart-wa-detail-rows");
    const detailStatus=document.getElementById("dart-wa-dialog-status");
    const more=document.getElementById("dart-wa-more");
    if(!section||!rows||!period||!dialog||!detailBody||!more)return;
    let active=false,sequence=0,detailSequence=0,loading=false,detailLoading=false,selection=null,offset=0;
    function showNav(){
      for(const id of ["dart-wa-nav-desktop","dart-wa-nav-mobile"]){
        const link=document.getElementById(id);if(link)link.hidden=!canRead();
      }
      if(!canRead()) {section.querySelectorAll("[data-wa-total]").forEach(el=>el.textContent="—");rows.replaceChildren();if(dialog.open)dialog.close();}
    }
    function applyTotals(totals){
      section.querySelectorAll("[data-wa-total]").forEach(el=>el.textContent=number(totals[el.dataset.waTotal]??0));
    }
    function cellButton(parent,type,key,value){
      const button=make("button","",number(value));button.type="button";
      button.dataset.waType=type;button.dataset.waStatus=statusKey[key];
      button.disabled=!Number(value);
      button.setAttribute("aria-label",`${labels[type]||"كل الرسائل"}: ${states[statusKey[key]]||"الإجمالي"} ${value}`);
      parent.append(button);
    }
    function render(templates){
      const map=new Map((templates||[]).map(t=>[t.eventType,t]));
      const types=[...Object.keys(labels),...[...map.keys()].filter(type=>!Object.hasOwn(labels,type))];
      const fragment=document.createDocumentFragment();
      for(const type of types){
        const stats=map.get(type)||{};
        const tr=make("tr"),title=make("td","",labels[type]||type);tr.append(title);
        for(const key of keys){const td=make("td");cellButton(td,type,key,stats[key]||0);tr.append(td);}
        fragment.append(tr);
      }
      rows.replaceChildren(fragment);
    }
    async function refresh(){
      if(!active||!canRead()||loading||document.hidden)return;
      const seq=++sequence;loading=true;feedback.classList.remove("is-error");feedback.textContent="جارٍ تحديث بيانات واتساب…";
      try{
        const data=await window.DartAdminApi.request("/api/v1/admin/messaging/whatsapp-analytics?period="+encodeURIComponent(period.value));
        if(seq!==sequence||!active)return;
        applyTotals(data.totals||{});render(data.templates||[]);
        feedback.textContent="آخر تحديث: "+escapeDate(data.asOf)+" · الأرقام حسب ردود Meta؛ لا يُحتسب قبول Meta وحده كتسليم.";
      }catch(error){
        if(seq!==sequence||!active)return;
        feedback.classList.add("is-error");feedback.textContent=error?.message||"تعذّر تحميل إحصائيات واتساب.";
      }finally{loading=false;}
    }
    function addCell(row,text,className){
      const td=make("td");const item=className?make("span",className,text):document.createTextNode(String(text));
      td.append(item);row.append(td);return td;
    }
    async function loadDetails(reset){
      if(!selection||detailLoading)return;
      if(reset){offset=0;detailBody.replaceChildren();}
      const current=++detailSequence;detailLoading=true;more.hidden=true;
      detailStatus.classList.remove("is-error");detailStatus.textContent="جارٍ تحميل الرسائل…";
      try{
        const query=new URLSearchParams({period:period.value,type:selection.type,status:selection.status,limit:"40",offset:String(offset)});
        const data=await window.DartAdminApi.request("/api/v1/admin/messaging/whatsapp-analytics?"+query);
        if(current!==detailSequence||!dialog.open)return;
        const fragment=document.createDocumentFragment();
        for(const event of data.items||[]){
          const tr=make("tr");
          const type=make("td");type.append(make("span","dart-wa-detail-code",labels[event.eventType]||event.eventType));
          type.append(make("span","dart-wa-detail-hint",event.orderCode?`Order ${event.orderCode}`:"—"));
          if(event.orderSource)type.append(make("span","dart-wa-detail-hint",event.orderSource==="Manual"?"من الداشبورد":"من المتجر"));
          tr.append(type);
          addCell(tr,event.recipient||"***");
          const statusCell=make("td"),state=make("span","dart-wa-state",states[event.status]||event.status);
          state.dataset.state=event.status;statusCell.append(state);tr.append(statusCell);
          addCell(tr,escapeDate(event.createdAt));addCell(tr,escapeDate(event.availableAt));addCell(tr,escapeDate(event.publishedAt));
          addCell(tr,event.errorCode?`Meta: ${event.errorCode}`:event.error||`محاولات: ${event.attempts||0}`);
          fragment.append(tr);
        }
        detailBody.append(fragment);
        offset+=(data.items||[]).length;more.hidden=!data.hasMore;
        detailStatus.textContent=offset?`عرض ${number(offset)} رسالة`:"لا توجد رسائل في هذا التصنيف.";
      }catch(error){
        if(current!==detailSequence)return;
        detailStatus.classList.add("is-error");detailStatus.textContent=error?.message||"تعذر تحميل الرسائل.";
        more.hidden=false;
      }finally{detailLoading=false;}
    }
    function showDetails(type,status){
      if(!canRead())return;
      selection={type,status};offset=0;
      document.getElementById("dart-wa-dialog-title").textContent=type==="all"?"كل رسائل واتساب":labels[type]||type;
      document.getElementById("dart-wa-dialog-caption").textContent=states[status]||"الكل";
      if(!dialog.open)dialog.showModal();
      void loadDetails(true);
    }
    section.addEventListener("click",event=>{
      const btn=event.target.closest?.("button[data-wa-type]");
      if(!btn||btn.disabled)return;
      showDetails(btn.dataset.waType||"all",btn.dataset.waStatus||"all");
    });
    period.addEventListener("change",()=>{if(dialog.open){detailSequence++;dialog.close();}void refresh();});
    document.getElementById("dart-wa-refresh")?.addEventListener("click",()=>void refresh());
    for(const id of ["dart-wa-dialog-close","dart-wa-done"])document.getElementById(id)?.addEventListener("click",()=>dialog.close());
    more.addEventListener("click",()=>void loadDetails(false));
    dialog.addEventListener("close",()=>{detailSequence++;selection=null;});
    dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
    window.addEventListener("dart:dashboard-section-activated",event=>{
      active=event.detail?.id==="whatsapp";
      if(!active){sequence++;if(dialog.open)dialog.close();return;}
      showNav();void refresh();
    });
    window.addEventListener("dart:admin-authenticated",()=>{
      showNav();active=section.classList.contains("active-section");if(active)void refresh();
    });
    window.addEventListener("dart:admin-logged-out",()=>{active=false;sequence++;showNav();});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&active)void refresh();});
    // Limit reads to the visible WhatsApp section; never poll every few seconds.
    setInterval(()=>{if(active&&!document.hidden)void refresh();},60000);
    showNav();active=section.classList.contains("active-section");if(active)void refresh();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
