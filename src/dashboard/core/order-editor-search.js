function setupOrderModal() {
  if (window.DartOperations?.active) return;
  const modal = document.getElementById("orderModal"),
    form = document.getElementById("orderForm");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";
  let selected = [];
  const list = document.getElementById("selectedProductsList"),
    codeInput = document.getElementById("productsInputCode");
  function renderSel() {
    if (list)
      list.innerHTML = selected
        .map(
          (code, i) =>
            `<span class="order-item-chip"><b>${dartEsc(code)}</b><button type="button" class="remove-item-btn" data-index="${i}">&times;</button></span>`,
        )
        .join("");
    calc();
  }
  function calc() {
    const snap = dartPriceSnapshotForCodes(selected),
      subtotal = snap.reduce((a, l) => a + l.finalUnitPrice, 0),
      pct = Number(document.getElementById("deductions")?.value) || 0,
      total = Math.max(0, subtotal - (subtotal * pct) / 100);
    document.getElementById("subtotalVal").textContent = dartMoney(subtotal);
    document.getElementById("discountVal").textContent = dartMoney(
      subtotal - total,
    );
    document.getElementById("totalVal").textContent = dartMoney(total);
    return { subtotal, pct, total, snap };
  }
  function populate() {
    const dl = document.getElementById("items-datalist");
    if (dl)
      dl.innerHTML = itemsData
        .filter(
          (i) =>
            dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
        )
        .map(
          (i) =>
            `<option value="${dartEsc(i.itemCode)}">${dartEsc(i.modelId)} - ${dartEsc(i.color)} (${dartEsc(i.size)})</option>`,
        )
        .join("");
    populateModelsDatalist();
  }
  document.getElementById("openModalBtn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-order-edit-id").value = "";
    selected = [];
    populate();
    renderSel();
    openModal(modal);
  });
  document.getElementById("addProductBtn")?.addEventListener("click", () => {
    const code = codeInput.value.trim(),
      it = dartFindItemByCode(code);
    if (
      !it ||
      dartIsArchived(it) ||
      String(it.status).toLowerCase() !== "in stock"
    ) {
      window.DartDialog.alert("القطعة غير متاحة.");
      return;
    }
    if (!selected.includes(code)) selected.push(code);
    codeInput.value = "";
    renderSel();
  });
  document
    .getElementById("autoAllocateProductBtn")
    ?.addEventListener("click", () => {
      const r = dartAutoAllocate(
        document.getElementById("orderModelCode").value.trim(),
        document.getElementById("orderItemColor").value.trim(),
        document.getElementById("orderItemSize").value.trim(),
        Math.max(1, Number(document.getElementById("orderItemQty").value) || 1),
        selected,
      );
      if (!r.ok) {
        window.DartDialog.alert(r.message);
        return;
      }
      selected.push(...r.codes);
      renderSel();
    });
  list?.addEventListener("click", (e) => {
    if (!e.target.classList.contains("remove-item-btn")) return;
    selected.splice(Number(e.target.dataset.index), 1);
    renderSel();
  });
  document.getElementById("deductions")?.addEventListener("input", calc);
  window.loadOrderItemsForEdit = (codes) => {
    selected = [...(codes || [])];
    populate();
    renderSel();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected.length) {
      window.DartDialog.alert("أضف قطعة واحدة على الأقل.");
      return;
    }
    const editId = document.getElementById("modal-order-edit-id").value,
      existing = ordersData.find((o) => String(o.id) === String(editId)),
      prices = calc(),
      selectedClientId = document.getElementById("clientId").value || "-",
      selectedClient = dartFindCustomerByCode(selectedClientId);
    if (selectedClient && dartIsArchived(selectedClient)) {
      window.DartDialog.alert("لا يمكن استخدام عميل مشطوب.");
      return;
    }
    const payload = {
      clientId: selectedClientId,
      clientName: document.getElementById("clientName").value,
      phone1: document.getElementById("phone1").value,
      phone2: document.getElementById("phone2").value || "-",
      email: document.getElementById("email").value || "-",
      paymentMethod:
        document.getElementById("paymentMethod").value || "Cash on Delivery",
      paymentStatus: document.getElementById("paymentStatus").value || "Unpaid",
      amountPaid: Number(document.getElementById("amountPaid").value) || 0,
      amountRefunded:
        Number(document.getElementById("amountRefunded").value) || 0,
      orderSource: document.getElementById("orderSource").value || "Manual",
      deliveryNotes: document.getElementById("deliveryNotes").value || "",
      items: [...selected],
      totalProducts: selected.length,
      totalPrice: prices.subtotal,
      discount: prices.pct,
      reasonDeduction: prices.pct ? "Order discount" : "-",
      country: document.getElementById("orderCountry").value || "Egypt",
      governorate: document.getElementById("governorate").value || "",
      area: document.getElementById("orderArea").value || "",
      street: document.getElementById("orderStreetName").value || "",
      building: document.getElementById("orderBuildingNumber").value || "",
      floor: document.getElementById("orderFloor").value || "",
    };

    if (!existing && window.DartOrdersApi?.createManual) {
      try {
        await window.DartOrdersApi.createManual({
          ...(selectedClientId && selectedClientId !== "-"
            ? { clientId: selectedClientId }
            : {}),
          clientName: payload.clientName,
          phone1: payload.phone1,
          ...(payload.phone2 && payload.phone2 !== "-" ? { phone2: payload.phone2 } : {}),
          ...(payload.email && payload.email !== "-" ? { email: payload.email } : {}),
          paymentMethod: payload.paymentMethod,
          paymentStatus: payload.paymentStatus,
          amountPaid: payload.amountPaid,
          amountRefunded: payload.amountRefunded,
          orderSource: payload.orderSource,
          deliveryNotes: payload.deliveryNotes,
          itemCodes: [...selected],
          discountPercent: prices.pct,
          country: payload.country,
          governorate: payload.governorate,
          area: payload.area,
          street: payload.street,
          building: payload.building,
          floor: payload.floor,
        });
        if (window.DartCatalog?.hydrate) await window.DartCatalog.hydrate(true);
        dartRefreshAll();
        closeModal(modal);
        form.reset();
        selected = [];
        renderSel();
        return;
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual order could not be created.");
        return;
      }
    }

    if (existing && window.DartOrdersApi?.updateManual) {
      try {
        await window.DartOrdersApi.updateManual(
          existing.orderId || existing.id,
          {
            ...(selectedClientId && selectedClientId !== "-"
              ? { clientId: selectedClientId }
              : {}),
            clientName: payload.clientName,
            phone1: payload.phone1,
            ...(payload.phone2 && payload.phone2 !== "-" ? { phone2: payload.phone2 } : {}),
            ...(payload.email && payload.email !== "-" ? { email: payload.email } : {}),
            paymentMethod: payload.paymentMethod,
            paymentStatus: payload.paymentStatus,
            amountPaid: payload.amountPaid,
            amountRefunded: payload.amountRefunded,
            orderSource: payload.orderSource,
            deliveryNotes: payload.deliveryNotes,
            itemCodes: [...selected],
            discountPercent: prices.pct,
            country: payload.country,
            governorate: payload.governorate,
            area: payload.area,
            street: payload.street,
            building: payload.building,
            floor: payload.floor,
          },
        );
        if (window.DartCatalog?.hydrate) await window.DartCatalog.hydrate(true);
        dartRefreshAll();
        closeModal(modal);
        form.reset();
        selected = [];
        renderSel();
        return;
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual order could not be updated.");
        return;
      }
    }

    if (existing) {
      const oldCodes = [...(existing.items || [])],
        newCodes = selected.filter((c) => !oldCodes.includes(c)),
        check = dartReserveItems(existing, newCodes);
      if (!check.ok) {
        window.DartDialog.alert(check.message);
        return;
      }
      oldCodes
        .filter((c) => !selected.includes(c))
        .forEach((c) => {
          const it = dartFindItemByCode(c);
          if (it && it.status === "Processing/Held") {
            it.status = "In stock";
            it.orderId = "";
          }
        });
      const old = { ...existing };
      Object.assign(existing, payload);
      existing.priceSnapshot = dartPriceSnapshotForCodes(selected);
      dartAudit("EDIT", "orders", existing.id, old, payload);
      dartLogOrder(existing, "ORDER_EDITED", existing.status, existing.status, {
        notes: "Order details edited",
      });
    } else {
      const order = {
        id: dartUid("ODB"),
        orderId: dartNextBusinessCode("K", ordersData, "orderId"),
        date: new Date().toLocaleDateString("en-GB"),
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: "New",
        createdAt: dartNowISO(),
        orderCreatedAt: dartNowISO(),
        activityLog: [],
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...payload,
      };
      const r = dartReserveItems(order, selected);
      if (!r.ok) {
        window.DartDialog.alert(r.message);
        return;
      }
      order.priceSnapshot = dartPriceSnapshotForCodes(selected);
      dartLogOrder(order, "ORDER_CREATED", null, "New");
      ordersData.push(order);
      dartAudit("CREATE", "orders", order.id, {}, order);
      dartNotify(
        "new_order",
        `New order ${order.orderId}`,
        `${order.clientName} — ${selected.length} item(s)`,
        "orders",
        order.id,
      );
    }
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
    form.reset();
    selected = [];
    renderSel();
  });
}

function dartUpdateFilterSummary(key, count, total) {
  const section=document.getElementById(key), panel=section?.querySelector('.dart-filter-summary');
  if(!panel)return;
  panel.replaceChildren();
  const status=document.createElement('span');status.className='dart-filter-count';status.textContent=`${count} of ${total} records`;panel.append(status);
  const state=dartFilterState[key]||{};
  const search=section.querySelector('.search-box input,.search-bar input');
  if(state.search){const chip=document.createElement('button');chip.type='button';chip.textContent=`Search: ${search.value} ×`;chip.addEventListener('click',()=>{search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));});panel.append(chip);}
  section.querySelectorAll('.filter-bar select[data-filter-key]').forEach(select=>{
    const filter=select.dataset.filterKey,value=select.value;
    if(!value||value==='all'||(filter==='archive'&&value==='active'))return;
    const chip=document.createElement('button');chip.type='button';chip.textContent=`${select.selectedOptions[0]?.textContent||value} ×`;chip.setAttribute('aria-label',`Clear ${select.getAttribute('aria-label')||filter}`);
    chip.addEventListener('click',()=>{select.value=filter==='archive'?'active':select.dataset.dartAllValue??'all';select.dispatchEvent(new Event('change',{bubbles:true}));});panel.append(chip);
  });
}

function setupSearchFilter() {
  document.querySelectorAll(".dashboard-section").forEach((sec) => {
    const key = sec.id;
    if (!sectionsMap[key]) return;
    dartFilterState[key] = dartFilterState[key] || { archive: "active" };
    const search = sec.querySelector(".search-box input,.search-bar input");
    if (search && !search.dataset.dartBound) {
      search.dataset.dartBound = "1";
      search.addEventListener("input", () => {
        dartFilterState[key].search = search.value.toLowerCase().trim();
        dartRenderSection(key);
      });
    }
    const selects = [...sec.querySelectorAll(".filter-bar select")],
      maps = {
        models: ["category", "status", "priceRange"],
        items: ["category", "status", "sizeProfile", "size", "color"],
        customers: ["monthlyOrders", "dartCard", "birthday"],
        orders: ["date", "status", "totalPrice"],
        returns: ["reason", "status"],
        review: ["rating", "status", "source"],
        representative: ["status"],
        card: ["status"],
        damage: ["status", "archive"],
      };
    (maps[key] || []).forEach((f, i) => {
      if (selects[i] && !selects[i].dataset.filterKey)
        selects[i].dataset.filterKey = f;
    });
    if (
      !selects.some((s) => s.dataset.filterKey === "archive") &&
      !["brand"].includes(key)
    ) {
      const wrap = document.createElement("div");
      wrap.className = "select-box";
      wrap.innerHTML =
        '<select data-filter-key="archive"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select><i class="bx bx-chevron-down arrow-icon"></i>';
      sec
        .querySelector(".filter-bar")
        ?.insertBefore(wrap, sec.querySelector(".filter-bar .add-btn"));
    }
    sec.querySelectorAll(".filter-bar select").forEach((sel) => {
      const keyLabel={date:'Dates',status:'Statuses',category:'Categories',size:'Sizes',sizeProfile:'Size systems',color:'Colors',priceRange:'Prices',dartCard:'Dart Cards',birthday:'Birthdays',reason:'Reasons',source:'Sources',archive:'Records',rating:'Rating order',monthlyOrders:'Order count sorting',totalPrice:'Amount sorting'}[sel.dataset.filterKey]||'Options';
      sel.setAttribute('aria-label',keyLabel);
      if(sel.dataset.filterKey!=='archive'){
        let all=[...sel.options].find(option=>!option.disabled&&(option.value==='all'||option.value===''));
        if(!all){all=new Option(`All ${keyLabel.toLowerCase()}`,'all');sel.add(all,0);if(!dartFilterState[key][sel.dataset.filterKey])sel.value='all';}
        if(/^None$/i.test(all.textContent.trim()))all.textContent=`All ${keyLabel.toLowerCase()}`;
        sel.dataset.dartAllValue=all.value;
      }
      sel.querySelector('option[value="up"]')?.replaceChildren(document.createTextNode(/sorting|order/.test(keyLabel)?'Highest first':'Ascending'));
      sel.querySelector('option[value="low"]')?.replaceChildren(document.createTextNode(/sorting|order/.test(keyLabel)?'Lowest first':'Descending'));
      if (sel.dataset.dartBound) return;
      sel.dataset.dartBound = "1";
      sel.addEventListener("change", () => {
        const f = sel.dataset.filterKey;
        if (f) dartFilterState[key][f] = sel.value;
        if (key === "items" && f === "sizeProfile")
          dartPopulateItemSizeFilter(sel.value);
        dartRenderSection(key);
      });
    });
    const bar=sec.querySelector('.filter-bar');
    if(bar&&!bar.querySelector('.dart-clear-filters')){
      const clear=document.createElement('button');clear.type='button';clear.className='dart-clear-filters';clear.textContent='Clear Filters';bar.append(clear);
      const summary=document.createElement('div');summary.className='dart-filter-summary';summary.setAttribute('aria-live','polite');bar.after(summary);
      clear.addEventListener('click',()=>{
        dartFilterState[key]={archive:'active'};
        if(search)search.value='';
        sec.querySelectorAll('.filter-bar select[data-filter-key]').forEach(select=>{const field=select.dataset.filterKey;select.value=field==='archive'?'active':select.dataset.dartAllValue??'all';dartFilterState[key][field]=select.value;});
        if(key==='items')dartPopulateItemSizeFilter('all');
        dartRenderSection(key);
      });
    }
    if(search)search.placeholder={orders:'Search order, client, phone or item code',customers:'Search client, phone or email',models:'Search model name or code',items:'Search item or model code'}[key]||`Search ${key}`;
  });
  dartPopulateItemSizeFilter(
    document.getElementById("item-size-profile-filter")?.value || "all",
  );
}
function dartPopulateItemSizeFilter(profile) {
  const sel = document.getElementById("item-size-filter");
  if (!sel) return;
  const sizes =
    profile === "pants"
      ? DART_PANTS_SIZES
      : profile === "tops"
        ? DART_TOP_SIZES
        : [
            ...new Set([
              ...DART_PANTS_SIZES,
              ...DART_TOP_SIZES,
              ...itemsData.map((i) => String(i.size || "")).filter(Boolean),
            ]),
          ];
  const old = sel.value;
  sel.innerHTML =
    '<option value="all">All Sizes</option>' +
    sizes
      .map((s) => `<option value="${dartEsc(s)}">${dartEsc(s)}</option>`)
      .join("");
  if ([...sel.options].some((o) => o.value === old)) sel.value = old;
}

// Enhance Audit History to show what changed, not only the action name.
async function dartShowAuditFor(type, id) {
  const body = document.getElementById("history-modal-body");
  document.getElementById("history-modal-title").textContent =
    `Audit History — ${type}`;
  let rows = auditData.filter(
    (a) => a.entityType === type && String(a.entityId) === String(id),
  );
  if (window.DartDomainState?.auditFor) {
    try {
      rows = await window.DartDomainState.auditFor(type, id);
    } catch (error) {
      console.warn("Dart audit history request failed; using cached history.", error);
    }
  }
  body.innerHTML = `<div class="dart-timeline">${
    rows
      .map((a) => {
        const keys = [
          ...new Set([
            ...Object.keys(a.oldValues || {}),
            ...Object.keys(a.newValues || {}),
          ]),
        ].filter(
          (k) =>
            JSON.stringify(a.oldValues?.[k]) !==
            JSON.stringify(a.newValues?.[k]),
        );
        const changes = keys
          .map(
            (k) =>
              `<div><b>${dartEsc(k)}:</b> ${dartEsc(a.oldValues?.[k] ?? "-")} → ${dartEsc(a.newValues?.[k] ?? "-")}</div>`,
          )
          .join("");
        return `<div class="dart-timeline-item"><b>${dartEsc(a.action)}</b>${changes || `<div>${dartEsc(a.note || a.metadata?.message || "No field details")}</div>`}<small>${dartEsc(new Date(a.timestamp).toLocaleString())}</small></div>`;
      })
      .join("") || '<div class="dart-empty-state">No audit entries yet</div>'
  }</div>`;
  openModal(document.getElementById("history-modal"));
}

// V3 UI-only binding that does not depend on backend connectivity.
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".dart-info-btn");
    if (!b) return;
    window.DartDialog.alert(`${b.dataset.infoTitle}\n\n${b.dataset.infoText}`);
  });
  renderBirthdayWidget();
  renderTopClients();
  renderNotifications();
  updateBrandAnalytics();
});

// Keep the dashboard synchronized when a representative completes a delivery
// or return pickup in another browser tab.
