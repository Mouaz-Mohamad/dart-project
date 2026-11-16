// Live dashboard filter options are read-only projections of server-hydrated records.
// No catalog, order, or inventory value is written by this module.
const dartLegacyApplyFilters = dartApplyFilters;
const dartLegacyRenderSection = dartRenderSection;
const dartLegacySetupSearchFilter = setupSearchFilter;

(function installDynamicDashboardFilters() {
  "use strict";

  const ORDER_STATUSES = [
    ...DART_ORDER_FLOW, "Refused", "Cancelled", "Needs Attention",
  ];
  const ITEM_STATUSES = [
    "In stock", "Processing/Held", "With Representative",
    "Return Inspection", "Sold", "Damaged", "Destroyed",
  ];
  const RETURN_STATUSES = [
    "Pending Request", "Approved - Awaiting Representative",
    "Representative Assigned", "Pickup On The Way",
    "Pending Inspection", "Completed", "Rejected", "Closed",
  ];

  const norm = (value) => String(value ?? "").trim().toLocaleLowerCase();
  const archived = (row) => Boolean(row?.isArchived || row?.isDeleted);
  const nonempty = (value) => String(value ?? "").trim() !== "";
  const same = (left, right) => norm(left) === norm(right);
  const selected = (value) => nonempty(value) && !same(value, "all");
  const readable = (values, field = "") => {
    const deduped = new Map();
    for (const value of values) {
      const label = String(value ?? "").trim();
      if (label && !deduped.has(norm(label))) deduped.set(norm(label), label);
    }
    const result = [...deduped.values()];
    // Statuses follow their business workflow, not alphabetical order.
    if (["status", "inspection", "deliveryMode", "codVerification"].includes(field))
      return result;
    if (field === "size") {
      const topOrder = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "3xl", "4xl", "5xl", "6xl"];
      const rank = (value) => {
        const label = norm(value);
        if (/^\d+$/.test(label)) return Number(label);
        const i = topOrder.indexOf(label);
        return i >= 0 ? 1000 + i : 2000;
      };
      return result.sort((a, b) => rank(a) - rank(b) ||
        a.localeCompare(b, ["en", "ar"], { numeric: true }));
    }
    return result.sort((a, b) => a.localeCompare(b, ["en", "ar"],
      { sensitivity: "base", numeric: true }));
  };
  const stateOf = (section) => dartFilterState[section] || {};
  const scopeOf = (section) => stateOf(section).archive || "active";
  const currentModels = (section) => modelsData.filter((model) => {
    const scope = scopeOf(section);
    return scope === "archived" ? archived(model)
      : scope === "all" ? true
      : !archived(model) && model.active !== false;
  });
  const optionsOf = (model, kind, allowInactive = false) => {
    const field = kind === "size" ? "sizeOptions" : "colorOptions";
    const getter = kind === "size" ? "sizes" : "colors";
    const options = Array.isArray(model?.[field])
      ? model[field] : (window.DartCatalog?.[getter]?.(model) || []);
    return options.filter((option) => allowInactive || option?.active !== false)
      .map((option) => typeof option === "string" ? option : option?.name)
      .filter(nonempty);
  };
  const modelFor = (item) => modelsData.find((model) => same(model.modelId, item.modelId));
  const categoryOf = (item) => modelFor(item)?.category || "";
  function sizeSystem(item) {
    const category = norm(categoryOf(item));
    if (/(jeans|denim|pant|trouser|cargo|short|jogger|بنطلون|بناطيل|جينز|شورت)/.test(category)) return "pants";
    if (/(shirt|hoodie|jacket|jaket|crewneck|sweat|top|تيشيرت|قميص|هودي|جاكيت)/.test(category)) return "tops";
    return /^[0-9]+$/.test(String(item.size ?? "").trim()) ? "pants" : "tops";
  }
  const codeStatus = (item) =>
    item?.cartReservationId && (!item.reservationUntil ||
      Date.parse(item.reservationUntil) > Date.now()) && same(item.status, "In stock")
      ? "cart-reserved" : String(item.status || "");
  const carrierOf = (order) =>
    order?.deliveryShipment?.companyName ||
    order?.pendingDispatch?.companyName || "";
  const modeOf = (order) =>
    same(order?.deliveryShipment?.type, "external") ||
    nonempty(carrierOf(order)) ? "external"
      : (order?.representativeId || order?.pendingDispatch?.representativeId ||
        order?.deliveryShipment?.type === "dart") ? "dart" : "unassigned";
  const codOf = (order) =>
    order?.verificationStatus || order?.codVerificationStatus || "Not Required";

  function filteredBase(section, records) {
    const state = stateOf(section);
    let result = [...(records || [])];
    if (state.search) result = result.filter((row) =>
      dartSectionSearchText(row).includes(norm(state.search)));
    if (state.archive === "archived") result = result.filter(archived);
    else if (state.archive !== "all") result = result.filter((row) => !archived(row));
    return result;
  }

  dartApplyFilters = function liveDashboardApplyFilters(section, data) {
    const state = stateOf(section);
    if (section === "models") {
      let rows = filteredBase(section, data);
      if (selected(state.category)) rows = rows.filter((row) => same(row.category, state.category));
      if (selected(state.size)) rows = rows.filter((row) =>
        optionsOf(row, "size", scopeOf(section) !== "active").some((size) => same(size, state.size)));
      if (selected(state.color)) rows = rows.filter((row) =>
        optionsOf(row, "color", scopeOf(section) !== "active").some((color) => same(color, state.color)));
      if (selected(state.status)) rows = rows.filter((row) => {
        const availability = dartModelDerived(row);
        const available = Number(availability.count) || 0;
        const total = Number(availability.total) || 0;
        if (state.status === "in-stock") return available > 0;
        if (state.status === "out-of-stock") return available === 0;
        if (state.status === "no-items") return total === 0;
        if (state.status === "low-stock") return available > 0 &&
          available <= (Number(row.lowStockLimit) || 5);
        return same(row.status || "Active", state.status);
      });
      if (selected(state.priceRange)) rows = rows.filter((row) => {
        const price = Number(row.discountedPrice ?? row.selling) || 0;
        if (state.priceRange === "0-500") return price <= 500;
        if (state.priceRange === "500-1000") return price > 500 && price <= 1000;
        return price > 1000;
      });
      return rows;
    }
    if (section === "items") {
      let rows = filteredBase(section, data);
      if (selected(state.category)) rows = rows.filter((row) =>
        same(categoryOf(row), state.category));
      if (selected(state.status)) rows = rows.filter((row) =>
        state.status === "cart-reserved" ? codeStatus(row) === "cart-reserved"
          : same(row.status, state.status));
      if (selected(state.sizeProfile)) rows = rows.filter((row) =>
        sizeSystem(row) === state.sizeProfile);
      if (selected(state.size)) rows = rows.filter((row) => same(row.size, state.size));
      if (selected(state.color)) rows = rows.filter((row) => same(row.color, state.color));
      return rows;
    }
    let result = dartLegacyApplyFilters(section, data);
    if (section === "orders") {
      if (selected(state.deliveryMode))
        result = result.filter((row) => modeOf(row) === state.deliveryMode);
      if (selected(state.carrier))
        result = result.filter((row) => same(carrierOf(row), state.carrier));
      if (selected(state.codVerification))
        result = result.filter((row) => same(codOf(row), state.codVerification));
      if (["last-7-days", "last-30-days"].includes(state.date)) {
        const maxAgeDays = state.date === "last-7-days" ? 7 : 30;
        result = result.filter((row) => {
          const stamp = Date.parse(row.createdAt || row.date || "");
          return Number.isFinite(stamp) && stamp <= Date.now() &&
            stamp >= Date.now() - maxAgeDays * 86400000;
        });
      }
    } else if (section === "returns") {
      if (selected(state.inspection))
        result = result.filter((row) =>
          same(row.inspectionStatus || "Pending", state.inspection));
      if (selected(state.returnType))
        result = result.filter((row) => same(row.requestType, state.returnType));
    }
    return result;
  };

  function replaceOptions(select, section, field, options, allLabel) {
    if (!select) return;
    const state = dartFilterState[section] || (dartFilterState[section] = { archive: "active" });
    const wanted = state[field] ?? select.value ?? "all";
    const allowed = readable(options, field);
    select.replaceChildren(
      new Option(allLabel, "all"),
      ...allowed.map((value) => new Option(value, value)),
    );
    const actual = [...select.options].find((option) => same(option.value, wanted));
    select.value = actual?.value || "all";
    select.dataset.dartAllValue = "all";
    state[field] = select.value;
  }

  function refresh(section) {
    const root = document.getElementById(section);
    if (!root || !root.querySelector(".filter-bar")) return;
    const state = stateOf(section);
    if (section === "models" || section === "items") {
      // Reconcile the category first so a removed category cannot strand the other controls.
      replaceOptions(root.querySelector('.filter-bar select[data-filter-key="category"]'),
        section, "category", currentModels(section).map((model) => model.category),
        "All Categories");
    }
    const catalog = currentModels(section)
      .filter((model) => !selected(state.category) || same(model.category, state.category));
    const historical = scopeOf(section) !== "active";
    const sizes = catalog.flatMap((model) => optionsOf(model, "size", historical));
    const colors = catalog.flatMap((model) => optionsOf(model, "color", historical));
    const records = (sectionsMap[section]?.data || [])
      .filter((row) => scopeOf(section) === "archived" ? archived(row)
        : scopeOf(section) === "all" || !archived(row));
    const find = (key) => root.querySelector('.filter-bar select[data-filter-key="' + key + '"]');
    const populate = (key, choices, label) => replaceOptions(find(key), section, key, choices, label);
    if (section === "models") {
      populate("category", currentModels(section).map((model) => model.category), "All Categories");
      populate("size", sizes, "All Sizes");
      populate("color", colors, "All Colors");
      populate("status", [
        "in-stock", "out-of-stock", "low-stock", "no-items",
      ].map((value) => value), "All Stock States");
      const status = find("status");
      if (status) {
        const labels = {
          "in-stock": "In Stock", "out-of-stock": "Out of Stock",
          "low-stock": "Low Stock", "no-items": "No Physical Items",
        };
        [...status.options].forEach((option) => {
          if (labels[option.value]) option.textContent = labels[option.value];
        });
      }
    } else if (section === "items") {
      populate("category", currentModels(section).map((model) => model.category), "All Categories");
      const profile = state.sizeProfile || "all";
      const filteredCatalog = catalog.filter((model) => {
        if (!selected(profile)) return true;
        const samples = optionsOf(model, "size", historical);
        return samples.some((size) => sizeSystem({ modelId: model.modelId, size }) === profile);
      });
      const scopedSizes = filteredCatalog.flatMap((model) => optionsOf(model, "size", historical));
      const scopedColors = catalog.flatMap((model) => optionsOf(model, "color", historical));
      const historySizes = historical ? records
        .filter((row) => !selected(profile) || sizeSystem(row) === profile)
        .map((row) => row.size) : [];
      populate("size", [...scopedSizes, ...historySizes], "All Sizes");
      populate("color", [...scopedColors, ...(historical ? records.map((row) => row.color) : [])], "All Colors");
      populate("status", [
        ...ITEM_STATUSES, ...records.map((row) => row.status),
        ...(records.some((row) => codeStatus(row) === "cart-reserved") ? ["cart-reserved"] : []),
      ], "All Item States");
      const cart = [...(find("status")?.options || [])].find((option) => option.value === "cart-reserved");
      if (cart) cart.textContent = "Cart Reserved";
    } else if (section === "orders") {
      populate("status", [...ORDER_STATUSES, ...records.map((row) => row.status)], "All Order States");
      populate("deliveryMode", ["dart", "external", "unassigned"], "All Delivery Modes");
      const mode = find("deliveryMode");
      const label = { dart: "Dart Delivery", external: "Shipping Company", unassigned: "Not Assigned" };
      [...(mode?.options || [])].forEach((option) => {
        if (label[option.value]) option.textContent = label[option.value];
      });
      populate("carrier", records.map(carrierOf), "All Shipping Companies");
      populate("codVerification", [
        "Not Required", ...records.map(codOf),
      ], "All COD Verifications");
    } else if (section === "returns") {
      populate("status", [...RETURN_STATUSES, ...records.map((row) => row.status)], "All Return States");
      populate("inspection", ["Pending", "Good", "Damaged", ...records.map((row) => row.inspectionStatus)], "All Inspections");
      populate("returnType", records.map((row) => row.requestType), "All Return Types");
    } else if (["review", "representative", "card", "damage"].includes(section)) {
      const builtIn = {
        review: ["Active", "Hidden"],
        representative: ["Active", "Pending Approval", "Rejected", "Not available"],
        card: ["Active", "Expired", "Hidden"],
        damage: ["Damaged", "Repaired", "Destroyed"],
      };
      populate("status", [...builtIn[section], ...records.map((row) => row.status)], "All Statuses");
    }
  }

  // Override the old fixed-size selector; source-of-truth values are catalog options.
  dartPopulateItemSizeFilter = function liveItemSizeOptions(profile = "all") {
    const state = dartFilterState.items || (dartFilterState.items = { archive: "active" });
    state.sizeProfile = profile || "all";
    refresh("items");
  };

  dartRenderSection = function renderSectionWithLiveFilters(section) {
    refresh(section);
    return dartLegacyRenderSection(section);
  };
  setupSearchFilter = function setupLiveDashboardFilters() {
    dartLegacySetupSearchFilter();
    for (const section of [
      "models", "items", "orders", "returns", "review",
      "representative", "card", "damage",
    ]) refresh(section);
  };

  window.DartDashboardDynamicFilters = Object.freeze({
    refresh, sizeSystem, modeOf, codOf, optionsOf, readable,
  });
})();
