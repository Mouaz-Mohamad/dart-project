// ==========================================
// 10. خريطة الأقسام والتحكم العام بالتعديل (Sections Router & Dynamic Edit)
// ==========================================

const sectionsMap = {
  models: {
    get data() {
      return modelsData;
    },
    set data(v) {
      modelsData = v;
    },
    render: renderModels,
    storageKey: "dart_models",
  },
  items: {
    get data() {
      return itemsData;
    },
    set data(v) {
      itemsData = v;
    },
    render: renderItems,
    storageKey: "dart_items",
  },
  customers: {
    get data() {
      return customersData;
    },
    set data(v) {
      customersData = v;
    },
    render: renderCustomers,
    storageKey: "dart_customers",
  },
  orders: {
    get data() {
      return ordersData;
    },
    set data(v) {
      ordersData = v;
    },
    render: renderOrders,
    storageKey: "dart_orders",
  },
  returns: {
    get data() {
      return returnsData;
    },
    set data(v) {
      returnsData = v;
    },
    render: renderReturns,
    storageKey: "dart_returns",
  },
  review: {
    get data() {
      return reviewsData;
    },
    set data(v) {
      reviewsData = v;
    },
    render: renderReviews,
    storageKey: "dart_reviews",
  },
  card: {
    get data() {
      return cardsData;
    },
    set data(v) {
      cardsData = v;
    },
    render: renderCards,
    storageKey: "dart_cards",
  },
  representative: {
    get data() {
      return representativeData;
    },
    set data(v) {
      representativeData = v;
    },
    render: renderRepresentative,
    storageKey: "dart_representatives",
  },
};

// فتح تعديل العنصر ديناميكياً حسب القسم

// ==========================================
// 11. تفويض الأحداث والتحكم الجماعي والبحث (Event Delegation & Global Handlers)
// ==========================================

// التحكم بالحذف والشطب الجماعي

// البحث والفلترة العامة

// إغلاق وفتح النوافذ المنبثقة بالزر العام والإضافة

// ==========================================
// 12. الناف  (DOM Content Loaded)
// ==========================================

let dartLiveOperationsLoadPromise = null;
function dartLoadLiveOperations() {
  if (window.DartLiveOperationsLoaded) return Promise.resolve();
  if (dartLiveOperationsLoadPromise) return dartLiveOperationsLoadPromise;
  dartLiveOperationsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-dart-live-operations]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "dart-live-operations.js";
    script.defer = true;
    script.dataset.dartLiveOperations = "1";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Live Operations module could not be loaded."));
    document.body.appendChild(script);
  });
  return dartLiveOperationsLoadPromise;
}

let dartFinanceLoadPromise = null;
function dartLoadFinance() {
  if (window.DartFinance) return Promise.resolve(window.DartFinance);
  if (dartFinanceLoadPromise) return dartFinanceLoadPromise;
  // A previous failed download cannot emit another load event on retry.
  document.querySelector('script[data-dart-finance]')?.remove();
  dartFinanceLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "dart-finance.js?v=20261006-finance-state-v1";
    script.defer = true;
    script.dataset.dartFinance = "1";
    script.onload = () => {
      if (window.DartFinance) resolve(window.DartFinance);
      else script.onerror();
    };
    script.onerror = () => {
      dartFinanceLoadPromise = null;
      script.remove();
      reject(new Error("Finance module could not be loaded."));
    };
    document.body.appendChild(script);
  });
  // Navigation intentionally does not await loading. Handle its rejection here.
  void dartFinanceLoadPromise.catch(() => {
    const content = document.getElementById("dart-finance-content");
    if (!content) return;
    content.textContent = "Finance could not be loaded. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.className = "dart-finance-secondary";
    retry.onclick = () => { void dartLoadFinance(); };
    content.appendChild(retry);
  });
  return dartFinanceLoadPromise;
}

let dartTrafficAnalyticsLoadPromise = null;
function dartLoadTrafficAnalytics() {
  if (window.DartTrafficAnalyticsLoaded) return Promise.resolve();
  if (dartTrafficAnalyticsLoadPromise) return dartTrafficAnalyticsLoadPromise;
  dartTrafficAnalyticsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "dart-traffic-analytics.js";
    script.defer = true;
    script.dataset.dartTrafficAnalytics = "1";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Traffic Analytics module could not be loaded."));
    document.body.appendChild(script);
  });
  return dartTrafficAnalyticsLoadPromise;
}

document.addEventListener("DOMContentLoaded", () => {
  // 1. تحميل البيانات المخزنة سابقاً
  loadAllDataFromStorage();

  // 2. إعداد التنقل (يحدد جميع الروابط في النافين التي تحتوي على data-target)
  const menuLinks = document.querySelectorAll("[data-target]");
  const sections = document.querySelectorAll(".dashboard-section");

  const savedSectionId = "brand";

  // دالة موحدة لتنفيذ التفعيل وتحديث النافين معاً
  function activateSection(targetId) {
    if (!targetId) return;

    // تحديث كلاس active لجميع الروابط المترابطة في القائمتين
    menuLinks.forEach((link) => {
      if (link.getAttribute("data-target") === targetId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    // إخفاء وإظهار السكاشن
    sections.forEach((sec) => sec.classList.remove("active-section"));
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
      targetSection.classList.add("active-section");
    }

    // حفظ القسم النشط
    localStorage.setItem("dart_active_section", targetId);
    if (targetId === "live-operations") void dartLoadLiveOperations();
    if (targetId === "brand" || targetId === "finance") void dartLoadFinance();
    if (targetId === "brand") void dartLoadTrafficAnalytics();
    dartRefreshAll();
    window.dispatchEvent(new CustomEvent("dart:dashboard-section-activated", { detail: { id: targetId } }));
  }

  // تفعيل القسم المخزن أو الافتراضي عند التحميل
  activateSection(savedSectionId);

  // إضافة الأحداث لكل الروابط
  menuLinks.forEach((link) => {
    link.dataset.dartNavBound = "1";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("data-target");
      activateSection(targetId);
    });
  });

  // 3. عرض كافة السكاشن وتفعيل أحداث القوائم
  renderAllSections();
  setupAllDelegatedEvents();
  setupHeaderBatchActions();
  setupSearchFilter();
  setupGlobalModalTriggers();

  // 4. إعداد المودالات لكل السكاشن
  setupModelModal();
  setupItemModal();
  setupCustomerModal();
  setupOrderModal();
  setupReturnModal();
  setupReviewModal();
  setupCardModal();
});


window.addEventListener("dart:catalog-hydrated", () => {
  if (!window.DartCatalog) return;
  modelsData = window.DartCatalog.models();
  itemsData = window.DartCatalog.items();
  if (typeof dartRefreshAll === "function") dartRefreshAll();
});

window.addEventListener("dart:catalog-synced", () => {
  if (!window.DartCatalog) return;
  modelsData = window.DartCatalog.models();
  itemsData = window.DartCatalog.items();
  if (typeof renderModels === "function") renderModels(modelsData);
  if (typeof renderItems === "function") renderItems(itemsData);
});

window.addEventListener("dart:orders-hydrated", (event) => {
  const incoming = event.detail?.orders;
  if (!Array.isArray(incoming)) return;
  ordersData = incoming;
  if (typeof dartRefreshAll === "function") dartRefreshAll();
});

// BEGIN Pending order actions.
function dartRefreshOrderBusyUi() {
  document.querySelectorAll("#orders-container [data-id]").forEach((row) => {
    const order = ordersData.find((entry) => String(entry.id) === String(row.dataset.id));
    if (!order) return;
    const busy = window.DartOrdersApi?.isBusy?.(order.orderId || order.id) === true;
    row.setAttribute("aria-busy", String(busy));
    row.querySelectorAll(".row-action-btns button:not(.dart-history-btn)").forEach((button) => {
      if (busy && !button.disabled) {
        button.dataset.dartOrderBusy = "1";
        button.disabled = true;
        button.setAttribute('aria-busy','true');
      } else if (!busy && button.dataset.dartOrderBusy) {
        delete button.dataset.dartOrderBusy;
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  });
}
window.addEventListener("dart:orders-busy", dartRefreshOrderBusyUi);
window.addEventListener("dart:orders-refresh-failed", () => {
  const message="تم حفظ العملية، وتعذّر تحديث بعض البيانات المرتبطة. جارٍ إعادة محاولة عرضها.";
  if(window.DartDashboardUI?.notify)window.DartDashboardUI.notify(message,'warning');else window.DartDialog?.alert?.(message);
});
// END Per-order pending actions.

/* BEGIN Dashboard data synchronization */
window.addEventListener("dart:data-changed", (event) => {
  if (event.detail?.key === "dart_orders" &&
      ["orders:hydrate", "orders:authoritative", "orders:sync-confirmed", "orders:selection"].includes(event.detail?.source)) return;
  dartDashboardReloadQueued = true;
  dartRefreshAll();
});

window.addEventListener("dart:audit-hydrated", (event) => {
  const incoming = event.detail?.audit;
  if (!Array.isArray(incoming)) return;
  auditData = incoming;
});

window.addEventListener("dart:domain-hydrated", (event) => {
  const domain = event.detail?.domain;
  const data = event.detail?.data;
  if (!Array.isArray(data)) return;
  const handlers = {
    customers: (value) => (customersData = value),
    returns: (value) => (returnsData = value),
    reviews: () => (reviewsData = dartFeedbackRows()),
    contacts: () => (reviewsData = dartFeedbackRows()),
    cards: (value) => (cardsData = value),
    representatives: (value) => (representativeData = value),
    damage: (value) => (damageData = value),
    notifications: (value) => (notificationData = value),
  };
  handlers[domain]?.(data);
  if (typeof dartRefreshAll === "function") dartRefreshAll();
});


/* END Dashboard data synchronization */

// ===========================================
// 13. Chart in Brand Information
// ===========================================

document.addEventListener("click", (e) => {
  if(e.target.closest('#dart-finance-modal'))return;
  if (
    e.target.classList.contains("close-modal") ||
    e.target.classList.contains("modal")
  ) {
    const modal = e.target.closest(".modal") || e.target;
    closeModal(modal);
  }
});

