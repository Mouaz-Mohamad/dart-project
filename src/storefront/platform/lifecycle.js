  bindAuth();
  document.addEventListener("DOMContentLoaded", async () => {
    if (document.prerendering) {
      await new Promise((resolve) => document.addEventListener("prerenderingchange", resolve, { once: true }));
    }
    if (API_BASE) {
      try {
        await hydrateApiSession();
        if (!window.DartCatalog?.isServerAuthoritative?.()) {
          await window.DartCatalog?.hydrate?.();
        }
        await hydrateCustomerCart();
      } catch (error) {
        // Expected connectivity/API bootstrap failures are surfaced as UI state,
        // not console noise. Server-side observability remains authoritative.
        window.dispatchEvent(
          new CustomEvent("dart:platform-unavailable", {
            detail: { code: error?.code || "API_ERROR" },
          }),
        );
      }
    }
    if (redirectRememberedCustomer()) return;
    if (document.getElementById("customerEmailVerificationForm")) {
      try {
        const pending = JSON.parse(
          sessionStorage.getItem("dart_pending_email_verification") || "null",
        );
        if (pending?.challengeId) {
          const dialog = document.getElementById("customerEmailVerification");
          const form = document.getElementById("customerEmailVerificationForm");
          form.elements.challengeId.value = pending.challengeId;
          dialog.hidden = false;
          form.elements.code.focus();
        }
      } catch {
        sessionStorage.removeItem("dart_pending_email_verification");
      }
    }
    ensureCatalogInventory();
    cleanupCartReservations();
    updateCartReservationTimer();
    prefillCheckout();
    renderProfile();
    void hydrateWaiting().catch((error) => {
      if (error?.status !== 401) {
        window.dispatchEvent(
          new CustomEvent("dart:waiting-unavailable", {
            detail: { code: error?.code || "WAITING_ERROR" },
          }),
        );
      }
    });
    renderTracking();
    bindRep();
    renderFeedbackEligibility();
    renderLeaderboard();
    renderBirthdayExperience();
    wireAccountLink();
    initializeReturnRequestForm();
    document.addEventListener("dart:section-loaded", () => {
      renderFeedbackEligibility();
      renderLeaderboard();
      renderBirthdayTicker();
      wireSocialLinks();
      wireAccountLink();
      initializeReturnRequestForm();
    });
    document
      .querySelectorAll("img:not([alt])")
      .forEach((img) => (img.alt = "Decorative Dart visual"));
  });
  document.addEventListener("dart:sections-loaded", () => {
    initializeReturnRequestForm();
    renderProfile();
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    try {
      const url = new URL(link.href, location.href),
        current = new URL(location.href);
      if (
        url.origin === current.origin &&
        (url.pathname !== current.pathname || url.search !== current.search)
      )
        sessionStorage.setItem("dart_internal_navigation", "1");
    } catch {}
  });
  setInterval(() => {
    if (document.hidden || document.prerendering) return;
    void cleanupCartReservations();
    updateCartReservationTimer();
  }, 1000);
  setInterval(() => {
    if (!document.hidden) void hydratePublicLeaderboard();
  }, 30000);
  setInterval(async () => {
    if (!document.hidden && currentUser()) {
      try {
        await hydrateCustomerCommerce();
        await hydrateWaiting();
      } catch (error) {
        if (error.status !== 401)
          console.warn("Dart customer snapshot refresh failed", error);
      }
    }
  }, 15000);
  window.addEventListener("focus", () => {
    void hydratePublicLeaderboard();
    if (currentUser()) {
      void hydrateCustomerCommerce();
      void hydrateWaiting(true);
    }
  });
  // A restored document retains UI selections, but its account/cart projection must be fresh.
  let pageRestorePending = false;
  window.addEventListener("pageshow", async (event) => {
    if (!event.persisted || pageRestorePending || document.prerendering) return;
    pageRestorePending = true;
    window.DartSets?.clearDrafts?.();
    cacheApiUser(null);
    [KEYS.customers, KEYS.orders, KEYS.returns, KEYS.cards, KEYS.birthdayRewards,
      KEYS.birthdayMessages, "user_last_address", "dart_cart"].forEach((key) =>
      window.DartState?.remove?.(key, { source: "page-restore" }));
    if (typeof cartData !== "undefined") cartData = [];
    if (typeof updateCartCount === "function") updateCartCount();
    setCartReservationId(sessionStorage.getItem("dart_cart_reservation_id") || uid("CART"));
    try {
      await hydrateApiSession();
      await Promise.all([window.DartCatalog?.hydrate?.(), hydrateCustomerCart({ claimLocal: false })]);
      updateCartReservationTimer();
      renderBirthdayExperience();
      wireAccountLink();
    } catch {
      window.dispatchEvent(new CustomEvent("dart:platform-unavailable", { detail: { code: "RESTORE_REFRESH_FAILED" } }));
    } finally { pageRestorePending = false; }
  });
  window.addEventListener("dart:data-changed", (event) => {
    if (
      [KEYS.orders, KEYS.returns, KEYS.customers, KEYS.cards].includes(
        event.detail?.key,
      )
    )
      renderLeaderboard();
    if ([KEYS.orders, KEYS.returns].includes(event.detail?.key)) {
      if (event.detail?.key === KEYS.orders) {
        const feedbackSection =
        document.getElementById("reviewForm")?.closest(".feedback-section");
        if (feedbackSection) delete feedbackSection.dataset.eligibilityRendered;
        renderFeedbackEligibility();
      }
      renderProfile();
    }
  });
