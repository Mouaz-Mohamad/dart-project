  // Account windows keep their current appearance and have reloadable URLs.
  const accountViews = Object.freeze({
    profile: ".profile-details", orders: ".order-info",
    waiting: ".waiting-info", returns: ".return-info",
  });

  function customerLoginUrl() {
    const current = new URL(location.href);
    const params = new URLSearchParams({ next: "profile" });
    if (current.pathname.endsWith("/track.html")) {
      params.set("next", "track");
      for (const key of ["order", "return"]) if (current.searchParams.get(key)) params.set(key, current.searchParams.get(key));
    } else if (current.pathname.endsWith("/form-return.html")) params.set("next", "return");
    else if (accountViews[current.searchParams.get("view")]) params.set("view", current.searchParams.get("view"));
    return `Sign%20Up%20modern.html?${params}`;
  }

  function enforceCustomerAccountAccess() {
    if (!document.body?.hasAttribute("data-customer-private")) return true;
    const status = document.querySelector("[data-customer-access-status]");
    if (apiSessionUnavailable) {
      document.body.dataset.customerAuth = "error";
      if (status) {
        status.textContent = "Account unavailable. ";
        const retry = document.createElement("button");
        retry.type = "button"; retry.textContent = "Retry";
        retry.addEventListener("click", async () => {
          document.body.dataset.customerAuth = "pending";
          status.textContent = "Checking account…";
          try { await hydrateApiSession(); } catch { /* Keep the recoverable access error. */ }
          enforceCustomerAccountAccess();
        });
        status.appendChild(retry);
      }
      return false;
    }
    if (!apiSessionChecked) return false;
    if (!currentUser()) {
      document.body.dataset.customerAuth = "pending";
      location.replace(customerLoginUrl());
      return false;
    }
    document.body.dataset.customerAuth = "ready";
    return true;
  }

  function initializeAccountNavigation() {
    if (!document.querySelector(".account")) return;
    const sections = Object.values(accountViews).map(selector => document.querySelector(selector)).filter(Boolean);
    let lastTrigger = null;
    function renderAccountView() {
      const requested = new URLSearchParams(location.search).get("view");
      const selector = Object.hasOwn(accountViews, requested) ? accountViews[requested] : null;
      const allowed = document.body.dataset.customerAuth === "ready";
      sections.forEach(section => section.classList.toggle("active", allowed && section.matches(selector || ":not(*)")));
      document.body.classList.toggle("no-scroll", Boolean(allowed && selector));
    }
    function closeAccountView() {
      const url = new URL(location.href);
      if (!url.searchParams.has("view")) return;
      if (history.state?.dartAccountParent) history.back();
      else {
        url.searchParams.delete("view");
        history.replaceState(null, "", url);
        renderAccountView();
      }
      lastTrigger?.focus();
    }
    document.querySelectorAll("[data-account-view]").forEach(link => {
      link.addEventListener("click", event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!enforceCustomerAccountAccess()) return;
        lastTrigger = link;
        const url = new URL(link.href, location.href);
        if (url.href !== location.href) history.pushState({ dartAccountParent: location.href }, "", url);
        renderAccountView();
        if (link.dataset.accountView === "waiting") void hydrateWaiting(true).catch(() => {});
      });
    });
    sections.forEach(section => {
      const close = section.querySelector(".dart-account-back");
      if (close) {
        close.addEventListener("click", closeAccountView);
      }
      let startX = 0, startY = 0;
      section.addEventListener("touchstart", event => {
        const touch = event.touches[0]; if (touch) { startX = touch.clientX; startY = touch.clientY; }
      }, { passive: true });
      section.addEventListener("touchend", event => {
        if (event.target.closest("input, textarea, select, button")) return;
        const touch = event.changedTouches[0];
        if (touch && touch.clientX - startX > 100 && Math.abs(touch.clientY - startY) < 80) closeAccountView();
      }, { passive: true });
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closeAccountView(); });
    window.addEventListener("popstate", renderAccountView);
    window.addEventListener("dart:customer-session-changed", renderAccountView);
    renderAccountView();
  }

  window.addEventListener("dart:customer-session-changed", () => {
    enforceCustomerAccountAccess();
    wireAccountLink();
  });
