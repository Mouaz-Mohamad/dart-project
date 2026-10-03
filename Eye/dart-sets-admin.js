// DART CODE GUIDE | Eye/dart-sets-admin.js
// Additive Dart Eye Sets management. Existing Models UI and catalog behavior remain intact.
(function (root) {
  "use strict";
  if (!root?.document || root.__dartSetsAdmin) return;
  root.__dartSetsAdmin = true;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;",
  })[char]);
  const money = (minor) => `${(Math.max(0,Number(minor)||0)/100).toLocaleString("en-EG",{maximumFractionDigits:2})} EGP`;
  let initialized=false, rows=[], editRecord=null, settingsCache=null;

  function can(permission) { return root.DartAdminAccess?.can?.(permission) === true; }
  function model(modelId) { try { return root.DartCatalog?.model?.(String(modelId||"").trim()) || null; } catch { return null; } }
  function api(path, options={}) { return root.DartSets?.request?.(path,options) ?? root.DartAdminApi?.request?.(path,options); }

  function setStatus(form,message,error=false) {
    const node=form?.querySelector?.("[data-set-form-status]"); if (!node) return;
    node.textContent=message||""; node.classList.toggle("is-error",Boolean(error));
  }

  function installPanel() {
    const section=root.document.getElementById("models"); if (!section || section.querySelector("[data-model-set-tabs]")) return;
    const tabs=root.document.createElement("div"); tabs.className="dart-model-set-tabs"; tabs.dataset.modelSetTabs="1";
    tabs.innerHTML='<button type="button" class="is-active" data-model-set-view="models">Models</button><button type="button" data-model-set-view="sets">Sets</button>';
    section.prepend(tabs);
    const original=[...section.children].filter(node=>node!==tabs);
    original.forEach(node=>node.dataset.dartModelsOriginal="1");
    const panel=root.document.createElement("div"); panel.className="dart-sets-admin-panel"; panel.dataset.setsAdminPanel="1"; panel.hidden=true;
    panel.innerHTML=`<div class="dart-sets-toolbar"><div><h2>Sets</h2><p>Build sellable looks from existing Models without creating parallel stock.</p></div><div class="dart-sets-toolbar-actions"><input type="search" data-set-search placeholder="Search Set ID or name"><button type="button" data-set-settings>Set Discounts</button><button type="button" class="add-btn" data-set-add><span>+</span> Add Set</button></div></div><div class="dart-sets-table"><div class="dart-sets-head"><span>Action</span><span>Photo</span><span>Set ID</span><span>Name</span><span>Pieces</span><span>Cost</span><span>Separate</span><span>Set Price</span><span>Discount</span><span>Final</span><span>Margin</span><span>Status</span></div><div data-set-rows></div></div><div class="dart-sets-empty" data-set-empty hidden>No Sets yet.</div>`;
    section.appendChild(panel);
    tabs.addEventListener("click",(event)=>{ const btn=event.target.closest("[data-model-set-view]"); if(!btn)return; const view=btn.dataset.modelSetView; tabs.querySelectorAll("button").forEach(b=>b.classList.toggle("is-active",b===btn)); const sets=view==="sets"; original.forEach(node=>node.hidden=sets); panel.hidden=!sets; if(sets) void loadSets(); });
    panel.querySelector("[data-set-add]")?.addEventListener("click",()=>openEditor());
    panel.querySelector("[data-set-settings]")?.addEventListener("click",()=>void openSettings());
    panel.querySelector("[data-set-search]")?.addEventListener("input",renderRows);
    if(!can("sets.manage")){ panel.querySelector("[data-set-add]").hidden=true; panel.querySelector("[data-set-settings]").hidden=true; }
  }

  async function loadSets() {
    if(!can("sets.read")&&!can("sets.manage")) return;
    const container=root.document.querySelector("[data-set-rows]"); if(container) container.innerHTML='<div class="dart-sets-loading">Loading Sets…</div>';
    try { const payload=await api("/api/v1/admin/sets"); rows=Array.isArray(payload?.sets)?payload.sets:[]; renderRows(); }
    catch(error){ if(container) container.innerHTML=`<div class="dart-sets-error">${esc(error.message||"Unable to load Sets")}</div>`; }
  }

  function renderRows() {
    const container=root.document.querySelector("[data-set-rows]"), empty=root.document.querySelector("[data-set-empty]"); if(!container)return;
    const q=String(root.document.querySelector("[data-set-search]")?.value||"").trim().toLocaleLowerCase();
    const visible=rows.filter(row=>!q||[row.setId,row.name,row.description].join(" ").toLocaleLowerCase().includes(q));
    container.replaceChildren(); if(empty) empty.hidden=visible.length>0;
    visible.forEach(row=>{
      const node=root.document.createElement("div"); node.className="dart-set-row"; node.dataset.setId=row.setId;
      const pricing=row.pricing||{}, image=Array.isArray(row.images)&&row.images[0]?row.images[0]:"../Photos/logo-1to1.png";
      node.innerHTML=`<div class="dart-set-actions"><button type="button" data-set-view title="View"><i class="bx bx-show"></i></button>${can("sets.manage")?`<button type="button" data-set-edit title="Edit"><i class="bx bx-edit"></i></button><button type="button" data-set-state title="${row.isArchived?"Restore":"Archive"}"><i class="bx ${row.isArchived?"bx-revision":"bx-minus-circle"}"></i></button>`:""}</div><img class="dart-set-row-image" src="${esc(image)}" alt="${esc(row.name)}"><strong>${esc(row.setId)}</strong><span>${esc(row.name)}</span><span>${Number(row.pieceCount)||0}</span><span>${money(pricing.costTotalMinor)}</span><span>${money(pricing.componentsSellingTotalMinor)}</span><span>${money(pricing.basePriceMinor)}</span><span>${Math.round(Number(pricing.discountPercent)||0)}%</span><span>${money(pricing.finalMinor)}</span><span class="${Number(pricing.marginVsCostMinor)<0?"is-loss":"is-profit"}">${money(Math.abs(Number(pricing.marginVsCostMinor)||0))}${Number(pricing.marginVsCostMinor)<0?" loss":""}</span><span>${row.isArchived?"Archived":row.active?"Active":"Inactive"}</span>`;
      node.querySelector("[data-set-view]")?.addEventListener("click",()=>openEditor(row,true));
      node.querySelector("[data-set-edit]")?.addEventListener("click",()=>openEditor(row,false));
      node.querySelector("[data-set-state]")?.addEventListener("click",()=>void toggleState(row));
      container.appendChild(node);
    });
  }

  async function toggleState(row) {
    const action=row.isArchived?"restore":"archive";
    const accepted=await root.DartDialog?.confirm?.(`${action==="archive"?"Archive":"Restore"} Set ${row.setId}?`);
    if(!accepted)return;
    try { await api(`/api/v1/admin/sets/${encodeURIComponent(row.setId)}/state`,{method:"POST",body:{action,expectedVersion:Number(row.version)}}); await loadSets(); }
    catch(error){ await root.DartDialog?.alert?.(error.message||"Unable to update Set state."); }
  }

  function ensureEditor() {
    let modal=root.document.getElementById("dartSetAdminModal"); if(modal)return modal;
    modal=root.document.createElement("section"); modal.id="dartSetAdminModal"; modal.className="dart-admin-set-modal"; modal.hidden=true; modal.setAttribute("role","dialog"); modal.setAttribute("aria-modal","true");
    modal.innerHTML=`<form class="dart-admin-set-dialog" data-set-form><button type="button" class="dart-admin-set-close" data-set-close aria-label="Close">&times;</button><div class="dart-admin-set-title"><div><p>MODELS / SETS</p><h2 data-set-form-title>Add Set</h2></div><span data-set-cost-warning hidden>Selling Below Cost</span></div><div class="dart-set-form-grid"><label>Set ID<input name="setId" required maxlength="120" pattern="[A-Za-z0-9_-]+" placeholder="SET-001"></label><label>Set Name<input name="name" required maxlength="160"></label><label class="is-wide">Description<textarea name="description" rows="3" maxlength="4000"></textarea></label><label class="is-wide">Set Images<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>Uploaded Set images are stored once. Existing model images remain referenced from their Models.</small></label></div><section class="dart-set-builder"><div class="dart-set-builder-head"><div><h3>Set Items</h3><p>Type an existing Model ID. Use Quantity when the same design appears more than once.</p></div><button type="button" data-set-component-add>+ Add Item</button></div><div data-set-component-list></div></section><div class="dart-set-pricing-editor"><label>Set Price (EGP)<input name="basePrice" type="number" min="0" step="0.01" required></label><label>Set Discount %<input name="discount" type="number" min="0" max="100" step="0.01" value="0"></label><div class="dart-set-price-summary" data-set-summary></div></div><div class="dart-set-existing-images" data-set-existing-images></div><p class="dart-set-form-status" data-set-form-status role="status"></p><div class="dart-set-form-actions"><button type="button" data-set-close>Cancel</button><button type="submit" class="add-btn" data-set-save>Save Set</button></div></form>`;
    root.document.body.appendChild(modal);
    modal.querySelectorAll("[data-set-close]").forEach(button=>button.addEventListener("click",closeEditor));
    modal.addEventListener("click",event=>{if(event.target===modal)closeEditor();});
    const form=modal.querySelector("[data-set-form]");
    form.querySelector("[data-set-component-add]").addEventListener("click",()=>{addComponentRow();updateSummary();});
    form.addEventListener("input",event=>{if(event.target.matches("input[name='basePrice'],input[name='discount'],[data-set-model-id],[data-set-quantity]"))updateSummary();});
    form.addEventListener("submit",event=>void submitSet(event));
    return modal;
  }

  function addComponentRow(component={}) {
    const list=root.document.querySelector("#dartSetAdminModal [data-set-component-list]"); if(!list)return;
    const row=root.document.createElement("div"); row.className="dart-set-component-admin";
    row.innerHTML=`<label>Model ID<input type="text" data-set-model-id required value="${esc(component.modelId||"")}" placeholder="HD-001"></label><label>Quantity<input type="number" data-set-quantity min="1" max="20" value="${Math.max(1,Number(component.quantity)||1)}"></label><div class="dart-set-model-preview" data-set-model-preview></div><button type="button" data-set-component-remove aria-label="Remove item"><i class="bx bx-trash"></i></button>`;
    const input=row.querySelector("[data-set-model-id]");
    input.addEventListener("input",()=>updateModelPreview(row)); input.addEventListener("blur",()=>updateModelPreview(row));
    row.querySelector("[data-set-component-remove]").addEventListener("click",()=>{row.remove();if(!list.children.length)addComponentRow();updateSummary();});
    list.appendChild(row); updateModelPreview(row);
  }

  function updateModelPreview(row) {
    const id=String(row.querySelector("[data-set-model-id]")?.value||"").trim(), m=model(id), preview=row.querySelector("[data-set-model-preview]");
    if(!id){preview.textContent="Enter Model ID";preview.className="dart-set-model-preview";return;}
    if(!m){preview.textContent="Model not found";preview.className="dart-set-model-preview is-error";return;}
    const image=root.DartCatalog?.cover?.(m,root.DartCatalog?.colors?.(m)?.find(c=>c.active!==false)?.name||"")||"../Photos/logo-1to1.png";
    preview.className="dart-set-model-preview is-valid"; preview.innerHTML=`<img src="${esc(image)}" alt=""><div><strong>${esc(m.name||id)}</strong><small>Cost ${Number(m.cost||0).toLocaleString("en-EG")} EGP · Selling ${Number(m.selling||0).toLocaleString("en-EG")} EGP</small></div>`; updateSummary();
  }

  function componentValues() {
    return [...root.document.querySelectorAll("#dartSetAdminModal .dart-set-component-admin")].map(row=>({
      modelId:String(row.querySelector("[data-set-model-id]")?.value||"").trim(),quantity:Math.max(1,Math.trunc(Number(row.querySelector("[data-set-quantity]")?.value)||1)),
    })).filter(row=>row.modelId);
  }

  function localPricing() {
    const form=root.document.querySelector("#dartSetAdminModal [data-set-form]"), components=componentValues();
    let cost=0,separate=0; components.forEach(c=>{const m=model(c.modelId);cost+=Number(m?.cost||0)*c.quantity;separate+=Number(m?.selling||0)*c.quantity;});
    const base=Math.max(0,Number(form?.elements.basePrice?.value)||0),discount=Math.max(0,Math.min(100,Number(form?.elements.discount?.value)||0)),final=Math.max(0,base*(1-discount/100));
    return {cost,separate,base,discount,final,margin:final-cost,pieces:components.reduce((s,c)=>s+c.quantity,0)};
  }

  function updateSummary() {
    const modal=root.document.getElementById("dartSetAdminModal"); if(!modal)return; const p=localPricing(), box=modal.querySelector("[data-set-summary]"), warning=modal.querySelector("[data-set-cost-warning]");
    box.innerHTML=`<div><span>Real Cost</span><strong>${p.cost.toLocaleString("en-EG")} EGP</strong></div><div><span>Separate Selling</span><strong>${p.separate.toLocaleString("en-EG")} EGP</strong></div><div><span>Set Base</span><strong>${p.base.toLocaleString("en-EG")} EGP</strong></div><div><span>Set Discount</span><strong>${p.discount}%</strong></div><div><span>Final Set Price</span><strong>${p.final.toLocaleString("en-EG")} EGP</strong></div><div class="${p.margin<0?"is-loss":"is-profit"}"><span>${p.margin<0?"Loss":"Margin"}</span><strong>${Math.abs(p.margin).toLocaleString("en-EG")} EGP</strong></div>`;
    warning.hidden=!(p.margin<0);
  }

  function openEditor(row=null,readOnly=false) {
    const modal=ensureEditor(),form=modal.querySelector("[data-set-form]"); editRecord=row; form.reset();
    form.elements.setId.disabled=Boolean(row); form.elements.setId.value=row?.setId||""; form.elements.name.value=row?.name||""; form.elements.description.value=row?.description||""; form.elements.basePrice.value=((Number(row?.pricing?.basePriceMinor)||0)/100)||""; form.elements.discount.value=Number(row?.pricing?.discountPercent)||0;
    modal.querySelector("[data-set-form-title]").textContent=readOnly?`Set ${row?.setId||""}`:row?`Edit ${row.setId}`:"Add Set";
    const list=modal.querySelector("[data-set-component-list]"); list.replaceChildren(); (row?.components?.length?row.components:[{}]).forEach(addComponentRow);
    const images=modal.querySelector("[data-set-existing-images]"); images.replaceChildren(); (row?.images||[]).forEach(src=>{const img=root.document.createElement("img");img.src=src;img.alt=row?.name||"Set image";images.appendChild(img);});
    [...form.elements].forEach(el=>{if(el.name!=="setId")el.disabled=readOnly;}); form.querySelector("[data-set-component-add]").disabled=readOnly; form.querySelectorAll("[data-set-component-remove]").forEach(b=>b.disabled=readOnly); form.querySelector("[data-set-save]").hidden=readOnly;
    updateSummary(); setStatus(form,""); modal.hidden=false; root.document.body.classList.add("dart-admin-set-modal-open");
  }

  function closeEditor() { const modal=root.document.getElementById("dartSetAdminModal"); if(modal)modal.hidden=true; root.document.body.classList.remove("dart-admin-set-modal-open"); editRecord=null; }

  async function uploadImages(files) {
    const output=[]; for(const file of files){ const saved=await root.DartCatalog?.saveImage?.(file); if(saved?.url)output.push(saved.url); } return output;
  }

  async function submitSet(event) {
    event.preventDefault(); const form=event.currentTarget; if(!form.checkValidity())return form.reportValidity();
    const components=componentValues(); if(!components.length)return setStatus(form,"Add at least one valid Model ID.",true);
    const missing=components.find(c=>!model(c.modelId)); if(missing)return setStatus(form,`Model ${missing.modelId} does not exist in the current catalog.`,true);
    const p=localPricing(); if(p.pieces>100)return setStatus(form,"A Set can contain at most 100 physical pieces.",true);
    if(p.margin<0){ const accepted=await root.DartDialog?.confirm?.(`Final Set price is ${Math.abs(p.margin).toLocaleString("en-EG")} EGP below current real cost. Save this Owner override?`); if(!accepted)return; }
    const save=form.querySelector("[data-set-save]"); save.disabled=true; setStatus(form,"Saving Set…");
    try {
      const newImages=await uploadImages([...form.elements.images.files]);
      const images=[...(editRecord?.images||[]),...newImages];
      const input={name:form.elements.name.value.trim(),description:form.elements.description.value.trim(),basePriceMinor:Math.round(p.base*100),discountPercent:p.discount,images,components};
      if(editRecord) await api(`/api/v1/admin/sets/${encodeURIComponent(editRecord.setId)}`,{method:"PUT",body:{...input,expectedVersion:Number(editRecord.version)}});
      else await api("/api/v1/admin/sets",{method:"POST",body:{setId:form.elements.setId.value.trim(),...input}});
      closeEditor(); await loadSets();
    } catch(error){setStatus(form,error.message||"Unable to save Set.",true);} finally {save.disabled=false;}
  }

  async function openSettings() {
    try { const payload=await api("/api/v1/admin/sets/settings"); settingsCache=payload?.settings||{}; }
    catch(error){return root.DartDialog?.alert?.(error.message||"Unable to load Set discount settings.");}
    let modal=root.document.getElementById("dartSetSettingsModal"); if(!modal){modal=root.document.createElement("section");modal.id="dartSetSettingsModal";modal.className="dart-admin-set-modal";modal.hidden=true;modal.innerHTML=`<form class="dart-set-settings-dialog"><button type="button" class="dart-admin-set-close" data-settings-close>&times;</button><p>SETS / DISCOUNTS</p><h2>Set Discount Fallbacks</h2><p>Set discount always wins. If a Set has no own discount, Birthday is checked, then Dart Card. Campaigns never apply to Sets.</p><label>Birthday Discount on Sets %<input name="birthday" type="number" min="0" max="100" step="0.01" required></label><label>Dart Card Discount on Sets %<input name="card" type="number" min="0" max="100" step="0.01" required></label><p data-set-form-status class="dart-set-form-status"></p><div class="dart-set-form-actions"><button type="button" data-settings-close>Cancel</button><button type="submit" class="add-btn">Save</button></div></form>`;root.document.body.appendChild(modal);modal.querySelectorAll("[data-settings-close]").forEach(b=>b.addEventListener("click",()=>{modal.hidden=true;}));modal.querySelector("form").addEventListener("submit",event=>void saveSettings(event));}
    modal.querySelector("[name='birthday']").value=Number(settingsCache.birthdayPercent??10);modal.querySelector("[name='card']").value=Number(settingsCache.dartCardPercent??10);modal.hidden=false;
  }

  async function saveSettings(event) {event.preventDefault();const form=event.currentTarget;try{const payload=await api("/api/v1/admin/sets/settings",{method:"PUT",body:{expectedVersion:Number(settingsCache.version),birthdayPercent:Number(form.elements.birthday.value),dartCardPercent:Number(form.elements.card.value)}});settingsCache=payload?.settings||settingsCache;form.closest("#dartSetSettingsModal").hidden=true;}catch(error){setStatus(form,error.message||"Unable to save Set discounts.",true);}}

  function init(){if(initialized)return; if(!root.DartSets||!root.DartAdminApi)return; initialized=true;installPanel();}
  root.addEventListener("dart:admin-authenticated",init);
  root.addEventListener("dart:sets-client-ready",init);
  if(root.DartAdminHydration?.ready) init(); else root.setTimeout(init,0);
})(typeof window!=="undefined"?window:globalThis);
