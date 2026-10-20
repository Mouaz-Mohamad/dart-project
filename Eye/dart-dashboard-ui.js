/* Dart Eye: compact records and accessible details. Original controls stay in their owning row. */
(function (root) {
  "use strict";
  const doc = root.document;
  if (!doc) return;
  const preferred = {
    orders: [/id order/i, /client name/i, /name area/i, /total products/i, /final amount/i, /^status$/i, /^representative$/i],
    customers: [/client name/i, /id clinte/i, /^phone number$/i, /orders/i, /spent|spending/i, /dart card/i],
    models: [/code|id model/i, /^name|model name/i, /selling|final price/i, /stock|quantity|status/i],
    items: [/code|id item/i, /model/i, /^color|^size|^status$/i],
    returns: [/id return|return id/i, /^client name|request type|item code|^status|inspection/i],
    damage: [/code|model|status|condition|cost/i],
    representative: [/^name|representative name|id rep|^phone number$|^status$/i],
    review: [/client name|rating|date|status|source/i],
    card: [/client name|id card|remaining|expiry|expiration|status/i],
    waiting: [/customer|model|color|size|status|expires/i],
    news: [/title|status|publish|date/i],
  };
  const states = new WeakMap();
  let openRecord = null;
  let queued = false;
  let serial = 0;
  function notify(message,type='success') {
    let region=doc.getElementById('dart-operation-notices');
    if(!region){region=doc.createElement('div');region.id='dart-operation-notices';region.setAttribute('aria-live','polite');doc.body.append(region);}
    const notice=doc.createElement('div');notice.className=`dart-operation-notice is-${type}`;
    const text=doc.createElement('span');text.textContent=message;
    const close=button('×','dart-notice-close');close.setAttribute('aria-label','Dismiss notification');close.addEventListener('click',()=>notice.remove());notice.append(text,close);region.append(notice);
    while(region.children.length>3)region.firstElementChild.remove();
    root.setTimeout(()=>notice.remove(),type==='warning'?10000:5000);
  }

  function button(text, className) {
    const node = doc.createElement("button");
    node.type = "button"; node.textContent = text; node.className = className;
    return node;
  }
  function cleanLabel(node, index) {
    return node?.textContent?.replace(/\s+/g, " ").trim() || `Field ${index + 1}`;
  }
  function labelsFor(row, section) {
    const table = row.closest("table");
    const head = table?.querySelector("thead tr") || section.querySelector(".cont-titel .title-name, .dart-sets-head");
    return head ? [...head.children].map(cleanLabel) : [];
  }
  function keyFor(row) {
    return row.dataset.id || row.dataset.newsId || row.dataset.waitingId || row.dataset.setId || row.dataset.groupKey || row.textContent.trim().slice(0,100);
  }
  function primaryColumns(section, labels, cells) {
    const patterns = preferred[section] || [/name|title|date|amount|status/i];
    const indices = [];
    patterns.forEach(pattern => labels.forEach((label, i) => {
      if (pattern.test(label) && cells[i] && !cells[i].querySelector("button") && !indices.includes(i)) indices.push(i);
    }));
    cells.forEach((cell, i) => {
      if (indices.length < 4 && !indices.includes(i) && !cell.matches('input[type="checkbox"]') && !cell.querySelector("button,input,select")) indices.push(i);
    });
    return indices.slice(0,7);
  }
  function closeDetails(state, keepSelection = false) {
    if (!keepSelection) openRecord = null;
    if (state?.dialog.open) state.dialog.close();
  }
  function showDetails(state) {
    doc.querySelectorAll(".dart-record-dialog[open]").forEach(dialog => { if (dialog !== state.dialog) dialog.close(); });
    openRecord = { section: state.section.id, key: state.key, scroll: openRecord?.scroll || 0 };
    state.trigger.setAttribute("aria-expanded", "true");
    state.dialog.showModal();
    state.dialog.scrollTop = openRecord.scroll;
  }
  function decorate(row, section) {
    if (states.has(row) || row.closest(".dart-record-dialog")) return;
    const cells = [...row.children];
    if (cells.length < 3) return;
    const labels = labelsFor(row, section);
    const isTableRow = row.tagName === "TR";
    const checkbox = cells.find(cell => cell.matches?.('input[type="checkbox"]')) || cells[0]?.querySelector?.('input[type="checkbox"]');
    const main = doc.createElement(isTableRow ? "td" : "div");
    main.className = "dart-record-main";
    if (isTableRow) main.colSpan = Math.max(cells.length,1);
    const fields = doc.createElement("div"); fields.className = "dart-record-fields";
    primaryColumns(section.id, labels, cells).forEach(index => {
      const field = doc.createElement("div"); field.className = "dart-record-field"; field.dataset.column = String(index);
      const label = doc.createElement("small"); label.textContent = labels[index] || `Field ${index + 1}`;
      const value = doc.createElement("strong"); value.textContent = (cells[index].querySelector('.status-pill') || cells[index]).textContent.trim() || "—";
      const image = cells[index].querySelector("img");
      if (image) { const preview = image.cloneNode(false); preview.removeAttribute("id"); preview.loading = "lazy"; value.replaceChildren(preview); }
      field.append(label,value); fields.append(field);
    });
    const controls = doc.createElement("div"); controls.className = "dart-record-controls";
    const primary = row.querySelector(".dart-status-btn, .return-accept-btn:not([hidden]), [data-waiting-action]");
    let proxy;
    if (primary) {
      proxy = button(primary.textContent.trim() || primary.title || "Next action", "dart-record-next");
      proxy.addEventListener("click", event => { event.stopPropagation(); if (!primary.disabled && !primary.hidden) primary.click(); });
      controls.append(proxy);
    }
    const trigger = button("Details", "dart-record-open"); controls.append(trigger);
    const dialog = doc.createElement("dialog"); dialog.className = "dart-record-dialog"; dialog.id = `dart-record-dialog-${++serial}`;
    const title = doc.createElement("h2"); title.id = `${dialog.id}-title`;
    title.textContent = `${section.id.charAt(0).toUpperCase() + section.id.slice(1)} · ${fields.querySelector("strong")?.textContent || "Details"}`;
    dialog.setAttribute("aria-labelledby",title.id);
    trigger.setAttribute("aria-controls",dialog.id); trigger.setAttribute("aria-expanded","false");
    const close = button("Close", "dart-record-close");
    const header = doc.createElement("header"); header.className = "dart-record-dialog-head"; header.append(title,close);
    const grid = doc.createElement("div"); grid.className = "dart-record-detail-grid";
    cells.forEach((cell,index) => {
      if (cell === checkbox) return;
      const wrapper = doc.createElement("div"); wrapper.className = "dart-record-detail-field";
      wrapper.dataset.recordColumn=String(index);
      const label = doc.createElement("h3"); label.textContent = labels[index] || (cell.querySelector("button") ? "Actions" : `Field ${index + 1}`);
      if (cell.querySelector("button")) wrapper.classList.add("dart-record-detail-actions");
      wrapper.append(label,cell); grid.append(wrapper);
    });
    dialog.append(header,grid);
    if (checkbox) main.append(checkbox);
    main.append(fields,controls,dialog); row.replaceChildren(main);
    row.classList.add("dart-compact-record");
    const state = { row, section, key:keyFor(row), trigger, dialog, primary, proxy };
    states.set(row,state);
    trigger.addEventListener("click", event => { event.stopPropagation(); showDetails(state); });
    close.addEventListener("click", event => { event.stopPropagation(); closeDetails(state); });
    dialog.addEventListener("cancel", () => { openRecord = null; });
    dialog.addEventListener("close", () => {
      trigger.setAttribute("aria-expanded","false");
      root.requestAnimationFrame(()=>{if(doc.querySelector('.modal.active,dialog[open]'))return;const current=[...section.querySelectorAll('.dart-compact-record')].map(node=>states.get(node)).find(item=>item?.key===state.key);if(current?.trigger.isConnected)current.trigger.focus({preventScroll:true});});
    });
    dialog.addEventListener("scroll", () => { if (openRecord?.key === state.key) openRecord.scroll = dialog.scrollTop; });
    dialog.addEventListener("click", event => {
      if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDetails(state); }
    });
    // Close the detail layer before an original action opens its existing editor/confirmation.
    dialog.addEventListener("click", event => {
      if (event.target.closest("button,a") && !event.target.closest(".dart-record-dialog-head")) closeDetails(state);
    },true);
    syncBusy(state);
  }
  function syncBusy(state) {
    if (!state.proxy || !state.primary) return;
    state.proxy.disabled = state.primary.disabled;
    state.proxy.hidden = state.primary.hidden;
    state.proxy.textContent = state.primary.getAttribute("aria-busy") === "true" ? "Saving…" : state.primary.textContent.trim();
    state.proxy.setAttribute("aria-busy",state.primary.getAttribute("aria-busy") || "false");
  }
  function refresh() {
    queued = false;
    const section = doc.querySelector(".dashboard-section.active-section");
    if (!section) return;
    const rows = section.querySelectorAll('.cont-titel .model-row, .dart-set-row, tr[data-waiting-id], .dart-finance-table tbody tr');
    rows.forEach(row => decorate(row,section));
    section.querySelectorAll(".cont-titel .title-name, .dart-sets-head").forEach(header => {
      if (!header.querySelector(".dart-compact-heading")) {
        header.classList.add("dart-compact-heading-row");
        const label = doc.createElement("strong"); label.className = "dart-compact-heading"; label.textContent = "Records · open Details for all fields and actions"; header.append(label);
      }
    });
    if (openRecord?.section === section.id && !doc.querySelector(".dart-record-dialog[open]")) {
      const match = [...rows].find(row => states.get(row)?.key === openRecord.key);
      if (match) showDetails(states.get(match)); else openRecord = null;
    }
  }
  function schedule() { if (!queued) { queued = true; root.requestAnimationFrame(refresh); } }
  function start() {
    const main = doc.querySelector("main"); if (!main) return;
    new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
    doc.querySelectorAll('.modal .close-modal').forEach(close=>{close.setAttribute('role','button');close.tabIndex=0;close.setAttribute('aria-label','Close');close.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();close.click();}});});
    doc.addEventListener('keydown',event=>{
      if(doc.querySelector('dialog[open]'))return;
      const modal=[...doc.querySelectorAll('.modal.active')].filter(node=>node.getClientRects().length).at(-1);
      if(!modal||modal.id==='dart-finance-modal')return;
      if(event.key==='Escape'){event.preventDefault();if(typeof closeModal==='function')closeModal(modal);}
      if(event.key==='Tab'){
        const controls=[...modal.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length);
        if(!controls.length)return;const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    root.addEventListener("dart:dashboard-section-activated", () => { openRecord = null; schedule(); });
    root.addEventListener("dart:orders-busy", () => { doc.querySelectorAll(".dart-compact-record").forEach(row => { const state=states.get(row); if(state) syncBusy(state); }); });
    root.addEventListener('dart:order-command-confirmed',event=>notify(event.detail?.refreshing?'Order saved. Refreshing details…':'Order saved.'));
    root.addEventListener("dart:admin-logged-out", () => { openRecord=null; doc.querySelectorAll(".dart-record-dialog[open]").forEach(dialog=>dialog.close()); });
    schedule();
  }
  root.DartDashboardUI = Object.freeze({refresh,notify,columnIndices:(section,labels)=>primaryColumns(section,labels,labels.map(()=>doc.createElement('span')))});
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})(window);
