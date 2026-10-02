// DART CODE GUIDE | Js/dart-home-performance.js
// الغرض: تحسين First Paint للصفحة الرئيسية وإضافة سلوك وصول غير معيق للواجهة.
(function installDartHomePerformance(root) {
  "use strict";

  const FONT_AWESOME_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
  let fontAwesomeRequested = false;

  function loadFontAwesome() {
    if (fontAwesomeRequested || document.querySelector(`link[href="${FONT_AWESOME_URL}"]`)) return;
    fontAwesomeRequested = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_AWESOME_URL;
    link.crossOrigin = "anonymous";
    link.referrerPolicy = "no-referrer";
    document.head.appendChild(link);
  }

  function scheduleNonCriticalAssets() {
    const eagerLoad = () => loadFontAwesome();
    root.addEventListener("pointerdown", eagerLoad, { once: true, passive: true, capture: true });
    root.addEventListener("touchstart", eagerLoad, { once: true, passive: true, capture: true });
    root.addEventListener("keydown", eagerLoad, { once: true, capture: true });

    if ("requestIdleCallback" in root) {
      root.requestIdleCallback(loadFontAwesome, { timeout: 1800 });
    } else {
      root.setTimeout(loadFontAwesome, 900);
    }
  }

  function syncMenuAccessibility() {
    const trigger = document.querySelector(".icon-menu");
    const menu = document.querySelector(".side-menu");
    if (!trigger || !menu) return;
    const expanded = menu.classList.contains("active");
    trigger.setAttribute("aria-expanded", String(expanded));
    menu.setAttribute("aria-hidden", String(!expanded));
  }

  function bindMenuAccessibility() {
    syncMenuAccessibility();
    const trigger = document.querySelector(".icon-menu");
    const menu = document.querySelector(".side-menu");
    if (!trigger || !menu || trigger.dataset.dartA11yBound === "1") return;
    trigger.dataset.dartA11yBound = "1";
    trigger.addEventListener("click", () => queueMicrotask(syncMenuAccessibility));
  }

  function bindProductModalAccessibility() {
    const modal = document.getElementById("SectionModel");
    const close = modal?.querySelector(".dart-modal-close");
    if (!modal || !close || modal.dataset.dartA11yBound === "1") return;
    modal.dataset.dartA11yBound = "1";

    const sync = () => {
      const open = root.getComputedStyle(modal).display !== "none";
      modal.setAttribute("aria-hidden", String(!open));
      if (open && document.activeElement !== close) {
        root.requestAnimationFrame(() => close.focus({ preventScroll: true }));
      }
    };
    new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["style", "class"] });
    sync();
  }

  function bindCspSafeNavigation() {
    document.addEventListener("click", (event) => {
      const signup = event.target.closest("[data-dart-signup-link]");
      if (!signup) return;
      event.preventDefault();
      root.location.href = "/Sign%20Up%20modern.html";
    });
  }

  function bindEscapeKey() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      const menu = document.querySelector(".side-menu.active");
      const menuTrigger = document.querySelector(".icon-menu");
      if (menu && menuTrigger) {
        event.preventDefault();
        menuTrigger.click();
        menuTrigger.focus({ preventScroll: true });
        return;
      }

      const modal = document.getElementById("SectionModel");
      if (modal && root.getComputedStyle(modal).display !== "none") {
        const sizeChart = document.getElementById("productSizeChartPanel");
        if (sizeChart && !sizeChart.hidden) return;
        event.preventDefault();
        root.closeProductModal?.();
      }
    });
  }

  function init() {
    scheduleNonCriticalAssets();
    bindMenuAccessibility();
    bindProductModalAccessibility();
    bindCspSafeNavigation();
    bindEscapeKey();

    document.addEventListener("dart:section-loaded", (event) => {
      if (event.detail?.containerId === "header-container") bindMenuAccessibility();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
