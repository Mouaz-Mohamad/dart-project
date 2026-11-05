/* Dart Eye — Shipping Companies subnavigation and compact management UI.
 * Presentation only: requests, version checks, coverage rules and shipment commands
 * remain owned by dart-shipping.js and the backend.
 */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const companyState = { list: [], catalog: new Map(), editButtons: new Map(), activeTab: "companies", returnFocus: null };
  const make = (tag, className, content) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = String(content);
    return el;
  };
  const regions = company => [...new Set([
    ...Object.keys(company.coverage || {}),
    ...(Array.isArray(company.governorates) ? company.governorates : [])
  ])];
  const regionName = id => companyState.catalog.get(id) || id;
  const safeText = value => String(value || "").trim().toLocaleLowerCase();

  function setTab(name, focus = false) {
    const tab = byId("shipping-tab-" + name);
    const panel = byId("shipping-panel-" + name);
    if (!tab || !panel) return;
    companyState.activeTab = name;
    document.querySelectorAll("#shipping .dart-shipping-tab").forEach(button => {
      const selected = button === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-active", selected);
    });
    document.querySelectorAll("#shipping .dart-shipping-panel").forEach(item => {
      item.hidden = item !== panel;
    });
    if (focus) tab.focus();
  }

  function fillSelect(id, choices, label) {
    const select = byId(id);
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option(label, ""));
    for (const item of choices) select.add(new Option(item.label, item.value));
    select.value = choices.some(item => item.value === selected) ? selected : "";
  }

  function applyCompanyFilters() {
    const query = safeText(byId("shipping-filter-search")?.value);
    const status = byId("shipping-filter-status")?.value || "";
    const checkout = byId("shipping-filter-checkout")?.value || "";
    const governorate = byId("shipping-filter-governorate")?.value || "";
    let count = 0;
    for (const company of companyState.list) {
      const row = byId("shipping-company-row-" + company.id);
      if (!row) continue;
      const matches = (!query || safeText(company.name).includes(query)) &&
        (!status || String(Boolean(company.active)) === status) &&
        (!checkout || String(Boolean(company.checkoutEnabled)) === checkout) &&
        (!governorate || regions(company).includes(governorate));
      row.hidden = !matches;
      if (matches) count++;
    }
    const total = byId("shipping-company-results-count");
    if (total) total.textContent = count + " / " + companyState.list.length + " companies";
    const empty = byId("shipping-company-empty");
    if (empty) {
      empty.hidden = count > 0;
      empty.textContent = companyState.list.length ? "No companies match these filters." : "No shipping companies yet. Use Add Company to get started.";
    }
  }

  function setStats() {
    const all = companyState.list;
    const update = (id, value) => { if (byId(id)) byId(id).textContent = String(value); };
    update("shipping-stat-total", all.length);
    update("shipping-stat-active", all.filter(company => company.active).length);
    update("shipping-stat-inactive", all.filter(company => !company.active).length);
  }

  function openEditor(mode = "add") {
    const overlay = byId("shipping-company-overlay");
    if (!overlay) return false;
    companyState.returnFocus = document.activeElement;
    const title = byId("shipping-editor-title");
    if (title) title.textContent = mode === "edit" ? "Edit Company" : "Add Company";
    overlay.hidden = false;
    document.body.classList.add("dart-shipping-editor-open");
    byId("shipping-company-name")?.focus();
    return true;
  }

  function closeEditor() {
    const overlay = byId("shipping-company-overlay");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove("dart-shipping-editor-open");
    if (companyState.returnFocus?.isConnected) companyState.returnFocus.focus();
    companyState.returnFocus = null;
  }

  function editCompany(id) {
    const oldEdit = companyState.editButtons.get(id);
    if (oldEdit) oldEdit.click(); // Existing edit handler populates the verified coverage picker.
  }

  function renderCoverage() {
    const target = byId("shipping-coverage-list");
    if (!target) return;
    target.replaceChildren();
    if (!companyState.list.length) {
      target.append(make("p", "dart-shipping-empty", "No shipping companies have been added yet."));
      return;
    }
    for (const company of companyState.list) {
      const card = make("article", "dart-shipping-coverage-card");
      const head = make("div", "dart-shipping-coverage-head");
      const name = make("strong", "", company.name);
      const status = make("span", "dart-shipping-badge " + (company.active ? "is-active" : "is-inactive"), company.active ? "Active" : "Inactive");
      head.append(name, status);
      const ids = regions(company);
      card.append(head, make("p", "dart-shipping-coverage-summary",
        ids.length ? ids.map(regionName).join(" · ") : "No governorates selected"));
      card.append(make("small", "", (company.checkoutEnabled ? "Checkout enabled" : "Checkout disabled") + " · " + ids.length + " governorates"));
      const edit = make("button", "dart-shipping-secondary", "Manage Coverage");
      edit.type = "button";
      edit.addEventListener("click", () => editCompany(company.id));
      card.append(edit);
      target.append(card);
    }
  }

  function renderCompanies(companies, catalog = []) {
    const list = byId("shipping-companies-list");
    if (!list) return;
    companyState.list = (Array.isArray(companies) ? companies : []).filter(company => company.id !== "dart");
    if (Array.isArray(catalog)) {
      companyState.catalog = new Map(catalog.map(item => [item.id, item.ar || item.en || item.id]));
    }
    // Save the real edit callbacks before replacing legacy cards with compact rows.
    const originalButtons = [...list.children].map(row => row.querySelector("button"));
    companyState.editButtons.clear();
    companyState.list.forEach((company, index) => {
      if (originalButtons[index]) companyState.editButtons.set(company.id, originalButtons[index]);
    });
    list.replaceChildren();
    for (const company of companyState.list) {
      const row = make("div", "dart-shipping-company-row");
      row.id = "shipping-company-row-" + company.id;
      row.setAttribute("role", "row");
      const title = make("div", "dart-shipping-company-title");
      title.setAttribute("role", "cell");
      title.append(make("strong", "", company.name), make("small", "", company.id));
      const state = make("div", "", "");
      state.setAttribute("role", "cell");
      state.append(make("span", "dart-shipping-badge " + (company.active ? "is-active" : "is-inactive"), company.active ? "Active" : "Inactive"));
      const checkout = make("div", "", "");
      checkout.setAttribute("role", "cell");
      checkout.append(make("span", "dart-shipping-badge " + (company.checkoutEnabled ? "is-enabled" : "is-disabled"), company.checkoutEnabled ? "Enabled" : "Disabled"));
      const coverage = make("div", "dart-shipping-coverage-count", regions(company).length + " governorates");
      coverage.setAttribute("role", "cell");
      const actions = make("div", "dart-shipping-row-actions");
      actions.setAttribute("role", "cell");
      const view = make("button", "dart-shipping-secondary", "View / Edit");
      view.type = "button";
      view.addEventListener("click", () => editCompany(company.id));
      actions.append(view);
      row.append(title, state, checkout, coverage, actions);
      list.append(row);
    }
    fillSelect("shipping-filter-governorate",
      [...new Set(companyState.list.flatMap(regions))].sort().map(id => ({value: id, label: regionName(id)})),
      "All Governorates");
    fillSelect("shipping-shipment-company",
      companyState.list.map(company => ({value: company.id, label: company.name})),
      "All Companies");
    setStats();
    renderCoverage();
    applyCompanyFilters();
    applyShipmentFilters();
  }

  function applyShipmentFilters() {
    const rows = [...(byId("shipping-orders-list")?.querySelectorAll(".dart-shipping-row") || [])];
    const search = safeText(byId("shipping-shipment-search")?.value);
    const company = byId("shipping-shipment-company")?.value || "";
    const status = byId("shipping-shipment-status")?.value || "";
    let visible = 0;
    for (const row of rows) {
      const matched = (!search || safeText(row.dataset.search || row.textContent).includes(search)) &&
        (!company || row.dataset.companyId === company) &&
        (!status || row.dataset.orderStatus === status);
      row.hidden = !matched;
      if (matched) visible++;
    }
    if (byId("shipping-shipment-count")) byId("shipping-shipment-count").textContent =
      visible + " / " + rows.length + " shipments";
    const empty = byId("shipping-shipment-empty");
    if (empty) {
      empty.hidden = visible > 0;
      empty.textContent = rows.length ? "No shipments match these filters." : "No external shipments yet.";
    }
    const legacyEmpty = byId("shipping-orders-list");
    if (legacyEmpty && !rows.length) legacyEmpty.textContent = "";
  }

  function renderShipments() {
    const orders = (window.DartOrdersApi?.read?.() || [])
      .filter(order => order.deliveryShipment?.type === "external" && !order.isDeleted);
    const rows = [...(byId("shipping-orders-list")?.querySelectorAll(".dart-shipping-row") || [])];
    rows.forEach((row, index) => {
      const order = orders[index];
      if (!order) return;
      row.dataset.companyId = order.deliveryShipment.companyId || "";
      row.dataset.orderStatus = order.status || "";
      row.dataset.search = [order.orderId || order.id, order.deliveryShipment.companyName,
        order.deliveryShipment.trackingNumber, order.status].join(" ");
    });
    fillSelect("shipping-shipment-status",
      [...new Set(orders.map(order => order.status).filter(Boolean))].map(value => ({value, label: value})),
      "All Statuses");
    applyShipmentFilters();
  }

  function initialize() {
    document.querySelectorAll("#shipping .dart-shipping-tab").forEach((tab, index, all) => {
      tab.addEventListener("click", () => setTab(tab.dataset.shippingTab));
      tab.addEventListener("keydown", event => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 :
          (index + (event.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
        setTab(all[next].dataset.shippingTab, true);
      });
    });
    ["shipping-filter-search", "shipping-filter-status", "shipping-filter-checkout", "shipping-filter-governorate"]
      .forEach(id => byId(id)?.addEventListener("input", applyCompanyFilters));
    ["shipping-shipment-search", "shipping-shipment-company", "shipping-shipment-status"]
      .forEach(id => byId(id)?.addEventListener("input", applyShipmentFilters));
    byId("shipping-clear-filters")?.addEventListener("click", () => {
      ["shipping-filter-search", "shipping-filter-status", "shipping-filter-checkout", "shipping-filter-governorate"]
        .forEach(id => { if (byId(id)) byId(id).value = ""; });
      applyCompanyFilters();
    });
    byId("shipping-shipment-clear")?.addEventListener("click", () => {
      ["shipping-shipment-search", "shipping-shipment-company", "shipping-shipment-status"]
        .forEach(id => { if (byId(id)) byId(id).value = ""; });
      applyShipmentFilters();
    });
    byId("shipping-add-company")?.addEventListener("click", () => {
      byId("shipping-company-cancel")?.click(); // Existing reset also clears the coverage picker.
      openEditor("add");
    });
    byId("shipping-editor-close")?.addEventListener("click", closeEditor);
    byId("shipping-company-cancel")?.addEventListener("click", closeEditor);
    byId("shipping-company-overlay")?.addEventListener("click", event => {
      if (event.target === byId("shipping-company-overlay")) closeEditor();
    });
    document.addEventListener("keydown", event => {
      const overlay = byId("shipping-company-overlay");
      if (!overlay || overlay.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); closeEditor(); }
      if (event.key !== "Tab") return;
      const focusable = [...overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]")]
        .filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.addEventListener("dart:admin-logged-out", () => {
      companyState.list = [];
      companyState.editButtons.clear();
      closeEditor();
      setTab("companies");
      byId("shipping-coverage-list")?.replaceChildren();
      setStats();
    });
    setTab("companies");
    setStats();
  }

  window.DartShippingUI = Object.freeze({ renderCompanies, renderShipments, openEditor, closeEditor });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, {once: true});
  else initialize();
})();
