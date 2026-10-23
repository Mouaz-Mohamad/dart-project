// Final V2 boot: runs after legacy declarations, while preserving the current HTML/CSS structure.
document.addEventListener("DOMContentLoaded", () => {
  loadAllDataFromStorage();
  // Re-run navigation discovery so newly added Damage exists in both desktop/mobile nav.
  const links = document.querySelectorAll("[data-target]"),
    sections = document.querySelectorAll(".dashboard-section");
  function activate(id) {
    sections.forEach((s) => s.classList.toggle("active-section", s.id === id));
    links.forEach((l) => l.classList.toggle("active", l.dataset.target === id));
    localStorage.setItem("dart_active_section", id);
    if (id === "live-operations") void dartLoadLiveOperations();
    if (id === "brand" || id === "finance") void dartLoadFinance();
    if (id === "brand") void dartLoadTrafficAnalytics();
    if (sectionsMap[id]) dartRenderSection(id);
    dartRefreshAll();
    window.dispatchEvent(new CustomEvent("dart:dashboard-section-activated", { detail: { id } }));
  }
  links.forEach((l) => {
    if (!l.dataset.dartNavBound) {
      l.dataset.dartNavBound = "1";
      l.addEventListener("click", (e) => {
        e.preventDefault();
        activate(l.dataset.target);
      });
    }
  });
  setupSearchFilter();
  setupHeaderBatchActions();
  setupAllDelegatedEvents();
  setupPasswordResetRequests();
  setupGlobalModalTriggers();
  setupBirthdayMessageActions();
  setupModelModal();
  setupItemModal();
  setupCustomerModal();
  setupOrderModal();
  setupRepresentativeModal();
  dartSetupDamageModal();
  dartSetupOperationalModals();
  dartRefreshAll();
  const saved = localStorage.getItem("dart_active_section");
  if (saved && document.getElementById(saved)) activate(saved);
  else if (document.getElementById("brand")?.classList.contains("active-section")) void dartLoadTrafficAnalytics();
});

// Brand analytics data renderer. Its fixed mount lives in Dart Eye.html.
function dartTopBy(values) {
  const m = new Map();
  values.filter(Boolean).forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ["-", 0];
}
function dartEnsureAnalyticsGrid() {
  return document.getElementById("dart-analytics-grid");
}

// Better low-stock dedupe: one active alert per model/condition, resolved when stock recovers.
function dartCheckStockAlerts() {
  if (window.DartInventory) DartInventory.checkStockAlerts();
}

// ============================================================================
// DART OPERATIONS V3 — requested refinements (IDs, analytics, UX, filters)
