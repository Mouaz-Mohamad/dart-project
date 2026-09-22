// DART CODE GUIDE | Js/dart-catalog.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-catalog.js
// Catalog/models/items authority adapter and inventory-derived helpers.
// BEGIN MODULE

/* BEGIN DART CATALOG — المصدر المشترك للتصميمات والمخزون والصور.
 * BACKEND: replace read/write with authenticated repositories; keep the public
 * product response free of cost, customer details and internal physical IDs.
 * See API_CONTRACT.md for the API and immutable order-price contract.
 */
(function () {
  "use strict";
  // Production: never wipe browser state on load. Server hydration owns business data.
  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const IS_ADMIN = /\/Eye\//i.test(location.pathname);
  let serverVersion = 0;
  let remoteStock = null;
  let syncTimer = 0;
  let syncChain = Promise.resolve();
  let catalogDirty = false;

  function normalizeStockKey(modelId, color, size) {
    return JSON.stringify([
      String(modelId ?? "").trim(),
      String(color ?? "").trim().toLocaleLowerCase(),
      String(size ?? "").trim().toLocaleLowerCase(),
    ]);
  }

  function stockMapFromPayload(payload) {
    const map = new Map();
    for (const [rawKey, rawQuantity] of Object.entries(payload || {})) {
      const quantity = Number(rawQuantity) || 0;
      map.set(rawKey, quantity);
      try {
        const parsed = JSON.parse(rawKey);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          const normalizedKey = normalizeStockKey(
            parsed[0],
            parsed[1],
            parsed[2],
          );
          if (normalizedKey !== rawKey) {
            map.set(
              normalizedKey,
              Number(map.get(normalizedKey) || 0) + quantity,
            );
          }
        }
      } catch {
        // Ignore malformed legacy stock keys; exact key remains available.
      }
    }
    return map;
  }

  const read = (key, fallback = []) =>
    window.DartState?.read?.(key, fallback) ?? fallback;
  const cacheWrite = (key, data) => {
    window.DartState?.write?.(key, data, { source: "catalog" });
  };
  let csrfMemory = "";

  async function api(path, options = {}) {
    if (!API_BASE) throw new Error("Catalogue API is not configured.");
    const method = String(options.method || "GET").toUpperCase();
    const csrf =
      csrfMemory ||
      document.cookie
        .split("; ")
        .find((row) => row.startsWith("dart_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
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
    if (payload?.csrfToken) csrfMemory = payload.csrfToken;
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
    catalogDirty = false;
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
    if (["dart_models", "dart_items"].includes(key)) {
      catalogDirty = true;
      scheduleAdminSync();
    }
  };

  async function hydrateCatalog(_force = false) {
    if (!API_BASE) throw new Error("Catalogue API is not configured.");
    if (IS_ADMIN) {
      const state = await api("/api/v1/admin/catalog-state");
      serverVersion = Number(state.version || 1);
      catalogDirty = false;
      cacheWrite("dart_models", state.models || []);
      cacheWrite("dart_items", state.items || []);
      remoteStock = null;
    } else {
      const state = await api("/api/v1/catalog");
      serverVersion = Number(state.version || 1);
      cacheWrite("dart_models", state.models || []);
      cacheWrite("dart_items", []);
      remoteStock = stockMapFromPayload(state.stock || {});
    }
    await preloadImages().catch(() => {});
    window.dispatchEvent(new CustomEvent("dart:catalog-hydrated", {
      detail: { version: serverVersion, admin: IS_ADMIN },
    }));
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
  const uid = () => {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint32Array(4)))
      .map((value) => value.toString(36))
      .join("-");
  };
  const placeholder =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="280"><rect width="100%" height="100%" fill="#f4f2f1"/><text x="120" y="140" text-anchor="middle" fill="#666" font-size="16">Dart — No image</text></svg>',
    );
  const models = () =>
    !IS_ADMIN && !serverVersion ? [] : read("dart_models");
  const items = () =>
    IS_ADMIN ? read("dart_items") : [];
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
  // END Server-backed repositories.

  // BEGIN Shared image storage. Images are compressed client-side and persisted server-side.
  const imageURLs = new Map();

  function assetPath(id) {
    const encodedId = encodeURIComponent(String(id || ""));
    return API_BASE ? `${API_BASE}/api/v1/catalog/assets/${encodedId}` : `/api/v1/catalog/assets/${encodedId}`;
  }
  function resolveAssetUrl(value, assetId = "") {
    const raw = String(value || "").trim();
    if (!raw) return assetId ? assetPath(assetId) : "";
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith("/")) return API_BASE ? `${API_BASE}${raw}` : raw;
    return raw;
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function uploadAssetBlob(id, name, blob) {
    if (!IS_ADMIN || !API_BASE) throw new Error("Dashboard authentication is required to upload product images.");
    if (!blob || blob.size > 4 * 1024 * 1024) throw new Error("Compressed product image is too large.");
    const result = await api("/api/v1/admin/catalog/assets", {
      method: "PUT",
      body: { assetId: id, originalName: name || "", contentType: blob.type || "image/webp", base64: await blobToBase64(blob) },
    });
    return resolveAssetUrl(result.urlPath, id) || assetPath(id);
  }
  async function loadImage(asset) {
    return imageSrc(asset);
  }
  async function preloadImages() { window.dispatchEvent(new Event("dart:images-ready")); }
  async function loadModelImages() { window.dispatchEvent(new Event("dart:images-ready")); }
  async function migrateLegacyAssets() { return false; }

  async function loadCompressibleImage(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Could not read the selected image."));
        element.src = objectUrl;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  async function compressImage(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024)
      throw new Error("Choose JPG, PNG or WebP, up to 15 MB.");
    const image = await loadCompressibleImage(file);
    try {
      const maxDimension = 1400;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image compression is unavailable in this browser.");
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      let quality = 0.8, blob = null;
      while (quality >= 0.56) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.size <= 4 * 1024 * 1024) break;
        quality -= 0.08;
      }
      if (!blob || blob.size > 4 * 1024 * 1024) throw new Error("Could not compress this image below 4 MB.");
      return blob;
    } finally { image.cleanup(); }
  }
  async function saveImage(file) {
    const blob = await compressImage(file);
    const id = uid();
    const preview = URL.createObjectURL(blob);
    imageURLs.set(id, preview);
    try {
      const url = await uploadAssetBlob(id, file.name, blob);
      return { id, name: file.name, url };
    } catch (error) {
      imageURLs.delete(id);
      URL.revokeObjectURL(preview);
      throw error;
    }
  }
  const imageSrc = (asset) => {
    if (!asset) return placeholder;
    const local = imageURLs.get(asset.id);
    if (local) return local;
    if (asset.url) return resolveAssetUrl(asset.url, asset.id);
    if (asset.id && API_BASE) return assetPath(asset.id);
    return placeholder;
  };
  function cover(m, colorName) {
    const color = colors(m).find((row) => norm(row.name) === norm(colorName));
    return imageSrc(color?.images?.[0] || colors(m).find((row) => row.images?.length)?.images?.[0]);
  }
  // END Shared image storage.  // END Shared image storage.

  // BEGIN Inventory projections. Quantities are derived; no editable stock counters.
  function available(m, size, color, owner = "") {
    if (
      !active(m) ||
      !colors(m).some((c) => active(c) && norm(c.name) === norm(color)) ||
      !sizes(m).some((s) => active(s) && norm(s.name) === norm(size))
    )
      return 0;
    if (!IS_ADMIN && remoteStock) {
      const exactKey = JSON.stringify([m.modelId, color, String(size)]);
      const normalizedKey = normalizeStockKey(m.modelId, color, size);
      return Number(
        remoteStock.get(exactKey) ??
          remoteStock.get(normalizedKey) ??
          0,
      );
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
    checkForServerChanges,
    migrateLegacyAssets,
  };
  let versionPollTimer = 0;
  let versionCheckBusy = false;

  async function checkForServerChanges() {
    if (!API_BASE || versionCheckBusy || document.hidden) return;
    versionCheckBusy = true;
    try {
      if (IS_ADMIN && catalogDirty && serverVersion) {
        try {
          await syncAdminState();
        } catch (error) {
          if (error.status === 409) {
            await hydrateCatalog(true);
          } else {
            throw error;
          }
        }
      }
      const payload = await api("/api/v1/catalog/version");
      const remoteVersion = Number(payload.version || 0);
      if (remoteVersion && serverVersion && remoteVersion !== serverVersion) {
        await hydrateCatalog(true);
      }
    } catch (error) {
      console.warn("Dart catalogue live refresh failed", error);
    } finally {
      versionCheckBusy = false;
    }
  }

  function startLiveRefresh() {
    clearInterval(versionPollTimer);
    const intervalMs = IS_ADMIN ? 3000 : 20000;
    versionPollTimer = window.setInterval(() => {
      if (!document.hidden) void checkForServerChanges();
    }, intervalMs);
  }

  window.addEventListener("online", () => {
    if (IS_ADMIN && catalogDirty) scheduleAdminSync();
    checkForServerChanges();
  });
  window.addEventListener("focus", checkForServerChanges);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForServerChanges();
  });
  startLiveRefresh();

  preloadImages();
  hydrateCatalog().catch((error) => {
    console.error("Dart catalogue hydration failed", error);
    window.dispatchEvent(new CustomEvent("dart:catalog-hydration-error", { detail: { code: error.code || "HYDRATION_FAILED", message: error.message } }));
  });
})();
/* END DART CATALOG */


// END MODULE
