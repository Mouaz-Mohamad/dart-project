/* Dart Eye Orders — visual quick views only.
   Delegates filtering to the dashboard's existing status select and handlers.
   Does not modify order states, prices, discounts, permissions, or API calls. */
(() => {
  "use strict";
  const root = document.getElementById("orders");
  if (!root) return;
  const quickButtons = [...root.querySelectorAll("[data-dart-order-quick]")];
  const statusSelect = () => root.querySelector('.filter-bar select[data-filter-key="status"]');
  const refreshSelected = () => {
    const select = statusSelect();
    if (!select) return;
    const value = select.value === (select.dataset.dartAllValue || "all")
      ? "" : select.value;
    for (const button of quickButtons) {
      const isActive = button.dataset.dartOrderQuick === value;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  };
  for (const button of quickButtons) {
    button.addEventListener("click", () => {
      const select = statusSelect();
      if (!select) return;
      const desired = button.dataset.dartOrderQuick;
      const target = desired || (select.dataset.dartAllValue || "");
      if (![...select.options].some(option => option.value === target)) return;
      if (select.value !== target) {
        select.value = target;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      refreshSelected();
    });
  }
  root.addEventListener("change", event => {
    if (event.target === statusSelect()) refreshSelected();
  });
  root.addEventListener("click", event => {
    if (event.target.closest(".dart-clear-filters")) {
      queueMicrotask(refreshSelected);
    }
  });
  window.addEventListener("dart:dashboard-section-activated", event => {
    if (event.detail?.id === "orders") refreshSelected();
  });

  // Keep the native bulk-action details usable without showing all commands
  // by default. Expand them when staff select one or more orders.
  const count = document.getElementById("bulk-selected-count");
  const bulk = root.querySelector(".dart-orders-bulk-panel");
  if (count && bulk) {
    const revealSelected = () => {
      const selected = Number.parseInt(count.textContent || "", 10);
      if (Number.isFinite(selected) && selected > 0) bulk.open = true;
    };
    const observer = new MutationObserver(revealSelected);
    observer.observe(count, { characterData: true, childList: true, subtree: true });
    window.addEventListener("dart:admin-logged-out", () => { bulk.open = false; });
  }
  refreshSelected();
})();