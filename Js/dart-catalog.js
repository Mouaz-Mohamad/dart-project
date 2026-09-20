/* BEGIN DART CATALOG — المصدر المشترك للتصميمات والمخزون والصور.
 * BACKEND: replace read/write with authenticated repositories; keep the public
 * product response free of cost, customer details and internal physical IDs.
 * See API_CONTRACT.md for the API and immutable order-price contract.
 */
(function () {
  "use strict";
  const RESET = "dart_v7_empty_start_completed";
  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const CSRF_STORAGE_KEY = "dart_csrf_token";
  const IS_ADMIN = /\/Eye\//i.test(location.pathname);
  let serverVersion = 0;
  let remoteStock = null;
  let syncTimer = 0;
  let syncChain = Promise.resolve();
  // BEGIN One-time reset explicitly requested by the owner. New entries survive reloads.
  if (localStorage.getItem(RESET) !== "1") {
    Object.keys(localStorage)
      .filter(
        (key) =>
          key.startsWith("dart_") ||
          ["order_45_state", "user_last_address"].includes(key),
      )
      .forEach((key) => localStorage.removeItem(key));
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("dart_"))
      .forEach((key) => sessionStorage.removeItem(key));
    localStorage.setItem(RESET, "1");
  }
  const readCache = new Map();
  const read = (key, fallback = []) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const cached = readCache.get(key);
      if (cached?.raw === raw) return cached.value;
      const value = JSON.parse(raw) ?? fallback;
      readCache.set(key, { raw, value });
      return value;
    } catch {
      return fallback;
    }
  };
  const cacheWrite = (key, data) => {
    const raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
    readCache.set(key, { raw, value: data });
    window.dispatchEvent(
      new CustomEvent("dart:data-changed", { detail: { key } }),
    );
  };

  async function api(path, options = {}) {
    if (!API_BASE) throw new Error("Catalogue API is not configured.");
    const method = String(options.method || "GET").toUpperCase();
    const csrf = localStorage.getItem(CSRF_STORAGE_KEY);
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      method,
      headers: {
        "Content-Type": "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
          ? { "X-CSRF-Token": csrf }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.csrfToken) localStorage.setItem(CSRF_STORAGE_KEY, payload.csrfToken);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Catalogue request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function syncAdminState() {
    if (!IS_ADMIN || !API_BASE || !serverVersion) return;
    const payload = await api("/api/v1/admin/catalog-state", {
      method: "PUT",
      body: {
        expectedVersion: serverVersion,
        models: read("dart_models", []),
        items: read("dart_items", []),
      },
    });
    serverVersion = Number(payload.version || serverVersion);
    cacheWrite("dart_models", payload.models || []);
    cacheWrite("dart_items", payload.items || []);
    window.dispatchEvent(new CustomEvent("dart:catalog-synced", { detail: { version: serverVersion } }));
  }

  function scheduleAdminSync() {
    if (!IS_ADMIN || !API_BASE || !serverVersion) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncChain = syncChain
        .then(syncAdminState)
        .catch(async (error) => {
          console.error("Dart catalogue sync failed", error);
          window.dispatchEvent(new CustomEvent("dart:catalog-sync-error", { detail: { code: error.code || "SYNC_FAILED", message: error.message } }));
          if (error.status === 409) await hydrateCatalog(true);
        });
    }, 120);
  }

  const write = (key, data) => {
    cacheWrite(key, data);
    if (["dart_models", "dart_items"].includes(key)) scheduleAdminSync();
  };

  async function hydrateCatalog(force = false) {
    if (!API_BASE) return;
    if (IS_ADMIN) {
      const localModels = read("dart_models", []);
      const localItems = read("dart_items", []);
      let state = await api("/api/v1/admin/catalog-state");
      serverVersion = Number(state.version || 1);
      if (
        !force &&
        (state.models || []).length === 0 &&
        (state.items || []).length === 0 &&
        (localModels.length > 0 || localItems.length > 0)
      ) {
        state = await api("/api/v1/admin/catalog-state", {
          method: "PUT",
          body: {
            expectedVersion: serverVersion,
            models: localModels,
            items: localItems,
          },
        });
        serverVersion = Number(state.version || serverVersion);
      }
      cacheWrite("dart_models", state.models || []);
      cacheWrite("dart_items", state.items || []);
      remoteStock = null;
    } else {
      const state = await api("/api/v1/catalog");
      serverVersion = Number(state.version || 1);
      cacheWrite("dart_models", state.models || []);
      remoteStock = new Map(Object.entries(state.stock || {}));
    }
    await preloadImages().catch(() => {});
    window.dispatchEvent(new CustomEvent("dart:catalog-hydrated", { detail: { version: serverVersion, admin: IS_ADMIN } }));
  }
  const active = (record) =>
    record &&
    !record.isArchived &&
    !record.isDeleted &&
    record.active !== false;
  const norm = (value) =>
    String(value ?? "")
      .trim()
      .toLocaleLowerCase();
  const uid = () => crypto.randomUUID();
  const placeholder =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="280"><rect width="100%" height="100%" fill="#f4f2f1"/><text x="120" y="140" text-anchor="middle" fill="#666" font-size="16">Dart — No image</text></svg>',
    );
  const models = () => read("dart_models");
  const items = () => read("dart_items");
  const model = (code) => models().find((m) => m.modelId === code);
  const colors = (m) => (Array.isArray(m?.colorOptions) ? m.colorOptions : []);
  const sizes = (m) => (Array.isArray(m?.sizeOptions) ? m.sizeOptions : []);
  const discountPercent = (value) =>
    Math.min(100, Math.max(0, Number(value) || 0));
  const modelPrice = (m) =>
    Math.max(0, Number(m?.selling || 0) * (1 - discountPercent(m?.discount) / 100));
  const pricing = (m) => {
    const originalPrice = Math.max(0, Number(m?.selling || 0));
    const siteDiscount = window.DartSiteSettings?.activeSiteDiscount?.();
    const effectiveDiscountPercent = siteDiscount
      ? discountPercent(siteDiscount.percent)
      : discountPercent(m?.discount);
    return {
      originalPrice,
      finalPrice: Math.max(0, originalPrice * (1 - effectiveDiscountPercent / 100)),
      effectiveDiscountPercent,
      discountSource: effectiveDiscountPercent
        ? siteDiscount ? "Site" : "Model"
        : "",
    };
  };
  const price = (m) => pricing(m).finalPrice;
  // END One-time reset and repositories.

  // BEGIN Shared image storage. Blobs live once in IndexedDB; models hold IDs only.
  // BACKEND: use uploaded asset IDs/URLs instead; never duplicate binaries per Item.
  const imageURLs = new Map();
  let database;
  function db() {
    if (!database)
      database = new Promise((resolve, reject) => {
        const request = indexedDB.open("dart-catalog-media-v7", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("images");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    return database;
  }
  async function imageBlob(id) {
    const store = (await db()).transaction("images").objectStore("images");
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function loadImage(asset) {
    if (!asset?.id || imageURLs.has(asset.id)) return;
    const blob = await imageBlob(asset.id);
    if (blob) imageURLs.set(asset.id, URL.createObjectURL(blob));
  }
  async function preloadImages() {
    const assets = models().flatMap((m) =>
      colors(m).flatMap((c) => (c.images?.length ? [c.images[0]] : [])),
    );
    await Promise.all(assets.map((asset) => loadImage(asset).catch(() => {})));
    window.dispatchEvent(new Event("dart:images-ready"));
  }
  async function loadModelImages(code) {
    await Promise.all(
      colors(model(code))
        .flatMap((c) => c.images || [])
        .map((asset) => loadImage(asset).catch(() => {})),
    );
  }
  async function saveImage(file) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    )
      throw new Error("Choose JPG, PNG or WebP, up to 10 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.84),
    );
    if (!blob) throw new Error("Could not prepare this image.");
    const id = uid(),
      connection = await db();
    await new Promise((resolve, reject) => {
      const tx = connection.transaction("images", "readwrite");
      tx.objectStore("images").put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    imageURLs.set(id, URL.createObjectURL(blob));
    return { id, name: file.name };
  }
  const imageSrc = (asset) =>
    asset?.url || imageURLs.get(asset?.id) || placeholder;
  function cover(m, colorName) {
    const c = colors(m).find((c) => norm(c.name) === norm(colorName));
    return imageSrc(
      c?.images?.[0] || colors(m).find((c) => c.images?.length)?.images[0],
    );
  }
  // END Shared image storage.

  // BEGIN Inventory projections. Quantities are derived; no editable stock counters.
  function available(m, size, color, owner = "") {
    if (
      !active(m) ||
      !colors(m).some((c) => active(c) && c.name === color) ||
      !sizes(m).some((s) => active(s) && s.name === String(size))
    )
      return 0;
    if (!IS_ADMIN && remoteStock && !owner) {
      return Number(remoteStock.get(JSON.stringify([m.modelId, color, String(size)])) || 0);
    }
    return items().filter(
      (i) =>
        i.modelId === m.modelId &&
        String(i.size) === String(size) &&
        i.color === color &&
        active(i) &&
        (norm(i.status) === "in stock" ||
          (owner &&
            norm(i.status) === "cart reserved" &&
            i.cartReservationId === owner &&
            Date.parse(i.reservationUntil) > Date.now())),
    ).length;
  }
  const groupKey = (i) =>
    JSON.stringify([i.modelId, String(i.color), String(i.size)]);
  function groups(
    allItems = items(),
    allModels = models(),
    orders = read("dart_orders"),
  ) {
    const map = new Map(),
      modelMap = new Map(allModels.map((m) => [m.modelId, m])),
      orderMap = new Map(orders.map((o) => [o.orderId, o]));
    for (const i of allItems) {
      const key = groupKey(i),
        m = modelMap.get(i.modelId);
      if (!map.has(key))
        map.set(key, {
          key,
          modelId: i.modelId,
          name: m?.name || "",
          color: i.color,
          size: String(i.size),
          total: 0,
          stock: 0,
          reserved: 0,
          processing: 0,
          withRep: 0,
          sold: 0,
          refused: 0,
          damaged: 0,
          limit: Number(m?.lowStockLimit ?? 5),
          createdAt: i.createdAt || "",
          image: cover(m, i.color),
        });
      const g = map.get(key);
      g.total++;
      if ((i.createdAt || "") > g.createdAt) g.createdAt = i.createdAt;
      const state = norm(i.status),
        order = orderMap.get(i.orderId);
      if (state === "sold") g.sold++;
      else if (
        ["damaged", "destroyed", "repair", "under repair"].includes(state)
      )
        g.damaged++;
      else if (
        ["refused", "return inspection", "returned inspection"].includes(state)
      )
        g.refused++;
      else if (
        active(i) &&
        ["out with representative", "representative on the way"].includes(
          norm(order?.status),
        )
      )
        g.withRep++;
      else if (active(i) && state === "in stock") g.stock++;
      else if (active(i) && state === "cart reserved") g.reserved++;
      else if (
        active(i) &&
        ["processing/held", "processing", "held"].includes(state)
      )
        g.processing++;
    }
    return [...map.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  function products() {
    return models()
      .filter(active)
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      )
      .map((m) => {
        const stock = {};
        for (const s of sizes(m).filter(active)) {
          stock[s.name] = {};
          for (const c of colors(m).filter(active))
            stock[s.name][c.name] = available(m, s.name, c.name);
        }
        const gallery = colors(m)
          .filter(active)
          .flatMap((c) =>
            (c.images || []).map((img) => ({
              src: imageSrc(img),
              color: c.name,
              assetId: img.id,
            })),
          );
        const currentPricing = pricing(m);
        return {
          id: m.modelId,
          code: m.modelId,
          title: m.name,
          category: m.category,
          description: m.description || "",
          price: currentPricing.finalPrice,
          originalPrice: currentPricing.originalPrice,
          effectiveDiscountPercent: currentPricing.effectiveDiscountPercent,
          discountSource: currentPricing.discountSource,
          selling: Number(m.selling),
          discount: Number(m.discount) || 0,
          stock,
          images: gallery.map((i) => i.src),
          gallery,
          colorOptions: colors(m).filter(active),
          sizeOptions: sizes(m).filter(active),
          sizeChart: m.sizeChart,
          createdAt: m.createdAt,
          lowStockLimit: Number(m.lowStockLimit ?? 5),
        };
      });
  }
  function snapshot(m, i) {
    const original = Number(m.selling) || 0,
      final = modelPrice(m);
    return {
      itemId: i.id,
      itemCode: i.itemCode,
      modelCode: m.modelId,
      name: m.name,
      color: i.color,
      size: String(i.size),
      qty: 1,
      originalUnitPrice: original,
      discountPercent: Number(m.discount) || 0,
      discountAmount: original - final,
      finalUnitPrice: final,
      costSnapshot: Number(m.cost) || 0,
    };
  }
  // END Inventory projections.
  window.DartCatalog = {
    read,
    write,
    active,
    norm,
    uid,
    models,
    items,
    model,
    colors,
    sizes,
    price,
    pricing,
    modelPrice,
    cover,
    placeholder,
    imageSrc,
    saveImage,
    loadImage,
    loadModelImages,
    preloadImages,
    available,
    groupKey,
    groups,
    products,
    snapshot,
    hydrate: hydrateCatalog,
    syncAdminState,
    serverVersion: () => serverVersion,
    isServerAuthoritative: () => Boolean(API_BASE && serverVersion),
  };
  window.addEventListener("storage", (e) => {
    if (["dart_models", "dart_items", "dart_orders"].includes(e.key)) {
      preloadImages();
      window.dispatchEvent(
        new CustomEvent("dart:data-changed", { detail: { key: e.key } }),
      );
    }
  });
  preloadImages();
  hydrateCatalog().catch((error) => {
    console.error("Dart catalogue hydration failed", error);
    window.dispatchEvent(new CustomEvent("dart:catalog-hydration-error", { detail: { code: error.code || "HYDRATION_FAILED", message: error.message } }));
  });
})();
/* END DART CATALOG */
