/* BEGIN INVENTORY UI — نوافذ التصميم والقطعة وعروض المجموعات.
 * Reads/writes existing dashboard arrays; DartCatalog owns derived stock/media.
 * BACKEND: replace persistence at dartSaveAll/repositories, not individual rows.
 */
(function () {
  "use strict";
  const C = DartCatalog,
    $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const state = { view: "groups", group: null, limit: 60, scroll: 0 };
  let draft = { sizes: [], colors: [] },
    uploads = 0;
  const stamp = () => new Date().toISOString();
  // BEGIN View switching. First/filter-bar and second are never replaced.
  function initViews() {
    const sec = $("items");
    if (!sec || sec.dataset.viewsReady) return;
    sec.dataset.viewsReady = "1";
    const all = sec.querySelector(".cont-titel");
    all.classList.add("all-items");
    all.id = "all-items-view";
    const header = all.querySelector(".title-name").cloneNode(true);
    const groups = document.createElement("div");
    groups.id = "groups-view";
    groups.className = "cont-titel groups";
    const columns = [
      "Photo",
      "Model Code",
      "Model Name",
      "Color",
      "Size",
      "Total",
      "In Stock",
      "Reserved",
      "Processing",
      "With Rep",
      "Sold",
      "Refused / Inspection",
      "Damaged / Repair",
      "Low Stock",
    ];
    groups.innerHTML =
      '<div class="title-name">' +
      columns.map((c) => `<h2 class="w150">${c}</h2>`).join("") +
      '</div><div id="groups-container"></div>';
    const detail = document.createElement("div");
    detail.id = "items-groups-view";
    detail.className = "cont-titel items-groups";
    detail.innerHTML =
      '<div class="group-heading"><button type="button" id="back-to-groups">← Groups</button><strong id="group-title"></strong></div>';
    detail.append(header);
    all.after(groups, detail);
    const buttons = document.createElement("div");
    buttons.className = "inventory-view-buttons";
    buttons.innerHTML =
      '<button type="button" data-item-view="groups">Groups</button><button type="button" data-item-view="all">All Items</button>';
    sec.querySelector(".second").append(buttons);
    buttons.addEventListener("click", (e) => {
      const b = e.target.closest("[data-item-view]");
      if (b) switchView(b.dataset.itemView);
    });
    $("back-to-groups").onclick = () => switchView("groups");
    groups.addEventListener("click", (e) => {
      const r = e.target.closest("[data-group-key]");
      if (r) {
        state.scroll = groups.scrollTop;
        state.group = r.dataset.groupKey;
        switchView("detail");
      }
    });
    groups.addEventListener("keydown", (e) => {
      if (
        ["Enter", " "].includes(e.key) &&
        e.target.matches("[data-group-key]")
      ) {
        e.preventDefault();
        e.target.click();
      }
    });
    switchView("groups");
  }
  function switchView(view) {
    state.view = view;
    state.limit = 60;
    if (view === "all") state.group = null;
    renderItems();
    if (view === "groups") $("groups-view").scrollTop = state.scroll;
  }
  function visibleItems() {
    if (state.view === "groups") return [];
    let rows = dartApplyFilters("items", itemsData);
    if (state.view === "detail")
      rows = rows.filter((i) => C.groupKey(i) === state.group);
    else
      rows = rows.filter((i) => !["Damaged", "Destroyed"].includes(i.status));
    return rows
      .sort((a, b) =>
        String(b.createdAt || b.regDate || "").localeCompare(
          String(a.createdAt || a.regDate || ""),
        ),
      )
      .slice(0, state.limit);
  }
  function updateMaster() {
    const sec = $("items");
    if (!sec) return;
    const rows = visibleItems().filter(C.active),
      selected = rows.filter((i) => i.isChecked);
    sec.querySelectorAll('.title-name input[type="checkbox"]').forEach((m) => {
      m.checked = rows.length > 0 && selected.length === rows.length;
      m.indeterminate = selected.length > 0 && selected.length < rows.length;
    });
  }
  function rowMarkup(i) {
    const archived = !C.active(i),
      src = C.cover(
        modelsData.find((m) => m.modelId === i.modelId),
        i.color,
      );
    return `<div class="${getRowClass(i)}" data-id="${esc(i.id)}"><input type="checkbox" class="model-checkbox" ${i.isChecked ? "checked" : ""} ${archived ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete" title="${archived ? "Restore" : "Archive"}"><i class="bx ${archived ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete" title="Delete permanently"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit" title="Edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="items" title="History"><i class="bx bx-history"></i></button></div><div class="w100"><img loading="lazy" src="${esc(src)}" alt="${esc(i.modelId + " " + i.color)}" class="product-img dart-item-thumb" data-full-image="${esc(src)}"></div>${["modelId", "itemCode", "color", "size", "status", "regDate", "orderId", "clientName", "clientId", "phone1", "phone2", "email", "purchaseDate"].map((k) => `<span class="text-item ${["regDate", "clientName"].includes(k) ? "w200" : k === "phone2" ? "w300" : "w150"}">${esc(i[k] || "-")}</span>`).join("")}</div>`;
  }
  function renderItems() {
    if (!$("groups-view")) return;
    const isGroups = state.view === "groups",
      isDetail = state.view === "detail";
    $("all-items-view").hidden = state.view !== "all";
    $("groups-view").hidden = !isGroups;
    $("items-groups-view").hidden = !isDetail;
    const container = $("items-container");
    (isDetail ? $("items-groups-view") : $("all-items-view")).append(container);
    $("items").querySelector(".second .delete-btn").disabled = isGroups;
    document.querySelectorAll("[data-item-view]").forEach((b) => {
      b.classList.toggle(
        "active",
        b.dataset.itemView === (isGroups || isDetail ? "groups" : "all"),
      );
      b.setAttribute("aria-pressed", String(b.classList.contains("active")));
    });
    if (isGroups) {
      container.replaceChildren();
      const matching = new Set(
        dartApplyFilters("items", itemsData).map(C.groupKey),
      );
      const groups = C.groups(itemsData, modelsData, ordersData).filter((g) =>
        matching.has(g.key),
      );
      $("groups-container").innerHTML =
        groups
          .slice(0, state.limit)
          .map(
            (g) =>
              `<div class="group-row" role="button" tabindex="0" data-group-key="${esc(g.key)}"><div class="w150"><img loading="lazy" class="product-img" alt="${esc(g.color)}" src="${esc(g.image)}"></div>${["modelId", "name", "color", "size", "total", "stock", "reserved", "processing", "withRep", "sold", "refused", "damaged"].map((k) => `<span class="w150">${esc(g[k])}</span>`).join("")}<span class="w150"><span class="stock-badge ${g.stock === 0 ? "empty" : g.stock <= g.limit ? "low" : "normal"}">${g.stock === 0 ? "Sold Out" : g.stock <= g.limit ? "Low Stock" : "Available"}</span></span></div>`,
          )
          .join("") || '<p class="dart-empty-state">No item groups yet.</p>';
      if (groups.length > state.limit) addMore($("groups-container"));
    } else {
      const rows = visibleItems();
      container.innerHTML =
        rows.map(rowMarkup).join("") ||
        '<p class="dart-empty-state">No items match these filters.</p>';
      if (isDetail) {
        const parts = JSON.parse(state.group);
        $("group-title").textContent =
          `${parts[0]} / ${parts[1]} / ${parts[2]}`;
      }
      let total = dartApplyFilters("items", itemsData).filter((i) =>
        isDetail
          ? C.groupKey(i) === state.group
          : !["Damaged", "Destroyed"].includes(i.status),
      ).length;
      if (total > state.limit) addMore(container);
      updateMaster();
    }
  }
  function addMore(container) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "inventory-load-more";
    b.textContent = "Load more";
    b.onclick = () => {
      state.limit += 60;
      renderItems();
    };
    container.append(b);
  }
  // END View switching and shared physical-item row template.

  // BEGIN Model editor. Editable color galleries own media; items contain references.
  function setupModelModal() {
    initViews();
    const form = $("model-form");
    if (!form || form.dataset.catalogReady) return;
    form.dataset.catalogReady = "1";
    const discountGroup = $("modal-discount").closest(".form-group");
    const editor = document.createElement("div");
    editor.className = "model-options-editor";
    editor.innerHTML = `<div class="form-group"><label>Sizes</label><div class="option-entry"><input id="new-model-size" placeholder="M, XL, 32…"><button type="button" id="add-model-size">Add</button></div><div id="model-size-tags" class="option-tags"></div></div><div class="form-group"><label>Colors & images</label><div class="option-entry"><input id="new-model-color" placeholder="White"><button type="button" id="add-model-color">Add</button></div><div id="model-color-editors"></div></div><div class="form-group"><label for="model-low-stock">Low stock limit per color / size</label><input type="number" min="0" step="1" value="5" id="model-low-stock"></div><p id="catalog-form-status" role="status"></p>`;
    discountGroup.before(editor);
    editor.before(
      $("modal-cost").closest(".form-group"),
      $("modal-selling").closest(".form-group"),
    );
    const calc = () => {
      const cost = Number($("modal-cost").value) || 0,
        selling = Number($("modal-selling").value) || 0,
        discount = Number($("modal-discount").value) || 0;
      $("modal-final-price").textContent =
        `${Math.trunc(selling * (1 - discount / 100))} EGP`;
    };
    $("modal-cost").oninput = () => {
      $("modal-selling").value = String(Number($("modal-cost").value) * 1.5);
      calc();
    };
    $("modal-selling").oninput = calc;
    $("modal-discount").oninput = calc;
    $("modal-discount").min = 0;
    $("modal-discount").max = 100;
    $("modal-discount").step = "any";
    for (const id of ["modal-cost", "modal-selling"]) {
      $(id).min = 0;
      $(id).step = "any";
    }
    document
      .querySelector("#models .add-btn")
      .addEventListener("click", () => openEditor(null, "models"));
    $("add-model-size").onclick = () => addOption("sizes", "new-model-size");
    $("add-model-color").onclick = () => addOption("colors", "new-model-color");
    for (const [id, kind] of [
      ["new-model-size", "sizes"],
      ["new-model-color", "colors"],
    ])
      $(id).onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addOption(kind, id);
        }
      };
    editor.addEventListener("click", (e) => {
      const b = e.target.closest("[data-option-action]");
      if (!b) return;
      const kind = b.dataset.kind,
        index = Number(b.dataset.index),
        entry = draft[kind][index];
      if (b.dataset.optionAction === "toggle") {
        entry.active = entry.active === false;
        renderOptions();
        return;
      }
      if (b.dataset.optionAction === "remove") {
        const m = modelsData.find((m) => m.id === $("modal-edit-id").value),
          field = kind === "colors" ? "color" : "size";
        const linked =
          m &&
          (itemsData.some(
            (i) => i.modelId === m.modelId && String(i[field]) === entry.name,
          ) ||
            ordersData.some((o) =>
              (o.priceSnapshot || []).some(
                (l) =>
                  l.modelCode === m.modelId && String(l[field]) === entry.name,
              ),
            ));
        if (linked) {
          entry.active = false;
          $("catalog-form-status").textContent =
            "This option has linked records. It has been archived in this draft; save to apply.";
        } else draft[kind].splice(index, 1);
      }
      if (b.dataset.optionAction === "cover") {
        const image = entry.images.splice(Number(b.dataset.image), 1)[0];
        entry.images.unshift(image);
      }
      if (b.dataset.optionAction === "remove-image")
        entry.images.splice(Number(b.dataset.image), 1);
      renderOptions();
    });
    editor.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-upload-color]")) return;
      const entry = draft.colors[Number(e.target.dataset.uploadColor)],
        files = [...e.target.files];
      uploads++;
      $("btn-submit-modal").disabled = true;
      try {
        for (const file of files) entry.images.push(await C.saveImage(file));
        $("catalog-form-status").textContent = "Images ready.";
      } catch (error) {
        $("catalog-form-status").textContent = error.message;
      } finally {
        uploads--;
        $("btn-submit-modal").disabled = uploads > 0;
        renderOptions();
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (uploads) return;
      const id = $("modal-edit-id").value,
        old = modelsData.find((m) => m.id === id),
        code = $("modal-id").value.trim();
      if (
        modelsData.some(
          (m) => C.norm(m.modelId) === C.norm(code) && m.id !== id,
        )
      )
        return alert("Model Code already exists.");
      if (!draft.sizes.some(C.active) || !draft.colors.some(C.active))
        return alert("Add at least one active size and color.");
      const payload = {
        modelId: code,
        name: $("modal-name").value.trim(),
        category: $("modal-category").value,
        description: $("modal-description").value,
        cost: Number($("modal-cost").value),
        selling: Number($("modal-selling").value),
        discount: Number($("modal-discount").value) || 0,
        lowStockLimit: Number($("model-low-stock").value),
        sizeOptions: structuredClone(draft.sizes),
        colorOptions: structuredClone(draft.colors),
        updatedAt: stamp(),
      };
      payload.discountedPrice = C.price(payload);
      payload.colors = payload.colorOptions
        .filter(C.active)
        .map((c) => c.name)
        .join(", ");
      payload.sizes = payload.sizeOptions
        .filter(C.active)
        .map((s) => s.name)
        .join(" ");
      if (old) {
        const before = structuredClone(old);
        Object.assign(old, payload);
        dartAudit("EDIT", "models", old.id, before, payload);
      } else {
        const m = {
          id: C.uid(),
          status: "Active",
          date: new Date().toLocaleDateString("en-GB"),
          createdAt: stamp(),
          isArchived: false,
          isDeleted: false,
          isChecked: false,
          ...payload,
        };
        modelsData.push(m);
        dartAudit("CREATE", "models", m.id, {}, payload);
      }
      dartSaveAll();
      dartRefreshAll();
      refreshFilters();
      closeModal($("model-modal"));
      window.dispatchEvent(
        new CustomEvent("dart:data-changed", {
          detail: { key: "dart_models" },
        }),
      );
    });
  }
  function addOption(kind, id) {
    const name = $(id).value.trim();
    if (!name) return;
    if (draft[kind].some((x) => C.norm(x.name) === C.norm(name)))
      return alert("Already added.");
    draft[kind].push({
      id: C.uid(),
      name,
      active: true,
      ...(kind === "colors" ? { images: [] } : {}),
    });
    $(id).value = "";
    renderOptions();
  }
  function renderOptions() {
    $("model-size-tags").innerHTML = draft.sizes
      .map(
        (s, i) =>
          `<span class="option-tag ${s.active === false ? "archived-option" : ""}">${esc(s.name)} <button type="button" data-option-action="${s.active === false ? "toggle" : "remove"}" data-kind="sizes" data-index="${i}">${s.active === false ? "Restore" : "×"}</button></span>`,
      )
      .join("");
    $("model-color-editors").innerHTML = draft.colors
      .map(
        (c, i) =>
          `<div class="color-editor ${c.active === false ? "archived-option" : ""}"><div class="color-editor-heading"><strong>${esc(c.name)}</strong><button type="button" data-option-action="${c.active === false ? "toggle" : "remove"}" data-kind="colors" data-index="${i}">${c.active === false ? "Restore" : "Remove / Archive"}</button></div><input aria-label="${esc(c.name)} images" type="file" multiple accept="image/jpeg,image/png,image/webp" data-upload-color="${i}"><div class="color-images">${(c.images || []).map((img, j) => `<figure><img alt="${esc(c.name)} ${j + 1}" src="${esc(C.imageSrc(img))}"><figcaption><button type="button" data-option-action="cover" data-kind="colors" data-index="${i}" data-image="${j}">${j === 0 ? "Cover" : "Set cover"}</button><button aria-label="Remove image" type="button" data-option-action="remove-image" data-kind="colors" data-index="${i}" data-image="${j}">×</button></figcaption></figure>`).join("")}</div>${!c.images.length ? "<small>No separate website card until an image is added. This color can still be purchased from the product window.</small>" : ""}</div>`,
      )
      .join("");
  }
  // END Model editor.

  // BEGIN Item editor: four fields, validated against the chosen model.
  function setupItemModal() {
    const form = $("item-add-form");
    if (!form || form.dataset.catalogReady) return;
    form.dataset.catalogReady = "1";
    const file = $("modal-item-file");
    file?.closest(".form-group").remove();
    for (const id of ["modal-item-color", "modal-item-size"]) {
      const old = $(id),
        s = document.createElement("select");
      s.id = id;
      s.required = true;
      old.replaceWith(s);
    }
    const code = $("modal-item-model-id");
    code.addEventListener("input", () => populateItemOptions());
    document
      .querySelector("#items .add-btn")
      .addEventListener("click", () => openEditor(null, "items"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("modal-item-add-edit-id").value,
        old = itemsData.find((i) => i.id === id),
        m = modelsData.find((m) => m.modelId === code.value.trim());
      const itemCode = $("modal-item-code-pic").value.trim(),
        color = $("modal-item-color").value,
        size = $("modal-item-size").value;
      if (
        !C.active(m) ||
        !C.colors(m).some((c) => C.active(c) && c.name === color) ||
        !C.sizes(m).some((s) => C.active(s) && s.name === size)
      )
        return alert("Choose an active model, color and size.");
      if (
        itemsData.some(
          (i) => C.norm(i.itemCode) === C.norm(itemCode) && i.id !== id,
        )
      )
        return alert("Item Code already exists.");
      if (
        old &&
        (old.orderId || old.status === "Sold") &&
        (old.modelId !== m.modelId ||
          old.color !== color ||
          old.size !== size ||
          old.itemCode !== itemCode)
      )
        return alert(
          "A piece linked to an order keeps its identity and options.",
        );
      const payload = {
        modelId: m.modelId,
        itemCode,
        color,
        size,
        updatedAt: stamp(),
      };
      if (old) {
        const before = { ...old };
        Object.assign(old, payload);
        dartAudit("EDIT", "items", old.id, before, payload);
      } else {
        const it = {
          id: C.uid(),
          status: "In stock",
          createdAt: stamp(),
          regDate: new Date().toLocaleDateString("en-GB"),
          isArchived: false,
          isDeleted: false,
          isChecked: false,
          ...payload,
        };
        itemsData.push(it);
        dartAudit("CREATE", "items", it.id, {}, payload);
      }
      dartSaveAll();
      dartRefreshAll();
      refreshFilters();
      closeModal($("item-add-modal"));
      window.dispatchEvent(
        new CustomEvent("dart:data-changed", { detail: { key: "dart_items" } }),
      );
    });
  }
  function populateItemOptions(color = "", size = "") {
    const m = modelsData.find(
      (m) => m.modelId === $("modal-item-model-id").value.trim(),
    );
    for (const [id, options, value] of [
      ["modal-item-color", C.colors(m), color],
      ["modal-item-size", C.sizes(m), size],
    ]) {
      $(id).innerHTML =
        '<option value="">Choose…</option>' +
        options
          .filter(C.active)
          .map((o) => `<option value="${esc(o.name)}">${esc(o.name)}</option>`)
          .join("");
      $(id).value = value;
    }
  }
  function openEditor(id, key) {
    if (key === "models") {
      const m = modelsData.find((m) => m.id === id);
      $("model-form").reset();
      $("modal-edit-id").value = id || "";
      draft = {
        sizes: structuredClone(C.sizes(m)),
        colors: structuredClone(C.colors(m)),
      };
      for (const [field, k] of [
        ["modal-id", "modelId"],
        ["modal-name", "name"],
        ["modal-category", "category"],
        ["modal-description", "description"],
        ["modal-cost", "cost"],
        ["modal-selling", "selling"],
        ["modal-discount", "discount"],
        ["model-low-stock", "lowStockLimit"],
      ])
        $(field).value =
          m?.[k] ?? (k === "discount" ? 0 : k === "lowStockLimit" ? 5 : "");
      $("modal-id").readOnly = Boolean(
        m &&
        (itemsData.some((i) => i.modelId === m.modelId) ||
          ordersData.some((o) =>
            (o.priceSnapshot || []).some((l) => l.modelCode === m.modelId),
          )),
      );
      if (m)
        C.loadModelImages(m.modelId).then(() => {
          if ($("modal-edit-id").value === id) renderOptions();
        });
      $("modal-final-price").textContent = `${Math.trunc(C.price(m))} EGP`;
      $("catalog-form-status").textContent = "";
      renderOptions();
      openModal($("model-modal"));
    } else {
      const i = itemsData.find((i) => i.id === id);
      $("item-add-form").reset();
      $("modal-item-add-edit-id").value = id || "";
      populateModelsDatalist();
      $("modal-item-model-id").value = i?.modelId || "";
      $("modal-item-code-pic").value = i?.itemCode || "";
      populateItemOptions(i?.color, i?.size);
      openModal($("item-add-modal"));
    }
  }
  // END Item editor.
  function refreshFilters() {
    const sel = document.querySelector('#items [data-filter-key="color"]');
    if (sel) {
      const old = sel.value;
      sel.innerHTML =
        '<option value="all">All Colors</option>' +
        [...new Set(modelsData.flatMap((m) => C.colors(m).map((c) => c.name)))]
          .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
          .join("");
      sel.value = [...sel.options].some((o) => o.value === old) ? old : "all";
    }
  }
  function checkStockAlerts() {
    const groups = C.groups(itemsData, modelsData, ordersData).filter((g) =>
      C.active(modelsData.find((m) => m.modelId === g.modelId)),
    );
    const low = new Set(
      groups
        .filter((g) => g.stock <= g.limit)
        .map((g) => "group-stock:" + g.key),
    );
    notificationData
      .filter((n) => n.dedupeKey?.startsWith("group-stock:"))
      .forEach((n) => {
        n.resolved = !low.has(n.dedupeKey);
      });
    groups
      .filter((g) => g.stock <= g.limit)
      .forEach((g) => {
        const key = "group-stock:" + g.key;
        let n = notificationData.find(
          (n) => n.dedupeKey === key && !n.resolved,
        );
        if (!n) {
          n = {
            id: C.uid(),
            type: "low_stock",
            timestamp: stamp(),
            read: false,
            resolved: false,
            severity: "warning",
            dedupeKey: key,
            relatedEntityType: "items",
          };
          notificationData.unshift(n);
        }
        n.title = `${g.modelId} / ${g.color} / ${g.size}`;
        n.message = `${g.stock} available — threshold ${g.limit}`;
      });
  }
  window.DartInventory = {
    setupModelModal,
    setupItemModal,
    openEditor,
    renderItems,
    visibleItems,
    updateMaster,
    checkStockAlerts,
    refreshFilters,
    state,
  };
  window.addEventListener("dart:images-ready", () => {
    if ($("groups-view")) {
      renderItems();
      renderModels(modelsData);
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    refreshFilters();
  });
})();
/* END INVENTORY UI */
