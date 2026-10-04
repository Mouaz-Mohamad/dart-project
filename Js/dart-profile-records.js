// DART CODE GUIDE | Js/dart-profile-records.js
// Compact My Account commerce rows + centered details modal.
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) root.DartProfileRecords = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const details = new Map(), meta = new Map(), observed = new WeakSet();
  let scheduled = false, lastOpener = null;
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const txt = (v, fallback = "-") => String(v ?? "").trim() || fallback;

  function quantity(lines) {
    return Array.isArray(lines) ? lines.reduce((n, x) => n + (Number(x?.quantity) > 0 ? Math.trunc(Number(x.quantity)) : 1), 0) : 0;
  }
  function orderPieceCount(order) {
    const items = Array.isArray(order?.items) ? order.items.filter(x => x != null && String(x).trim()) : [];
    return items.length || quantity(order?.priceSnapshot);
  }
  function returnPieceCount(record) {
    for (const lines of [record?.returnLines, record?.lines, record?.items]) {
      const count = quantity(lines); if (count) return count;
    }
    const q = Number(record?.quantity);
    return Number.isFinite(q) && q > 0 ? Math.trunc(q) : record?.itemCode ? 1 : 0;
  }
  function displayDate(primary, fallback) {
    const value = primary || fallback; if (!value) return "-";
    const raw = String(value).trim();
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw)) return raw.replaceAll("-", "/");
    const date = new Date(value); return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("en-GB");
  }
  function statusTone(status) {
    const v = String(status || "").toLowerCase();
    if (/delivered|completed|converted|ordered|added to cart|\bgood\b/.test(v)) return "success";
    if (/refused|rejected|cancelled|canceled|expired|damaged|\bbad\b|failed/.test(v)) return "danger";
    if (/notified|inspection|review|alternative/.test(v)) return "warning";
    if (/pending|waiting|reserved|accepted|preparing|representative|on the way|pickup|active|new/.test(v)) return "active";
    return "neutral";
  }
  function orderSummary(order = {}) {
    return { id: txt(order.orderId || order.id), status: txt(order.status), date: displayDate(order.date, order.createdAt), pieces: orderPieceCount(order) };
  }
  function returnSummary(record = {}) {
    return { id: txt(record.returnId || record.id), status: txt(record.publicStatus || record.status), date: displayDate(record.date, record.createdAt), pieces: returnPieceCount(record) };
  }
  function waitingSummary(entry = {}) {
    if (String(entry.type || "").toLowerCase() === "set") {
      return { id:txt(entry.id),design:txt(entry.setName || entry.setId,"Set"),size:`${Number(entry.pieceCount)||0} Pieces`,color:"Set",date:displayDate(entry.requestedAt,entry.createdAt),status:txt(entry.statusLabel || entry.status) };
    }
    return { id: txt(entry.id), design: txt(entry.modelName || entry.modelId), size: txt(entry.size), color: txt(entry.color), date: displayDate(entry.requestedAt, entry.createdAt), status: txt(entry.statusLabel || entry.status) };
  }

  const snapshot = (o) => Array.isArray(o?.priceSnapshot) ? o.priceSnapshot.filter(Boolean) : [];
  function stableIndex(seed, length) {
    if (!length) return 0;
    return [...String(seed || "dart")].reduce((n, c, i) => n + c.charCodeAt(0) * (i + 1), 0) % length;
  }
  function chooseOrderLine(order) {
    const lines = snapshot(order); return lines.length ? lines[stableIndex(order?.orderId || order?.id, lines.length)] : null;
  }
  function designName(line) { return txt(line?.name || line?.modelName || line?.model_name || line?.modelCode || line?.modelId); }
  function distinctDesignCount(order) {
    return new Set(snapshot(order).map(x => txt(x?.modelCode || x?.modelId || x?.name, "")).filter(Boolean)).size;
  }
  function orderVisualSummary(order = {}) {
    const sets = Array.isArray(order?.setGroups) ? order.setGroups.filter(Boolean) : [];
    if (sets.length) {
      const set = sets[0] || {}, setPieces = sets.reduce((sum,row)=>sum+(Number(row?.pieceCount)||0),0);
      const otherPieces = Math.max(0,orderPieceCount(order)-setPieces);
      return {
        ...orderSummary(order),design:txt(set.setName || set.name || set.setId,"Set"),
        extraDesigns:Math.max(0,sets.length-1+otherPieces),color:"Set",size:`${Number(set.pieceCount)||0} Pieces`,
        modelId:"",lineImage:txt(set.setImage || set.image,""),isSet:true,
      };
    }
    const line = chooseOrderLine(order) || {};
    return { ...orderSummary(order), design: designName(line), extraDesigns: Math.max(0, distinctDesignCount(order) - 1), color: txt(line.color), size: txt(line.size), modelId: txt(line.modelCode || line.modelId || line.model_id, ""), lineImage: txt(line.image || line.imageUrl || line.image_url, "") };
  }
  function returnTypeLabel(record = {}) {
    return String(record.requestType || record.type || "").trim().toLowerCase() === "exchange" ? "Exchange" : "Refund";
  }
  function returnLine(record, order) {
    const code = txt(record?.itemCode, ""), lines = snapshot(order);
    return (code && lines.find(x => txt(x?.itemCode || x?.item_code, "") === code)) || record?.originalLineSnapshot || lines[0] || {};
  }
  function returnVisualSummary(record = {}, order = {}) {
    const line = returnLine(record, order), exchange = returnTypeLabel(record) === "Exchange";
    const modelId = txt(record.modelId || line.modelCode || line.modelId || line.model_id, "");
    return {
      ...returnSummary(record), type: returnTypeLabel(record), design: txt(record.modelName || line.name || line.modelName || modelId),
      color: exchange ? txt(record.requestedColor || record.replacementColor || line.color) : txt(line.color || record.originalLineSnapshot?.color),
      size: exchange ? txt(record.requestedSize || record.replacementSize || line.size) : txt(line.size || record.originalLineSnapshot?.size),
      modelId, lineImage: txt(line.image || line.imageUrl || line.image_url, ""), variantLabel: exchange ? "New" : "Returned"
    };
  }

  function platform() { return root.DartPlatform || null; }
  function customerRows(key) {
    const id = platform()?.currentUser?.()?.customerId || "";
    return (platform()?.read?.(key, []) || []).filter(x => (!id || String(x.clientId) === String(id)) && !x.isDeleted);
  }
  const customerOrders = () => customerRows("dart_orders");
  const customerReturns = () => customerRows("dart_returns");
  function normalWaitingEntries() {
    const rows = platform()?.waitingEntries?.();
    return Array.isArray(rows) ? rows.slice() : [];
  }
  function field(card, label) {
    const wanted = String(label).toLowerCase();
    for (const el of card?.querySelectorAll?.(".profile-record-field") || []) {
      if (el.querySelector("small")?.textContent?.trim().toLowerCase() === wanted) return el.querySelector("span")?.textContent?.trim() || "";
    }
    return "";
  }
  const identity = card => card?.querySelector(".profile-record-head strong")?.textContent?.trim() || "";
  const cardStatus = card => card?.querySelector(".profile-status")?.textContent?.trim() || "-";
  function imageFor(modelId, color, fallback = "") {
    if (fallback) return fallback;
    try { const model = root.DartCatalog?.model?.(modelId); return root.DartCatalog?.cover?.(model, color) || model?.image || model?.images?.[0] || "Photos/logo-1to1.png"; }
    catch { return "Photos/logo-1to1.png"; }
  }
  function fallbackImage(img) {
    img?.addEventListener("error", () => { if (img.dataset.fallback === "1") return void (img.hidden = true); img.dataset.fallback = "1"; img.src = "Photos/logo-1to1.png"; });
  }
  function tone(el, status) {
    if (!el) return;
    const p = {success:["#e8f7ef","#166534"],danger:["#fff0f3","#991b1b"],warning:["#fff7ed","#92400e"],active:["#f7e9ed","#8c1d2c"],neutral:["#f1f5f9","#475569"]}[statusTone(status)];
    el.style.background = p[0]; el.style.color = p[1]; el.style.border = `1px solid ${p[1]}25`;
  }
  function shell(key, label) {
    const b = root.document.createElement("button");
    b.type = "button"; b.className = "profile-record-card"; b.dataset.dartCompactRow = "1"; b.dataset.dartProfileRecordOpen = key; b.setAttribute("aria-label", label);
    Object.assign(b.style,{width:"100%",padding:"0",border:"1px solid rgba(30,30,30,.14)",background:"#fff",color:"inherit",font:"inherit",textAlign:"start",cursor:"pointer",appearance:"none"});
    return b;
  }
  function commerceRow(s, image, key, type) {
    const isReturn = type === "return", row = shell(key, `${isReturn ? "Open return" : "Open order"} ${s.id}`);
    const design = isReturn ? s.design : `${s.design}${s.extraDesigns ? ` +${s.extraDesigns}` : ""}`;
    const variant = isReturn ? `${s.type} · ${s.variantLabel} Color: ${s.color} · ${s.variantLabel} Size: ${s.size}` : `Color: ${s.color} · Size: ${s.size}`;
    row.innerHTML = `<div class="profile-record-head" style="display:grid;grid-template-columns:58px minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:5px 11px;padding:9px 12px"><img data-row-image src="${esc(image)}" alt="${esc(s.design)}" loading="lazy" decoding="async" style="grid-row:1/3;width:58px;height:72px;object-fit:cover;border-radius:10px;background:#f1f5f9"><div style="min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.id)}</strong><span style="display:block;margin-top:3px;color:#111827;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(design)}</span><span style="display:block;margin-top:3px;color:#64748b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(variant)}</span></div><span class="profile-status">${esc(s.status)}</span><div style="color:#64748b;font-size:11px">${esc(s.date)} · ${esc(`${s.pieces} ${s.pieces === 1 ? "Piece" : "Pieces"}`)}</div><span aria-hidden="true" style="color:#ab012b;font-size:18px">›</span></div>`;
    tone(row.querySelector(".profile-status"), s.status); fallbackImage(row.querySelector("[data-row-image]")); return row;
  }
  function waitingRow(s, image, key) {
    const row = shell(key, `Open Waiting details for ${s.design}`);
    row.innerHTML = `<div class="profile-record-head" style="display:grid;grid-template-columns:52px minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:5px 11px;padding:9px 12px"><img data-row-image src="${esc(image)}" alt="${esc(s.design)}" loading="lazy" decoding="async" style="grid-row:1/3;width:52px;height:64px;object-fit:cover;border-radius:9px;background:#f1f5f9"><div style="min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.design)}</strong><span style="display:block;margin-top:3px;color:#475569;font-size:11px">Size: ${esc(s.size)} · Color: ${esc(s.color)}</span></div><span class="profile-status">${esc(s.status)}</span><span style="color:#64748b;font-size:11px">${esc(s.date)}</span><span aria-hidden="true" style="color:#ab012b;font-size:18px">›</span></div>`;
    tone(row.querySelector(".profile-status"), s.status); fallbackImage(row.querySelector("[data-row-image]")); return row;
  }
  function remember(type, id, card, extra) {
    const key = `${type}:${id}`; details.set(key, card.cloneNode(true)); meta.set(key, {...extra,type}); return key;
  }

  function enhanceOrders(list) {
    const cards = [...list.children].filter(x => x.matches?.(".profile-record-card:not([data-dart-compact-row])")); if (!cards.length) return;
    const byId = new Map(customerOrders().map(x => [String(x.orderId), x]));
    cards.forEach(card => {
      const id = identity(card), record = byId.get(id) || {}, base = orderVisualSummary(record);
      const s = {...base,id:id || base.id,status:cardStatus(card) || base.status,date:(record.date || record.createdAt) ? displayDate(record.date,record.createdAt) : field(card,"Order date") || "-",pieces:orderPieceCount(record) || card.querySelectorAll(".profile-record-item").length};
      if (s.design === "-") s.design = card.querySelector(".profile-record-item span")?.textContent?.trim() || "Design";
      const image = imageFor(s.modelId,s.color,s.lineImage), key = remember("order",s.id,card,{title:`Order ${s.id}`,summary:s,image});
      card.replaceWith(commerceRow(s,image,key,"order"));
    });
  }
  function enhanceReturns(list) {
    const cards = [...list.children].filter(x => x.matches?.(".profile-record-card:not([data-dart-compact-row])")); if (!cards.length) return;
    const orders = customerOrders(), byId = new Map(customerReturns().map(x => [String(x.returnId),x]));
    cards.forEach(card => {
      const id = identity(card), record = byId.get(id) || {}, order = orders.find(x => String(x.orderId) === String(record.orderId)) || {}, base = returnVisualSummary(record,order);
      const s = {...base,id:id || base.id,status:cardStatus(card) || base.status,date:(record.date || record.createdAt) ? displayDate(record.date,record.createdAt) : field(card,"Request date") || "-",pieces:returnPieceCount(record) || (field(card,"Original Item") && field(card,"Original Item") !== "-" ? 1 : 0)};
      if (s.design === "-") s.design = field(card,"Model") || "Design";
      if (s.type === "Exchange") { const p = field(card,"Replacement").split("·").map(x=>x.trim()).filter(Boolean); if (s.color === "-" && p.length >= 2) s.color = p.at(-2); if (s.size === "-" && p.length) s.size = p.at(-1); }
      else { const [size,color] = field(card,"Original Size / Color").split("/").map(x=>x.trim()); if (s.size === "-" && size) s.size = size; if (s.color === "-" && color) s.color = color; }
      const image = imageFor(s.modelId,s.color,s.lineImage), key = remember("return",s.id,card,{title:`Return ${s.id}`,summary:s,image});
      card.replaceWith(commerceRow(s,image,key,"return"));
    });
  }
  function enhanceWaiting(list) {
    const cards = [...list.children].filter(x => x.matches?.(".profile-record-card:not([data-dart-compact-row])"));
    const normalEntries = normalWaitingEntries(), labels = {waiting:"Waiting",reserved:"Reserved for you",confirmed:"Added to cart",converted:"Ordered",expired:"Reservation expired",cancelled:"Cancelled"};
    cards.forEach((card,i) => {
      const e = normalEntries[i] || {}, b = waitingSummary(e), s = {...b,id:e.id || `${identity(card) || "waiting"}-${i}`,design:e.modelName || identity(card) || b.design,size:e.size || field(card,"Size") || "-",color:e.color || field(card,"Requested color") || "-",date:e.requestedAt ? displayDate(e.requestedAt) : field(card,"Requested") || "-",status:labels[e.status] || cardStatus(card)};
      const image = imageFor(e.modelId,e.color), key = remember("waiting",s.id,card,{title:s.design,image,imageAlt:s.design,summary:s,entry:e}); card.replaceWith(waitingRow(s,image,key));
    });
  }

  function ensureModal() {
    let modal = root.document.getElementById("dartProfileRecordDetailModal"); if (modal) return modal;
    modal = root.document.createElement("section"); modal.id = "dartProfileRecordDetailModal"; modal.className = "serial-result"; modal.hidden = true; modal.style.zIndex = "400000";
    modal.setAttribute("role","dialog"); modal.setAttribute("aria-modal","true"); modal.setAttribute("aria-labelledby","dartProfileRecordDetailTitle");
    modal.innerHTML = `<div class="serial-result-card" style="width:min(92vw,620px);max-height:82dvh;overflow:auto;text-align:start;padding:20px"><button type="button" class="serial-result-close" data-detail-close aria-label="Close details">×</button><h2 id="dartProfileRecordDetailTitle" style="margin:0 38px 14px 0;color:#ab012b"></h2><div data-detail-body></div></div>`;
    if (!root.document.getElementById("dartProfileRecordDetailStyle")) {
      const style = root.document.createElement("style"); style.id = "dartProfileRecordDetailStyle";
      style.textContent = `
        #dartProfileRecordDetailModal .dart-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
        #dartProfileRecordDetailModal .dart-detail-field{min-width:0;padding:9px 10px;border:1px solid rgba(15,23,42,.09);border-radius:9px;background:#fff}
        #dartProfileRecordDetailModal .dart-detail-field.is-full{grid-column:1/-1}
        #dartProfileRecordDetailModal .dart-detail-field small{display:block;margin-bottom:3px;color:#64748b;font-size:11px;font-weight:400}
        #dartProfileRecordDetailModal .dart-detail-field span{display:block;color:#111827;font-size:13px;font-weight:600;overflow-wrap:anywhere}
        #dartProfileRecordDetailModal .dart-detail-preview{display:grid;grid-template-columns:74px minmax(0,1fr);gap:12px;align-items:center;margin-bottom:14px;padding:10px;border:1px solid rgba(171,1,43,.14);border-radius:12px;background:#fffaf8}
        #dartProfileRecordDetailModal .dart-detail-preview img{width:74px;height:92px;object-fit:cover;border-radius:10px;background:#f1f5f9}
        #dartProfileRecordDetailModal .profile-record-items{margin:14px 0 0;padding-top:12px}
        @media(max-width:650px){
          #dartProfileRecordDetailModal .serial-result-card{width:calc(100vw - 20px)!important;padding:14px!important;font-size:11px}
          #dartProfileRecordDetailModal .serial-result-card *{font-weight:400!important}
          #dartProfileRecordDetailModal .dart-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
          #dartProfileRecordDetailModal .dart-detail-field{padding:7px}
          #dartProfileRecordDetailModal .dart-detail-field small{font-size:9px}
          #dartProfileRecordDetailModal .dart-detail-field span{font-size:10px}
          #dartProfileRecordDetailModal .profile-record-item{font-size:10px}
          #dartProfileRecordDetailModal .profile-record-head strong{font-size:13px!important}
          #dartProfileRecordDetailModal .dart-detail-preview{grid-template-columns:58px minmax(0,1fr);gap:8px;padding:8px}
          #dartProfileRecordDetailModal .dart-detail-preview img{width:58px;height:72px}
          #dartProfileRecordDetailModal #dartProfileRecordDetailTitle{font-size:18px}
        }`;
      root.document.head.appendChild(style);
    }
    root.document.body.appendChild(modal); return modal;
  }

  function makeField(label, value, full = false) {
    const el = root.document.createElement("div"); el.className = `dart-detail-field${full ? " is-full" : ""}`;
    el.innerHTML = `<small>${esc(label)}</small><span>${esc(value || "-")}</span>`; return el;
  }
  function addFields(grid, rows) {
    rows.forEach(([label,value,full]) => grid.appendChild(makeField(label,value,Boolean(full))));
  }
  function splitPayment(value) {
    const parts = String(value || "").split("·").map(x=>x.trim()).filter(Boolean);
    return { method: parts[0] || "Cash on Delivery", status: parts.slice(1).join(" · ") || "-" };
  }
  function preview(m) {
    if (!m?.summary || !m?.image) return null;
    const s = m.summary, isReturn = m.type === "return", box = root.document.createElement("div"); box.className = "dart-detail-preview";
    const design = isReturn ? s.design : `${s.design}${s.extraDesigns ? ` +${s.extraDesigns}` : ""}`;
    const variant = isReturn ? `${s.type} · ${s.variantLabel} Color: ${s.color} · ${s.variantLabel} Size: ${s.size}` : `Color: ${s.color} · Size: ${s.size}`;
    box.innerHTML = `<img src="${esc(m.image)}" alt="${esc(s.design)}"><div style="min-width:0"><strong style="display:block;color:#111827;font-size:15px">${esc(design)}</strong><span style="display:block;margin-top:5px;color:#475569;font-size:12px">${esc(variant)}</span><span style="display:block;margin-top:5px;color:#64748b;font-size:11px">${esc(`${s.pieces} ${s.pieces === 1 ? "Piece" : "Pieces"}`)}</span></div>`;
    fallbackImage(box.querySelector("img")); return box;
  }
  function layoutOrderDetail(card) {
    const originalGrid = card.querySelector(".profile-record-grid"), items = card.querySelector(".profile-record-items");
    if (!originalGrid) return card;
    const payment = splitPayment(field(card,"Payment"));
    const grid = root.document.createElement("div"); grid.className = "dart-detail-grid";
    addFields(grid, [
      ["Subtotal",field(card,"Subtotal")],["Final Total",field(card,"Final total")],
      ["Order Date",field(card,"Order date")],["Discount",field(card,"Discount")],
      ["Payment Method",payment.method],["Payment Status",payment.status],
      ["Created",field(card,"Created")],["Accepted",field(card,"Accepted")],
      ["Out With Representative",field(card,"Out for delivery")],["Delivered",field(card,"Delivered")],
      ["Address",field(card,"Address"),true]
    ]);
    originalGrid.replaceWith(grid);
    if (items) items.style.display = "block";
    return card;
  }
  function layoutReturnDetail(card, m) {
    const originalGrid = card.querySelector(".profile-record-grid"); if (!originalGrid) return card;
    const s = m.summary || {}, exchange = s.type === "Exchange";
    const grid = root.document.createElement("div"); grid.className = "dart-detail-grid";
    const valueLabel = exchange ? "Exchange Value" : "Refund Value";
    const value = exchange ? (field(card,"Original net item price") || field(card,"Refund")) : field(card,"Refund");
    addFields(grid, [
      ["Return Type",s.type || field(card,"Request type")],["Status",cardStatus(card)],
      ["Order ID",field(card,"Order ID")],["Request Date",field(card,"Request date")],
      ["Design",s.design || field(card,"Model")],["Item Code",field(card,"Original Item")],
      [exchange ? "New Color" : "Returned Color",s.color],[exchange ? "New Size" : "Returned Size",s.size],
      ["Original Price",field(card,"Original net item price")],[valueLabel,value],
      ["Courier Fee",field(card,"Courier fee")],["Internal Progress",field(card,"Internal progress")],
      ["Representative",field(card,"Representative")],["Inspection",field(card,"Inspection")],
      ["Created",field(card,"Created")],["Completed",field(card,"Completed")],
      ["Inspected",field(card,"Inspected")],["Rejection Reason",field(card,"Rejection reason")],
      ["Reason",field(card,"Reason"),true],["Address",field(card,"Pickup address"),true],["Notes",field(card,"Notes"),true]
    ]);
    originalGrid.replaceWith(grid); return card;
  }
  function layoutWaitingDetail(card, m) {
    const originalGrid = card.querySelector(".profile-record-grid"); if (!originalGrid) return card;
    const s = m.summary || {}, grid = root.document.createElement("div"); grid.className = "dart-detail-grid";
    addFields(grid, [
      ["Design",s.design || identity(card)],["Status",s.status || cardStatus(card)],
      ["Size",field(card,"Size") || s.size],["Color",field(card,"Requested color") || s.color],
      ["Queue Position",field(card,"Queue position")],["Requested At",field(card,"Requested")],
      ["Notified At",field(card,"Notified")],["Reservation Expires",field(card,"Reservation expires")],
      ["Reserved Color",field(card,"Reserved color")],["Match Type",field(card,"Match")],
      ["Order",field(card,"Order"),true]
    ]);
    originalGrid.replaceWith(grid); return card;
  }
  function openDetail(key, opener) {
    const cached = details.get(key); if (!cached) return;
    const modal = ensureModal(), m = meta.get(key) || {}, body = modal.querySelector("[data-detail-body]"); body.replaceChildren(); modal.querySelector("#dartProfileRecordDetailTitle").textContent = m.title || "Details";
    if (m.type === "order" || m.type === "return") { const p = preview(m); if (p) body.appendChild(p); }
    else if (m.type === "waiting" && m.image) { const p = root.document.createElement("div"); p.className = "dart-detail-preview"; p.innerHTML = `<img src="${esc(m.image)}" alt="${esc(m.imageAlt || m.title)}"><strong>${esc(m.title)}</strong>`; fallbackImage(p.querySelector("img")); body.appendChild(p); }
    let detail = cached.cloneNode(true); detail.style.width = "100%"; detail.style.boxShadow = "none";
    if (m.type === "order") detail = layoutOrderDetail(detail);
    else if (m.type === "return") detail = layoutReturnDetail(detail,m);
    else if (m.type === "waiting") detail = layoutWaitingDetail(detail,m);
    body.appendChild(detail);
    lastOpener = opener || root.document.activeElement; modal.hidden = false; root.document.body.dataset.dartProfilePreviousOverflow = root.document.body.style.overflow || ""; root.document.body.style.overflow = "hidden";
    root.requestAnimationFrame?.(() => modal.querySelector("[data-detail-close]")?.focus());
  }
  function closeDetail() {
    const modal = root.document.getElementById("dartProfileRecordDetailModal"); if (!modal || modal.hidden) return;
    modal.hidden = true; root.document.body.style.overflow = root.document.body.dataset.dartProfilePreviousOverflow || ""; delete root.document.body.dataset.dartProfilePreviousOverflow; lastOpener?.focus?.(); lastOpener = null;
  }
  function enhanceAll() {
    if (!root.document) return;
    const orders = root.document.getElementById("profileOrdersList"), returns = root.document.getElementById("profileReturnsList"), waiting = root.document.getElementById("profileWaitingList");
    if (orders) enhanceOrders(orders); if (returns) enhanceReturns(returns); if (waiting) enhanceWaiting(waiting);
  }
  function scheduleEnhance() {
    if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; enhanceAll(); });
  }
  function observeLists() {
    if (!root.MutationObserver) return;
    ["profileOrdersList","profileReturnsList","profileWaitingList"].forEach(id => {
      const list = root.document.getElementById(id); if (!list || observed.has(list)) return;
      observed.add(list); new root.MutationObserver(scheduleEnhance).observe(list,{childList:true});
    });
  }
  function bindDom() {
    observeLists(); scheduleEnhance();
    root.document.addEventListener("dart:data-changed",scheduleEnhance);
    root.addEventListener("dart:sets-extension-ready",scheduleEnhance);
    root.document.addEventListener("dart:sections-loaded",()=>{observeLists();scheduleEnhance();});
    root.document.addEventListener("click",event=>{
      const opener = event.target.closest?.("[data-dart-profile-record-open]"); if (opener) return openDetail(opener.dataset.dartProfileRecordOpen,opener);
      const modal = root.document.getElementById("dartProfileRecordDetailModal"); if (!modal) return;
      if (event.target.closest?.("[data-detail-close]") || event.target === modal) return closeDetail();
      if (event.target.closest?.("[data-waiting-action]") && modal.contains(event.target)) root.setTimeout(closeDetail,0);
    });
    root.document.addEventListener("keydown",event=>{ if (event.key === "Escape") closeDetail(); });
  }
  if (root.document) { if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded",bindDom); else bindDom(); }

  return Object.freeze({orderPieceCount,returnPieceCount,statusTone,orderSummary,returnSummary,waitingSummary,displayDate,orderVisualSummary,returnVisualSummary,returnTypeLabel});
});
