// DART CODE GUIDE | Js/dart-product-button-state.js
// Buy/Waiting modal actions: fast optimistic Buy, duplicate-click lock, real Waiting reservation.
(function (root) {
  "use strict";

  let rememberedSize = "", observer = null, purchaseBusy = false, waitingBusy = false, reservedKey = "", restoringSize = false;
  const $ = id => root.document?.getElementById?.(id) || null;
  const product = () => typeof activeProduct === "undefined" ? null : activeProduct;
  const rawSize = () => typeof selectedSize === "undefined" ? null : selectedSize;
  const color = () => typeof selectedColor === "undefined" ? null : selectedColor;
  const quantity = () => Math.max(1, Number(typeof modalQuantity === "undefined" ? 1 : modalQuantity) || 1);
  const key = (p, s, c) => [p?.id || "", s || "", c || ""].join("::");
  const waitEnabled = () => root.DartSiteSettings?.get?.().waiting?.enabled !== false;
  const available = (p, s, c) => !p || !s || !c || typeof getAvailableStock !== "function"
    ? 0 : Math.max(0, Number(getAvailableStock(p, s, c)) || 0);
  const toast = message => { if (typeof showToast === "function") showToast(message); };
  const status = (message, state = "") => {
    if (typeof setProductOptionStatus === "function") setProductOptionStatus(message, state);
  };

  function modal() { return $("SectionModel"); }
  function rememberedSizeButton() {
    if (!rememberedSize) return null;
    return Array.from(modal()?.querySelectorAll?.(".size-btn") || [])
      .find(node => String(node.dataset?.size || "") === rememberedSize) || null;
  }
  function size() {
    const current = rawSize();
    if (current) return current;
    return rememberedSizeButton() ? rememberedSize : null;
  }

  function decide({ hasColor, hasSize, stock, waitingEnabled }) {
    const hasVariant = Boolean(hasColor && hasSize);
    const showWaiting = Boolean(waitingEnabled && hasVariant && Number(stock) <= 0);
    return Object.freeze({ hasVariant, showWaiting, showBuy: !showWaiting });
  }

  function sync() {
    const p = product(), s = size(), c = color(), hasVariant = Boolean(p && s && c);
    const stock = hasVariant ? available(p, s, c) : 0;
    const state = decide({ hasColor: Boolean(c), hasSize: Boolean(s), stock, waitingEnabled: waitEnabled() });
    const buy = $("modalBuyBtn"), wait = $("modalWaitBtn"), reserved = state.showWaiting && key(p, s, c) === reservedKey;

    if (buy) {
      buy.hidden = state.showWaiting;
      buy.disabled = purchaseBusy || !state.hasVariant || stock <= 0;
      buy.textContent = purchaseBusy ? "Adding…" : "Buy";
      purchaseBusy ? buy.setAttribute?.("aria-busy", "true") : buy.removeAttribute?.("aria-busy");
    }
    if (wait) {
      wait.hidden = !state.showWaiting;
      wait.style.background = wait.style.borderColor = "#2563eb";
      wait.style.color = "#fff";
      wait.dataset.modelId = p?.id || "";
      wait.dataset.size = s || "";
      wait.dataset.color = c || "";
      wait.disabled = waitingBusy || reserved;
      wait.textContent = waitingBusy ? "Reserving…" : reserved ? "Reserved in Waiting" : "Waiting";
      waitingBusy ? wait.setAttribute?.("aria-busy", "true") : wait.removeAttribute?.("aria-busy");
    }
    const qtyRow = $("modalQtyControl")?.closest?.(".modal-qty-row");
    if (qtyRow) qtyRow.hidden = state.showWaiting;
    return { product: p, size: s, color: c, stock, ...state };
  }

  function restoreSize() {
    const currentModal = modal();
    const button = rememberedSizeButton();
    if (restoringSize || !currentModal || !button || !color() || rawSize()) return false;
    restoringSize = true;
    try {
      if (typeof selectedSize !== "undefined") selectedSize = rememberedSize;
      Array.from(currentModal.querySelectorAll?.(".size-btn") || []).forEach(node => {
        const active = node === button;
        node.classList?.toggle?.("active", active);
        node.setAttribute?.("aria-pressed", String(active));
      });
      button.click?.();
    } finally {
      restoringSize = false;
    }
    return true;
  }
  const settle = () => root.queueMicrotask?.(() => { restoreSize(); sync(); });

  async function handleBuy() {
    if (purchaseBusy) return false;
    const state = sync(), { product: p, size: s, color: c, stock, hasVariant } = state;
    if (!p || !hasVariant) {
      const message = !s ? "Choose a size first." : "Choose a color first.";
      status(message, "error"); toast(message); return false;
    }
    if (stock <= 0) { status("This option is unavailable. Use Waiting to reserve it.", "info"); sync(); return false; }
    if (typeof cartData === "undefined" || !Array.isArray(cartData)) { toast("Cart is not ready yet. Please try again."); return false; }

    const qty = quantity();
    const existing = cartData.find(line => String(line.id) === String(p.id) && String(line.size) === String(s) && String(line.color) === String(c));
    const total = Number(existing?.quantity || 0) + qty;
    if (total > stock) {
      status("Adjust the quantity using the quantity selector before buying.", "error");
      toast("Adjust the quantity with the quantity selector.");
      return false;
    }

    purchaseBusy = true;
    const buy = $("modalBuyBtn");
    if (buy) { buy.disabled = true; buy.textContent = "Adding…"; buy.setAttribute?.("aria-busy", "true"); }
    try {
      if (existing) existing.quantity = total;
      else cartData.push({
        id: p.id, title: p.title, price: p.price, size: s, color: c, quantity: qty,
        image: root.DartCatalog?.cover?.(root.DartCatalog?.model?.(p.id), c) || p.images?.[0] || p.image || ""
      });
      if (typeof cacheFastCartSnapshot === "function") cacheFastCartSnapshot(cartData);
      if (typeof renderCart === "function") renderCart();
      if (typeof updateCartCount === "function") updateCartCount();
      if (typeof persistCartReservation !== "function") throw new Error("Cart reservation service is unavailable.");
      if (!await persistCartReservation()) { if (typeof renderCart === "function") renderCart(); return false; }
      toast("تم إضافة المنتج إلى السلة بنجاح!");
      if (typeof showCartBanner === "function") showCartBanner(p.title);
      if (typeof closeProductModal === "function") closeProductModal();
      if (typeof renderCart === "function") renderCart();
      return true;
    } catch (error) {
      toast(error?.message || "تعذر حجز القطعة. حاول مرة أخرى.");
      return false;
    } finally {
      purchaseBusy = false;
      if (modal()?.style?.display === "flex") sync();
    }
  }

  async function handleWaiting() {
    if (waitingBusy) return false;
    restoreSize();
    const state = sync(), { product: p, size: s, color: c, stock, hasVariant, showWaiting } = state;
    if (!p || !hasVariant) { toast("Choose the size and color you want first."); return false; }
    if (stock > 0 || !showWaiting) { status("This option is available now. Use Buy instead.", "success"); sync(); return false; }
    if (!root.DartPlatform?.currentUser?.()) {
      root.sessionStorage?.setItem?.("dart_internal_navigation", "1");
      const next = root.location?.pathname?.split("/").pop() || "products.html";
      root.location?.assign?.(`Sign Up modern.html?next=${encodeURIComponent(next)}`);
      return false;
    }

    waitingBusy = true; sync();
    try {
      await root.DartPlatform.joinWaiting(String(p.id), String(s), String(c));
      reservedKey = key(p, s, c);
      const message = `تم تسجيل حجز القطعة في Waiting: ${p.title} — المقاس: ${s} — اللون: ${c}.`;
      status(message, "success"); toast(message); return true;
    } catch (error) {
      if (error?.code === "WAITING_ALREADY_EXISTS") {
        reservedKey = key(p, s, c);
        const message = `حجز ${p.title} — ${s} — ${c} موجود بالفعل في Waiting.`;
        status(message, "info"); toast(message); return true;
      }
      if (error?.code === "STOCK_AVAILABLE") {
        status("The item became available now. Use Buy instead.", "success");
        toast("القطعة أصبحت متاحة الآن. استخدم Buy لإضافتها للسلة.");
        root.DartStorefront?.refresh?.(); return false;
      }
      toast(error?.message || "تعذر تسجيل حجز Waiting."); return false;
    } finally { waitingBusy = false; sync(); }
  }

  const stop = event => { event.preventDefault?.(); event.stopImmediatePropagation?.(); };
  root.document?.addEventListener?.("click", event => {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest("#modalBuyBtn")) { stop(event); void handleBuy().catch(error => { console.error("Dart Buy action failed", error); purchaseBusy = false; sync(); }); return; }
    if (target.closest("#modalWaitBtn")) { stop(event); void handleWaiting().catch(error => { console.error("Dart Waiting action failed", error); waitingBusy = false; sync(); }); return; }
    if (target.closest(".product-card, .cart-btn")) { rememberedSize = ""; settle(); return; }
    const sizeButton = target.closest("#SectionModel .size-btn");
    if (sizeButton) { rememberedSize = String(sizeButton.dataset?.size || ""); settle(); return; }
    if (target.closest("#SectionModel .color-btn")) settle();
  }, true);

  function bind() {
    const currentModal = modal();
    if (!currentModal || typeof root.MutationObserver !== "function" || observer) { sync(); return; }
    observer = new root.MutationObserver(() => {
      if (currentModal.style?.display === "flex") { restoreSize(); sync(); }
    });
    observer.observe(currentModal, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    sync();
  }
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
  ["dart:catalog-hydrated", "dart:data-changed", "dart:site-settings-changed"].forEach(name => root.addEventListener?.(name, settle));

  root.DartProductButtonState = Object.freeze({
    decide, sync, handleBuy, handleWaiting,
    __resetForTests() { rememberedSize = reservedKey = ""; purchaseBusy = waitingBusy = restoringSize = false; }
  });
})(typeof window !== "undefined" ? window : globalThis);
