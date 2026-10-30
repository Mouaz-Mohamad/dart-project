// DART CODE GUIDE | src/storefront/home-ui.js
// Homepage-only storefront runtime. Keeps Home fast by excluding checkout/maps/profile/returns code.

const DART_LOCAL_DEMO_MODE = ["localhost", "127.0.0.1"].includes(location.hostname);
let productsData = DartCatalog.products();
let selectedSize = null;
let selectedColor = null;
let activeProduct = null;
let modalQuantity = 1;
let reviewsData = [];
let reviewsLoadFailed = false;
let cachedProductTemplate = null;
let dartPageUnloading = false;
function readFastCartSnapshot() {
    const memory = window.DartState?.read?.("dart_cart", []) || [];
    return Array.isArray(memory) ? memory : [];
}
function cacheFastCartSnapshot() {
    // Retire old cart snapshots. Reservation contents are rehydrated from PostgreSQL.
    try { sessionStorage.removeItem("dart_cart_ui_cache_v1"); } catch {}
}
cacheFastCartSnapshot();
let cartData = readFastCartSnapshot();

function escapeCatalogHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

function createUiState(type, title, message, actionLabel = "", action = null) {
  const state = document.createElement("div");
  state.className = `dart-ui-state dart-ui-state-${type}`;
  state.setAttribute("role", type === "error" ? "alert" : "status");
  state.innerHTML = `<span class="dart-ui-state-icon" aria-hidden="true"></span><div><strong>${escapeCatalogHtml(title)}</strong><p>${escapeCatalogHtml(message)}</p></div>`;
  if (actionLabel && typeof action === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dart-ui-state-action";
    button.textContent = actionLabel;
    button.addEventListener("click", action);
    state.appendChild(button);
  }
  return state;
}

function setUiState(container, type, title, message, actionLabel = "", action = null) {
  if (!container) return null;
  const state = createUiState(type, title, message, actionLabel, action);
  container.replaceChildren(state);
  return state;
}

function publicCatalogProducts() {
  return window.DartStorefront?.cards?.() || [];
}

function getAvailableStock(product, size, color) {
  return DartCatalog.available(
    DartCatalog.model(product.code || product.id),
    size,
    color,
    window.DartPlatform?.cartReservationId || "",
  );
}

function productStockPairs(product) {
  const pairs = [];
  Object.entries(product.stock || {}).forEach(([size, colors]) => {
    Object.keys(colors || {})
      .filter((color) => !product.cardColor || color === product.cardColor)
      .forEach((color) => pairs.push({
        size: String(size),
        color: String(color),
        quantity: getAvailableStock(product, size, color),
      }));
  });
  return pairs;
}

function getProductImages(item) {
  if (item && Array.isArray(item.images) && item.images.length) return item.images;
  if (item?.image) return [item.image];
  return [];
}

function getProductTemplate() {
  if (!cachedProductTemplate) {
    const source = document.getElementById("productTemplate");
    if (source) cachedProductTemplate = source.cloneNode(true);
  }
  return cachedProductTemplate;
}

function clearRenderedProducts(container) {
  if (!container) return;
  [...container.children].forEach((child) => {
    if (child.id !== "productTemplate") child.remove();
  });
}

function createProductCard(item, template) {
  const card = template.cloneNode(true);
  card.removeAttribute("id");
  card.style.display = "flex";
  card.style.position = "relative";
  card.dataset.id = item.id;
  card.dataset.color = item.cardColor || "";
  card.tabIndex = 0;

  const image = card.querySelector(".product-img");
  if (image) {
    const images = getProductImages(item);
    image.src = images[0] || "";
    image.alt = item.title || "Dart product";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.hidden = true;
      if (card.querySelector(".dart-product-image-error")) return;
      const fallback = document.createElement("div");
      fallback.className = "dart-product-image-error";
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", `Image unavailable for ${item.title || "Dart product"}`);
      fallback.innerHTML = '<span aria-hidden="true">□</span><span>Image unavailable</span>';
      image.insertAdjacentElement("afterend", fallback);
    }, { once: true });
  }

  const category = card.querySelector(".product-category");
  if (category) category.textContent = item.category || "";
  const title = card.querySelector(".product-title");
  if (title) title.textContent = item.title || "";
  const code = card.querySelector(".product-code");
  if (code) code.textContent = `Code : ${item.code || ""}`;

  const currentPrice = card.querySelector('[data-product-price="current"], .product-price');
  const oldPrice = card.querySelector('[data-product-price="old"]');
  const discountBadge = card.querySelector('[data-product-price="discount"]');
  const finalPrice = Math.max(0, Number(item.price) || 0);
  const originalPrice = Math.max(finalPrice, Number(item.originalPrice) || finalPrice);
  const discount = Math.min(100, Math.max(0, Number(item.effectiveDiscountPercent) || 0));
  if (currentPrice) currentPrice.textContent = `EGP ${window.DartState.formatMoney(finalPrice)}`;
  if (oldPrice) {
    oldPrice.textContent = `EGP ${window.DartState.formatMoney(originalPrice)}`;
    oldPrice.hidden = !discount;
  }
  if (discountBadge) {
    discountBadge.textContent = `خصم ${Math.round(discount)}%`;
    discountBadge.hidden = !discount;
  }

  const inStock = productStockPairs(item).some((pair) => pair.quantity > 0);
  if (!inStock) {
    card.classList.add("out-of-stock");
    const badge = document.createElement("span");
    badge.className = "out-of-stock-badge";
    badge.textContent = "Sold Out";
    card.appendChild(badge);
  }

  card.querySelector(".cart-btn")?.setAttribute("data-id", item.id);
  return card;
}

function appendProductCards(container, products, template) {
  if (!container || !products.length) return;
  const fragment = document.createDocumentFragment();
  products.forEach((item) => fragment.appendChild(createProductCard(item, template)));
  container.appendChild(fragment);
}

function renderProductsLogic() {
  const template = getProductTemplate();
  if (!template || !window.DartStorefront?.cards) return;

  const cards = publicCatalogProducts();
  productsData = DartCatalog.products();

  const newest = document.getElementById("productsContainer");
  if (newest) {
    clearRenderedProducts(newest);
    const rows = cards.slice(0, 8);
    appendProductCards(newest, rows, template);
    if (!rows.length) newest.appendChild(createUiState("empty", "No products yet", "New Dart products will appear here."));
  }

  const best = document.getElementById("bestProductsContainer");
  if (best) {
    clearRenderedProducts(best);
    const rows = cards.filter((product) => productStockPairs(product).some((pair) => pair.quantity > 0)).slice(0, 5);
    appendProductCards(best, rows, template);
    if (!rows.length) best.appendChild(createUiState("empty", "No best sellers yet", "Available products will appear here."));
  }
  window.dispatchEvent(new CustomEvent("dart:products-rendered"));
}

async function hydratePublicReviews() {
  try {
    const apiBase = String(window.DART_API_BASE_URL || window.DartApi?.baseUrl || location.origin).replace(/\/$/, "");
    const response = await fetch(`${apiBase}/api/v1/reviews`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Reviews request failed");
    const payload = await response.json();
    reviewsData = Array.isArray(payload.reviews) ? payload.reviews : [];
    reviewsLoadFailed = false;
  } catch {
    reviewsData = [];
    reviewsLoadFailed = true;
  }
  renderReviewsLogic();
  return reviewsData;
}

// The same vector stars are used on cards and in the full-review dialog.
function renderReviewStars(container, rating) {
  if (!container) return;
  container.replaceChildren();
  const count = Math.max(0, Math.min(5, Number(rating) || 0));
  container.setAttribute("role", "img");
  container.setAttribute("aria-label", `${count} out of 5 stars`);
  for (let index = 1; index <= 5; index += 1) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("dart-review-star", index <= count ? "is-filled" : "is-empty");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.classList.add("dart-star-shape");
    shape.setAttribute("d", "M16 3.5c.5 0 .9.3 1.1.8l3.4 7 7.7 1.1c1 .1 1.3 1.3.6 1.9l-5.6 5.5 1.3 7.7c.2 1-.8 1.7-1.7 1.2L16 25l-6.8 3.6c-.9.5-1.9-.2-1.7-1.2l1.3-7.7-5.6-5.5c-.7-.7-.3-1.8.6-1.9l7.7-1.1 3.4-7c.2-.5.6-.8 1.1-.8Z");
    const sparkle = document.createElementNS("http://www.w3.org/2000/svg", "path");
    sparkle.classList.add("dart-star-spark");
    sparkle.setAttribute("d", "M16 11.7l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z");
    svg.append(shape, sparkle);
    container.appendChild(svg);
  }
}

function renderReviewsLogic() {
  const container = document.getElementById("reviewsContainer");
  const template = document.getElementById("reviewTemplate");
  if (!container || !template) return;
  if (!container.dataset.dartReviewDialogBound) {
    container.dataset.dartReviewDialogBound = "1";
    container.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-review-read-more]");
      if (!trigger) return;
      const item = reviewsData[Number(trigger.dataset.reviewIndex)];
      const dialog = document.getElementById("dartReviewDialog");
      if (!item || !dialog) return;
      renderReviewStars(dialog.querySelector(".stars"), item.rating);
      dialog.querySelector("#dart-review-full-title").textContent = item.title || "";
      dialog.querySelector("#dart-review-full-text").textContent = item.comment || "";
      dialog.querySelector(".dart-review-dialog-name").textContent = item.name || "";
      dialog.querySelector(".dart-review-dialog-date").textContent = item.date || "";
      if (!dialog.open) dialog.showModal();
    });
    const dialog = document.getElementById("dartReviewDialog");
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-review-dialog-close]")) dialog.close();
    });
  }
  [...container.children].forEach((child) => {
    if (child.id !== "reviewTemplate") child.remove();
  });

  if (!reviewsData.length) {
    container.appendChild(
      reviewsLoadFailed
        ? createUiState("error", "Reviews temporarily unavailable", "Verified reviews could not be loaded from Dart right now.", "Retry", () => void hydratePublicReviews())
        : createUiState("empty", "No reviews yet", "Verified customer reviews will appear here after delivered orders."),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  reviewsData.forEach((item, index) => {
    const card = template.cloneNode(true);
    card.removeAttribute("id");
    card.style.display = "flex";
    renderReviewStars(card.querySelector(".stars"), item.rating);
    const title = card.querySelector(".review-title");
    const text = card.querySelector(".review-text");
    const name = card.querySelector(".user-name-");
    const date = card.querySelector(".review-date");
    const more = card.querySelector("[data-review-read-more]");
    if (title) title.textContent = item.title || "";
    if (text) text.textContent = item.comment || "";
    if (name) name.textContent = item.name || "";
    if (date) date.textContent = item.date || "";
    if (more) more.dataset.reviewIndex = String(index);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

/* DART_SHARED_SECTIONS */

function initHeader() {
  const trigger = document.querySelector(".icon-menu");
  const menu = document.querySelector(".side-menu");
  const overlay = document.querySelector(".menu-facke");
  if (!trigger || trigger.dataset.dartMenuBound === "1") return;
  trigger.dataset.dartMenuBound = "1";

  const close = () => {
    menu?.classList.remove("active");
    overlay?.classList.remove("active");
    document.body.classList.remove("menu-open");
    trigger.setAttribute("aria-expanded", "false");
    menu?.setAttribute("aria-hidden", "true");
  };
  const open = () => {
    menu?.classList.add("active");
    overlay?.classList.add("active");
    document.body.classList.add("menu-open");
    trigger.setAttribute("aria-expanded", "true");
    menu?.setAttribute("aria-hidden", "false");
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    menu?.classList.contains("active") ? close() : open();
  });
  overlay?.addEventListener("click", close);
  menu?.addEventListener("click", (event) => {
    if (event.target.closest("a[href]")) close();
  });
  document.addEventListener("click", (event) => {
    if (menu?.classList.contains("active") && !menu.contains(event.target) && !trigger.contains(event.target)) close();
  });
  window.addEventListener("pagehide", close);
}

function updateCartCount() {
  const total = cartData.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  document.querySelectorAll(".cart-count, #cartCount").forEach((node) => {
    node.textContent = String(total);
    node.style.display = total > 0 ? "inline-block" : "none";
  });
}

function showToast(message) {
  document.querySelector(".custom-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "custom-toast";
  toast.textContent = String(message || "");
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

function showCartBanner(productTitle) {
  let banner = document.getElementById("cartBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "cartBanner";
    banner.className = "cart-banner";
    document.body.appendChild(banner);
  }
  banner.textContent = `تم إضافة "${String(productTitle || "")}" للسلة`;
  banner.classList.add("show");
  clearTimeout(window.cartBannerTimeout);
  window.cartBannerTimeout = window.setTimeout(() => banner.classList.remove("show"), 2500);
}

async function persistCartReservation(previous) {
  const sequence = persistCartReservation.sequence = (persistCartReservation.sequence || 0) + 1;
  try {
    cacheFastCartSnapshot(cartData);
    if (!window.DartPlatform?.reserveCart) throw new Error("تعذر الاتصال بخدمة حجز السلة.");
    await window.DartPlatform.reserveCart(cartData);
    if (sequence === persistCartReservation.sequence) window.DartAnalytics?.trackCartIncrease?.(previous, cartData);
    return true;
  } catch (error) {
    if (sequence !== persistCartReservation.sequence) return false;
    cartData = previous;
    cacheFastCartSnapshot(previous);
    window.DartState?.write?.("dart_cart", previous, { source: "cart-rollback" });
    updateCartCount();
    showToast(error?.message || "تعذر حجز القطعة. حاول مرة أخرى.");
    return false;
  }
}

const defaultScenes = [
  { hold: 2000, words: [{ text: "Dart |", color: "#AB012B", size: "50px", weight: "600" }, { text: "For You", color: "#fff", size: "50px", weight: "400" }] },
  { hold: 2000, words: [{ text: "Delivered Fast", color: "#fff", size: "35px", weight: "400" }, { text: "up to", color: "#fff", size: "35px", weight: "400" }, { text: "12h.", color: "#AB012B", size: "50px", weight: "600" }] },
  { hold: 2500, words: [{ text: "30%", color: "#AB012B", size: "40px", weight: "700" }, { text: "birthday", color: "#fff", size: "30px", weight: "500" }, { text: "discount.", color: "#fff", size: "30px", weight: "800" }] },
  { hold: 2200, words: [{ text: "Easy", color: "#AB012B", size: "50px", weight: "500" }, { text: "R&E", color: "#fff", size: "30px", weight: "300" }] },
  { hold: 2200, words: [{ text: "Made", color: "#fff", size: "30px", weight: "300" }, { text: "For You", color: "#AB012B", size: "40px", weight: "500" }] },
];

let typingRunId = 0;

function restartHeroTyping() {
  const container = document.getElementById("dartTyping");
  if (!container) return;
  const settings = window.DartSiteSettings?.get?.().typing || {};
  const scenes = Array.isArray(settings.scenes) && settings.scenes.length ? settings.scenes : defaultScenes;
  const typingSpeed = Math.max(10, Number(settings.typingSpeed) || 70);
  const deletingSpeed = Math.max(5, Number(settings.deletingSpeed) || 10);
  const wordDelay = Math.max(0, Number(settings.wordDelay) || 100);
  const nextSceneDelay = Math.max(0, Number(settings.nextSceneDelay) || 400);
  const runId = ++typingRunId;
  let sceneIndex = 0;
  let wordIndex = 0;

  const syncCursor = () => {
    const title = container.closest(".dart-hero-title");
    const cursor = title?.querySelector(".dart-cursor");
    const words = container.querySelectorAll(".dart-word");
    const last = words[words.length - 1];
    if (!cursor) return;
    cursor.style.transform = `translate3d(${Math.round(last ? last.offsetLeft + last.offsetWidth : 0)}px, ${Math.round(last ? last.offsetTop : 0)}px, 0)`;
  };
  const later = (callback, delay) => window.setTimeout(() => runId === typingRunId && callback(), delay);

  const nextScene = () => {
    container.replaceChildren();
    wordIndex = 0;
    sceneIndex = (sceneIndex + 1) % scenes.length;
    requestAnimationFrame(syncCursor);
    later(typeScene, nextSceneDelay);
  };
  const deleteScene = () => {
    const words = container.querySelectorAll(".dart-word");
    const last = words[words.length - 1];
    if (!last) return nextScene();
    const text = last.textContent || "";
    if (text.length) {
      last.textContent = text.slice(0, -1);
      requestAnimationFrame(syncCursor);
      later(deleteScene, deletingSpeed);
    } else {
      last.remove();
      later(deleteScene, deletingSpeed);
    }
  };
  const typeScene = () => {
    const scene = scenes[sceneIndex];
    if (!scene) return;
    if (wordIndex >= scene.words.length) return later(deleteScene, Number(scene.hold) || 0);
    const word = scene.words[wordIndex++];
    const text = String(word.text || "").replace(/(^|\s)([a-z])/g, (_, space, letter) => space + letter.toUpperCase());
    const span = document.createElement("span");
    span.className = "dart-word";
    span.style.color = word.color || "#111";
    span.style.fontSize = window.DartSiteSettings?.heroWordSize?.(word.size, 60) || `${Math.max(10, Number.parseFloat(word.size) || 60)}px`;
    span.style.fontWeight = String(word.weight || "400");
    span.style.display = "inline-block";
    container.appendChild(span);
    let index = 0;
    const typeChar = () => {
      span.textContent = text.slice(0, ++index);
      requestAnimationFrame(syncCursor);
      if (index < text.length) later(typeChar, typingSpeed);
      else {
        container.appendChild(document.createTextNode(" "));
        later(typeScene, wordDelay);
      }
    };
    typeChar();
  };

  container.replaceChildren();
  typeScene();
}

function scheduleOptionalSections() {
    preloadPageSections([
        ["leaderboard-card", "sections/leaderboard-card.html"],
        ["birthday", "sections/birthday.html"],
        ["feedback-form", "sections/form-feedback.html"],
        ["why", "sections/why-dart.html"],
    ]);
}

window.addEventListener("pagehide", () => {
  dartPageUnloading = true;
});
window.addEventListener("pageshow", () => { dartPageUnloading = false; });

window.addEventListener("dart:data-changed", (event) => {
  if (event.detail?.key !== "dart_cart") return;
  const next = window.DartState?.read?.("dart_cart", []);
  if (Array.isArray(next)) {
    cartData = next;
    cacheFastCartSnapshot(next);
    updateCartCount();
  }
});

window.addEventListener("dart:catalog-hydrated", () => {
  productsData = DartCatalog.products();
  requestAnimationFrame(renderProductsLogic);
});

window.addEventListener("dart:site-settings-changed", restartHeroTyping);

document.querySelectorAll("[data-go-products]").forEach((button) => {
  button.addEventListener("click", () => {
    location.href = "/products.html";
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadSection("header-container", "sections/Nav-Bar.html", 5000), loadSection("footer", "sections/footer.html", 5000)]);
  initHeader();
  updateCartCount();

  requestAnimationFrame(() => {
    renderProductsLogic();
    if (document.getElementById("reviewsContainer")) renderReviewsLogic();
  });

  document.dispatchEvent(new CustomEvent("dart:critical-ready"));
  scheduleOptionalSections();
  if (window.DartSiteSettings?.ready) restartHeroTyping();
  else window.setTimeout(() => {
    if (!document.getElementById("dartTyping")?.textContent) restartHeroTyping();
  }, 2500);
});
