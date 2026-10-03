// DART CODE GUIDE | Js/dart-product-button-state.js
// Single Buy/Waiting action controller shared by every storefront product modal.
(function (root) {
  "use strict";
  let rememberedSize = "";
  let observer = null;
  let purchaseBusy = false;
  let waitingBusy = false;
  let reservedKey = "";
  let restoringSize = false;

  const $ = (id) => root.document?.getElementById?.(id) || null;
  const product = () =>
    typeof activeProduct === "undefined" ? null : activeProduct;
  const rawSize = () =>
    typeof selectedSize === "undefined" ? null : selectedSize;
  const color = () =>
    typeof selectedColor === "undefined" ? null : selectedColor;
  const quantity = () =>
    Math.max(1, Number(typeof modalQuantity === "undefined" ? 1 : modalQuantity) || 1);
  const key = (item, size, selectedColor) =>
    [item?.id || "", size || "", selectedColor || ""].join("::");
  const waitingEnabled = () =>
    root.DartSiteSettings?.get?.().waiting?.enabled !== false;
  const available = (item, size, selectedColor) =>
    !item || !size || !selectedColor || typeof getAvailableStock !== "function"
      ? 0
      : Math.max(0, Number(getAvailableStock(item, size, selectedColor)) || 0);
  const toast = (message) => {
    if (typeof showToast === "function") showToast(message);
  };
  const status = (message, state = "") => {
    root.DartStorefront?.setOptionStatus?.(message, state);
  };
  const modal = () => $("SectionModel");

  function rememberedSizeButton() {
    if (!rememberedSize) return null;
    return (
      Array.from(modal()?.querySelectorAll?.(".size-btn") || []).find(
        (node) => String(node.dataset?.size || "") === rememberedSize,
      ) || null
    );
  }

  function size() {
    return rawSize() || (rememberedSizeButton() ? rememberedSize : null);
  }

  function decide({ hasColor, hasSize, stock, waitingEnabled: enabled }) {
    const hasVariant = Boolean(hasColor && hasSize);
    const showWaiting = Boolean(enabled && hasVariant && Number(stock) <= 0);
    return Object.freeze({ hasVariant, showWaiting, showBuy: !showWaiting });
  }

  function sync() {
    const item = product();
    const selectedSizeValue = size();
    const selectedColorValue = color();
    const hasVariant = Boolean(item && selectedSizeValue && selectedColorValue);
    const stock = hasVariant
      ? available(item, selectedSizeValue, selectedColorValue)
      : 0;
    const state = decide({
      hasColor: Boolean(selectedColorValue),
      hasSize: Boolean(selectedSizeValue),
      stock,
      waitingEnabled: waitingEnabled(),
    });
    const buy = $("modalBuyBtn");
    const waiting = $("modalWaitBtn");
    const reserved =
      state.showWaiting &&
      key(item, selectedSizeValue, selectedColorValue) === reservedKey;

    if (buy) {
      buy.hidden = state.showWaiting;
      buy.disabled = purchaseBusy || !state.hasVariant || stock <= 0;
      buy.textContent = purchaseBusy ? "Adding…" : "Buy";
      buy.setAttribute("aria-hidden", String(state.showWaiting));
      buy.setAttribute("aria-label", "Buy selected product");
      if (purchaseBusy) buy.setAttribute("aria-busy", "true");
      else buy.removeAttribute("aria-busy");
    }

    if (waiting) {
      waiting.hidden = !state.showWaiting;
      waiting.disabled = waitingBusy || reserved;
      waiting.dataset.modelId = item?.id || "";
      waiting.dataset.size = selectedSizeValue || "";
      waiting.dataset.color = selectedColorValue || "";
      waiting.textContent = waitingBusy
        ? "Joining Waiting…"
        : reserved
          ? "Already in Waiting"
          : "Notify me when available";
      waiting.setAttribute("aria-hidden", String(!state.showWaiting));
      waiting.setAttribute(
        "aria-label",
        reserved
          ? "Already in Waiting"
          : "Notify me when this size and color are available",
      );
      if (waitingBusy) waiting.setAttribute("aria-busy", "true");
      else waiting.removeAttribute("aria-busy");
    }

    const row = $("modalQtyControl")?.closest?.(".modal-qty-row");
    if (row) row.hidden = state.showWaiting;
    return {
      product: item,
      size: selectedSizeValue,
      color: selectedColorValue,
      stock,
      ...state,
    };
  }

  function restoreSize() {
    const currentModal = modal();
    const button = rememberedSizeButton();
    if (restoringSize || !currentModal || !button || !color() || rawSize())
      return false;
    restoringSize = true;
    try {
      if (typeof selectedSize !== "undefined") selectedSize = rememberedSize;
      Array.from(currentModal.querySelectorAll?.(".size-btn") || []).forEach(
        (node) => {
          const active = node === button;
          node.classList?.toggle?.("active", active);
          node.setAttribute?.("aria-pressed", String(active));
        },
      );
      button.click?.();
    } finally {
      restoringSize = false;
    }
    return true;
  }

  const settle = () =>
    root.queueMicrotask?.(() => {
      restoreSize();
      sync();
    });

  async function handleBuy() {
    if (purchaseBusy) return false;
    const state = sync();
    const {
      product: item,
      size: selectedSizeValue,
      color: selectedColorValue,
      stock,
      hasVariant,
    } = state;
    if (!item || !hasVariant) {
      const message = !selectedSizeValue
        ? "Choose a size first."
        : "Choose a color first.";
      status(message, "error");
      toast(message);
      return false;
    }
    if (stock <= 0) {
      status("This option is unavailable. Use Waiting instead.", "info");
      sync();
      return false;
    }
    if (typeof cartData === "undefined" || !Array.isArray(cartData)) {
      toast("Cart is not ready yet. Please try again.");
      return false;
    }

    const requestedQuantity = quantity();
    const existing = cartData.find(
      (line) =>
        String(line.id) === String(item.id) &&
        String(line.size) === String(selectedSizeValue) &&
        String(line.color) === String(selectedColorValue),
    );
    const total = Number(existing?.quantity || 0) + requestedQuantity;
    if (total > stock) {
      status(
        `Only ${stock} item${stock === 1 ? "" : "s"} available for this size and color.`,
        "error",
      );
      toast(`Only ${stock} item${stock === 1 ? "" : "s"} available.`);
      return false;
    }

    purchaseBusy = true;
    sync();
    const previous =
      root.DartState?.clone?.(cartData) ||
      JSON.parse(JSON.stringify(cartData));
    try {
      if (existing) existing.quantity = total;
      else {
        cartData.push({
          id: item.id,
          title: item.title,
          price: item.price,
          size: selectedSizeValue,
          color: selectedColorValue,
          quantity: requestedQuantity,
          image:
            root.DartCatalog?.cover?.(
              root.DartCatalog?.model?.(item.id),
              selectedColorValue,
            ) ||
            item.images?.[0] ||
            item.image ||
            "",
        });
      }
      if (typeof cacheFastCartSnapshot === "function")
        cacheFastCartSnapshot(cartData);
      if (typeof renderCart === "function") renderCart();
      if (typeof updateCartCount === "function") updateCartCount();
      if (typeof persistCartReservation !== "function")
        throw new Error("Cart reservation service is unavailable.");
      if (!(await persistCartReservation(previous))) {
        if (typeof renderCart === "function") renderCart();
        return false;
      }
      toast("تم إضافة المنتج إلى السلة بنجاح!");
      if (typeof showCartBanner === "function") showCartBanner(item.title);
      root.DartStorefront?.close?.();
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
    const state = sync();
    const {
      product: item,
      size: selectedSizeValue,
      color: selectedColorValue,
      stock,
      hasVariant,
      showWaiting,
    } = state;
    if (!item || !hasVariant) {
      toast("Choose the size and color you want first.");
      return false;
    }
    if (stock > 0 || !showWaiting) {
      status("This option is available now. Use Buy instead.", "success");
      sync();
      return false;
    }
    if (!root.DartPlatform?.currentUser?.()) {
      root.sessionStorage?.setItem?.("dart_internal_navigation", "1");
      const next = root.location?.pathname?.split("/").pop() || "products.html";
      root.location?.assign?.(
        `Sign Up modern.html?next=${encodeURIComponent(next)}`,
      );
      return false;
    }

    waitingBusy = true;
    sync();
    try {
      await root.DartPlatform.joinWaiting(
        String(item.id),
        String(selectedSizeValue),
        String(selectedColorValue),
      );
      reservedKey = key(item, selectedSizeValue, selectedColorValue);
      const message = `تم تسجيل حجز القطعة في Waiting: ${item.title} — المقاس: ${selectedSizeValue} — اللون: ${selectedColorValue}.`;
      status(message, "success");
      toast(message);
      return true;
    } catch (error) {
      if (error?.code === "WAITING_ALREADY_EXISTS") {
        reservedKey = key(item, selectedSizeValue, selectedColorValue);
        const message = `حجز ${item.title} — ${selectedSizeValue} — ${selectedColorValue} موجود بالفعل في Waiting.`;
        status(message, "info");
        toast(message);
        return true;
      }
      if (error?.code === "STOCK_AVAILABLE") {
        status("The item became available now. Use Buy instead.", "success");
        toast("القطعة أصبحت متاحة الآن. استخدم Buy لإضافتها للسلة.");
        root.DartStorefront?.refresh?.();
        return false;
      }
      toast(error?.message || "تعذر تسجيل حجز Waiting.");
      return false;
    } finally {
      waitingBusy = false;
      sync();
    }
  }

  const stop = (event) => {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  };

  root.document?.addEventListener?.(
    "click",
    (event) => {
      const target = event.target;
      if (!target?.closest) return;
      if (target.closest("#modalBuyBtn")) {
        stop(event);
        void handleBuy().catch((error) => {
          console.error("Dart Buy action failed", error);
          purchaseBusy = false;
          sync();
        });
        return;
      }
      if (target.closest("#modalWaitBtn")) {
        stop(event);
        void handleWaiting().catch((error) => {
          console.error("Dart Waiting action failed", error);
          waitingBusy = false;
          sync();
        });
        return;
      }
      if (target.closest(".product-card, .cart-btn")) {
        rememberedSize = "";
        settle();
        return;
      }
      const sizeButton = target.closest("#SectionModel .size-btn");
      if (sizeButton) {
        rememberedSize = String(sizeButton.dataset?.size || "");
        settle();
        return;
      }
      if (target.closest("#SectionModel .color-btn")) settle();
    },
    true,
  );

  function bind() {
    const currentModal = modal();
    if (!currentModal) return;
    observer?.disconnect?.();
    observer = null;
    if (typeof root.MutationObserver === "function") {
      observer = new root.MutationObserver(() => {
        if (currentModal.style?.display === "flex") {
          restoreSize();
          sync();
        }
      });
      observer.observe(currentModal, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    sync();
  }

  if (root.document?.readyState === "loading")
    root.document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
  root.addEventListener?.("dart:product-modal-ready", bind);
  [
    "dart:catalog-hydrated",
    "dart:data-changed",
    "dart:site-settings-changed",
  ].forEach((name) => root.addEventListener?.(name, settle));

  root.DartProductButtonState = Object.freeze({
    decide,
    sync,
    handleBuy,
    handleWaiting,
    __resetForTests() {
      rememberedSize = "";
      reservedKey = "";
      purchaseBusy = false;
      waitingBusy = false;
      restoringSize = false;
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
