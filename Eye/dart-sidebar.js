/* DART SIDEBAR V1 — presentation state only; section navigation remains in dart.js. */
(() => {
  "use strict";
  const init = () => {
    const sidebar = document.querySelector("body > nav.cont-menu");
    const collapseButton = document.getElementById("dart-sidebar-toggle");
    const closeButton = document.getElementById("dart-sidebar-close");
    const mobileButton = document.getElementById("dart-mobile-menu-toggle");
    const overlay = document.getElementById("dart-sidebar-overlay");
    if (!sidebar || !collapseButton || !mobileButton || !overlay) return;
    const storageKey = "dart_eye_sidebar_collapsed";
    const mobile = () => window.matchMedia("(max-width: 768px)").matches;
    const readChoice = () => { try { return localStorage.getItem(storageKey) === "1"; } catch { return false; } };
    const saveChoice = (collapsed) => { try { localStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch { /* Storage can be disabled. */ } };
    const refreshCollapse = () => {
      const collapsed = document.body.classList.contains("dart-sidebar-collapsed");
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      collapseButton.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
      const icon = collapseButton.querySelector("i");
      if (icon) icon.className = collapsed ? "fa-solid fa-angles-right" : "fa-solid fa-angles-left";
    };
    document.body.classList.toggle("dart-sidebar-collapsed", readChoice());
    refreshCollapse();
    collapseButton.addEventListener("click", () => {
      const collapsed = document.body.classList.toggle("dart-sidebar-collapsed");
      saveChoice(collapsed);
      refreshCollapse();
    });
    const closeDrawer = (restoreFocus = false) => {
      const wasOpen = document.body.classList.contains("dart-sidebar-mobile-open");
      document.body.classList.remove("dart-sidebar-mobile-open");
      overlay.hidden = true;
      mobileButton.setAttribute("aria-expanded", "false");
      if (wasOpen && restoreFocus) mobileButton.focus();
    };
    const openDrawer = () => {
      if (!mobile() || document.body.classList.contains("dart-admin-locked")) return;
      overlay.hidden = false;
      document.body.classList.add("dart-sidebar-mobile-open");
      mobileButton.setAttribute("aria-expanded", "true");
      closeButton?.focus();
    };
    mobileButton.addEventListener("click", () => {
      if (document.body.classList.contains("dart-sidebar-mobile-open")) closeDrawer(true);
      else openDrawer();
    });
    closeButton?.addEventListener("click", () => closeDrawer(true));
    overlay.addEventListener("click", () => closeDrawer(true));
    sidebar.querySelectorAll(".menu a[data-target]").forEach((link) => {
      link.setAttribute("title", link.textContent.trim());
      link.addEventListener("click", () => {
        if (mobile()) closeDrawer();
      });
    });
    const syncActive = () => {
      document.querySelectorAll(".cont-menu a[data-target], .nav-tow a[data-target]").forEach((link) => {
        if (link.classList.contains("active")) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    };
    syncActive();
    window.addEventListener("dart:dashboard-section-activated", syncActive);
    document.addEventListener("keydown", (event) => {
      if (!document.body.classList.contains("dart-sidebar-mobile-open")) return;
      if (event.key === "Escape") { event.preventDefault(); closeDrawer(true); return; }
      if (event.key !== "Tab") return;
      const controls = [...sidebar.querySelectorAll("button:not([hidden]), a[data-target]")].filter((el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden");
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.addEventListener("resize", () => { if (!mobile()) closeDrawer(); });
    window.addEventListener("dart:admin-logged-out", () => closeDrawer());
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();