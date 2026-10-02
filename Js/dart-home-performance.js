// DART CODE GUIDE | Js/dart-home-performance.js
// الغرض: تحسين First Paint للصفحة الرئيسية وإضافة سلوك وصول غير معيق للواجهة.
(function installDartHomePerformance(root) {
  "use strict";

  const FONT_AWESOME_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
  let fontAwesomeRequested = false;
  let reviewsActivated = false;
  let reviewsRefreshTimer = 0;

  function hasSessionHint() {
    return document.cookie
      .split(";")
      .map((part) => part.trim())
      .some((part) => part.startsWith("dart_csrf="));
  }

  // The secure session cookie is HttpOnly, while dart_csrf is created and cleared
  // with the same authenticated session. On a fresh guest visit there is no value
  // in issuing /api/v1/me only to receive an expected 401 (and a Lighthouse console error).
  // This only short-circuits that exact read-only probe; every protected API route
  // continues to use the real backend and its normal authentication middleware.
  function installGuestSessionProbe() {
    if (root.__dartGuestSessionProbeInstalled || typeof root.fetch !== "function") return;
    root.__dartGuestSessionProbeInstalled = true;
    const nativeFetch = root.fetch.bind(root);

    root.fetch = function dartHomeFetch(input, init) {
      const requestMethod = String(
        init?.method ||
        (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"),
      ).toUpperCase();

      if (requestMethod === "GET" && !hasSessionHint()) {
        const rawUrl = typeof input === "string" ? input : input?.url || "";
        try {
          const url = new URL(rawUrl, root.location.href);
          if (url.pathname === "/api/v1/me") {
            return Promise.resolve(
              new Response(
                JSON.stringify({ user: null, permissions: [], session: null }),
                {
                  status: 200,
                  headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                  },
                },
              ),
            );
          }
        } catch {
          // Invalid URL inputs fall through to the native fetch implementation.
        }
      }

      return nativeFetch(input, init);
    };
  }

  installGuestSessionProbe();

  function normalizeReviewAccessibility(scope = document) {
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll(".stars[aria-label]").forEach((stars) => {
      stars.setAttribute("role", "img");
      const filled = stars.querySelectorAll(".fa-solid.fa-star").length;
      if (filled > 0) stars.setAttribute("aria-label", `${filled} out of 5 stars`);
    });
  }

  function prepareLazyReviews() {
    const container = document.getElementById("reviewsContainer");
    if (!container || container.hasAttribute("data-dart-lazy-reviews")) return;
    normalizeReviewAccessibility(container);
    container.setAttribute("data-dart-lazy-reviews", "");
    container.removeAttribute("id");
  }

  // This script is intentionally loaded before dart-ui.js on the homepage.
  // Hiding the reviews id here prevents the UI bootstrap from starting the
  // reviews request while the hero/LCP resources are still competing for network/CPU.
  prepareLazyReviews();

  function activateBrandFontsAfterFirstPaint() {
    const stylesheet = document.getElementById("dart-brand-fonts");
    if (!stylesheet || stylesheet.media === "all") return;
    root.requestAnimationFrame(() => {
      root.requestAnimationFrame(() => {
        stylesheet.media = "all";
      });
    });
  }

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

  function normalizeLeaderboardStructure() {
    const list = document.querySelector("#leaderboard-card .leaderboard-list");
    if (!list) return;
    list.querySelectorAll(":scope > h1").forEach((heading) => heading.remove());
  }

  function bindLeaderboardStructure() {
    const host = document.getElementById("leaderboard-card");
    if (!host || host.dataset.dartListA11yBound === "1") return;
    host.dataset.dartListA11yBound = "1";
    const observer = new MutationObserver(() => normalizeLeaderboardStructure());
    observer.observe(host, { childList: true, subtree: true });
    normalizeLeaderboardStructure();
  }

  function bindReviewAccessibility() {
    const container =
      document.querySelector("[data-dart-lazy-reviews]") ||
      document.getElementById("reviewsContainer");
    if (!container || container.dataset.dartReviewA11yBound === "1") return;
    container.dataset.dartReviewA11yBound = "1";
    const observer = new MutationObserver(() => normalizeReviewAccessibility(container));
    observer.observe(container, { childList: true, subtree: true });
    normalizeReviewAccessibility(container);
  }

  function refreshReviews() {
    if (!reviewsActivated || document.hidden) return;
    if (typeof root.hydratePublicReviews === "function") {
      void root.hydratePublicReviews();
    }
  }

  function activateReviews() {
    if (reviewsActivated) return;
    const container = document.querySelector("[data-dart-lazy-reviews]");
    if (!container) return;

    reviewsActivated = true;
    container.id = "reviewsContainer";
    container.removeAttribute("data-dart-lazy-reviews");

    if (typeof root.renderReviewsLogic === "function") root.renderReviewsLogic();
    normalizeReviewAccessibility(container);
    refreshReviews();

    if (!reviewsRefreshTimer) {
      reviewsRefreshTimer = root.setInterval(refreshReviews, 30000);
      root.addEventListener("focus", refreshReviews, { passive: true });
    }
  }

  function bindLazyReviews() {
    const container = document.querySelector("[data-dart-lazy-reviews]");
    if (!container) return;

    if (!("IntersectionObserver" in root)) {
      if ("requestIdleCallback" in root) {
        root.requestIdleCallback(activateReviews, { timeout: 3000 });
      } else {
        root.setTimeout(activateReviews, 2000);
      }
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        activateReviews();
      },
      { rootMargin: "700px 0px", threshold: 0.01 },
    );
    observer.observe(container);
  }

  function init() {
    activateBrandFontsAfterFirstPaint();
    scheduleNonCriticalAssets();
    bindMenuAccessibility();
    bindProductModalAccessibility();
    bindCspSafeNavigation();
    bindEscapeKey();
    bindLeaderboardStructure();
    bindReviewAccessibility();
    bindLazyReviews();

    document.addEventListener("dart:section-loaded", (event) => {
      if (event.detail?.containerId === "header-container") bindMenuAccessibility();
      if (event.detail?.containerId === "leaderboard-card") normalizeLeaderboardStructure();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
