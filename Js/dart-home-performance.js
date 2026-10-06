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
        } catch {}
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

  prepareLazyReviews();

  function activateBrandFontsAfterCriticalLoad() {
    const stylesheet = document.getElementById("dart-brand-fonts");
    if (!stylesheet || stylesheet.media === "all") return;

    const activate = () => {
      if (stylesheet.media !== "all") stylesheet.media = "all";
    };
    const schedule = () => {
      if ("requestIdleCallback" in root) {
        root.requestIdleCallback(activate, { timeout: 2000 });
      } else {
        root.setTimeout(activate, 1000);
      }
    };

    if (document.readyState === "complete") schedule();
    else root.addEventListener("load", schedule, { once: true });
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

    // Start the icon stylesheet automatically after DOMContentLoaded without making it render-blocking.
    // Interaction listeners above remain as an immediate fallback if the user acts before this queued task.
    root.setTimeout(loadFontAwesome, 0);
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

      // Product Modal Escape handling is owned by DartStorefront on every page.
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

  function productRenderSignature() {
    const cards = root.DartStorefront?.cards?.();
    if (!Array.isArray(cards)) return "";
    try {
      return JSON.stringify(
        cards.map((product) => ({
          id: String(product?.id || product?.code || ""),
          color: String(product?.cardColor || ""),
          title: String(product?.title || ""),
          category: String(product?.category || ""),
          price: Number(product?.price) || 0,
          originalPrice: Number(product?.originalPrice) || 0,
          discount: Number(product?.effectiveDiscountPercent) || 0,
          image: String(product?.images?.[0] || product?.image || ""),
          stock: product?.stock && typeof product.stock === "object" ? product.stock : {},
        })),
      );
    } catch {
      return "";
    }
  }

  function installProductRenderGuard() {
    const original = root.renderProductsLogic;
    if (typeof original !== "function" || original.__dartHomeRenderGuard) return false;

    let lastSignature = "";
    function guardedRenderProductsLogic(force = false) {
      const signature = productRenderSignature();
      if (!force && signature && signature === lastSignature) return false;
      const result = original.apply(this, arguments);
      if (signature) lastSignature = signature;
      return result;
    }

    Object.defineProperty(guardedRenderProductsLogic, "__dartHomeRenderGuard", {
      value: true,
      configurable: false,
      enumerable: false,
    });
    guardedRenderProductsLogic.invalidate = () => {
      lastSignature = "";
    };

    root.renderProductsLogic = guardedRenderProductsLogic;
    return true;
  }

  function init() {
    activateBrandFontsAfterCriticalLoad();
    scheduleNonCriticalAssets();
    bindMenuAccessibility();
    bindCspSafeNavigation();
    bindEscapeKey();
    bindLeaderboardStructure();
    bindReviewAccessibility();
    bindLazyReviews();
    installProductRenderGuard();

    document.addEventListener("dart:section-loaded", (event) => {
      if (event.detail?.containerId === "header-container") bindMenuAccessibility();
      if (event.detail?.containerId === "leaderboard-card") normalizeLeaderboardStructure();
    });
  }

  root.DartHomePerformance = Object.freeze({
    version: "1.1.1",
    productRenderSignature,
    installProductRenderGuard,
    invalidateProductRender() {
      root.renderProductsLogic?.invalidate?.();
    },
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
