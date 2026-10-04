// DART CODE GUIDE | Js/dart-sets.js
// Shared lightweight browser client for Sets. PostgreSQL/Backend remain the source of truth.
(function (root) {
  "use strict";
  if (!root || root.DartSets) return;

  const DRAFT_KEY = "dart_cart_set_groups_v1";
  const DEFAULT_SETTINGS = Object.freeze({ birthdayPercent: 10, dartCardPercent: 10, version: 1 });
  let catalog = [];
  let setWaiting = [];
  let settings = { ...DEFAULT_SETTINGS };
  let loadedAt = 0;
  const CACHE_MS = 30_000;

  function apiBase() {
    return String(root.DART_API_BASE_URL || root.DartApi?.baseUrl || root.location?.origin || "").replace(/\/$/, "");
  }

  function csrfToken() {
    return root.document?.cookie
      ?.split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=") || "";
  }

  async function request(path, options = {}) {
    if (root.DartAdminApi?.request && /\/admin\//.test(path)) {
      return root.DartAdminApi.request(path, options);
    }
    if (root.DartPlatform?.apiRequest) {
      return root.DartPlatform.apiRequest(path, options);
    }
    const method = String(options.method || "GET").toUpperCase();
    const csrf = csrfToken();
    const response = await fetch(`${apiBase()}${path}`, {
      credentials: "include",
      cache: "no-store",
      method,
      headers: {
        Accept: "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "Content-Type": "application/json" } : {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
          ? { "X-CSRF-Token": decodeURIComponent(csrf) }
          : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Dart Sets request failed");
      error.status = response.status;
      error.code = payload?.error?.code || "SETS_REQUEST_FAILED";
      error.details = payload?.error?.details;
      throw error;
    }
    return payload;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readDrafts() {
    try {
      const value = JSON.parse(root.sessionStorage?.getItem(DRAFT_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      try { root.sessionStorage?.removeItem(DRAFT_KEY); } catch {}
      return [];
    }
  }

  function writeDrafts(groups) {
    const safe = Array.isArray(groups) ? clone(groups) : [];
    try { root.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(safe)); } catch {}
    root.dispatchEvent?.(new CustomEvent("dart:set-cart-draft-changed", { detail: { groups: safe } }));
    return safe;
  }

  function clearDrafts() {
    return writeDrafts([]);
  }

  function currentReservationId() {
    return String(
      root.DartPlatform?.cartReservationId ||
      root.sessionStorage?.getItem("dart_cart_reservation_id") ||
      "",
    ).trim();
  }

  function signedIn() {
    return Boolean(root.DartPlatform?.currentUser?.());
  }

  async function loadCatalog(force = false) {
    if (!force && catalog.length && Date.now() - loadedAt < CACHE_MS) return clone(catalog);
    const settingsRequest = request("/api/v1/sets/settings")
      .then((payload) => ({ payload, error: null }))
      .catch((error) => ({ payload: null, error }));
    const setsPayload = await request("/api/v1/sets");
    const settingsResult = await settingsRequest;
    catalog = Array.isArray(setsPayload?.sets) ? setsPayload.sets : [];
    if (settingsResult.payload?.settings) {
      settings = { ...DEFAULT_SETTINGS, ...settingsResult.payload.settings };
    } else if (settingsResult.error) {
      settings = { ...DEFAULT_SETTINGS, ...settings };
      root.dispatchEvent?.(new CustomEvent("dart:sets-settings-unavailable", {
        detail: {
          code: settingsResult.error.code || "SETS_SETTINGS_UNAVAILABLE",
          usingDefaults: settings.birthdayPercent === 10 && settings.dartCardPercent === 10,
        },
      }));
    }
    loadedAt = Date.now();
    root.dispatchEvent?.(new CustomEvent("dart:sets-catalog-changed", { detail: { sets: clone(catalog), settings: clone(settings) } }));
    return clone(catalog);
  }

  async function detail(setId) {
    const payload = await request(`/api/v1/sets/${encodeURIComponent(String(setId || ""))}`);
    return payload?.set || null;
  }

  async function attachCartGroups(groups = readDrafts(), reservationId = currentReservationId()) {
    if (!reservationId) throw new Error("Cart reservation is not ready yet.");
    const path = signedIn() ? "/api/v1/me/cart/set-groups" : "/api/v1/cart/set-groups";
    const payload = await request(path, {
      method: "PUT",
      body: { reservationId, groups: Array.isArray(groups) ? groups : [] },
    });
    writeDrafts(payload?.groups || groups || []);
    return payload;
  }

  async function cartGroups(reservationId = currentReservationId()) {
    if (!reservationId) return [];
    const path = signedIn()
      ? `/api/v1/me/cart/set-groups?reservationId=${encodeURIComponent(reservationId)}`
      : `/api/v1/cart/set-groups/${encodeURIComponent(reservationId)}`;
    const payload = await request(path);
    const groups = Array.isArray(payload?.groups) ? payload.groups : [];
    writeDrafts(groups);
    return groups;
  }

  async function loadWaiting() {
    if (!signedIn()) { setWaiting = []; return []; }
    const payload = await request("/api/v1/me/sets/waiting");
    setWaiting = Array.isArray(payload?.entries) ? payload.entries : [];
    root.dispatchEvent?.(new CustomEvent("dart:set-waiting-changed", { detail: { entries: clone(setWaiting) } }));
    return clone(setWaiting);
  }

  async function joinWaiting(setId, selections) {
    if (!signedIn()) throw Object.assign(new Error("Sign in to join Set Waiting."), { code: "AUTH_REQUIRED" });
    const payload = await request("/api/v1/me/sets/waiting", { method: "POST", body: { setId, selections } });
    await loadWaiting();
    return payload?.entry || null;
  }

  async function confirmWaiting(entryId) {
    const payload = await request(`/api/v1/me/sets/waiting/${encodeURIComponent(entryId)}/confirm`, { method: "POST", body: {} });
    const entry = payload?.entry || null;
    if (entry?.status === "confirmed" && entry.cartReservationId) {
      const set = setById(entry.setId) || await detail(entry.setId);
      const currentCart = root.DartState?.clone?.(root.DartState?.read?.("dart_cart", []) || [])
        || clone(root.DartState?.read?.("dart_cart", []) || []);
      const currentGroups = readDrafts();
      const unitIndex = 1 + Math.max(0,...currentGroups.filter((group) => String(group.setId) === String(entry.setId)).map((group) => Number(group.unitIndex) || 0));
      const key = `${entry.setId}:${unitIndex}`;
      const selections = Array.isArray(entry.selections) ? entry.selections : [];
      const lines = selections.map((selection) => {
        const model = root.DartCatalog?.model?.(selection.modelId);
        let price = Number(model?.selling || 0);
        try { price = Number(root.DartCatalog?.price?.(model) ?? price); } catch {}
        let image = "";
        try { image = root.DartCatalog?.cover?.(model,selection.color) || ""; } catch {}
        return {
          id:String(selection.modelId),title:model?.name || String(selection.modelId),price,
          size:String(selection.size),color:String(selection.color),quantity:1,image,
          setId:String(entry.setId),dartSetKey:key,dartSetUnitIndex:unitIndex,
          reservationId:String(entry.cartReservationId),reservationUntil:entry.reservedUntil || null,
        };
      });
      writeDrafts([...currentGroups,{setId:String(entry.setId),unitIndex,selections}]);
      root.DartPlatform?.adoptCartReservationId?.(entry.cartReservationId);
      const combined = [...currentCart,...lines];
      if (root.DartPlatform?.reserveCart) await root.DartPlatform.reserveCart(combined);
      else root.DartState?.write?.("dart_cart",combined,{source:"set-waiting-confirm"});
    }
    await loadWaiting();
    return entry;
  }

  async function cancelWaiting(entryId) {
    const payload = await request(`/api/v1/me/sets/waiting/${encodeURIComponent(entryId)}`, { method: "DELETE" });
    await loadWaiting();
    return payload?.entry || null;
  }

  function setById(setId) {
    return catalog.find((row) => String(row.setId) === String(setId)) || null;
  }

  function moneyMinor(value) {
    return `${(Math.max(0, Number(value) || 0) / 100).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
  }

  function firstImage(set) {
    return Array.isArray(set?.images) && set.images.length
      ? String(set.images[0] || "")
      : "Photos/logo-1to1.png";
  }

  root.DartSets = Object.freeze({
    request,
    loadCatalog,
    detail,
    setById,
    readDrafts,
    writeDrafts,
    clearDrafts,
    attachCartGroups,
    cartGroups,
    loadWaiting,
    joinWaiting,
    confirmWaiting,
    cancelWaiting,
    waitingEntries: () => clone(setWaiting),
    currentReservationId,
    signedIn,
    moneyMinor,
    firstImage,
    catalog: () => clone(catalog),
    settings: () => clone(settings),
  });

  root.dispatchEvent?.(new CustomEvent("dart:sets-client-ready"));
})(typeof window !== "undefined" ? window : globalThis);

// DART SETS STOREFRONT — additive UI integration; ordinary product rendering remains untouched.
(function installDartSetsStorefront(root) {
  "use strict";
  if (!root?.document || /\/Eye\//i.test(root.location?.pathname || "") || root.__dartSetsStorefront) return;
  root.__dartSetsStorefront = true;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let setCatalog = [];
  let activeSet = null;
  let lastAttachedGroups = [];
  let renderScheduled = false;
  let cartDecorating = false;
  let setFilterActive = false;

  function drafts() {
    return normalizeGroups(root.DartSets?.readDrafts?.() || []);
  }

  function normalizeGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map((group) => ({
      ...group,
      setId: String(group.setId || ""),
      unitIndex: Math.max(1, Number(group.unitIndex) || 1),
      selections: (Array.isArray(group.selections) ? group.selections : Array.isArray(group.components) ? group.components : [])
        .map((row) => ({
          modelId: String(row.modelId || ""), color: String(row.color || ""), size: String(row.size || ""),
          ...(row.modelName ? { modelName: String(row.modelName) } : {}),
          ...(row.itemCode ? { itemCode: String(row.itemCode) } : {}),
          ...(Number.isFinite(Number(row.allocatedBaseMinor)) ? { allocatedBaseMinor: Number(row.allocatedBaseMinor) } : {}),
          ...(Number.isFinite(Number(row.allocatedFinalMinor)) ? { allocatedFinalMinor: Number(row.allocatedFinalMinor) } : {}),
        }))
        .filter((row) => row.modelId && row.color && row.size),
    })).filter((group) => group.setId && group.selections.length);
  }

  function cartRef() {
    try { if (typeof cartData !== "undefined" && Array.isArray(cartData)) return cartData; } catch {}
    const value = root.DartState?.read?.("dart_cart", []);
    return Array.isArray(value) ? value : [];
  }

  function modelFor(modelId) {
    try { return root.DartCatalog?.model?.(String(modelId)) || null; } catch { return null; }
  }

  function activeOptions(options) {
    return (Array.isArray(options) ? options : [])
      .filter((row) => row && row.active !== false && String(row.name || "").trim())
      .map((row) => String(row.name));
  }

  function variantAvailable(modelId, size, color) {
    try {
      return Number(root.DartCatalog?.available?.(modelFor(modelId), String(size), String(color), root.DartPlatform?.cartReservationId || "")) || 0;
    } catch { return 0; }
  }

  function setAvailable(set) {
    return (set.components || []).every((component) => {
      const sizes = activeOptions(component.sizes);
      const colors = activeOptions(component.colors);
      let total = 0;
      sizes.forEach((size) => colors.forEach((color) => { total += Math.max(0, variantAvailable(component.modelId, size, color)); }));
      return total >= Math.max(1, Number(component.quantity) || 1);
    });
  }

  function setImage(set) {
    const direct = root.DartSets?.firstImage?.(set);
    if (direct && !/logo-1to1/.test(direct)) return direct;
    for (const component of set.components || []) {
      const model = modelFor(component.modelId);
      const color = activeOptions(component.colors)[0] || "";
      try {
        const cover = root.DartCatalog?.cover?.(model, color);
        if (cover) return cover;
      } catch {}
    }
    return direct || "Photos/logo-1to1.png";
  }

  function setCurrentPrice(set) { return Math.max(0, Number(set?.pricing?.finalMinor || 0)) / 100; }
  function setBasePrice(set) { return Math.max(0, Number(set?.pricing?.basePriceMinor || 0)) / 100; }

  function setCardSignature(set) {
    return JSON.stringify({
      id: String(set?.setId || ""),
      name: String(set?.name || ""),
      image: setImage(set || {}),
      price: setCurrentPrice(set),
      base: setBasePrice(set),
      discount: Number(set?.pricing?.discountPercent || 0),
      available: setAvailable(set || {}),
    });
  }

  function syncSetCard(card, set) {
    if (!card || !set) return card;
    const signature = setCardSignature(set);
    if (card.dataset.dartSetRenderKey === signature) return card;
    card.dataset.dartSetRenderKey = signature;
    card.dataset.dartSetId = set.setId;
    const image = card.querySelector(".product-img");
    if (image) { image.src = setImage(set); image.alt = set.name; image.loading = "lazy"; }
    const category = card.querySelector(".product-category"); if (category) category.textContent = "Sets";
    const code = card.querySelector(".product-code"); if (code) code.textContent = `Code : ${set.setId}`;
    const title = card.querySelector(".product-title"); if (title) title.textContent = set.name;
    const current = card.querySelector('[data-product-price="current"], .product-price');
    const old = card.querySelector('[data-product-price="old"]');
    const badge = card.querySelector('[data-product-price="discount"]');
    const price = setCurrentPrice(set), base = setBasePrice(set), discount = Number(set?.pricing?.discountPercent || 0);
    if (current) current.textContent = `EGP ${Math.trunc(price)}`;
    if (old) { old.textContent = `EGP ${Math.trunc(base)}`; old.hidden = !(discount > 0); }
    if (badge) { badge.textContent = `خصم ${Math.round(discount)}%`; badge.hidden = !(discount > 0); }
    const available = setAvailable(set);
    card.classList.toggle("out-of-stock", !available);
    let stockBadge = card.querySelector(".out-of-stock-badge");
    if (!available && !stockBadge) {
      stockBadge = root.document.createElement("span");
      stockBadge.className = "out-of-stock-badge";
      card.appendChild(stockBadge);
    }
    if (stockBadge) {
      stockBadge.textContent = "Waiting available";
      stockBadge.hidden = available;
    }
    const button = card.querySelector(".cart-btn");
    if (button) { button.removeAttribute("data-id"); button.dataset.dartSetBuy = set.setId; }
    return card;
  }

  function createSetCard(set) {
    const template = root.document.getElementById("productTemplate");
    if (!template) return null;
    const card = template.cloneNode(true);
    card.removeAttribute("id");
    card.style.display = "flex";
    card.style.position = "relative";
    card.dataset.dartSetCard = "1";
    card.setAttribute("tabindex", "0");
    const openCurrentSet = () => {
      const current = setCatalog.find((row) => String(row.setId) === String(card.dataset.dartSetId));
      if (current) openSetModal(current);
    };
    const button = card.querySelector(".cart-btn");
    if (button) button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); openCurrentSet();
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest?.(".cart-btn")) return;
      openCurrentSet();
    });
    card.addEventListener("keydown", (event) => {
      if (event.target !== card || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openCurrentSet();
    });
    return syncSetCard(card, set);
  }

  function filterSetCatalog() {
    const query = String(root.document.getElementById("productSearchInput")?.value || "").trim().toLocaleLowerCase();
    const size = String(root.document.getElementById("productSizeFilter")?.value || "all");
    const color = String(root.document.getElementById("productColorFilter")?.value || "all");
    const availability = String(root.document.getElementById("productAvailabilityFilter")?.value || "all");
    const priceFilter = String(root.document.getElementById("productPriceFilter")?.value || "all");
    const sort = String(root.document.getElementById("productSortSelect")?.value || "featured");
    let rows = setCatalog.filter((set) => {
      const searchable = [set.name, set.setId, set.description, "Sets"].join(" ").toLocaleLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (size !== "all" && !(set.components || []).some((c) => activeOptions(c.sizes).includes(size))) return false;
      if (color !== "all" && !(set.components || []).some((c) => activeOptions(c.colors).includes(color))) return false;
      const available = setAvailable(set);
      if (availability === "in-stock" && !available) return false;
      if (availability === "out-of-stock" && available) return false;
      const price = setCurrentPrice(set);
      const range = priceFilter.match(/^range:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      if (range && (price < Number(range[1]) || price > Number(range[2]))) return false;
      return true;
    });
    if (sort === "price-low") rows = [...rows].sort((a,b) => setCurrentPrice(a)-setCurrentPrice(b));
    if (sort === "price-high") rows = [...rows].sort((a,b) => setCurrentPrice(b)-setCurrentPrice(a));
    if (sort === "name") rows = [...rows].sort((a,b) => String(a.name).localeCompare(String(b.name), ["en","ar"]));
    if (sort === "newest") rows = [...rows].sort((a,b) => new Date(b.createdAt||0)-new Date(a.createdAt||0));
    return rows;
  }

  function restoreSuppressedProductCards() {
    root.document.querySelectorAll('[data-dart-set-suppressed="1"]').forEach((node) => {
      node.style.display = node.dataset.dartSetPreviousDisplay || "";
      delete node.dataset.dartSetPreviousDisplay;
      delete node.dataset.dartSetSuppressed;
    });
  }

  function suppressNormalProductCards(containers) {
    for (const container of containers.filter(Boolean)) {
      [...container.children].forEach((node) => {
        if (node.id === "productTemplate" || node.dataset?.dartSetCard === "1" || node.dataset?.dartSetSuppressed === "1") return;
        node.dataset.dartSetPreviousDisplay = node.style.display || "";
        node.dataset.dartSetSuppressed = "1";
        node.style.display = "none";
      });
    }
  }

  function syncSetCards(rows, target) {
    const desiredIds = rows.map((set) => String(set.setId));
    const desired = new Set(desiredIds);
    const existing = new Map();
    root.document.querySelectorAll('[data-dart-set-card="1"]').forEach((node) => {
      const id = String(node.dataset.dartSetId || "");
      if (!desired.has(id)) { node.remove(); return; }
      if (existing.has(id)) { node.remove(); return; }
      existing.set(id, node);
    });
    if (!target) {
      existing.forEach((node) => node.remove());
      return;
    }
    const cards = rows.map((set) => {
      const card = existing.get(String(set.setId)) || createSetCard(set);
      return syncSetCard(card, set);
    }).filter(Boolean);
    const currentIds = [...target.querySelectorAll(':scope > [data-dart-set-card="1"]')]
      .map((node) => String(node.dataset.dartSetId || ""));
    if (currentIds.join("|") !== desiredIds.join("|") || cards.some((card) => card.parentElement !== target)) {
      cards.forEach((card) => target.appendChild(card));
    }
  }

  function renderSetCards() {
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => {
      renderScheduled = false;
      const activeCategory = root.document.querySelector("#filterContainer .filter-btn.active")?.dataset.category || "All";
      const category = setFilterActive ? "Sets" : activeCategory;
      const part1 = root.document.getElementById("productsPart1");
      const part2 = root.document.getElementById("productsPart2");
      const home = root.document.getElementById("productsContainer");
      const productContainers = [part1, part2, home];
      if (setFilterActive) suppressNormalProductCards([part1, part2, home]);
      else restoreSuppressedProductCards();
      if (!setCatalog.length || (!setFilterActive && !["All", "all", ""].includes(category))) {
        syncSetCards([], null);
        return;
      }
      const rows = filterSetCatalog();
      const target = setFilterActive ? (part1 || home) : (part2 || home);
      syncSetCards(rows, target);
      if (setFilterActive) suppressNormalProductCards(productContainers);
      const count = root.document.getElementById("productResultsCount");
      if (count && setFilterActive) count.textContent = `${rows.length} set${rows.length === 1 ? "" : "s"}`;
    });
  }

  function ensureSetFilter() {
    const container = root.document.getElementById("filterContainer");
    if (!container) return;
    let button = container.querySelector('[data-category="Sets"]');
    if (!button) {
      button = root.document.createElement("button");
      button.type = "button";
      button.className = "filter-btn";
      button.dataset.category = "Sets";
      button.textContent = "Sets";
      container.appendChild(button);
    }
    if (container.dataset.dartSetsCapture !== "1") {
      container.dataset.dartSetsCapture = "1";
      container.addEventListener("click", (event) => {
        const target = event.target.closest?.(".filter-btn");
        if (!target) return;
        if (target.dataset.category === "Sets") {
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
          container.querySelectorAll(".filter-btn").forEach((node) => node.classList.remove("active"));
          target.classList.add("active");
          setFilterActive = true;
          renderSetCards();
        } else {
          setFilterActive = false;
          queueMicrotask(renderSetCards);
        }
      }, true);
    }
  }

  function ensureModal() {
    let modal = root.document.getElementById("dartSetModal");
    if (modal) return modal;
    modal = root.document.createElement("section");
    modal.id = "dartSetModal";
    modal.className = "dart-set-modal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "dartSetModalTitle");
    modal.innerHTML = `<div class="dart-set-dialog"><button type="button" class="dart-set-close" data-set-close aria-label="Close Set details">&times;</button><div class="dart-set-gallery"><img data-set-cover alt=""><div data-set-thumbs class="dart-set-thumbs"></div></div><article class="dart-set-details"><span class="dart-set-category">Sets</span><small data-set-code></small><h2 id="dartSetModalTitle" data-set-title></h2><p data-set-description></p><div class="dart-set-pricing"><span data-set-old-price></span><strong data-set-price></strong><em data-set-discount></em></div><div data-set-components class="dart-set-components"></div><p class="dart-set-status" data-set-status role="status" aria-live="polite"></p><button type="button" class="buy-now-btn" data-set-add>Add Set to Cart</button><button type="button" class="buy-now-btn dart-waiting-btn" data-set-wait hidden>Join Set Waiting</button></article></div>`;
    root.document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal || event.target.closest?.("[data-set-close]")) closeSetModal(); });
    root.document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeSetModal(); });
    modal.querySelector("[data-set-add]")?.addEventListener("click", () => void addActiveSetToCart());
    modal.querySelector("[data-set-wait]")?.addEventListener("click", () => void joinActiveSetWaiting());
    return modal;
  }

  function componentImages(set) {
    const images = [...(Array.isArray(set.images) ? set.images : [])];
    (set.components || []).forEach((component) => {
      const model = modelFor(component.modelId), color = activeOptions(component.colors)[0] || "";
      try { const image = root.DartCatalog?.cover?.(model, color); if (image) images.push(image); } catch {}
    });
    return [...new Set(images.filter(Boolean))];
  }

  function openSetModal(set) {
    activeSet = set;
    const modal = ensureModal();
    const images = componentImages(set);
    const cover = modal.querySelector("[data-set-cover]");
    cover.src = images[0] || setImage(set); cover.alt = set.name;
    const thumbs = modal.querySelector("[data-set-thumbs]");
    thumbs.replaceChildren();
    images.forEach((src, index) => {
      const button = root.document.createElement("button"); button.type="button"; button.className="dart-set-thumb";
      button.innerHTML = `<img src="${esc(src)}" alt="${esc(set.name)} image ${index+1}">`;
      button.addEventListener("click", () => { cover.src = src; }); thumbs.appendChild(button);
    });
    modal.querySelector("[data-set-code]").textContent = `Code : ${set.setId}`;
    modal.querySelector("[data-set-title]").textContent = set.name;
    modal.querySelector("[data-set-description]").textContent = set.description || "";
    const old = modal.querySelector("[data-set-old-price]");
    const discount = Number(set?.pricing?.discountPercent || 0);
    old.textContent = root.DartSets.moneyMinor(set?.pricing?.basePriceMinor || 0); old.hidden = !(discount > 0);
    modal.querySelector("[data-set-price]").textContent = root.DartSets.moneyMinor(set?.pricing?.finalMinor || 0);
    modal.querySelector("[data-set-discount]").textContent = discount > 0 ? `${Math.round(discount)}% OFF` : "";
    const components = modal.querySelector("[data-set-components]"); components.replaceChildren();
    (set.components || []).forEach((component) => {
      const quantity = Math.max(1, Number(component.quantity)||1);
      for (let unit=1; unit<=quantity; unit+=1) {
        const block = root.document.createElement("div"); block.className="dart-set-component";
        const colors=activeOptions(component.colors), sizes=activeOptions(component.sizes);
        block.dataset.modelId=component.modelId;
        block.innerHTML=`<div class="dart-set-component-head"><strong>${esc(component.name || component.modelId)}${quantity>1?` ${unit}`:""}</strong><small>${esc(component.modelId)}</small></div><label>Color<select data-set-color>${colors.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select></label><label>Size<select data-set-size>${sizes.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select></label>`;
        components.appendChild(block);
      }
    });
    modal.querySelectorAll("select").forEach((select)=>select.addEventListener("change", updateModalAvailability));
    modal.hidden=false; root.document.body.classList.add("dart-set-modal-open");
    updateModalAvailability();
    root.requestAnimationFrame?.(()=>modal.querySelector("[data-set-close]")?.focus());
  }

  function closeSetModal() {
    const modal=root.document.getElementById("dartSetModal"); if (!modal) return;
    modal.hidden=true; root.document.body.classList.remove("dart-set-modal-open"); activeSet=null;
  }

  function selectedComponents() {
    const modal=root.document.getElementById("dartSetModal"); if (!modal) return [];
    return [...modal.querySelectorAll(".dart-set-component")].map((block)=>({
      modelId:String(block.dataset.modelId||""), color:String(block.querySelector("[data-set-color]")?.value||""), size:String(block.querySelector("[data-set-size]")?.value||""),
    }));
  }

  function exactSelectionsAvailable(selections) {
    const counts=new Map();
    selections.forEach((row)=>{ const key=JSON.stringify([row.modelId,row.size,row.color]); counts.set(key,(counts.get(key)||0)+1); });
    for (const [key,count] of counts) { const [modelId,size,color]=JSON.parse(key); if (variantAvailable(modelId,size,color)<count) return false; }
    return true;
  }

  function updateModalAvailability() {
    const modal=root.document.getElementById("dartSetModal"); if (!modal || !activeSet) return;
    const selections=selectedComponents(), ok=selections.length===Number(activeSet.pieceCount||selections.length) && selections.every(r=>r.color&&r.size) && exactSelectionsAvailable(selections);
    const status=modal.querySelector("[data-set-status]");
    if (status) status.textContent=ok?`${selections.length} pieces ready to reserve together.`:"One or more selected pieces are unavailable. You can join Waiting without reserving part of the Set.";
    const add=modal.querySelector("[data-set-add]"); if (add) add.disabled=!ok;
    const wait=modal.querySelector("[data-set-wait]"); if (wait) wait.hidden=ok;
  }

  function nextUnitIndex(setId, groups) {
    return 1+Math.max(0,...groups.filter(g=>g.setId===setId).map(g=>Number(g.unitIndex)||0));
  }

  function lineForSelection(selection, set, key, unitIndex) {
    const model=modelFor(selection.modelId);
    let price=Number(model?.selling || 0);
    try { price=Number(root.DartCatalog?.price?.(model) ?? price); } catch {}
    let image=""; try { image=root.DartCatalog?.cover?.(model,selection.color)||""; } catch {}
    return { id:selection.modelId,title:model?.name||selection.modelId,price,size:selection.size,color:selection.color,quantity:1,image,setId:set.setId,dartSetKey:key,dartSetUnitIndex:unitIndex };
  }

  async function joinActiveSetWaiting() {
    if (!activeSet) return;
    if (!root.DartSets?.signedIn?.()) {
      if (typeof showToast === "function") showToast("سجل دخولك أولاً للانضمام إلى Waiting.");
      root.location.href = "login.html";
      return;
    }
    const selections = selectedComponents();
    try {
      const entry = await root.DartSets.joinWaiting(activeSet.setId, selections);
      if (typeof showToast === "function") {
        showToast(entry?.status === "reserved" ? "الطقم أصبح متاحاً بالكامل وتم حجزه لك." : "تمت إضافتك إلى Waiting للطقم بالكامل.");
      }
      closeSetModal();
    } catch (error) {
      if (error?.code === "SET_STOCK_AVAILABLE") { updateModalAvailability(); }
      if (typeof showToast === "function") showToast(error?.message || "تعذر الانضمام إلى Waiting.");
    }
  }

  async function addActiveSetToCart() {
    if (!activeSet) return;
    const selections=selectedComponents();
    if (!exactSelectionsAvailable(selections)) return updateModalAvailability();
    const current=cartRef(), previousCart=clone(current), previousGroups=drafts();
    const unitIndex=nextUnitIndex(activeSet.setId,previousGroups), key=`${activeSet.setId}:${unitIndex}`;
    const group={setId:activeSet.setId,unitIndex,selections};
    selections.forEach((selection)=>current.push(lineForSelection(selection,activeSet,key,unitIndex)));
    root.DartSets.writeDrafts([...previousGroups,group]);
    try {
      if (typeof persistCartReservation !== "function") throw new Error("Cart reservation service is unavailable.");
      const ok=await persistCartReservation(previousCart);
      if (!ok) { root.DartSets.writeDrafts(previousGroups); return; }
      lastAttachedGroups=normalizeGroups(root.DartSets.readDrafts());
      if (typeof renderCart === "function") renderCart();
      if (typeof showCartBanner === "function") showCartBanner(activeSet.name);
      else if (typeof showToast === "function") showToast(`تم إضافة ${activeSet.name} للسلة`);
      closeSetModal(); scheduleCartDecoration();
    } catch (error) {
      root.DartSets.writeDrafts(previousGroups);
      if (typeof showToast === "function") showToast(error.message || "تعذر إضافة الطقم.");
    }
  }

  function installReservationBridge() {
    const platform=root.DartPlatform;
    if (!platform?.reserveCart || platform.__dartSetsReserveWrapped) return;
    const original=platform.reserveCart.bind(platform);
    platform.__dartSetsReserveWrapped=true;
    platform.reserveCart=async function reserveCartWithSets(nextCart) {
      const previousCart=clone(root.DartState?.read?.("dart_cart",[])||[]);
      const previousGroups=clone(lastAttachedGroups.length?lastAttachedGroups:drafts());
      const payload=await original(nextCart);
      const target=drafts();
      if (!target.length) { lastAttachedGroups=[]; return payload; }
      try {
        const attached=await root.DartSets.attachCartGroups(target,payload?.reservationId||root.DartSets.currentReservationId());
        lastAttachedGroups=normalizeGroups(attached?.groups||target);
        root.DartSets.writeDrafts(lastAttachedGroups);
        return payload;
      } catch (error) {
        try {
          const restored=await original(previousCart);
          if (previousGroups.length) await root.DartSets.attachCartGroups(previousGroups,restored?.reservationId||root.DartSets.currentReservationId());
          root.DartSets.writeDrafts(previousGroups); lastAttachedGroups=previousGroups;
        } catch {}
        throw error;
      }
    };
  }

  function tagCartLines() {
    const cart=cartRef(), groups=drafts();
    const validKeys=new Set(groups.map(g=>`${g.setId}:${g.unitIndex}`));
    cart.forEach((line)=>{ if (line.dartSetKey && !validKeys.has(line.dartSetKey)) { delete line.dartSetKey; delete line.setId; delete line.dartSetUnitIndex; } });
    for (const group of groups) {
      const key=`${group.setId}:${group.unitIndex}`;
      for (const selection of group.selections) {
        let line=cart.find(row=>!row.dartSetKey&&String(row.id)===selection.modelId&&String(row.color)===selection.color&&String(row.size)===selection.size&&Number(row.quantity)>0);
        if (!line) line=cart.find(row=>row.dartSetKey===key&&String(row.id)===selection.modelId&&String(row.color)===selection.color&&String(row.size)===selection.size);
        if (!line) continue;
        if (!line.dartSetKey && Number(line.quantity)>1) {
          line.quantity-=1; const unit={...line,quantity:1}; cart.push(unit); line=unit;
        }
        line.dartSetKey=key; line.setId=group.setId; line.dartSetUnitIndex=group.unitIndex;
      }
    }
    return cart;
  }

  function groupPricing(group) {
    const set=root.DartSets?.setById?.(group.setId);
    return {
      baseMinor:Number.isFinite(Number(group.basePriceMinor))?Number(group.basePriceMinor):Number(set?.pricing?.basePriceMinor||0),
      finalMinor:Number.isFinite(Number(group.finalMinor))?Number(group.finalMinor):Number(set?.pricing?.finalMinor||0),
    };
  }

  function renderSetAwareTotals() {
    const cart=tagCartLines(), groups=drafts();
    if (!groups.length) return;
    const groupKeys=new Set(groups.map(g=>`${g.setId}:${g.unitIndex}`));
    let subtotal=0, finalTotal=0;
    const promotion=root.dartAppliedPromotion||null;
    let cardRemaining=promotion?.type==="Dart Card"?Math.max(0,Number(promotion.itemLimit||promotion.purchasedLimit||10)-Number(promotion.purchasedItems||0)):Number.POSITIVE_INFINITY;
    for (const line of cart) {
      if (line.dartSetKey&&groupKeys.has(line.dartSetKey)) continue;
      const model=modelFor(line.id), original=Number(model?.selling||line.price||0), modelDiscount=Math.max(0,Math.min(100,Number(model?.discount||0))), quantity=Math.max(0,Number(line.quantity)||0);
      subtotal+=original*quantity;
      for (let i=0;i<quantity;i+=1) {
        let rate=modelDiscount/100;
        if (!modelDiscount&&promotion) {
          const p=Math.max(0,Math.min(100,Number(promotion.percent??promotion.discountPercent??0)))/100;
          if (promotion.type!=="Dart Card"||cardRemaining>0) { rate=p; if (promotion.type==="Dart Card") cardRemaining-=1; }
        }
        finalTotal+=original*(1-rate);
      }
    }
    groups.forEach((group)=>{ const p=groupPricing(group); subtotal+=p.baseMinor/100; finalTotal+=p.finalMinor/100; });
    const discount=Math.max(0,subtotal-finalTotal);
    const subtotalEl=root.document.getElementById("subtotalVal"),discountEl=root.document.getElementById("discountVal"),totalEl=root.document.getElementById("totalVal");
    if (subtotalEl) subtotalEl.textContent=`${Math.trunc(subtotal)} EGP`;
    if (discountEl) discountEl.textContent=`${Math.trunc(discount)} EGP`;
    if (totalEl) totalEl.textContent=`${Math.trunc(finalTotal)} EGP`;
  }

  async function removeSetGroup(key) {
    const cart=cartRef(),previousCart=clone(cart),previousGroups=drafts();
    const nextGroups=previousGroups.filter(g=>`${g.setId}:${g.unitIndex}`!==key);
    for (let index=cart.length-1;index>=0;index-=1) if (cart[index]?.dartSetKey===key) cart.splice(index,1);
    root.DartSets.writeDrafts(nextGroups);
    if (typeof persistCartReservation === "function") {
      const ok=await persistCartReservation(previousCart);
      if (!ok) root.DartSets.writeDrafts(previousGroups);
    }
    if (typeof renderCart === "function") renderCart();
  }

  function setCartCardSignature(group, set, pricing) {
    return JSON.stringify({
      key: `${group.setId}:${group.unitIndex}`,
      name: String(set?.name || group.setName || group.setId || ""),
      image: setImage(set || {}),
      specs: group.selections.map((row) => [row.modelName || row.modelId, row.color, row.size]),
      finalMinor: Number(pricing.finalMinor || 0),
    });
  }

  function syncSetCartCard(card, group, set, pricing, key) {
    const signature = setCartCardSignature(group, set, pricing);
    card.dataset.dartSetCartCard = "1";
    card.dataset.dartSetKey = key;
    if (card.dataset.dartSetRenderKey === signature) return card;
    card.dataset.dartSetRenderKey = signature;
    card.className = "cart-product-card dart-set-cart-card";
    const specs=group.selections.map(row=>`${esc(row.modelName||row.modelId)}: ${esc(row.color)} / ${esc(row.size)}`).join(" · ");
    card.innerHTML=`<img src="${esc(setImage(set||{}))}" alt="${esc(set?.name||group.setName||group.setId)}" class="cart-product-img"><div class="cart-product-info"><div class="cart-product-title">${esc(set?.name||group.setName||group.setId)}</div><div class="cart-product-specs dart-set-cart-specs">${specs}</div><div class="cart-product-price-qty"><span class="cart-item-price">${root.DartSets.moneyMinor(pricing.finalMinor)}</span><strong>${group.selections.length} pieces</strong></div><div class="cart-item-total-price">Set Total: <span class="p-total">${root.DartSets.moneyMinor(pricing.finalMinor)}</span></div></div><button type="button" class="remove-item-btn" data-set-remove>حذف</button>`;
    card.querySelector("[data-set-remove]")?.addEventListener("click",()=>void removeSetGroup(key));
    return card;
  }

  function decorateCart() {
    if (cartDecorating) return;
    const container=root.document.getElementById("cartItemsContainer"); if (!container) return;
    cartDecorating=true;
    try {
      const cart=tagCartLines(), groups=drafts();
      const groupKeys=new Set(groups
        .map((group)=>`${group.setId}:${group.unitIndex}`)
        .filter((key)=>cart.some((line)=>line.dartSetKey===key)));
      const baseCards=[...container.querySelectorAll('.cart-product-card:not(#cartItemTemplate):not([data-dart-set-cart-card="1"])')];
      baseCards.forEach((card,index)=>{ card.style.display=cart[index]?.dartSetKey?"none":"flex"; });
      const existing=new Map();
      container.querySelectorAll('[data-dart-set-cart-card="1"]').forEach((card)=>{
        const key=String(card.dataset.dartSetKey||"");
        if (!groupKeys.has(key) || existing.has(key)) { card.remove(); return; }
        existing.set(key,card);
      });
      groups.forEach((group)=>{
        const key=`${group.setId}:${group.unitIndex}`,set=root.DartSets?.setById?.(group.setId),pricing=groupPricing(group);
        const firstIndex=cart.findIndex(line=>line.dartSetKey===key); if (firstIndex<0) return;
        const firstCard=baseCards[firstIndex]; if (!firstCard) return;
        const card=syncSetCartCard(existing.get(key)||root.document.createElement("div"),group,set,pricing,key);
        if (card.parentElement!==container || card.nextElementSibling!==firstCard) firstCard.insertAdjacentElement("beforebegin",card);
      });
      renderSetAwareTotals();
    } finally { cartDecorating=false; }
  }

  function scheduleCartDecoration() { root.setTimeout(decorateCart,0); }

  async function restoreServerGroups() {
    const id=root.DartSets?.currentReservationId?.(); if (!id) return;
    // A fresh Dart session creates a local CART id before any server reservation exists.
    // Do not probe Set-cart state until there is actual cart/Set state to restore.
    if (!drafts().length && !cartRef().length) { scheduleCartDecoration(); return; }
    try {
      const groups=normalizeGroups(await root.DartSets.cartGroups(id));
      if (groups.length) { root.DartSets.writeDrafts(groups); lastAttachedGroups=groups; }
      else if (!cartRef().length) { root.DartSets.clearDrafts(); lastAttachedGroups=[]; }
    } catch (error) {
      const navigationAbort = error?.name === "TypeError" && /Failed to fetch/i.test(String(error?.message || ""));
      if (!navigationAbort && ![401,404,409].includes(error?.status)) console.warn("Dart Set cart restore failed",error);
    }
    scheduleCartDecoration();
  }

  function observe() {
    const scheduleSetRender=()=>root.setTimeout(renderSetCards,0);
    const syncFiltersAndSets=()=>root.setTimeout(()=>{ ensureSetFilter(); renderSetCards(); },0);
    [
      ["productSearchInput","input"],
      ["productSizeFilter","change"],
      ["productColorFilter","change"],
      ["productAvailabilityFilter","change"],
      ["productPriceFilter","change"],
      ["productSortSelect","change"],
    ].forEach(([id,eventName])=>root.document.getElementById(id)?.addEventListener(eventName,scheduleSetRender));
    root.addEventListener("dart:catalog-hydrated",syncFiltersAndSets);
    root.addEventListener("dart:products-rendered",syncFiltersAndSets);
    root.addEventListener("dart:product-filters-rendered",syncFiltersAndSets);
    root.addEventListener("dart:sets-catalog-changed",scheduleSetRender);
    root.addEventListener("dart:data-changed",event=>{
      if (event.detail?.key!=="dart_cart") return;
      scheduleCartDecoration();
      if (cartRef().length && !drafts().length) void restoreServerGroups();
    });
    root.addEventListener("dart:set-cart-draft-changed",scheduleCartDecoration);
    root.addEventListener("dart:customer-session-changed",()=>{ void restoreServerGroups(); void root.DartSets?.loadWaiting?.(); });
    root.document.addEventListener("click",()=>root.setTimeout(renderSetAwareTotals,0),true);
  }

  async function boot() {
    installReservationBridge();
    try { setCatalog=await root.DartSets.loadCatalog(true); } catch (error) { console.warn("Dart Sets catalog unavailable",error); setCatalog=[]; }
    ensureSetFilter(); renderSetCards(); observe();
    lastAttachedGroups=drafts();
    await restoreServerGroups();
    if (root.DartSets?.signedIn?.()) await root.DartSets.loadWaiting().catch(()=>[]);
  }

  if (root.document.readyState==="loading") root.document.addEventListener("DOMContentLoaded",()=>void boot(),{once:true});
  else void boot();
})(typeof window !== "undefined" ? window : globalThis);

