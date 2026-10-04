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
  let initialized=false, rows=[], editRecord=null, settingsCache=null, currentView="models";
  const selectedSetIds=new Set();

  function can(permission) { return root.DartAdminAccess?.can?.(permission) === true; }
  function model(modelId) { try { return root.DartCatalog?.model?.(String(modelId||"").trim()) || null; } catch { return null; } }
  function api(path, options={}) { return root.DartSets?.request?.(path,options) ?? root.DartAdminApi?.request?.(path,options); }

  function setStatus(form,message,error=false) {
    const node=form?.querySelector?.("[data-set-form-status]"); if (!node) return;
    node.textContent=message||""; node.classList.toggle("is-error",Boolean(error));
  }

  function dashboardControls() {
    const section=root.document.getElementById("models");
    const toolbar=[...(section?.children||[])].find(node=>node.matches?.(".first.filter-bar"));
    const second=[...(section?.children||[])].find(node=>node.matches?.(".second"));
    const modelTable=[...(section?.children||[])].find(node=>node.matches?.(".cont-titel")&&!node.matches?.("[data-sets-admin-panel]"));
    const selects=[...(toolbar?.querySelectorAll?.("select")||[])];
    const byKey=(key,index)=>toolbar?.querySelector?.(`[data-filter-key="${key}"]`)||selects[index]||null;
    return {
      section,toolbar,second,modelTable,
      search:toolbar?.querySelector?.(".search-box input")||null,
      category:byKey("category",0),status:byKey("status",1),priceRange:byKey("priceRange",2),
      archive:toolbar?.querySelector?.('[data-filter-key="archive"]')||null,
      add:toolbar?.querySelector?.(".add-btn")||null,
      remove:second?.querySelector?.(".delete-btn")||null,
    };
  }

  function norm(value) { return root.DartCatalog?.norm?.(value) ?? String(value??"").trim().toLocaleLowerCase(); }

  function availableItemCount(modelId) {
    const catalog=root.DartCatalog;
    if(!catalog?.items)return 0;
    return catalog.items().filter(item=>
      norm(item.modelId)===norm(modelId)&&
      catalog.active?.(item)!==false&&
      norm(item.status)==="in stock"
    ).length;
  }

  function setAvailable(row) {
    return (row.components||[]).every(component=>availableItemCount(component.modelId)>=Math.max(1,Number(component.quantity)||1));
  }

  function setSearchText(row) {
    const parts=[row.setId,row.name,row.description,row.category||"Sets"];
    (row.components||[]).forEach(component=>{
      const m=model(component.modelId);
      parts.push(component.modelId,component.name,m?.name,m?.category);
    });
    return parts.filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function filteredRows() {
    const controls=dashboardControls(), q=String(controls.search?.value||"").trim().toLocaleLowerCase();
    const category=controls.category?.value||"all", status=controls.status?.value||"", priceRange=controls.priceRange?.value||"", archive=controls.archive?.value||"active";
    let visible=[...rows];
    if(q) visible=visible.filter(row=>setSearchText(row).includes(q));
    if(archive==="active") visible=visible.filter(row=>!row.isArchived);
    else if(archive==="archived") visible=visible.filter(row=>row.isArchived);
    if(category&&category!=="all") visible=visible.filter(row=>{
      if(norm(category)==="sets") return true;
      return (row.components||[]).some(component=>norm(model(component.modelId)?.category)===norm(category));
    });
    if(status&&status!=="all") visible=visible.filter(row=>status==="out-of-stock"?!setAvailable(row):Boolean(row.active));
    if(priceRange&&priceRange!=="all") visible=visible.filter(row=>{
      const price=Math.max(0,Number(row.pricing?.finalMinor)||0)/100;
      return priceRange==="0-500"?price<=500:priceRange==="500-1000"?price>500&&price<=1000:price>1000;
    });
    return visible;
  }

  function syncSetHeaderCheckbox(visible=filteredRows()) {
    const header=root.document.querySelector("[data-set-select-all]"); if(!header)return;
    const eligible=visible.filter(row=>!row.isArchived), selected=eligible.filter(row=>selectedSetIds.has(String(row.setId))).length;
    header.checked=eligible.length>0&&selected===eligible.length;
    header.indeterminate=selected>0&&selected<eligible.length;
    header.disabled=eligible.length===0;
  }

  function setActiveView(view) {
    const controls=dashboardControls(), panel=controls.section?.querySelector?.("[data-sets-admin-panel]");
    currentView=view==="sets"?"sets":"models";
    const sets=currentView==="sets";
    controls.section?.setAttribute("data-model-set-view",currentView);
    controls.second?.querySelectorAll?.("[data-model-set-view]").forEach(button=>{
      const active=button.dataset.modelSetView===currentView;
      button.classList.toggle("is-active",active); button.setAttribute("aria-pressed",String(active));
    });
    if(controls.modelTable) controls.modelTable.hidden=sets;
    if(panel) panel.hidden=!sets;
    if(controls.add){
      const originalHidden=controls.add.dataset.dartSetsOriginalHidden==="1";
      controls.add.hidden=sets?(originalHidden||!can("sets.manage")):originalHidden;
    }
    if(sets) void loadSets();
  }

  function installPanel() {
    const controls=dashboardControls(), section=controls.section;
    if(!section||section.querySelector("[data-sets-admin-panel]"))return;
    if(!controls.toolbar||!controls.second||!controls.modelTable||!controls.add||!controls.remove)return;
    controls.add.dataset.dartSetsOriginalHidden=controls.add.hidden?"1":"0";

    const modelsButton=root.document.createElement("button");
    modelsButton.type="button"; modelsButton.className="dart-model-set-view-btn is-active"; modelsButton.dataset.modelSetView="models"; modelsButton.setAttribute("aria-pressed","true"); modelsButton.textContent="Models";
    const setsButton=root.document.createElement("button");
    setsButton.type="button"; setsButton.className="dart-model-set-view-btn"; setsButton.dataset.modelSetView="sets"; setsButton.setAttribute("aria-pressed","false"); setsButton.textContent="Sets";
    controls.second.insertBefore(modelsButton,controls.remove);
    controls.second.insertBefore(setsButton,controls.remove);

    const panel=root.document.createElement("div");
    panel.className="cont-titel dart-sets-admin-panel"; panel.dataset.setsAdminPanel="1"; panel.hidden=true;
    panel.innerHTML=`<div class="title-name dart-set-title-name"><input type="checkbox" data-set-select-all aria-label="Select visible Sets"><div class="w200 dart-set-action-heading"><h2>Action</h2>${can("sets.manage")?'<button type="button" data-set-settings title="Set discount settings" aria-label="Set discount settings"><i class="bx bx-cog"></i></button>':""}</div><h2 class="w100">Photo</h2><h2 class="w150">ID Set</h2><h2 class="w150">Set Name</h2><h2 class="w150">Category</h2><h2 class="w200">Description</h2><h2 class="w150">Available</h2><h2 class="w150">Total Items</h2><h2 class="w150">Cost</h2><h2 class="w150">Separate Selling</h2><h2 class="w150">Set Price</h2><h2 class="w150">Discount %</h2><h2 class="w150">Discounted price</h2><h2 class="w300">Components</h2><h2 class="w150">Status</h2><h2 class="w150">Date</h2></div><div data-set-rows></div><div class="dart-sets-empty" data-set-empty hidden>No Sets yet.</div>`;
    controls.modelTable.insertAdjacentElement("afterend",panel);

    controls.second.addEventListener("click",event=>{const button=event.target.closest("[data-model-set-view]");if(button)setActiveView(button.dataset.modelSetView);});
    controls.add.addEventListener("click",event=>{if(currentView!=="sets")return;event.preventDefault();event.stopImmediatePropagation();if(can("sets.manage"))openEditor();},true);
    controls.remove.addEventListener("click",event=>{if(currentView!=="sets")return;event.preventDefault();event.stopImmediatePropagation();void bulkArchiveSelected();},true);
    const refreshFiltered=()=>{if(currentView==="sets")renderRows();};
    controls.toolbar.addEventListener("input",refreshFiltered);
    controls.toolbar.addEventListener("change",refreshFiltered);

    panel.addEventListener("change",event=>{
      if(event.target.matches("[data-set-select-all]")){
        event.stopPropagation();
        filteredRows().filter(row=>!row.isArchived).forEach(row=>event.target.checked?selectedSetIds.add(String(row.setId)):selectedSetIds.delete(String(row.setId)));
        renderRows(); return;
      }
      const checkbox=event.target.closest("[data-set-select]"); if(!checkbox)return;
      checkbox.checked?selectedSetIds.add(String(checkbox.dataset.setSelect)):selectedSetIds.delete(String(checkbox.dataset.setSelect));
      syncSetHeaderCheckbox();
    },true);
    panel.addEventListener("click",event=>{
      if(event.target.closest("[data-set-settings]")){void openSettings();return;}
      const rowNode=event.target.closest("[data-set-id]"); if(!rowNode)return;
      const row=rows.find(item=>String(item.setId)===String(rowNode.dataset.setId)); if(!row)return;
      if(event.target.closest("[data-set-view]")){openEditor(row,true);return;}
      if(event.target.closest("[data-set-edit]")){openEditor(row,false);return;}
      if(event.target.closest("[data-set-state]")) void toggleState(row);
    });

    if(!can("sets.read")&&!can("sets.manage"))setsButton.hidden=true;
    setActiveView("models");
  }

  async function loadSets() {
    if(!can("sets.read")&&!can("sets.manage"))return;
    const container=root.document.querySelector("[data-set-rows]"); if(container)container.innerHTML='<div class="dart-sets-loading">Loading Sets…</div>';
    try{
      const payload=await api("/api/v1/admin/sets"); rows=Array.isArray(payload?.sets)?payload.sets:[];
      const live=new Set(rows.filter(row=>!row.isArchived).map(row=>String(row.setId)));
      [...selectedSetIds].forEach(id=>{if(!live.has(id))selectedSetIds.delete(id);});
      renderRows();
    }catch(error){if(container)container.innerHTML=`<div class="dart-sets-error">${esc(error.message||"Unable to load Sets")}</div>`;}
  }

  function setImage(row){
    if(Array.isArray(row.images)&&row.images[0])return row.images[0];
    const first=row.components?.[0],m=first?model(first.modelId):null;
    const color=root.DartCatalog?.colors?.(m)?.find(option=>option.active!==false)?.name||"";
    return root.DartCatalog?.cover?.(m,color)||"../Photos/logo-1to1.png";
  }

  function setComponentsLabel(row){
    return (row.components||[]).map(component=>{
      const m=model(component.modelId), quantity=Math.max(1,Number(component.quantity)||1);
      return `${m?.name||component.name||component.modelId}${quantity>1?` × ${quantity}`:""}`;
    }).join(", ")||"-";
  }

  function renderRows() {
    const container=root.document.querySelector("[data-set-rows]"),empty=root.document.querySelector("[data-set-empty]");if(!container)return;
    const visible=filteredRows(); container.replaceChildren(); if(empty)empty.hidden=visible.length>0;
    visible.forEach(row=>{
      const pricing=row.pricing||{}, available=setAvailable(row), archived=Boolean(row.isArchived), node=root.document.createElement("div");
      node.className=`model-row ${archived?"row-deleted":"row-normal"} dart-set-row`; node.dataset.setId=row.setId;
      const created=row.createdAt?new Date(row.createdAt).toLocaleDateString("en-GB"):"-";
      node.innerHTML=`<input type="checkbox" class="model-checkbox" data-set-select="${esc(row.setId)}" ${selectedSetIds.has(String(row.setId))?"checked":""} ${archived?"disabled":""}><div class="w200 button row-action-btns">${can("sets.manage")?`<button type="button" class="action-btn btn-delete" data-set-state title="${archived?"Restore":"Archive"}"><i class="bx ${archived?"bx-revision":"bx-minus-circle"}"></i></button><button type="button" class="action-btn btn-edit" data-set-edit title="Edit"><i class="bx bx-edit"></i></button>`:""}<button type="button" class="action-btn" data-set-view title="View"><i class="bx bx-show"></i></button></div><div class="w100"><img src="${esc(setImage(row))}" class="product-img model-img" alt="${esc(row.name)}"></div><span class="text-item w150">${esc(row.setId)}</span><span class="text-item w150">${esc(row.name)}</span><span class="text-item w150">Sets</span><span class="text-item w200">${esc(row.description||"-")}</span><span class="text-item w150 ${available?"status-active":"dart-set-out-of-stock"}">${available?"Available":"Out of stock"}</span><span class="text-item w150">${Number(row.pieceCount)||0}</span><span class="text-item w150">${money(pricing.costTotalMinor)}</span><span class="text-item w150">${money(pricing.componentsSellingTotalMinor)}</span><span class="text-item w150">${money(pricing.basePriceMinor)}</span><span class="text-item w150">${Math.round(Number(pricing.discountPercent)||0)}%</span><span class="text-item w150">${money(pricing.finalMinor)}</span><span class="text-item w300">${esc(setComponentsLabel(row))}</span><span class="text-item w150">• ${archived?"Archived":row.active?"Active":"Inactive"}</span><span class="text-item w150">${esc(created)}</span>`;
      container.appendChild(node);
    });
    syncSetHeaderCheckbox(visible);
  }

  async function bulkArchiveSelected(){
    if(!can("sets.manage"))return;
    const selected=filteredRows().filter(row=>!row.isArchived&&selectedSetIds.has(String(row.setId))); if(!selected.length)return;
    const accepted=await root.DartDialog?.confirm?.(`Archive ${selected.length} selected Set${selected.length===1?"":"s"}?`); if(!accepted)return;
    const button=dashboardControls().remove; if(button)button.disabled=true;
    const failed=[];
    try{
      for(const row of selected){
        try{await api(`/api/v1/admin/sets/${encodeURIComponent(row.setId)}/state`,{method:"POST",body:{action:"archive",expectedVersion:Number(row.version)}});selectedSetIds.delete(String(row.setId));}
        catch(error){failed.push(`${row.setId}: ${error.message||"Failed"}`);}
      }
      await loadSets();
      if(failed.length)await root.DartDialog?.alert?.(`Some Sets could not be archived:\n${failed.join("\n")}`);
    }finally{if(button)button.disabled=false;}
  }

  async function toggleState(row) {
    if(!can("sets.manage"))return;
    const action=row.isArchived?"restore":"archive";
    const accepted=await root.DartDialog?.confirm?.(`${action==="archive"?"Archive":"Restore"} Set ${row.setId}?`); if(!accepted)return;
    try{await api(`/api/v1/admin/sets/${encodeURIComponent(row.setId)}/state`,{method:"POST",body:{action,expectedVersion:Number(row.version)}});selectedSetIds.delete(String(row.setId));await loadSets();}
    catch(error){await root.DartDialog?.alert?.(error.message||"Unable to update Set state.");}
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

  function syncAccess(){
    if(!initialized)return;
    const controls=dashboardControls();
    const setsButton=controls.second?.querySelector?.('[data-model-set-view="sets"]');
    const readable=can("sets.read")||can("sets.manage");
    if(setsButton)setsButton.hidden=!readable;
    if(currentView==="sets"&&!readable)setActiveView("models");
    if(currentView==="sets"&&controls.add){
      const originalHidden=controls.add.dataset.dartSetsOriginalHidden==="1";
      controls.add.hidden=originalHidden||!can("sets.manage");
    }
  }

  function init(){
    if(!root.DartSets||!root.DartAdminApi||root.DartAdminHydration?.ready!==true)return;
    if(!initialized){initialized=true;installPanel();}
    syncAccess();
  }
  root.addEventListener("dart:admin-authenticated",init);
  root.addEventListener("dart:sets-client-ready",init);
  if(root.DartAdminHydration?.ready===true)init();
})(typeof window!=="undefined"?window:globalThis);
