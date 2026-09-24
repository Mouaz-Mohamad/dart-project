// DART CODE GUIDE | Js/dart-product-button-state.js
// الغرض: تبديل Buy / Waiting فقط حسب توفر اللون والمقاس، بدون اعتراض منطق الشراء أو الحجز.
// DART | MODULE: dart-product-button-state.js
(function (root) {
  "use strict";

  let rememberedSize = "";
  let observer = null;

  function decide({ hasColor, hasSize, stock, waitingEnabled }) {
    const hasVariant = Boolean(hasColor && hasSize);
    const showWaiting = Boolean(waitingEnabled && hasVariant && Number(stock) <= 0);
    return Object.freeze({
      hasVariant,
      showWaiting,
      showBuy: !showWaiting,
    });
  }

  function modal() {
    return root.document?.getElementById?.("SectionModel") || null;
  }

  function activeValue(selector, key) {
    const button = modal()?.querySelector?.(`${selector}.active`);
    return String(button?.dataset?.[key] || "").trim();
  }

  function selectedColor() {
    return activeValue(".color-btn", "color");
  }

  function selectedSize() {
    return activeValue(".size-btn", "size");
  }

  function currentModelCode() {
    return String(
      modal()?.querySelector?.(".model-product-code")?.textContent || "",
    ).trim();
  }

  function availableStock(size, color) {
    if (!size || !color) return 0;
    const code = currentModelCode();
    const model = root.DartCatalog?.model?.(code);
    if (!model) return 0;
    return Math.max(
      0,
      Number(
        root.DartCatalog?.available?.(
          model,
          size,
          color,
          root.DartPlatform?.cartReservationId || "",
        ),
      ) || 0,
    );
  }

  function waitingEnabled() {
    return root.DartSiteSettings?.get?.().waiting?.enabled !== false;
  }

  function styleWaitingButton(button) {
    if (!button) return;
    button.style.background = "#2563eb";
    button.style.borderColor = "#2563eb";
    button.style.color = "#ffffff";
  }

  function sync() {
    const currentModal = modal();
    if (!currentModal) return null;

    const color = selectedColor();
    const size = selectedSize();
    const stock = color && size ? availableStock(size, color) : 0;
    const state = decide({
      hasColor: Boolean(color),
      hasSize: Boolean(size),
      stock,
      waitingEnabled: waitingEnabled(),
    });

    const buyButton = currentModal.querySelector("#modalBuyBtn");
    const waitingButton = currentModal.querySelector("#modalWaitBtn");

    if (buyButton) {
      buyButton.hidden = state.showWaiting;
    }

    if (waitingButton) {
      waitingButton.hidden = !state.showWaiting;
      styleWaitingButton(waitingButton);
      if (state.showWaiting && !waitingButton.disabled) {
        waitingButton.textContent = "Waiting";
      }
    }

    return state;
  }

  function restoreRememberedSize() {
    const currentModal = modal();
    if (!currentModal || !rememberedSize || !selectedColor() || selectedSize()) {
      return false;
    }
    const sizeButton = Array.from(
      currentModal.querySelectorAll?.(".size-btn") || [],
    ).find((button) => String(button.dataset?.size || "") === rememberedSize);
    if (!sizeButton) return false;
    sizeButton.click();
    return true;
  }

  function settle() {
    root.queueMicrotask?.(() => {
      if (!restoreRememberedSize()) sync();
    });
  }

  root.document?.addEventListener?.("click", (event) => {
    const target = event.target;
    if (!target?.closest) return;

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

    if (target.closest("#SectionModel .color-btn")) {
      settle();
    }
  });

  function bindObserver() {
    const currentModal = modal();
    if (!currentModal || typeof root.MutationObserver !== "function" || observer) {
      sync();
      return;
    }
    observer = new root.MutationObserver(() => {
      if (currentModal.style?.display !== "flex") return;
      if (!restoreRememberedSize()) sync();
    });
    observer.observe(currentModal, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    sync();
  }

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", bindObserver, { once: true });
  } else {
    bindObserver();
  }

  ["dart:catalog-hydrated", "dart:data-changed", "dart:site-settings-changed"].forEach(
    (eventName) => root.addEventListener?.(eventName, settle),
  );

  root.DartProductButtonState = Object.freeze({ decide, sync });
})(typeof window !== "undefined" ? window : globalThis);
