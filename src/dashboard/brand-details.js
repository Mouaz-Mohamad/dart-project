// Lazy Brand cards and read-only drilldowns share server-calculated contributors.
(function installBrandDetails(root) {
  "use strict";
  const doc = root.document;
  if (!doc) return;
  const definitions = {
    sales: ["Total Selling", "#brand .sales-cont", ["finance.view_revenue"]],
    profit: ["Total Profit", "#brand .profit-cont", ["finance.view_profit", "finance.view_revenue", "finance.view_cost"]],
    cost: ["Owner Total Cost", "#brand .cost-cont", ["finance.view_cost"]],
    stockSelling: ["In Stock Selling Value", "#brand-in-stock-selling-card", ["inventory"]],
    stockCost: ["In Stock Cost Value", "#brand-in-stock-cost-card", ["finance.view_inventory_value"]],
    damage: ["Damage Loss", "#brand-damage-loss-card", ["finance.view_inventory_value"]],
    models: ["Top Models", "#brand-top-model-card", ["finance.view_revenue"]],
    colors: ["Top Colors", "#brand-top-color-card", ["finance.view_revenue"]],
    sizes: ["Top Sizes", "#brand-top-size-card", ["finance.view_revenue"]],
    lowStock: ["Low Stock", "#brand-low-stock-card", ["inventory"]],
    deadStock: ["Dead Stock", "#brand-dead-stock-card", ["inventory"]],
  };
  const cache = new Map(), pending = new Map();
  const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let epoch = 0, revision = 0, timer = 0, dialog, body, heading, trigger, savedOverflow = "", selected = null, lastReport = null;
  const can = (permission) => root.DartAdminAccess?.can?.(permission) === true;
  const inventoryAccess = () => ["finance.read", "finance.view_inventory_value", "catalog.read", "catalog.manage", "inventory.manage"].some(can);
  const allowed = (metric) => can("finance.read") || definitions[metric]?.[2].every((permission) => permission === "inventory" ? inventoryAccess() : can(permission));
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = (minor) => `${new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(minor || 0) / 100)} EGP`;
  const range = () => root.DartFinance?.currentRangeSelection?.();
  const rangeKey = () => { const value = range(); return value ? `${value.start}:${value.end}` : ""; };

  async function report(metric, page = 1, force = false) {
    const value = range();
    if (!value || !root.DartAdminApi?.request) throw new Error("not ready");
    const key = `${epoch}:${metric}:${value.start}:${value.end}:${page}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < 20000) return hit.data;
    if (pending.has(key)) return pending.get(key);
    const version = epoch;
    const request = root.DartAdminApi.request(`/api/v1/admin/finance/brand-details/${metric}?${new URLSearchParams({ start: value.start, end: value.end, page: String(page), limit: "100" })}`)
      .then((data) => { if (version === epoch) cache.set(key, { at: Date.now(), data }); return data; })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function decorateCards() {
    Object.entries(definitions).forEach(([metric, [, selector]]) => {
      const card = doc.querySelector(selector);
      if (!card) return;
      card.dataset.brandDrilldown = metric;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-haspopup", "dialog");
      card.setAttribute("aria-label", `${definitions[metric][0]} — View details`);
      card.setAttribute("aria-disabled", String(!allowed(metric)));
    });
  }

  function applyOverview(data) {
    const set = (id, value) => { const node = doc.getElementById(id); if (node) node.textContent = value; };
    set("brand-in-stock-selling-value", money(data.totals.sellingMinor));
    set("brand-in-stock-cost-value", data.totals.costMinor === undefined ? "Restricted" : money(data.totals.costMinor));
    set("brand-low-stock-value", data.totals.lowStock);
    set("brand-dead-stock-value", data.totals.deadStock);
    // Current warehouse values have no historical comparison snapshot.
    ["in-stock-selling", "in-stock-cost", "low-stock", "dead-stock"].forEach((id) => {
      const badge = doc.getElementById(`brand-${id}-change`);
      if (badge) { badge.textContent = "Current stock"; badge.className = "dart-kpi-change is-flat"; }
    });
    [["model", "models"], ["color", "colors"], ["size", "sizes"]].forEach(([id, key]) => {
      const row = data.top?.[key];
      set(`brand-top-${id}-value`, data.salesVisible ? row?.name || "—" : "Restricted");
      set(`brand-top-${id}-note`, data.salesVisible ? `${row?.sold || 0} net sold · ${row?.share || 0}%` : "Revenue access required");
    });
  }

  async function renderCards() {
    decorateCards();
    if (!root.DartFinance || !(inventoryAccess() || can("finance.view_revenue"))) return;
    const key = rangeKey(), version = epoch;
    try {
      const data = await report("overview");
      if (version === epoch && key === rangeKey()) applyOverview(data);
    } catch {
      if (version !== epoch || key !== rangeKey()) return;
      ["in-stock-selling", "in-stock-cost", "low-stock", "dead-stock", "top-model", "top-color", "top-size"].forEach((id) => {
        const node = doc.getElementById(`brand-${id}-value`); if (node) node.textContent = "Unavailable";
      });
    }
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = doc.createElement("dialog");
    dialog.id = "dart-brand-details-dialog";
    dialog.className = "dart-brand-details-dialog";
    dialog.setAttribute("aria-labelledby", "dart-brand-details-title");
    dialog.innerHTML = '<header class="dart-brand-details-head"><h2 id="dart-brand-details-title"></h2><button type="button" data-brand-close aria-label="Close details">×</button></header><div class="dart-brand-details-body"></div>';
    doc.body.appendChild(dialog);
    body = dialog.querySelector(".dart-brand-details-body");
    heading = dialog.querySelector("h2");
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); back(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog || event.target.closest("[data-brand-close]")) back(); });
  }

  function push(selection) {
    root.history.pushState({ ...root.history.state, dartBrandDetail: { session, ...selection } }, "");
    restore();
  }
  function open(metric, origin) {
    if (!allowed(metric)) return;
    trigger = origin;
    push({ metric, page: 1 });
  }
  function back() {
    if (root.history.state?.dartBrandDetail?.session === session) root.history.back();
    else dismiss();
  }
  function dismiss() {
    selected = null; revision++;
    if (dialog?.open) dialog.close();
    doc.body.style.overflow = savedOverflow;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function table(columns, rows) {
    if (!rows.length) return '<p class="dart-brand-empty">No records in this view.</p>';
    return `<div class="dart-brand-table-scroll"><table><thead><tr>${columns.map(([, label]) => `<th scope="col">${escape(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([key], index) => {
      let value = row[key] ?? "—";
      if (/Minor$/.test(key)) value = row[key] === undefined ? "Restricted" : money(row[key]);
      if (key === "share") value = `${value}%`;
      if (key === "waiting" && row.waiting === null) value = "Restricted";
      return `<td>${index === 0 ? `<button type="button" class="dart-brand-row-link" data-brand-row="${escape(row.id || row.key)}">${escape(value)}</button>` : escape(value)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function ledgerTable(rows) {
    return table([["reference", "Reference"], ["date", "Date"], ["source", "Source / reason"], ["amountMinor", "Amount"]], rows);
  }

  function renderReport(data) {
    lastReport = data;
    const metric = selected.metric, ledger = ["sales", "cost", "profit", "damage"].includes(metric);
    const stock = ["stockSelling", "stockCost", "lowStock", "deadStock"].includes(metric);
    const intro = ledger ? 'المبالغ حسب تاريخ العملية خلال الفترة المختارة. الإجماليات تشمل جميع الصفحات.'
      : stock ? 'حالة المخزن الحالية لجميع تواريخ دخول القطع. حجز السلة لا يُحسب Waiting.'
      : 'صافي البيع خلال الفترة المختارة بعد المرتجعات. المخزون وWaiting يعرضان الحالة الحالية.';
    let content = `<p class="dart-brand-period">${escape(range()?.label || "")}</p><p dir="rtl">${intro}</p>`;
    if (ledger) content += `<div class="dart-brand-total">${escape(definitions[metric][0])}<strong>${money(data.totals.amountMinor)}</strong></div>`;
    if (metric === "profit") {
      content += `<div class="dart-brand-ledger-halves"><section><h3>Income · ${money(data.totals.incomeMinor)}</h3>${ledgerTable(data.rows.filter((row) => row.lane === "income"))}</section><section><h3>Costs & Expenses · ${money(data.totals.costMinor)}</h3>${ledgerTable(data.rows.filter((row) => row.lane === "outgoing"))}</section></div>`;
    } else if (ledger) content += ledgerTable(data.rows);
    else {
      if (stock) content += `<div class="dart-brand-total"><span>${data.totals.pieces} pieces · ${data.totals.models} stocked models</span>${metric === "stockSelling" || metric === "stockCost" ? `<strong>${money(metric === "stockSelling" ? data.totals.sellingMinor : data.totals.costMinor)}</strong>` : ""}</div>`;
      const columns = [["name", metric === "colors" ? "Color" : metric === "sizes" ? "Size" : "Model"], ["total", "Total pieces"], ["waiting", "Waiting pieces"], ["stock", "In warehouse"]];
      if (["models", "colors", "sizes"].includes(metric)) {
        data.rows.forEach((row, index) => { row.rank = (data.page - 1) * data.limit + index + 1; });
        columns.push(["rank", "Rank"]);
      }
      if (metric === "stockSelling") columns.push(["unitSellingMinor", "Selling / piece after discount"], ["sellingMinor", "Stock selling value"]);
      else if (metric === "stockCost") {
        data.rows.forEach((row) => { row.averageCostMinor = row.stock ? Math.round(row.costMinor / row.stock) : 0; });
        columns.push(["averageCostMinor", "Average cost / piece"], ["costMinor", "Stock cost value"]);
      } else {
        if (data.salesVisible) columns.push(["sold", "Net sold"], ["returned", "Refunded pieces"], ["share", "Share of net sales"]);
        columns.push(["damaged", "Damaged / destroyed"]);
        if (metric === "deadStock") columns.push(["idleDays", "Days without sale"], ["lastSale", "Last sale"]);
      }
      content += table(columns, data.rows);
    }
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    content += `<footer class="dart-brand-pagination"><span>${data.total} records · Page ${data.page} / ${pages}</span><button type="button" data-brand-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Previous</button><button type="button" data-brand-page="${data.page + 1}" ${data.page >= pages ? "disabled" : ""}>Next</button><button type="button" data-brand-retry>Refresh</button></footer>`;
    body.innerHTML = content;
    if (selected.row) renderRecord(selected.row);
  }

  function renderRecord(id) {
    const row = lastReport?.rows.find((entry) => String(entry.id || entry.key) === id);
    if (!row) { body.innerHTML = '<p>Record unavailable. Go back and refresh the list.</p>'; return; }
    heading.textContent = `${definitions[selected.metric][0]} · ${row.reference || row.name}`;
    const fields = { ...row, ...row.details };
    body.innerHTML = `<button type="button" data-brand-parent>Back to list</button><dl class="dart-brand-record">${Object.entries(fields)
      .filter(([key, value]) => !["details", "lane", "id"].includes(key) && value !== undefined && value !== null && typeof value !== "object")
      .map(([key, value]) => `<div><dt>${escape(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>${escape(/Minor$/.test(key) ? money(value) : value)}</dd></div>`).join("")}</dl>`;
  }

  async function restore(force = false) {
    const selection = root.history.state?.dartBrandDetail;
    if (selection?.session !== session || !definitions[selection.metric] || !allowed(selection.metric)) { if (selected) dismiss(); return; }
    ensureDialog();
    selected = selection;
    const version = ++revision;
    const key = rangeKey();
    heading.textContent = definitions[selected.metric][0];
    if (!dialog.open) { savedOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; dialog.showModal(); }
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<p role="status">Loading details…</p>';
    try {
      const data = await report(selected.metric, selected.page, force);
      if (version !== revision || !selected || key !== rangeKey()) return;
      renderReport(data);
    } catch {
      if (version === revision && selected) body.innerHTML = '<p role="alert">تعذّر تحميل التفاصيل. راجع الاتصال أو صلاحيات حسابك.</p><button type="button" data-brand-retry>Retry</button>';
    } finally { if (version === revision) body.removeAttribute("aria-busy"); }
  }

  function invalidate() {
    epoch++; cache.clear();
    root.clearTimeout(timer);
    timer = root.setTimeout(() => { void renderCards(); if (selected) void restore(); }, 100);
  }
  doc.addEventListener("click", (event) => {
    if (event.target.closest(".dart-info-btn")) return;
    const card = event.target.closest("[data-brand-drilldown]");
    if (card) { open(card.dataset.brandDrilldown, card); return; }
    if (!dialog?.contains(event.target) || !selected) return;
    const row = event.target.closest("[data-brand-row]");
    if (row) { push({ metric: selected.metric, page: selected.page, row: row.dataset.brandRow }); return; }
    if (event.target.closest("[data-brand-parent]")) { back(); return; }
    const page = event.target.closest("[data-brand-page]");
    if (page && !page.disabled) { root.history.replaceState({ ...root.history.state, dartBrandDetail: { ...selected, page: Number(page.dataset.brandPage), row: undefined } }, ""); void restore(); }
    if (event.target.closest("[data-brand-retry]")) { cache.clear(); void restore(true); }
  });
  doc.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-brand-drilldown]");
    if (card && event.target === card && ["Enter", " "].includes(event.key)) { event.preventDefault(); open(card.dataset.brandDrilldown, card); }
  });
  root.addEventListener("popstate", () => { void restore(); });
  root.addEventListener("dart:dashboard-section-activated", (event) => { if (event.detail?.id === "brand") invalidate(); });
  ["dart:finance-period-changed", "dart:admin-authenticated", "dart:catalog-hydrated", "dart:orders-hydrated", "dart:domain-hydrated", "dart:domain-synced", "dart:waiting-updated"].forEach((name) => root.addEventListener(name, invalidate));
  root.addEventListener("dart:admin-logged-out", () => { epoch++; cache.clear(); dismiss(); });
  root.addEventListener("focus", invalidate);
  root.DartBrandDetails = Object.freeze({ renderCards, open });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => { void renderCards(); }, { once: true });
  else void renderCards();
})(window);
