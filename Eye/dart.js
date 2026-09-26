/* BEGIN WebP runtime fallback for dynamically assigned local images */
(function installDartWebpFallback() {
  if (window.__dartWebpFallbackInstalled) return;
  window.__dartWebpFallbackInstalled = true;
  document.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    var src = img.getAttribute('src') || '';
    if (!/\.webp(?:[?#].*)?$/i.test(src)) return;
    var base = src.replace(/\.webp(?=([?#].*)?$)/i, '');
    var stage = Number(img.dataset.dartFallbackStage || 0);
    var candidates = ['.png', '.jpg', '.jpeg', '.jfif'];
    if (stage >= candidates.length) return;
    img.dataset.dartFallbackStage = String(stage + 1);
    img.src = base + candidates[stage];
  }, true);
})();
/* END WebP runtime fallback for dynamically assigned local images */

// DART CODE GUIDE | Eye/dart.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// ============================================================================
 // DART EYE | DASHBOARD CORE
 // Core dashboard rendering, forms, navigation, brand analytics, and shared UI.
 // Feature-specific modules live in dart-inventory/finance/settings/staff/etc.
 // ============================================================================

// ==========================================
// 1. الدوال العامة والمساعدة (Global Helpers & Utilities)
// ==========================================

// التخزين المحلي
function saveDataToStorage(key, data) {
  if (
    window.DartCatalog &&
    ["dart_models", "dart_items"].includes(key)
  ) {
    window.DartCatalog.write(key, data);
    return;
  }
  if (key === "dart_orders" && window.DartOrdersApi) {
    window.DartOrdersApi.write(data);
    return;
  }
  if (window.DartDomainState?.domainForStorageKey?.(key)) {
    window.DartDomainState.write(key, data);
    return;
  }
  window.DartState?.write?.(key, data, { source: "dashboard" });
}

// تنسيق الصفوف والترتيب

// التحكم للنوافذ المنبثقة
function openModal(modal) {
  if (!modal) return;
  modal.style.display = "block";
  modal.classList.add("active");
}

function closeModal(modal) {
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("active");
}

// تحديث قائمة الموديلات داخل Datalist للقطع

// استدعاء الدالة عند فتح النافذة المنبثقة للقطع
document.getElementById("add-btn")?.addEventListener("click", () => {
  populateModelsDatalist();
});
// ==========================================
// 2. قسم الموديلات (Models Module)
// ==========================================

// البيانات الأولية للموديلات
let modelsData = [];

// عرض الموديلات

// النافذة المنبثقة للموديلات

// ==========================================
// 3. قسم القطع (Items Module)
// ==========================================

// البيانات الأولية للقطع
let itemsData = [];

// عرض القطع

// ==========================================
// 4. قسم العملاء (Customers Module)
// ==========================================

// البيانات الأولية للعملاء
let customersData = [];

// عرض العملاء

// النافذة المنبثقة للعملاء

// ==========================================
// 5. قسم الطلبات (Orders Module)
// ==========================================


// البيانات الأولية للطلبات
let ordersData = [];

// عرض الطلبات

// النافذة المنبثقة للطلبات

// ==========================================
// 6. قسم المرتجعات (Returns Module)
// ==========================================

// البيانات الأولية للمرتجعات
let returnsData = [];

// عرض المرتجعات

// النافذة المنبثقة للمرتجعات

// ==========================================
// 7. قسم التقييمات (Reviews Module)
// ==========================================

// البيانات الأولية للتقييمات
let reviewsData = [];

// عرض التقييمات

// النافذة المنبثقة للتقييمات

// ==========================================
// 8. قسم المندوبين (Representative Module)
// ==========================================

// البيانات الأولية للتقييمات
let representativeData = [];

document.addEventListener("DOMContentLoaded", () => {
  renderRepresentative(representativeData);
  setupRepresentativeModal();
});

// ==========================================
// 9. قسم الكروت (Cards Module)
// ==========================================

// البيانات الأولية للكروت
let cardsData = [];

// عرض الكروت
function renderCards(dataArray) {
  const container = document.getElementById("card-container");
  if (!container) return;
  container.innerHTML = "";

  getSortedData(dataArray).forEach((item) => {
    let boxesHTML = '<div class="card-items-grid">';
    (item.requestedProducts || []).forEach((code) => {
      boxesHTML += `<div class="card-item-chip">${dartEsc(code)}</div>`;
    });
    boxesHTML += "</div>";

    container.insertAdjacentHTML(
      "beforeend",
      `
            <div class="${getRowClass(item)}" data-id="${dartEsc(item.id)}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? "checked" : ""}>
                <div class="w100 button row-action-btns">
                    <button type="button" class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button type="button" class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button type="button" class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item overflow w150">${dartEsc(item.cardId)}</span>
                <span class="text-item overflow w150">${dartEsc(item.clientName)}</span>
                <span class="text-item overflow w150">${dartEsc(item.clientId)}</span>
                <span class="text-item overflow w150">${dartEsc(item.phone1)}</span>
                <span class="text-item overflow w150">${dartEsc(item.phone2 || "-")}</span>
                <span class="text-item overflow w200">${dartEsc(item.email || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.status || "-")}</span>
                <span class="text-item overflow w200">${dartEsc(item.issueDate || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.expDate || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.purchasedItems ?? 0)}</span>
                <span class="text-item overflow w150">${dartEsc(item.purchasedLimit ?? item.itemLimit ?? 10)}</span>
                <div class="text-item overflow w1200">${boxesHTML}</div>
            </div>
        `,
    );
  });
}

// النافذة المنبثقة للكروت
function dartCardIsCurrentlyActive(card, reference = new Date()) {
  if (!card || card.status !== "Active" || dartIsArchived(card)) return false;
  const limit = Number(card.itemLimit || card.purchasedLimit || 10),
    used = Number(card.purchasedItems || 0),
    parsedExpiry = dartDateValue(card.expDate),
    expiry = parsedExpiry ? new Date(parsedExpiry) : null;
  if (expiry) expiry.setHours(23, 59, 59, 999);
  return used < limit && (!expiry || expiry >= reference);
}

function setupCardModal() {
  const modal = document.getElementById("card-modal");
  const form = document.getElementById("card-form");
  if (!modal || !form || form.dataset.dartBound) return;
  form.dataset.dartBound = "1";
  const clientSelect = document.getElementById("modal-card-client-id"),
    inputDate = (value) => {
      const date = dartDateValue(value);
      if (!date) return "";
      const year = date.getFullYear(),
        month = String(date.getMonth() + 1).padStart(2, "0"),
        day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },
    fillClient = (clientId) => {
      const client = customersData.find(
        (row) => String(row.clientId) === String(clientId),
      );
      document.getElementById("modal-card-client-name").value =
        client?.clientName || "";
      document.getElementById("modal-card-phone1").value = client?.phone1 || "";
      document.getElementById("modal-card-phone2").value = client?.phone2 || "-";
      document.getElementById("modal-card-email").value = client?.email || "";
    };

  window.dartOpenCardEditor = (card = null) => {
    form.reset();
    clientSelect.innerHTML =
      '<option value="">Select client</option>' +
      customersData
        .filter(dartIsActive)
        .map(
          (customer) =>
            `<option value="${dartEsc(customer.clientId)}">${dartEsc(customer.clientName)} — ${dartEsc(customer.clientId)}</option>`,
        )
        .join("");
    const today = new Date(),
      expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    document.getElementById("modal-card-edit-id").value = card?.id || "";
    document.getElementById("modal-card-code-id").value =
      card?.cardId || `DC-${Date.now().toString(36).toUpperCase()}`;
    clientSelect.value = card?.clientId || "";
    fillClient(clientSelect.value);
    document.getElementById("modal-card-purchased").value =
      Number(card?.purchasedItems || 0);
    document.getElementById("modal-card-limit").value = "10";
    document.getElementById("modal-card-discount").value = `${Number(card?.discountPercent ?? window.DartSiteSettings?.get?.().dartCardDiscountPercent ?? 40)}%`;
    document.getElementById("modal-card-issue").value =
      inputDate(card?.issueDate) || inputDate(today);
    document.getElementById("modal-card-exp").value =
      inputDate(card?.expDate) || inputDate(expiry);
    document.getElementById("modal-card-status").value = card?.status || "Active";
    document.getElementById("card-modal-title").textContent = card
      ? "Edit Dart Card Benefit"
      : "Additional Benefit — Dart Card";
    form.querySelector('[type="submit"]').textContent = card
      ? "Save Dart Card"
      : "Grant Dart Card";
    openModal(modal);
  };

  clientSelect.addEventListener("change", () => fillClient(clientSelect.value));
  document
    .getElementById("openCardBenefitBtn")
    ?.addEventListener("click", () => window.dartOpenCardEditor());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const editId = document.getElementById("modal-card-edit-id").value,
      client = customersData.find(
        (row) => String(row.clientId) === String(clientSelect.value),
      ),
      issueDate = document.getElementById("modal-card-issue").value,
      expDate = document.getElementById("modal-card-exp").value,
      purchasedItems = Number(
        document.getElementById("modal-card-purchased").value,
      );
    if (!client) return window.DartDialog.alert("اختر العميل أولًا.");
    if (!issueDate || !expDate || new Date(expDate) <= new Date(issueDate))
      return window.DartDialog.alert("تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار.");
    if (!Number.isInteger(purchasedItems) || purchasedItems < 0 || purchasedItems > 10)
      return window.DartDialog.alert("عدد القطع المستخدمة يجب أن يكون من 0 إلى 10.");
    if (
      document.getElementById("modal-card-status").value === "Active" &&
      cardsData.some(
        (row) =>
          String(row.id) !== String(editId) &&
          row.clientId === client.clientId &&
          dartCardIsCurrentlyActive(row),
      )
    )
      return window.DartDialog.alert("هذا العميل لديه Dart Card نشط بالفعل.");

    const cardPayload = {
      cardId: document.getElementById("modal-card-code-id").value,
      clientName: client.clientName,
      clientId: client.clientId,
      phone1: client.phone1 || "",
      phone2: client.phone2 || "-",
      email: client.email || "",
      status: document.getElementById("modal-card-status").value || "Active",
      issueDate,
      expDate,
      purchasedItems: String(purchasedItems),
      purchasedLimit: "10",
      itemLimit: 10,
      discountPercent: editId
        ? Number(cardsData.find((row) => String(row.id) === String(editId))?.discountPercent ?? 40)
        : Number(window.DartSiteSettings?.get?.().dartCardDiscountPercent ?? 40),
      requestedProducts: editId
        ? cardsData.find((row) => String(row.id) === String(editId))
            ?.requestedProducts || []
        : [],
      isArchived: false,
      isDeleted: false,
      isChecked: false,
      updatedAt: dartNowISO(),
    };
    if (editId) {
      const card = cardsData.find((row) => String(row.id) === String(editId)),
        old = { ...card };
      Object.assign(card, cardPayload);
      dartAudit("EDIT", "card", card.id, old, cardPayload);
    } else {
      const card = {
        id: dartUid("CARDDB"),
        createdAt: dartNowISO(),
        grantType: "Manual Additional Benefit",
        ...cardPayload,
      };
      cardsData.push(card);
      dartAudit("CREATE", "card", card.id, {}, card);
    }
    customersData.forEach((customer) => {
      customer.dartCard = cardsData.some(
        (row) =>
          row.clientId === customer.clientId &&
          dartCardIsCurrentlyActive(row),
      )
        ? "yes"
        : "no";
    });
    dartSyncUserCardFlags();
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
    form.reset();
  });
}

function dartSyncUserCardFlags() {
  if (window.DartDomainState) return;
  let users;
  users = window.DartState?.read?.("dart_users", []) || [];
  users.forEach((user) => {
    user.dartCard = cardsData.some(
      (card) =>
        card.clientId === user.customerId &&
        dartCardIsCurrentlyActive(card),
    )
      ? "yes"
      : "no";
  });
  window.DartState?.write?.("dart_users", users, { source: "dashboard" });
}

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
  dartFinanceLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-dart-finance]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.DartFinance), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "dart-finance.js";
    script.defer = true;
    script.dataset.dartFinance = "1";
    script.onload = () => resolve(window.DartFinance);
    script.onerror = () => {
      dartFinanceLoadPromise = null;
      reject(new Error("Finance module could not be loaded."));
    };
    document.body.appendChild(script);
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
  }

  // تفعيل القسم المخزن أو الافتراضي عند التحميل
  activateSection(savedSectionId);

  // إضافة الأحداث لكل الروابط
  menuLinks.forEach((link) => {
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
  if (typeof renderModels === "function") renderModels(modelsData);
  if (typeof renderItems === "function") renderItems(itemsData);
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
  if (typeof renderOrders === "function") renderOrders(ordersData);
  if (typeof dartRefreshAll === "function") dartRefreshAll();
});

/* BEGIN Dashboard data synchronization */
window.addEventListener("dart:data-changed", () => {
  try {
    loadAllDataFromStorage(false);
    dartRefreshAll();
  } catch (error) {
    console.warn("Dashboard sync failed", error);
  }
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
    customers(value) {
      customersData = value;
      if (typeof renderCustomers === "function") renderCustomers(customersData);
    },
    returns(value) {
      returnsData = value;
      if (typeof renderReturns === "function") renderReturns(returnsData);
    },
    reviews(value) {
      reviewsData = value;
      if (typeof renderReviews === "function") renderReviews(reviewsData);
    },
    cards(value) {
      cardsData = value;
      if (typeof renderCards === "function") renderCards(cardsData);
    },
    representatives(value) {
      representativeData = value;
      if (typeof renderRepresentative === "function") renderRepresentative(representativeData);
    },
    damage(value) {
      damageData = value;
      if (typeof renderDamage === "function") renderDamage(damageData);
    },
    notifications(value) {
      notificationData = value;
      if (typeof renderNotifications === "function") renderNotifications();
    },
  };
  handlers[domain]?.(data);
  if (typeof dartRefreshAll === "function") dartRefreshAll();
});


/* END Dashboard data synchronization */

// ===========================================
// 13. Chart in Brand Information
// ===========================================

document.addEventListener("click", (e) => {
  if (
    e.target.classList.contains("close-modal") ||
    (e.target.tagName === "SPAN" && e.target.closest(".modal")) ||
    e.target.classList.contains("modal")
  ) {
    const modal = e.target.closest(".modal") || e.target;
    modal.style.display = "none";
    modal.classList.remove("active");
  }
});

let currentMode = "months";
let currentYear = new Date().getFullYear();

var options = {
  series: [{ name: "Total Sales", data: Array(12).fill(0) }],
  chart: {
    type: "area",
    height: 230,
    width: "100%",
    toolbar: { show: false },
    sparkline: { enabled: false },
  },
  colors: ["#43BFE5"],
  stroke: {
    curve: "smooth",
    width: 2,
  },
  fill: {
    type: "gradient",
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.4,
      opacityTo: 0.05,
    },
  },
  dataLabels: { enabled: false },
  xaxis: {
    categories: [],
    labels: {
      style: { colors: "#e2e8f0", fontSize: "11px" },
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: "#e2e8f0", fontSize: "11px" },
      formatter: (val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val),
    },
  },
  grid: {
    borderColor: "rgba(255, 255, 255, 0.1)",
    strokeDashArray: 4,
  },
  tooltip: {
    theme: "dark",
  },
};

var chart =
  typeof ApexCharts === "function"
    ? new ApexCharts(document.querySelector("#myChart"), options)
    : { render() {}, updateOptions() {} };
chart.render();


function navigate(dir) {
  currentYear += dir;
  updateChart();
}

document.querySelectorAll("[data-sales-year-delta]").forEach((button) => {
  button.addEventListener("click", () => {
    navigate(Number(button.dataset.salesYearDelta) || 0);
  });
});

function updateChart() {
  const label = document.getElementById("displayLabel");
  if (label) label.innerText = currentYear;
  const monthly = Array(12).fill(0);
  (typeof ordersData !== "undefined" ? ordersData : []).forEach((order) => {
    if (order.status !== "Delivered") return;
    const date = new Date(order.deliveredAt || order.updatedAt || order.createdAt || 0);
    if (!Number.isNaN(date.getTime()) && date.getFullYear() === currentYear)
      monthly[date.getMonth()] += dartOrderNet(order);
  });
  (typeof returnsData !== "undefined" ? returnsData : []).forEach((record) => {
    if (!record.isPostDeliveryReturn || !dartReturnRules()?.isRefund?.(record) || !dartReturnRules()?.isCompleted?.(record)) return;
    const date = new Date(dartReturnRules()?.eventDate?.(record) || record.completedAt || 0);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== currentYear) return;
    const order = ordersData.find((row) => String(row.orderId) === String(record.orderId));
    monthly[date.getMonth()] -= Number(record.originalNetAmount) || dartReturnRules()?.allocatedNetAmount?.(order, record.itemCode, record) || 0;
  });

  chart.updateOptions({
    series: [{ name: "Total Sales", data: monthly.map((value) => Math.round((value + Number.EPSILON) * 100) / 100) }],
    xaxis: {
      categories: [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ],
    },
  });
}

// تشغيل مبدئي
updateChart();

// البحث التلقائي وتعبئة بيانات العميل عبر برقم الهاتف
function autofillCustomerByPhone(phoneInput, fieldsMap) {
  if (!phoneInput) return;

  phoneInput.addEventListener("input", (e) => {
    const phoneVal = e.target.value.trim();
    if (phoneVal.length < 10) return;

    const customer = customersData.find(
      (c) => c.phone1 === phoneVal || c.phone2 === phoneVal,
    );
    if (customer) {
      if (fieldsMap.name && document.getElementById(fieldsMap.name))
        document.getElementById(fieldsMap.name).value =
          customer.clientName || "";
      if (fieldsMap.clientId && document.getElementById(fieldsMap.clientId))
        document.getElementById(fieldsMap.clientId).value =
          customer.clientId || "";
      if (fieldsMap.phone2 && document.getElementById(fieldsMap.phone2))
        document.getElementById(fieldsMap.phone2).value = customer.phone2 || "";
      if (fieldsMap.email && document.getElementById(fieldsMap.email))
        document.getElementById(fieldsMap.email).value = customer.email || "";
      if (
        fieldsMap.governorate &&
        document.getElementById(fieldsMap.governorate)
      )
        document.getElementById(fieldsMap.governorate).value =
          customer.governorate || "";
      if (fieldsMap.country && document.getElementById(fieldsMap.country))
        document.getElementById(fieldsMap.country).value =
          customer.country || "";
    }
  });
}

// تفعيل البحث التلقائي في جميع النوافذ المنبثقة (Modals)
function initGlobalCustomerAutofill() {
  // 1. نافذة الطلبات Order Modal
  autofillCustomerByPhone(document.getElementById("phone1"), {
    name: "clientName",
    clientId: "clientId",
    phone2: "phone2",
    email: "email",
    governorate: "governorate",
  });

  // 2. نافذة المرتجعات Returns Modal
  autofillCustomerByPhone(document.getElementById("modal-return-phone1"), {
    name: "modal-return-name",
    phone2: "modal-return-phone2",
    email: "modal-return-email",
  });

  // 3. نافذة التقييمات Reviews Modal
  autofillCustomerByPhone(document.getElementById("modal-cust-rev-phone1"), {
    name: "modal-cust-rev-name",
    phone2: "modal-cust-rev-phone2",
    email: "modal-cust-rev-email",
  });
}

// تشغيل التعبئة عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
  initGlobalCustomerAutofill();
});

function populateModelsDatalist() {
  const datalist = document.getElementById("models-list");
  if (!datalist) return;

  const options = modelsData
    .filter((model) => !model.isDeleted)
    .map((model) => {
      const option = document.createElement("option");
      option.value = String(model.modelId || "");
      option.textContent = `${String(model.name || "")} - ${String(model.category || "")}`;
      return option;
    });
  datalist.replaceChildren(...options);
}

// ============================================================================
// DART OPERATIONS V2 — integrated business layer (additive refactor)
// ============================================================================
let damageData = [];
let notificationData = [];
let auditData = [];
const DART_LOW_STOCK_THRESHOLD = 5;
const DART_DEAD_STOCK_DAYS = 60;
const DART_ORDER_FLOW = [
  "New",
  "Accepted",
  "Preparing",
  "Out With Representative",
  "Representative On The Way",
  "Delivered",
];
const DART_FINAL_ORDER_STATES = ["Delivered", "Refused", "Cancelled"];
let dartPendingOrderAction = null;
let dartPendingReturnAction = null;
const dartFilterState = {};

function dartNowISO() {
  return new Date().toISOString();
}
function dartUid(prefix = "ID") {
  const randomPart =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4)))
          .map((value) => value.toString(36))
          .join("-");
  return `${prefix}-${randomPart}`;
}
function dartMoney(v) {
  return `${Math.trunc(Number(v) || 0)} EGP`;
}
function dartEsc(v) {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function dartDateValue(v) {
  if (!v) return null;
  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(v)) {
    const [d, m, y] = v.split(/[/-]/);
    return new Date(`${y}-${m}-${d}T00:00:00`);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
// BEGIN Client age — derived from birthday and today's calendar date.
function dartClientAge(birthday, today = new Date()) {
  const born = dartDateValue(birthday);
  if (!born || born > today) return "-";
  let age = today.getFullYear() - born.getFullYear();
  const birthdayPassed =
    today.getMonth() > born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : "-";
}
function dartClientAgeLabel(birthday) {
  const age = dartClientAge(birthday);
  return age === "-" ? "-" : `${age} years`;
}
// END Client age.
function dartIsArchived(x) {
  return Boolean(x?.isArchived ?? x?.isDeleted);
}
function dartIsActive(x) {
  return !dartIsArchived(x);
}
function dartSetArchived(x, val) {
  x.isArchived = Boolean(val);
  x.isDeleted = Boolean(val);
  x.archivedAt = val ? dartNowISO() : null;
}
function dartStatusClass(s) {
  return `status-${String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}
function dartPaymentIcon(method) {
  const m = String(method || "").toLowerCase();
  if (m.includes("cash on") || m === "cash") return "bx bx-money";
  if (m.includes("insta")) return "bx bx-transfer";
  if (m.includes("wallet") || m.includes("vodafone")) return "bx bx-wallet";
  if (m.includes("card") || m.includes("visa") || m.includes("credit"))
    return "bx bx-credit-card";
  return "bx bx-dollar-circle";
}
function dartFindModelByCode(code) {
  return modelsData.find((m) => String(m.modelId) === String(code));
}
function dartFindItemByCode(code) {
  return itemsData.find((i) => String(i.itemCode) === String(code));
}
function dartFindCustomerByCode(code) {
  return customersData.find((c) => String(c.clientId) === String(code));
}
function dartFindRepById(id) {
  return representativeData.find(
    (r) => String(r.id) === String(id) || String(r.repId) === String(id),
  );
}
function dartOrderNet(order) {
  if (Number.isFinite(Number(order?.finalAmount)))
    return Math.max(0, Number(order.finalAmount));
  if (Array.isArray(order.priceSnapshot) && order.priceSnapshot.length) {
    return (
      order.priceSnapshot.reduce(
        (a, l) => a + (Number(l.finalUnitPrice) || 0) * (Number(l.qty) || 1),
        0,
      ) - (Number(order.orderLevelDiscountAmount) || 0)
    );
  }
  const subtotal = Number(order.totalPrice) || 0,
    pct = Number(order.discount) || 0;
  return Math.max(0, subtotal - (subtotal * pct) / 100);
}

function dartSaveAll() {
  saveDataToStorage("dart_models", modelsData);
  saveDataToStorage("dart_items", itemsData);
  saveDataToStorage("dart_customers", customersData);
  saveDataToStorage("dart_orders", ordersData);
  saveDataToStorage("dart_returns", returnsData);
  saveDataToStorage("dart_reviews", reviewsData);
  saveDataToStorage("dart_cards", cardsData);
  saveDataToStorage("dart_representatives", representativeData);
  saveDataToStorage("dart_damage", damageData);
  saveDataToStorage("dart_notifications", notificationData);
  saveDataToStorage("dart_audit", auditData);
  // Business schema state is server-authoritative.
}

function getRowClass(item) {
  return dartIsArchived(item)
    ? "model-row row-deleted"
    : "model-row row-normal";
}
function getSortedData(dataArray) {
  return [...(dataArray || [])].sort(
    (a, b) =>
      Number(dartIsArchived(a)) - Number(dartIsArchived(b)) ||
      String(b.createdAt || b.date || b.regDate || "").localeCompare(
        String(a.createdAt || a.date || a.regDate || ""),
      ),
  );
}

function dartAudit(
  action,
  entityType,
  entityId,
  oldValues = {},
  newValues = {},
  note = "",
) {
  auditData.unshift({
    id: dartUid("AUD"),
    action,
    entityType,
    entityId: String(entityId || ""),
    timestamp: dartNowISO(),
    oldValues,
    newValues,
    actorRole: "Admin",
    actorId: null,
    note,
  });
  if (auditData.length > 1500) auditData.length = 1500;
}
function dartNotify(
  type,
  title,
  message,
  entityType = "",
  entityId = "",
  severity = "info",
) {
  notificationData.unshift({
    id: dartUid("NOT"),
    type,
    title,
    message,
    timestamp: dartNowISO(),
    relatedEntityType: entityType,
    relatedEntityId: String(entityId || ""),
    read: false,
    severity,
  });
  if (notificationData.length > 500) notificationData.length = 500;
  renderNotifications();
}
function dartLogOrder(order, type, previousStatus, newStatus, meta = {}) {
  order.activityLog = Array.isArray(order.activityLog) ? order.activityLog : [];
  order.activityLog.push({
    id: dartUid("EVT"),
    type,
    previousStatus: previousStatus || null,
    newStatus: newStatus || order.status,
    timestamp: dartNowISO(),
    representativeId: meta.representativeId || order.representativeId || null,
    reason: meta.reason || "",
    notes: meta.notes || "",
    actorRole: meta.actorRole || "Admin",
    actorId: meta.actorId || null,
  });
}

function dartDeleteImpact(sectionKey, id) {
  const sid = String(id),
    impact = {
      models: new Set(),
      items: new Set(),
      customers: new Set(),
      orders: new Set(),
      returns: new Set(),
      review: new Set(),
      card: new Set(),
      representative: new Set(),
      damage: new Set(),
      clientCodes: new Set(),
      itemCodes: new Set(),
      orderCodes: new Set(),
      returnCodes: new Set(),
    };
  const target = sectionsMap[sectionKey]?.data.find(
    (row) => String(row.id) === sid,
  );
  if (!target) return null;
  impact[sectionKey]?.add(sid);

  if (sectionKey === "models") {
    const modelCode = target.modelId;
    itemsData
      .filter((row) => String(row.modelId) === String(modelCode))
      .forEach((row) => {
        impact.items.add(String(row.id));
        impact.itemCodes.add(String(row.itemCode));
      });
    ordersData
      .filter((row) =>
        (row.priceSnapshot || []).some(
          (line) => String(line.modelCode) === String(modelCode),
        ),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
  }
  if (sectionKey === "items") impact.itemCodes.add(String(target.itemCode));
  if (sectionKey === "customers") impact.clientCodes.add(String(target.clientId));
  if (sectionKey === "orders") impact.orderCodes.add(String(target.orderId));
  if (sectionKey === "returns") impact.returnCodes.add(String(target.returnId));

  if (sectionKey === "representative") {
    ordersData
      .filter(
        (row) =>
          [row.representativeId, row.representativeBusinessId].some(
            (value) =>
              String(value) === sid || String(value) === String(target.repId),
          ),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
  }

  if (impact.clientCodes.size) {
    ordersData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
    returnsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
    reviewsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => impact.review.add(String(row.id)));
    cardsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => impact.card.add(String(row.id)));
  }

  if (impact.itemCodes.size) {
    ordersData
      .filter((row) =>
        (row.items || []).some((code) => impact.itemCodes.has(String(code))),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
    returnsData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
    damageData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  if (impact.orderCodes.size) {
    ordersData
      .filter((row) => impact.orderCodes.has(String(row.orderId)))
      .forEach((row) => {
        impact.orders.add(String(row.id));
        (row.items || []).forEach((code) => impact.itemCodes.add(String(code)));
      });
    itemsData
      .filter(
        (row) =>
          impact.orderCodes.has(String(row.orderId)) ||
          impact.itemCodes.has(String(row.itemCode)),
      )
      .forEach((row) => {
        impact.items.add(String(row.id));
        impact.itemCodes.add(String(row.itemCode));
      });
    returnsData
      .filter((row) => impact.orderCodes.has(String(row.orderId)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
  }

  if (impact.itemCodes.size) {
    damageData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  if (impact.returnCodes.size) {
    damageData
      .filter((row) => impact.returnCodes.has(String(row.returnId)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  const labels = {
      models: "Models",
      items: "Items",
      customers: "Clients",
      orders: "Orders",
      returns: "Returns",
      review: "Reviews / Messages",
      card: "Dart Cards",
      representative: "Representatives",
      damage: "Damage records",
    },
    counts = Object.entries(labels)
      .map(([key, label]) => ({ key, label, count: impact[key].size }))
      .filter((row) => row.count > 0);
  return { sectionKey, id: sid, target, impact, counts };
}


let dartPendingHardDelete = null;
function dartHardDeleteRelations(preview) {
  return (preview?.counts || []).filter(
    (row) => row.key !== preview.sectionKey || row.count > 1,
  );
}

async function dartSyncHardDeleteSection(sectionKey) {
  if (["models", "items"].includes(sectionKey)) {
    await window.DartCatalog?.syncAdminState?.();
    await window.DartCatalog?.hydrate?.(true);
    return;
  }
  if (sectionKey === "orders") {
    await window.DartOrdersApi?.hydrate?.(true);
    return;
  }
  const domainBySection = {
    customers: "customers",
    returns: "returns",
    review: "reviews",
    card: "cards",
    representative: "representatives",
    damage: "damage",
  };
  const domain = domainBySection[sectionKey];
  if (domain) {
    await window.DartDomainState?.syncDomain?.(domain);
    await window.DartDomainState?.hydrateDomain?.(domain, true);
  }
  await window.DartDomainState?.hydrateAudit?.().catch(() => {});
}

async function dartRollbackHardDeleteSection(sectionKey) {
  try {
    if (["models", "items"].includes(sectionKey)) {
      await window.DartCatalog?.hydrate?.(true);
      return;
    }
    if (sectionKey === "orders") {
      await window.DartOrdersApi?.hydrate?.(true);
      return;
    }
    const domainBySection = {
      customers: "customers",
      returns: "returns",
      review: "reviews",
      card: "cards",
      representative: "representatives",
      damage: "damage",
    };
    const domain = domainBySection[sectionKey];
    if (domain) await window.DartDomainState?.hydrateDomain?.(domain, true);
  } finally {
    dartRefreshAll();
  }
}

async function dartCommitHardDelete(mode) {
  const preview = dartPendingHardDelete;
  if (!preview) return;

  const { sectionKey, id, target, impact } = preview;
  const sec = sectionsMap[sectionKey];
  const serverMode = Boolean(window.DartAdminApi?.request);
  const linked = dartHardDeleteRelations(preview);

  if (serverMode && (mode === "cascade" || linked.length)) {
    window.DartDialog.alert(
      "Permanent cascade delete is blocked in production for linked business records. Archive/soft-delete this record instead, or use Reset All Data when you intentionally need a full platform purge.",
    );
    return;
  }

  if (
    serverMode &&
    target?.serverAuthoritative &&
    ["customers", "representative"].includes(sectionKey)
  ) {
    window.DartDialog.alert("Secure customer and representative accounts must be deleted through the account API.");
    return;
  }

  if (mode === "only") {
    sec.data = sec.data.filter((row) => String(row.id) !== String(id));
  } else {
    // Legacy/local development fallback only. Production never enters this branch.
    modelsData = modelsData.filter((row) => !impact.models.has(String(row.id)));
    itemsData = itemsData.filter((row) => !impact.items.has(String(row.id)));
    customersData = customersData.filter(
      (row) => !impact.customers.has(String(row.id)),
    );
    ordersData = ordersData.filter((row) => !impact.orders.has(String(row.id)));
    returnsData = returnsData.filter((row) => !impact.returns.has(String(row.id)));
    reviewsData = reviewsData.filter((row) => !impact.review.has(String(row.id)));
    cardsData = cardsData.filter((row) => !impact.card.has(String(row.id)));
    representativeData = representativeData.filter(
      (row) => !impact.representative.has(String(row.id)),
    );
    damageData = damageData.filter((row) => !impact.damage.has(String(row.id)));

    if (!serverMode && impact.clientCodes.size) {
      let users;
      users = window.DartState?.read?.("dart_users", []) || [];
      users = users.filter(
        (row) => !impact.clientCodes.has(String(row.customerId)),
      );
      window.DartState?.write?.("dart_users", users, { source: "dashboard" });
    }
  }

  customersData.forEach((customer) => {
    customer.dartCard = cardsData.some(
      (card) =>
        card.clientId === customer.clientId &&
        dartCardIsCurrentlyActive(card),
    )
      ? "yes"
      : "no";
  });

  dartSyncUserCardFlags();
  dartAudit(
    mode === "cascade" ? "PERMANENT_DELETE_WITH_LINKS" : "PERMANENT_DELETE_ONLY",
    sectionKey,
    id,
    target || {},
    {},
  );
  dartSaveAll();

  if (serverMode) {
    try {
      await dartSyncHardDeleteSection(sectionKey);
    } catch (error) {
      await dartRollbackHardDeleteSection(sectionKey);
      window.DartDialog.alert(error.message || "Permanent delete was not committed to the database.");
      return;
    }
  }

  dartRefreshAll();
  closeModal(document.getElementById("hard-delete-modal"));
  dartPendingHardDelete = null;
}

function deletePermanently(id, sectionKey) {
  const preview = dartDeleteImpact(sectionKey, id);
  const modal = document.getElementById("hard-delete-modal");
  if (!preview || !modal) return;

  const linked = dartHardDeleteRelations(preview);
  if (window.DartAdminApi?.request && linked.length) {
    window.DartDialog.alert(
      `Permanent delete is blocked because this record has linked business history: ${linked
        .map((row) => `${row.label} (${row.count})`)
        .join(" · ")}. Use Archive/Soft Delete instead.`,
    );
    return;
  }

  dartPendingHardDelete = preview;
  document.getElementById("hard-delete-summary").textContent =
    window.DartAdminApi?.request
      ? "This record has no linked business history. Permanent deletion will be committed to the database."
      : "اختر طريقة الحذف لهذه المرة. الحذف النهائي لا يمكن استرجاعه.";

  const relations = document.getElementById("hard-delete-relations");
  relations.classList.toggle("is-empty", !linked.length);
  relations.innerHTML = linked.length
    ? `<strong>Linked data:</strong> ${linked
        .map((row) => `${dartEsc(row.label)} (${row.count})`)
        .join(" · ")}`
    : "No linked records were found.";

  const onlyButton = document.getElementById("hard-delete-only");
  const cascadeButton = document.getElementById("hard-delete-cascade");
  onlyButton.onclick = () => dartCommitHardDelete("only");

  if (window.DartAdminApi?.request) {
    cascadeButton.hidden = true;
    cascadeButton.onclick = null;
  } else {
    cascadeButton.hidden = false;
    cascadeButton.onclick = () => dartCommitHardDelete("cascade");
  }

  document.getElementById("hard-delete-cancel").onclick = () => {
    dartPendingHardDelete = null;
    closeModal(modal);
  };
  openModal(modal);
}

function dartCustomerStats(clientId) {
  const os = ordersData.filter((o) => o.clientId === clientId),
    delivered = os.filter((o) => o.status === "Delivered");
  const purchased = delivered.flatMap((o) => o.items || []);
  const returnedCodes = new Set(
    returnsData
      .filter(
        (r) =>
          r.clientId === clientId &&
          r.isPostDeliveryReturn &&
          !dartReturnIsExchange(r) &&
          (dartReturnRules()?.isCompleted(r) ||
            ["Completed", "Good", "Damaged", "Bad"].includes(r.status)),
      )
      .map((r) => r.itemCode),
  );
  const spent = delivered.reduce(
    (a, o) =>
      a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
    0,
  );
  return {
    orders: os.length,
    delivered: delivered.length,
    purchased: purchased.length,
    activePurchased: purchased.filter((x) => !returnedCodes.has(x)).length,
    spent,
    lastPurchase:
      delivered
        .map((o) => o.deliveredAt || o.date)
        .filter(Boolean)
        .sort()
        .at(-1) || "-",
  };
}

function dartNextStatus(status) {
  const i = DART_ORDER_FLOW.indexOf(status);
  return i >= 0 && i < DART_ORDER_FLOW.length - 1
    ? DART_ORDER_FLOW[i + 1]
    : null;
}
function dartCanTransition(order, target) {
  if (!order || dartIsArchived(order)) return false;
  if (order.status === target) return false;
  if (target === "Cancelled")
    return !["Delivered", "Refused", "Cancelled"].includes(order.status);
  if (target === "Refused")
    return ["Out With Representative", "Representative On The Way"].includes(
      order.status,
    );
  if (
    target === "Preparing" &&
    String(order.paymentMethod || "").toLowerCase().includes("cash")
  ) {
    const verificationStatus = String(
      order.verificationStatus || order.codVerificationStatus || "Not Required",
    );
    if (!["Not Required", "Verified"].includes(verificationStatus)) return false;
  }
  if (target === "Preparing" && order.status === "Out With Representative")
    return true; // representative cancelled pickup
  if (order.status === "Needs Attention") return false;
  return dartNextStatus(order.status) === target;
}
function dartPriceSnapshotForCodes(codes) {
  return codes.map((code) => {
    const item = dartFindItemByCode(code);
    const model = dartFindModelByCode(item?.modelId);
    if (!item || !model) throw new Error("Missing model or physical item");
    return DartCatalog.snapshot(model, item);
  });
}
function dartReserveItems(order, codes) {
  const seen = new Set();
  for (const code of codes) {
    const it = dartFindItemByCode(code);
    if (
      !it ||
      seen.has(code) ||
      dartIsArchived(it) ||
      String(it.status).toLowerCase() !== "in stock"
    )
      return { ok: false, message: `Item ${code} is not available.` };
    seen.add(code);
  }
  codes.forEach((code) => {
    const it = dartFindItemByCode(code);
    it.status = "Processing/Held";
    it.orderId = order.orderId;
    it.clientId = order.clientId;
    it.clientName = order.clientName;
    it.phone1 = order.phone1;
    it.phone2 = order.phone2;
    it.email = order.email;
  });
  return { ok: true };
}
function dartReleaseOrderItems(order, toStatus = "In stock") {
  (order.items || []).forEach((code) => {
    const it = dartFindItemByCode(code);
    if (it && !["Damaged", "Destroyed"].includes(it.status)) {
      it.status = toStatus;
      if (toStatus === "In stock") {
        it.orderId = "";
        it.clientId = "";
        it.clientName = "";
        it.purchaseDate = "";
      }
    }
  });
}
function dartAssignRepresentative(order, repId) {
  const rep = dartFindRepById(repId);
  if (!rep || dartIsArchived(rep) || rep.status !== "Active") return false;
  order.representativeId = rep.id;
  order.representativeBusinessId = rep.repId;
  order.representativeName = rep.name;
  order.representativePhone = rep.phone1 || "";
  order.deliveryStartedAt = null;
  order.courierLocation = null;
  return true;
}

function dartUpdateBirthdayRewardForOrder(order, target) {
  if (window.DartOrdersApi) return;
  if (!order?.birthdayRewardId) return;
  let rewards;
  rewards = window.DartState?.read?.("dart_birthday_rewards", []) || [];
  const reward = rewards.find((row) => row.id === order.birthdayRewardId);
  if (!reward) return;
  if (target === "Delivered") {
    reward.status = "Used";
    reward.usedCount = 1;
    reward.usedAt = order.deliveredAt || dartNowISO();
    order.birthdayRewardUsageRecorded = true;
  } else if (["Cancelled", "Refused"].includes(target)) {
    reward.status = new Date() < new Date(reward.expiresAt) ? "Active" : "Expired";
    reward.orderId = "";
    reward.reservedAt = null;
    order.birthdayRewardUsageRecorded = false;
  }
  if (window.DartDomainState?.write) {
    window.DartDomainState.write("dart_birthday_rewards", rewards);
  } else if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    window.DartState?.write?.("dart_birthday_rewards", rewards, { source: "dashboard" });
  } else {
    throw new Error("Birthday rewards require the secure server state.");
  }
}

function dartPersistOrderWorkflow() {
  if (window.DartOrdersApi) {
    saveDataToStorage("dart_orders", ordersData);
    saveDataToStorage("dart_notifications", notificationData);
    return;
  }
  dartSaveAll();
}

async function dartApplyTransition(order, target, meta = {}) {
  if (!dartCanTransition(order, target))
    return {
      ok: false,
      message: `Invalid transition: ${order.status} → ${target}`,
    };
  const prev = order.status,
    now = dartNowISO(),
    serverAuthoritative = Boolean(window.DartOrdersApi);
  if (target === "Out With Representative" && !meta.representativeId)
    return { ok: false, needsRep: true };
  if (window.DartOrdersApi?.workflow) {
    try {
      await window.DartOrdersApi.workflow(order.orderId || order.id, {
        expectedStatus: order.status,
        target,
        ...(meta.representativeId
          ? { representativeId: String(meta.representativeId) }
          : {}),
        ...(meta.deliveryGroupId
          ? { deliveryGroupId: String(meta.deliveryGroupId) }
          : {}),
        ...(meta.reason ? { reason: String(meta.reason) } : {}),
        ...(meta.notes ? { notes: String(meta.notes) } : {}),
      });
      return { ok: true };
    } catch (error) {
      if (
        ["ORDER_STATE_STALE", "COD_VERIFICATION_REQUIRED"].includes(error?.code)
      ) {
        await window.DartOrdersApi.hydrate(true).catch(() => {});
      }
      return {
        ok: false,
        message: error?.message || "Order status was not committed to the server.",
      };
    }
  }
  if (
    target === "Out With Representative" &&
    !dartAssignRepresentative(order, meta.representativeId)
  )
    return { ok: false, message: "Representative is not available." };
  if (target === "Out With Representative" && !order.deliveryGroupId)
    order.deliveryGroupId = window.DartGroups?.newId?.("DLG") || `DLG-${Date.now()}`;
  if (target === "Preparing" && prev === "Out With Representative") {
    order.representativeId = null;
    order.representativeBusinessId = "";
    order.representativeName = "";
    order.representativePhone = "";
    order.deliveryGroupId = "";
  }
  order.status = target;
  const stamps = {
    Accepted: "acceptedAt",
    Preparing: "preparingAt",
    "Out With Representative": "outWithRepresentativeAt",
    "Representative On The Way": "representativeOnWayAt",
    Delivered: "deliveredAt",
    Refused: "refusedAt",
    Cancelled: "cancelledAt",
    "Needs Attention": "needsAttentionAt",
  };
  if (stamps[target]) order[stamps[target]] = now;
  if (target === "Delivered") {
    if (!serverAuthoritative) {
      (order.items || []).forEach((code) => {
        const it = dartFindItemByCode(code);
        if (it) {
          it.status = "Sold";
          it.purchaseDate = new Date().toLocaleDateString("en-GB");
        }
      });
    }
    if (
      order.paymentMethod &&
      String(order.paymentMethod).toLowerCase().includes("cash") &&
      order.paymentStatus === "Unpaid"
    ) {
      order.paymentStatus = "Paid";
      order.amountPaid = dartOrderNet(order);
      order.paidAt = now;
    }
    if (!serverAuthoritative && order.dartCardId && !order.dartCardUsageRecorded) {
      const card = cardsData.find(
        (c) => c.cardId === order.dartCardId && c.status === "Active",
      );
      if (card) {
        card.purchasedItems = String(
          Number(card.purchasedItems || 0) +
            Number(order.totalProducts || order.items?.length || 0),
        );
        card.requestedProducts = [
          ...new Set([
            ...(card.requestedProducts || []),
            ...(order.items || []),
          ]),
        ];
        if (
          Number(card.purchasedItems) >=
          Number(card.itemLimit || card.purchasedLimit || 10)
        )
          card.status = "Expired";
        order.dartCardUsageRecorded = true;
      }
    }
  }
  if (target === "Refused") {
    order.refusalReason = meta.reason || "Other";
    order.refusalNotes = meta.notes || "";
    if (!serverAuthoritative)
      dartCreateInspectionReturns(order, order.refusalReason);
  }
  if (target === "Cancelled") {
    order.cancelledByRole = meta.actorRole || "Admin";
    order.cancelledBy = meta.actorId || null;
    order.cancellationReason = meta.reason || "Cancelled";
    if (!serverAuthoritative) dartReleaseOrderItems(order, "In stock");
  }
  if (
    !serverAuthoritative &&
    ["Delivered", "Cancelled", "Refused"].includes(target)
  )
    dartUpdateBirthdayRewardForOrder(order, target);
  dartLogOrder(order, meta.type || "STATUS_CHANGED", prev, target, meta);
  dartAudit(
    "ORDER_STATUS_CHANGE",
    "orders",
    order.id,
    { status: prev },
    { status: target },
    meta.reason || "",
  );
  dartNotify(
    `order_${target.toLowerCase().replace(/ /g, "_")}`,
    `${order.orderId}: ${target}`,
    meta.reason || `Order moved from ${prev} to ${target}.`,
    "orders",
    order.id,
    target === "Needs Attention" ? "warning" : "info",
  );
  if (!meta.suppressRefresh) {
    dartPersistOrderWorkflow();
    dartRefreshAll();
  }
  return { ok: true };
}
async function dartBatchTransition(orders, target, meta = {}) {
  const invalid = orders.filter((o) => !dartCanTransition(o, target));
  if (invalid.length)
    return {
      ok: false,
      message: `غير مسموح للأوردرات: ${invalid.map((o) => o.orderId).join(", ")}`,
    };
  if (target === "Out With Representative" && !meta.representativeId)
    return { ok: false, needsRep: true };
  let deliveryGroupId = "";
  if (target === "Out With Representative") {
    if (!window.DartGroups?.sameRoute?.(orders))
      return { ok: false, message: "يمكن تعيين مشوار واحد فقط لأوردرات نفس العميل ونفس الدولة والمحافظة والمنطقة والشارع." };
    deliveryGroupId = window.DartGroups?.newId?.("DLG") || `DLG-${Date.now()}`;
  }
  for (const o of orders) {
    if (
      target === "Out With Representative" &&
      !dartFindRepById(meta.representativeId)
    )
      return { ok: false, message: "Representative unavailable." };
  }
  for (const original of orders) {
    const current =
      ordersData.find(
        (row) =>
          String(row.id) === String(original.id) ||
          String(row.orderId) === String(original.orderId),
      ) || original;
    const result = await dartApplyTransition(current, target, {
      ...meta,
      ...(deliveryGroupId ? { deliveryGroupId } : {}),
      suppressRefresh: true,
    });
    if (!result.ok) return result;
  }
  if (!window.DartOrdersApi?.workflow) {
    dartPersistOrderWorkflow();
    dartRefreshAll();
  }
  return { ok: true };
}

function dartReturnRules() {
  return window.DartReturns || null;
}

function dartReturnIsExchange(record) {
  return dartReturnRules()?.isExchange(record) ||
    String(record?.requestType || "").toLowerCase().includes("exchange");
}

function dartReturnPickupAddress(record) {
  return record?.fullAddress ||
    [record?.building, record?.street, record?.area, record?.governorate, record?.country]
      .filter(Boolean)
      .join(", ");
}

function dartReturnReplacementCandidates(record) {
  return itemsData.filter(
    (item) =>
      dartIsActive(item) &&
      String(item.status || "").toLowerCase() === "in stock" &&
      String(item.modelId) === String(record.modelId) &&
      String(item.color) === String(record.requestedColor) &&
      String(item.size) === String(record.requestedSize),
  );
}

async function dartRefreshReturnServerState() {
  if (window.DartDomainState?.hydrateDomain) {
    await window.DartDomainState.hydrateDomain("returns", true);
    await window.DartDomainState.hydrateDomain("damage", true);
  }
  if (window.DartCatalog?.hydrate) {
    await window.DartCatalog.hydrate(true);
  }
}

async function dartAdminReturnAction(record, body) {
  if (!window.DartAdminApi?.request) return null;
  const payload = await window.DartAdminApi.request(
    `/api/v1/admin/returns/${encodeURIComponent(record.returnId || record.id)}/action`,
    { method: "POST", body },
  );
  await dartRefreshReturnServerState();
  return payload.return || null;
}

async function dartApproveReturn(record, replacementItemCode = "") {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "approve",
        ...(replacementItemCode ? { replacementItemCode } : {}),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return approval failed." };
    }
  }
  if (!record || record.status !== "Pending Request") return { ok: false, message: "Request is no longer pending." };
  let replacement = null;
  if (dartReturnIsExchange(record)) {
    replacement = dartReturnReplacementCandidates(record).find(
      (item) => String(item.itemCode) === String(replacementItemCode),
    );
    if (!replacement) return { ok: false, message: "Choose an available replacement item with the requested model, color and size." };
    record.approvalSnapshot = dartReturnRules()?.captureApprovalSnapshot?.(record, replacement, dartNowISO()) || null;
    replacement.status = "Processing/Held";
    replacement.orderId = record.orderId;
    replacement.returnRequestId = record.id;
    replacement.exchangeChainId = record.exchangeChainId || record.itemCode;
    record.replacementItemCode = replacement.itemCode;
    record.replacementItemId = replacement.id;
    const originalLine = record.originalLineSnapshot || {};
    record.replacementLineSnapshot = {
      ...originalLine,
      itemId: replacement.id,
      itemCode: replacement.itemCode,
      modelCode: replacement.modelId,
      color: replacement.color,
      size: String(replacement.size),
      exchangedFromItemCode: record.itemCode,
    };
  }
  if (!record.approvalSnapshot)
    record.approvalSnapshot = dartReturnRules()?.captureApprovalSnapshot?.(record, null, dartNowISO()) || null;
  const old = record.status;
  record.status = "Approved - Awaiting Representative";
  record.acceptedAt = dartNowISO();
  record.updatedAt = record.acceptedAt;
  record.inspectionStatus = record.inspectionStatus || "Pending";
  dartAudit("RETURN_ACCEPTED", "returns", record.id, { status: old }, { status: record.status, replacementItemCode: record.replacementItemCode || "" });
  dartNotify("return_accepted", `${record.returnId}: Approved`, "Request approved and waiting for a pickup representative.", "returns", record.id);
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartRejectReturn(record, reason) {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "reject",
        reason: String(reason || "").trim(),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return rejection failed." };
    }
  }
  if (!record || record.status !== "Pending Request") return { ok: false, message: "Request is no longer pending." };
  if (!String(reason || "").trim()) return { ok: false, message: "A rejection reason is required." };
  record.rejectionSnapshot = dartReturnRules()?.captureWorkflowSnapshot?.(
    record,
    ["rejectionReason", "rejectedAt", "updatedAt"],
    dartNowISO(),
  ) || null;
  const old = record.status;
  record.status = "Rejected";
  record.rejectionReason = String(reason).trim();
  record.rejectedAt = dartNowISO();
  record.updatedAt = record.rejectedAt;
  dartAudit("RETURN_REJECTED", "returns", record.id, { status: old }, { status: record.status, reason: record.rejectionReason });
  dartNotify("return_rejected", `${record.returnId}: Rejected`, record.rejectionReason, "returns", record.id, "warning");
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartAssignReturnRepresentative(record, representativeId, pickupGroupId = "") {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "assign",
        representativeId: String(representativeId || ""),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Representative assignment failed." };
    }
  }
  if (!record || record.status !== "Approved - Awaiting Representative") return { ok: false, message: "Approve the request before assigning a representative." };
  const representative = dartFindRepById(representativeId);
  if (!representative || !dartIsActive(representative) || representative.status !== "Active") return { ok: false, message: "Choose an active representative." };
  record.assignmentSnapshot = dartReturnRules()?.captureWorkflowSnapshot?.(
    record,
    ["representativeId", "representativeBusinessId", "representativeName", "representativePhone", "pickupGroupId", "assignedAt", "updatedAt"],
    dartNowISO(),
  ) || null;
  const old = record.status;
  record.status = "Representative Assigned";
  record.representativeId = representative.id;
  record.representativeBusinessId = representative.repId;
  record.representativeName = representative.name;
  record.representativePhone = representative.phone1;
  record.pickupGroupId = pickupGroupId || record.pickupGroupId || window.DartGroups?.newId?.("RPG") || `RPG-${Date.now()}`;
  record.assignedAt = dartNowISO();
  record.updatedAt = record.assignedAt;
  dartAudit("RETURN_REP_ASSIGNED", "returns", record.id, { status: old }, { status: record.status, representativeId: representative.id });
  dartNotify("return_representative_assigned", `${record.returnId}: Representative assigned`, representative.name, "returns", record.id);
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartInspectReturn(record, condition) {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "inspect",
        condition,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return inspection failed." };
    }
  }
  if (!record) return;
  const isLegacyRefusal = !record.isPostDeliveryReturn && record.status === "Pending Inspection";
  const canInspectCompleted = record.isPostDeliveryReturn &&
    (record.status === "Completed" || Boolean(record.completedAt)) &&
    (record.inspectionStatus || "Pending") === "Pending";
  if (!isLegacyRefusal && !canInspectCompleted) return;
  const item = dartFindItemByCode(record.itemCode);
  if (!item) return;
  const order = ordersData.find((row) => String(row.orderId) === String(record.orderId));
  const card = order?.dartCardId ? cardsData.find((row) => row.cardId === order.dartCardId) : null;
  record.inspectionSnapshot = dartReturnRules()?.captureInspectionSnapshot?.(
    record,
    item,
    card,
    damageData,
    dartNowISO(),
  ) || null;
  const previousInspection = record.inspectionStatus || "Pending";
  record.inspectionStatus = condition;
  record.inspectedAt = dartNowISO();
  record.updatedAt = record.inspectedAt;
  if (isLegacyRefusal) record.status = condition;
  if (condition === "Good") {
    const model = dartFindModelByCode(item.modelId);
    item.status = "In stock";
    item.orderId = "";
    item.clientId = "";
    item.clientName = "";
    item.returnRequestId = "";
    item.restockedAt = record.inspectedAt;
    item.restockedSellingPrice = Number(model?.discountedPrice ?? model?.selling) || 0;
  } else {
    item.status = "Damaged";
    item.updatedAt = record.inspectedAt;
    if (!damageData.some((damage) => damage.itemCode === item.itemCode && ["Damaged", "Destroyed"].includes(damage.status))) {
      const damageRecord = {
        id: dartUid("DMGDB"),
        damageId: dartUid("DMG"),
        itemCode: item.itemCode,
        modelId: item.modelId,
        img: item.img || "",
        color: item.color,
        size: item.size,
        status: "Damaged",
        reason: record.reason || "Return inspection - Damaged",
        notes: "",
        date: new Date().toLocaleDateString("en-GB"),
        createdAt: record.inspectedAt,
        inspectedAt: record.inspectedAt,
        costSnapshot: Number(record.originalLineSnapshot?.costSnapshot) || Number(dartFindModelByCode(item.modelId)?.cost) || 0,
        orderId: record.orderId || "",
        requestType: record.requestType || (record.isPostDeliveryReturn ? "Refund" : "Refusal"),
        exchangeChainId: record.exchangeChainId || "",
        clientId: record.clientId || "",
        clientName: record.clientName || "",
        returnId: record.returnId || "",
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };
      damageData.push(damageRecord);
      record.inspectionDamageId = damageRecord.id;
    }
  }
  if (!dartReturnIsExchange(record) && !record.dartCardUsageReversed) {
    if (card && order.dartCardUsageRecorded) {
      card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - 1));
      card.requestedProducts = (card.requestedProducts || []).filter((code) => String(code) !== String(record.itemCode));
      if (card.status === "Expired" && Number(card.purchasedItems) < Number(card.itemLimit || card.purchasedLimit || 10) && (!dartDateValue(card.expDate) || dartDateValue(card.expDate) >= new Date())) card.status = "Active";
      record.dartCardUsageReversed = true;
    }
  }
  dartAudit("RETURN_INSPECTION", "returns", record.id, { inspectionStatus: previousInspection }, { inspectionStatus: condition });
  dartNotify(condition === "Good" ? "return_good" : "item_damaged", `${record.itemCode}: ${condition}`, condition === "Good" ? "Item returned to stock at the model's current selling price." : "Item moved to Damage.", "returns", record.id, condition === "Good" ? "info" : "warning");
  dartSaveAll();
  dartRefreshAll();
}

async function dartRollbackReturn(record) {
  const rules = dartReturnRules();
  if (!record || !rules?.canRollback?.(record)) {
    window.DartDialog.alert("لا توجد خطوة سابقة آمنة لهذا المرتجع.");
    return;
  }
  const warning = [
    `تحذير: سيتم إرجاع المرتجع ${record.returnId || record.id} خطوة واحدة للخلف.`,
    "سيتم عكس الحالة التشغيلية الآمنة لهذه الخطوة، وسيُسجل الإجراء في سجل المراجعة.",
    "بعد استلام المرتجع تنتهي رحلة الاسترجاع/الاستبدال ولا يمكن الرجوع منها بهذه الأداة.",
  ].join("\n\n");
  if (!await window.DartDialog.confirm(warning)) return;
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, { action: "back" });
    } catch (error) {
      window.DartDialog.alert(error.message || "تعذر إرجاع المرتجع خطوة واحدة.");
    }
    return;
  }
  const before = {
    status: record.status,
    inspectionStatus: record.inspectionStatus || "Pending",
    financialCompletionApplied: Boolean(record.financialCompletionApplied),
    exchangeCompletionApplied: Boolean(record.exchangeCompletionApplied),
  };
  const result = rules.rollbackOneStep(record, {
    items: itemsData,
    orders: ordersData,
    cards: cardsData,
    damage: damageData,
  }, dartNowISO());
  if (!result.ok) {
    window.DartDialog.alert(result.message || "تعذر التراجع عن هذه الخطوة بأمان.");
    return;
  }
  const after = {
    status: record.status,
    inspectionStatus: record.inspectionStatus || "Pending",
    financialCompletionApplied: Boolean(record.financialCompletionApplied),
    exchangeCompletionApplied: Boolean(record.exchangeCompletionApplied),
  };
  dartAudit("RETURN_ROLLBACK", "returns", record.id, before, after, `Reversed ${result.step} one step`);
  dartNotify(
    "return_rollback",
    `${record.returnId || record.id}: رجوع خطوة`,
    `${result.previousStatus} → ${result.newStatus}`,
    "returns",
    record.id,
    "warning",
  );
  dartSaveAll();
  dartRefreshAll();
}

// BEGIN Return decision — approval, representative pickup, completion, then inspection.
function dartDecideReturn(record, decision) {
  if (!record || record.status !== "Pending Request") return;
  dartPendingReturnAction = { record, decision };
  if (decision === "reject") {
    const reason = document.getElementById("return-rejection-reason");
    if (reason) reason.value = "";
    openModal(document.getElementById("return-rejection-modal"));
    return;
  }
  const isExchange = dartReturnIsExchange(record);
  const field = document.getElementById("return-replacement-field");
  const select = document.getElementById("return-replacement-select");
  if (field) field.hidden = !isExchange;
  if (select) {
    select.required = isExchange;
    select.replaceChildren();
    dartReturnReplacementCandidates(record).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.itemCode;
      option.textContent = `${item.itemCode} — ${item.color} / ${item.size}`;
      select.appendChild(option);
    });
  }
  if (isExchange && !select?.options.length) {
    dartPendingReturnAction = null;
    window.DartDialog.alert("No available physical item matches the requested model, color and size.");
    return;
  }
  const summary = document.getElementById("return-approval-summary");
  if (summary) summary.textContent = `${record.returnId} · ${record.requestType || "Return"} · ${record.itemCode}`;
  const fee = document.getElementById("return-approval-fee-note");
  if (fee) fee.textContent = Number(record.customerCourierFee) > 0
    ? `Customer pays ${dartMoney(record.customerCourierFee)} directly to the representative.`
    : Number(record.brandCourierFee) > 0
      ? `Dart pays ${dartMoney(record.brandCourierFee)} to the representative.`
      : "No courier fee.";
  openModal(document.getElementById("return-approval-modal"));
}
// END Return decision.

function renderDamage(dataArray) {
  const c = document.getElementById("damage-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((d) =>
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(d)}" data-id="${dartEsc(d.id)}"><input type="checkbox" class="model-checkbox" ${d.isChecked ? "checked" : ""} ${dartIsArchived(d) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(d) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${d.status === "Damaged" ? '<button class="dart-repair-btn">Repaired</button><button class="dart-destroy-btn">Destroyed</button>' : ""}</div><span class="text-item w150">${dartEsc(d.damageId)}</span><span class="text-item w150">${dartEsc(d.itemCode)}</span><span class="text-item w150">${dartEsc(d.modelId || "-")}</span><div class="w100"><img src="${dartEsc(d.img || "https://via.placeholder.com/50")}" class="product-img"></div><span class="text-item w150">${dartEsc(d.color || "-")}</span><span class="text-item w150">${dartEsc(d.size || "-")}</span><span class="text-item w150"><span class="status-pill ${dartStatusClass(d.status)}">${dartEsc(d.status)}</span></span><span class="text-item w200">${dartEsc(d.reason || "-")}</span><span class="text-item w150">${dartEsc(d.date || "-")}</span><span class="text-item w150">${dartEsc(d.orderId || "-")}</span><span class="text-item w150">${dartEsc(d.clientName || d.clientId || "-")}</span><span class="text-item w150">${dartEsc(d.returnId || "-")}</span></div>`,
    ),
  );
}
async function dartSetDamageStatus(d, status) {
  if (!d) return { ok: false, message: "Damage record not found." };

  if (window.DartAdminApi?.request) {
    try {
      await window.DartAdminApi.request(
        `/api/v1/admin/damage/${encodeURIComponent(d.damageId || d.id)}/action`,
        { method: "POST", body: { status } },
      );
      if (window.DartDomainState?.hydrateDomain) {
        await window.DartDomainState.hydrateDomain("damage", true);
      }
      if (window.DartCatalog?.hydrate) {
        await window.DartCatalog.hydrate(true);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Damage action failed." };
    }
  }


  const it = dartFindItemByCode(d.itemCode),
    old = d.status;
  d.status = status;
  d[status === "Repaired" ? "repairDate" : "destroyedAt"] = dartNowISO();
  if (it) it.status = status === "Repaired" ? "In stock" : "Destroyed";
  dartAudit("DAMAGE_STATUS", "damage", d.id, { status: old }, { status });
  dartNotify(
    "damage_status",
    `${d.itemCode}: ${status}`,
    status === "Repaired"
      ? "Item returned to stock."
      : "Item permanently removed from usable inventory.",
    "damage",
    d.id,
    status === "Destroyed" ? "warning" : "info",
  );
  dartSaveAll();
  dartRefreshAll();
}

function dartGetSectionData(key) {
  return sectionsMap[key]?.data || [];
}
function dartSectionSearchText(x) {
  const modelName = x.modelId ? DartCatalog.model(x.modelId)?.name || "" : "";
  return (
    modelName.toLowerCase() +
    " " +
    Object.entries(x)
      .filter(([k]) => !["activityLog", "priceSnapshot"].includes(k))
      .map(([, v]) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")))
      .join(" ")
      .toLowerCase()
  );
}

function dartRenderSection(key) {
  const sec = sectionsMap[key];
  if (!sec) return;
  const filtered = dartApplyFilters(key, sec.data);
  sec.render(filtered);
  dartUpdateMasterCheckbox(key, filtered);
}
function dartRefreshAll() {
  // Render owner-facing sections first; defer hidden row construction to idle time.
  dartRenderSection("models");
  dartRenderSection("items");
  updateBrandAnalytics();
  renderNotifications();
  updateOrderCards();
  const active = document.querySelector(
    ".dashboard-section.active-section",
  )?.id;
  if (active && sectionsMap[active] && !["models", "items"].includes(active))
    dartRenderSection(active);
  clearTimeout(window.dartBackgroundRender);
  window.dartBackgroundRender = setTimeout(() => {
    const keys = Object.keys(sectionsMap).filter(
      (k) => !["models", "items", active].includes(k),
    );
    const next = () => {
      const key = keys.shift();
      if (key) dartRenderSection(key);
      if (keys.length) setTimeout(next, 0);
    };
    next();
  }, 30);
}
function renderAllSections() {
  dartRefreshAll();
}

// Extend the existing sectionsMap rather than replacing it.
sectionsMap.representative = {
  get data() {
    return representativeData;
  },
  set data(v) {
    representativeData = v;
  },
  render: renderRepresentative,
  storageKey: "dart_representatives",
};
sectionsMap.damage = {
  get data() {
    return damageData;
  },
  set data(v) {
    damageData = v;
  },
  render: renderDamage,
  storageKey: "dart_damage",
};

function dartArchiveRecord(key, id) {
  const sec = sectionsMap[key],
    x = sec?.data.find((v) => String(v.id) === String(id));
  if (!x) return;
  const old = dartIsArchived(x),
    snapshot = { ...x };
  dartSetArchived(x, !old);
  x.isChecked = false;
  if (key === "items" && !old && x.status === "Processing/Held" && x.orderId)
    dartRevalidateAllocatedItem(x, snapshot);
  dartAudit(
    old ? "RESTORE" : "ARCHIVE",
    key,
    id,
    { isArchived: old },
    { isArchived: !old },
  );
  dartSaveAll();
  dartRefreshAll();
}
function dartUpdateMasterCheckbox(key, viewData) {
  if (key === "items") return DartInventory.updateMaster();
  const sec = document.getElementById(key),
    master = sec?.querySelector(
      '.cont-titel .title-name input[type="checkbox"]',
    );
  if (!master) return;
  const visible = (
      viewData || dartApplyFilters(key, dartGetSectionData(key))
    ).filter(dartIsActive),
    selected = visible.filter((x) => x.isChecked);
  master.checked = visible.length > 0 && selected.length === visible.length;
  master.indeterminate =
    selected.length > 0 && selected.length < visible.length;
  if (key === "orders") {
    const n = document.getElementById("bulk-selected-count");
    if (n) n.textContent = `${selected.length} selected`;
  }
}
async function dartSyncBulkSection(key) {
  if (["models", "items"].includes(key)) {
    await window.DartCatalog?.syncAdminState?.();
    await window.DartCatalog?.hydrate?.(true);
    return;
  }
  const domainBySection = {
    customers: "customers",
    returns: "returns",
    review: "reviews",
    card: "cards",
    representative: "representatives",
    damage: "damage",
  };
  const domain = domainBySection[key];
  if (domain) {
    await window.DartDomainState?.syncDomain?.(domain);
    await window.DartDomainState?.hydrateDomain?.(domain, true);
  }
}

async function dartRollbackBulkSection(key) {
  if (["models", "items"].includes(key)) {
    await window.DartCatalog?.hydrate?.(true).catch(() => {});
    return;
  }
  if (key === "orders") {
    await window.DartOrdersApi?.hydrate?.(true).catch(() => {});
    return;
  }
  const domainBySection = {
    customers: "customers",
    returns: "returns",
    review: "reviews",
    card: "cards",
    representative: "representatives",
    damage: "damage",
  };
  const domain = domainBySection[key];
  if (domain) {
    await window.DartDomainState?.hydrateDomain?.(domain, true).catch(() => {});
  }
}

async function dartBulkArchive(key, records) {
  if (!records.length) return { archived: 0, failed: [] };

  const serverMode = Boolean(window.DartAdminApi?.request);
  const failed = [];
  let archived = 0;

  if (serverMode && key === "orders" && window.DartOrdersApi?.stateAction) {
    for (const record of records) {
      try {
        await window.DartOrdersApi.stateAction(
          record.orderId || record.id,
          "archive",
        );
        archived += 1;
      } catch (error) {
        failed.push({
          id: record.orderId || record.id,
          message: error.message || "Order archive failed",
        });
      }
    }
    await window.DartOrdersApi.hydrate?.(true).catch(() => {});
    return { archived, failed };
  }

  if (
    serverMode &&
    ["customers", "representative"].includes(key)
  ) {
    const resource = key === "customers" ? "customers" : "representatives";
    const secure = records.filter((record) => record.serverAuthoritative);
    const legacy = records.filter((record) => !record.serverAuthoritative);

    for (const record of secure) {
      try {
        await window.DartAdminApi.request(
          `/api/v1/admin/${resource}/${encodeURIComponent(record.id)}/state`,
          { method: "POST", body: { action: "suspend" } },
        );
        archived += 1;
      } catch (error) {
        failed.push({
          id: record.clientId || record.repId || record.id,
          message: error.message || "Account suspension failed",
        });
      }
    }

    if (legacy.length) {
      const snapshots = legacy.map((record) => ({
        record,
        isArchived: record.isArchived,
        isDeleted: record.isDeleted,
        archivedAt: record.archivedAt,
      }));
      legacy.forEach((record) => {
        dartSetArchived(record, true);
        record.isChecked = false;
      });
      try {
        saveDataToStorage(sectionsMap[key].storageKey, sectionsMap[key].data);
        await dartSyncBulkSection(key);
        archived += legacy.length;
      } catch (error) {
        snapshots.forEach(({ record, isArchived, isDeleted, archivedAt }) => {
          record.isArchived = isArchived;
          record.isDeleted = isDeleted;
          record.archivedAt = archivedAt;
        });
        failed.push({
          id: "legacy-records",
          message: error.message || "Legacy CRM archive failed",
        });
      }
    }

    await window.DartDomainState?.hydrateDomain?.(
      key === "customers" ? "customers" : "representatives",
      true,
    ).catch(() => {});
    return { archived, failed };
  }

  const snapshots = records.map((record) => ({
    record,
    isArchived: record.isArchived,
    isDeleted: record.isDeleted,
    archivedAt: record.archivedAt,
  }));

  records.forEach((record) => {
    dartSetArchived(record, true);
    record.isChecked = false;
    dartAudit(
      "BULK_ARCHIVE",
      key,
      record.id,
      { isArchived: false },
      { isArchived: true },
    );
  });

  if (!serverMode) {
    dartSaveAll();
    return { archived: records.length, failed };
  }

  try {
    saveDataToStorage(sectionsMap[key].storageKey, sectionsMap[key].data);
    await dartSyncBulkSection(key);
    archived = records.length;
  } catch (error) {
    snapshots.forEach(({ record, isArchived, isDeleted, archivedAt }) => {
      record.isArchived = isArchived;
      record.isDeleted = isDeleted;
      record.archivedAt = archivedAt;
    });
    await dartRollbackBulkSection(key);
    failed.push({
      id: "bulk",
      message: error.message || "Bulk archive was not committed",
    });
  }

  return { archived, failed };
}

function setupHeaderBatchActions() {
  if (document.documentElement.dataset.dartBatchReady) return;
  document.documentElement.dataset.dartBatchReady = "1";

  document.addEventListener("change", (e) => {
    if (!e.target.matches('.cont-titel .title-name input[type="checkbox"]'))
      return;
    const sec = e.target.closest(".dashboard-section"),
      key = sec?.id,
      info = sectionsMap[key];
    if (!info) return;
    const visible = (
      key === "items"
        ? DartInventory.visibleItems()
        : dartApplyFilters(key, info.data)
    ).filter(dartIsActive);
    visible.forEach((x) => (x.isChecked = e.target.checked));
    dartRenderSection(key);
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".dashboard-section .second .delete-btn");
    if (!btn) return;

    const key = btn.closest(".dashboard-section")?.id,
      info = sectionsMap[key];
    if (!info) return;

    const visibleIds = new Set(
      (key === "items"
        ? DartInventory.visibleItems()
        : dartApplyFilters(key, info.data)
      )
        .filter(dartIsActive)
        .map((x) => String(x.id)),
    );
    const selected = info.data.filter(
      (record) =>
        record.isChecked && visibleIds.has(String(record.id)),
    );
    if (!selected.length) return;

    btn.disabled = true;
    try {
      const result = await dartBulkArchive(key, selected);
      selected.forEach((record) => {
        record.isChecked = false;
      });
      dartRefreshAll();

      if (result.failed.length) {
        window.DartDialog.alert(
          `${result.archived} archived successfully. ${result.failed.length} failed:\n` +
            result.failed
              .map((row) => `${row.id}: ${row.message}`)
              .join("\n"),
        );
      }
    } finally {
      btn.disabled = false;
    }
  });
}


let dartPasswordResetRequests = [];

async function dartLoadPasswordResetRequests(openAfterLoad = false) {
  if (!window.DartAdminApi?.request) return [];
  const payload = await window.DartAdminApi.request(
    "/api/v1/admin/password-reset-requests",
  );
  dartPasswordResetRequests = Array.isArray(payload.requests)
    ? payload.requests
    : [];

  const count = document.getElementById("passwordRequestsCount");
  if (count) count.textContent = String(dartPasswordResetRequests.length);

  const list = document.getElementById("password-requests-list");
  if (list) {
    list.replaceChildren();
    if (!dartPasswordResetRequests.length) {
      const empty = document.createElement("p");
      empty.className = "dart-empty-state";
      empty.textContent = "No pending password reset requests.";
      list.appendChild(empty);
    } else {
      dartPasswordResetRequests.forEach((request) => {
        const row = document.createElement("div");
        row.className = "dart-password-request-row";
        row.dataset.requestId = String(request.id);

        const info = document.createElement("div");
        info.className = "dart-password-request-info";
        const title = document.createElement("strong");
        title.textContent = [request.name, request.code].filter(Boolean).join(" · ");
        const meta = document.createElement("small");
        meta.textContent = [
          request.accountType,
          request.email,
          request.phone,
          request.requestedAt
            ? new Date(request.requestedAt).toLocaleString()
            : "",
        ].filter(Boolean).join(" · ");
        info.append(title, meta);

        if (!request.matchedAccount) {
          const unmatched = document.createElement("span");
          unmatched.className = "dart-sensitive-note";
          unmatched.textContent = "No matching account — can only cancel this request.";
          info.appendChild(unmatched);
        }

        const actions = document.createElement("div");
        actions.className = "dart-password-request-actions";

        if (request.matchedAccount) {
          const passwordInput = document.createElement("input");
          passwordInput.type = "password";
          passwordInput.minLength = 12;
          passwordInput.maxLength = 200;
          passwordInput.autocomplete = "new-password";
          passwordInput.placeholder = "Temporary password (12+ characters)";
          passwordInput.dataset.temporaryPassword = "1";

          const setButton = document.createElement("button");
          setButton.type = "button";
          setButton.className = "action-btn dart-set-temporary-password";
          setButton.textContent = "Set temporary password";
          actions.append(passwordInput, setButton);
        }

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "action-btn dart-cancel-reset-request";
        cancelButton.textContent = "Cancel request";
        actions.appendChild(cancelButton);

        row.append(info, actions);
        list.appendChild(row);
      });
    }
  }

  if (openAfterLoad) {
    openModal(document.getElementById("password-requests-modal"));
  }
  return dartPasswordResetRequests;
}

async function dartRequestCustomerPasswordReset(customer) {
  if (!customer?.serverAuthoritative || !window.DartAdminApi?.request) {
    return {
      ok: false,
      message: "This CRM-only customer does not have a secure login account.",
    };
  }
  try {
    await window.DartAdminApi.request("/api/v1/auth/forgot-password", {
      method: "POST",
      body: {
        identifier: customer.email || customer.phone1,
        accountType: "customer",
      },
    });
    await dartLoadPasswordResetRequests(false);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "Password reset request failed." };
  }
}

async function dartAdminAccountState(sectionKey, record, action) {
  if (!window.DartAdminApi?.request || !record?.serverAuthoritative) {
    return { ok: false, message: "Secure account API is unavailable." };
  }
  const resource =
    sectionKey === "customers"
      ? "customers"
      : sectionKey === "representative"
        ? "representatives"
        : "";
  if (!resource) return { ok: false, message: "Unsupported account type." };

  try {
    await window.DartAdminApi.request(
      `/api/v1/admin/${resource}/${encodeURIComponent(record.id)}/state`,
      { method: "POST", body: { action } },
    );
    if (window.DartDomainState?.hydrateDomain) {
      await window.DartDomainState.hydrateDomain(
        sectionKey === "customers" ? "customers" : "representatives",
        true,
      );
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "Account action failed." };
  }
}

function setupSectionEvents(containerId, dataArray, renderFn, sectionKey) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.dartDelegated) return;
  container.dataset.dartDelegated = "1";
  container.addEventListener("change", (e) => {
    if (!e.target.classList.contains("model-checkbox")) return;
    const id = e.target.closest(".model-row")?.dataset.id,
      x = sectionsMap[sectionKey]?.data.find(
        (v) => String(v.id) === String(id),
      );
    if (x) {
      x.isChecked = e.target.checked;
      dartUpdateMasterCheckbox(sectionKey);
    }
  });
  container.addEventListener("click", async (e) => {
    const row = e.target.closest(".model-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".btn-delete")) {
      const record = sectionsMap[sectionKey]?.data.find(
        (value) => String(value.id) === String(id),
      );
      if (sectionKey === "orders" && record && window.DartOrdersApi?.stateAction) {
        const action = dartIsArchived(record) ? "restore" : "archive";
        try {
          await window.DartOrdersApi.stateAction(record.orderId || record.id, action);
        } catch (error) {
          window.DartDialog.alert(error.message || "Order state update failed.");
        }
        return;
      }
      if (
        record?.serverAuthoritative &&
        ["customers", "representative"].includes(sectionKey)
      ) {
        const suspended =
          sectionKey === "customers"
            ? record.accountStatus === "suspended"
            : record.status === "Suspended" || record.accountStatus === "suspended";
        const result = await dartAdminAccountState(
          sectionKey,
          record,
          suspended ? "activate" : "suspend",
        );
        if (!result.ok) window.DartDialog.alert(result.message || "Account action failed.");
        return;
      }
      dartArchiveRecord(sectionKey, id);
      return;
    }
    if (e.target.closest(".btn-hard-delete")) {
      const record = sectionsMap[sectionKey]?.data.find(
        (value) => String(value.id) === String(id),
      );
      if (sectionKey === "orders" && record && window.DartOrdersApi?.stateAction) {
        if (
          !await window.DartDialog.confirm(
            "Soft-delete this order from operational views? Financial snapshots, item history and audit records will be preserved.",
          )
        ) return;
        try {
          await window.DartOrdersApi.stateAction(record.orderId || record.id, "delete");
        } catch (error) {
          window.DartDialog.alert(error.message || "Order deletion failed.");
        }
        return;
      }
      if (
        record?.serverAuthoritative &&
        ["customers", "representative"].includes(sectionKey)
      ) {
        if (
          !await window.DartDialog.confirm(
            "Delete this account? Login access will be permanently disabled, while orders and audit history stay preserved.",
          )
        ) return;
        const result = await dartAdminAccountState(sectionKey, record, "delete");
        if (!result.ok) window.DartDialog.alert(result.message || "Account deletion failed.");
        return;
      }
      deletePermanently(id, sectionKey);
      return;
    }
    if (e.target.closest(".btn-edit")) {
      openEditModal(id, sectionKey);
      return;
    }
    if (sectionKey === "orders") {
      const o = ordersData.find((x) => String(x.id) === String(id));
      if (!o) return;
      const codDecision = e.target.closest("[data-order-cod-decision]")?.dataset
        .orderCodDecision;
      if (codDecision) {
        if (!window.DartOrdersApi?.codVerification) {
          window.DartDialog.alert("COD verification requires the secure server API.");
          return;
        }
        const defaultReason =
          codDecision === "verify"
            ? "Customer/order COD details verified"
            : "COD verification failed";
        const reason = await window.DartDialog.prompt("ملاحظة التحقق من COD:", defaultReason);
        if (reason === null) return;
        try {
          await window.DartOrdersApi.codVerification(o.orderId || o.id, {
            expectedVersion: Math.max(1, Number(o.version || 1)),
            decision: codDecision,
            reason: String(reason).trim() || defaultReason,
          });
        } catch (error) {
          if (error?.code === "ORDER_VERSION_CONFLICT") {
            await window.DartOrdersApi.hydrate(true).catch(() => {});
          }
          window.DartDialog.alert(error?.message || "COD verification update failed.");
        }
        return;
      }
      const target = e.target.closest("[data-order-target]")?.dataset
        .orderTarget;
      if (target) {
        await dartRequestOrderTransition([o], target);
        return;
      }
      if (e.target.closest(".dart-pickup-cancel-btn")) {
        const result = await dartApplyTransition(o, "Preparing", {
          type: "REPRESENTATIVE_CANCELLED_PICKUP",
          actorRole: "Representative",
          reason: "Representative cancelled pickup",
        });
        if (!result.ok) window.DartDialog.alert(result.message || "Order status update failed.");
        return;
      }
      if (e.target.closest("[data-order-history]")) {
        dartShowOrderHistory(o);
        return;
      }
    }
    if (sectionKey === "returns") {
      const r = returnsData.find((x) => String(x.id) === String(id));
      if (e.target.closest(".return-rollback-btn")) {
        await dartRollbackReturn(r);
        return;
      }
      if (e.target.closest(".return-accept-btn")) dartDecideReturn(r, "accept");
      if (e.target.closest(".return-reject-btn")) dartDecideReturn(r, "reject");
      if (e.target.closest(".return-assign-btn")) {
        dartPendingReturnAction = { record: r, decision: "assign" };
        const select = document.getElementById("return-rep-assignment-select");
        select?.replaceChildren();
        dartActiveReps().forEach((representative) => {
          const option = document.createElement("option");
          option.value = representative.id;
          option.textContent = `${representative.name} — ${representative.repId}`;
          select?.appendChild(option);
        });
        if (!select?.options.length) {
          dartPendingReturnAction = null;
          window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
          return;
        }
        const summary = document.getElementById("return-rep-assignment-summary");
        if (summary) summary.textContent = `${r.returnId} · ${r.clientName || r.clientId || "Customer"}`;
        openModal(document.getElementById("return-rep-assignment-modal"));
      }
      if (e.target.closest(".return-good-btn")) {
        const result = await dartInspectReturn(r, "Good");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Inspection failed");
      }
      if (e.target.closest(".return-bad-btn")) {
        const result = await dartInspectReturn(r, "Damaged");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Inspection failed");
      }
    }
    if (sectionKey === "damage") {
      const d = damageData.find((x) => String(x.id) === String(id));
      if (e.target.closest(".dart-repair-btn")) {
        const result = await dartSetDamageStatus(d, "Repaired");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Repair failed");
      }
      if (
        e.target.closest(".dart-destroy-btn") &&
        await window.DartDialog.confirm("Mark this physical item as permanently Destroyed?")
      ) {
        const result = await dartSetDamageStatus(d, "Destroyed");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Destroy failed");
      }
    }
    if (sectionKey === "customers") {
      const x = customersData.find((v) => String(v.id) === String(id));
      if (e.target.closest("[data-client-profile]")) dartShowClientProfile(x);
      if (e.target.closest(".dart-reset-password-btn")) {
        const result = await dartRequestCustomerPasswordReset(x);
        if (!result.ok) {
          window.DartDialog.alert(result.message || "Password reset request failed.");
        } else {
          window.DartDialog.alert("تم تسجيل طلب Reset Password في قاعدة البيانات.");
        }
      }
    }
    if (e.target.closest("[data-history-entity]"))
      dartShowAuditFor(sectionKey, id);
  });
}

function dartActiveReps() {
  return representativeData.filter(
    (r) => dartIsActive(r) && r.status === "Active",
  );
}
async function dartRequestOrderTransition(orders, target) {
  if (!orders.length) return;
  const invalid = orders.filter((o) => !dartCanTransition(o, target));
  if (invalid.length) {
    window.DartDialog.alert(
      `الانتقال غير منطقي للأوردرات: ${invalid.map((o) => o.orderId).join(", ")}`,
    );
    return;
  }
  if (target === "Out With Representative") {
    dartPendingOrderAction = { orders, target };
    const sel = document.getElementById("rep-assignment-select");
    sel.innerHTML = dartActiveReps()
      .map(
        (r) =>
          `<option value="${dartEsc(r.id)}">${dartEsc(r.name)} — ${dartEsc(r.repId)}</option>`,
      )
      .join("");
    if (!sel.options.length) {
      window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
      return;
    }
    openModal(document.getElementById("rep-assignment-modal"));
    return;
  }
  if (target === "Refused" || target === "Cancelled") {
    dartPendingOrderAction = { orders, target };
    const title = document.getElementById("order-reason-title"),
      sel = document.getElementById("order-reason-select");
    title.textContent =
      target === "Refused" ? "Refusal Reason" : "Cancellation Reason";
    const reasons =
      target === "Refused"
        ? [
            "Customer changed mind",
            "Price",
            "Size",
            "Color",
            "Product different from expectation",
            "Customer unavailable / did not answer",
            "Product issue",
            "Delivery issue",
            "Other",
          ]
        : [
            "Customer request",
            "Admin decision",
            "Inventory issue",
            "Duplicate order",
            "Address/Delivery issue",
            "Other",
          ];
    sel.innerHTML = reasons
      .map((r) => `<option value="${dartEsc(r)}">${dartEsc(r)}</option>`)
      .join("");
    document.getElementById("order-reason-notes").value = "";
    openModal(document.getElementById("order-reason-modal"));
    return;
  }
  const result =
    orders.length === 1
      ? await dartApplyTransition(orders[0], target)
      : await dartBatchTransition(orders, target);
  if (!result.ok) window.DartDialog.alert(result.message || "Order status update failed.");
}
function dartSetupOperationalModals() {
  document
    .getElementById("confirm-return-approval")
    ?.addEventListener("click", async () => {
      const record = dartPendingReturnAction?.record;
      if (!record || dartPendingReturnAction?.decision !== "accept") return;
      const result = await dartApproveReturn(
        record,
        document.getElementById("return-replacement-select")?.value || "",
      );
      if (!result.ok) {
        window.DartDialog.alert(result.message || "Operation failed");
        return;
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-approval-modal"));
    });
  document
    .getElementById("confirm-return-rejection")
    ?.addEventListener("click", async () => {
      const record = dartPendingReturnAction?.record;
      if (!record || dartPendingReturnAction?.decision !== "reject") return;
      const reason = document.getElementById("return-rejection-reason")?.value;
      const result = await dartRejectReturn(record, reason);
      if (!result.ok) {
        window.DartDialog.alert(result.message || "Operation failed");
        return;
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-rejection-modal"));
    });
  document
    .getElementById("confirm-return-rep-assignment")
    ?.addEventListener("click", async () => {
      const records = dartPendingReturnAction?.records || (dartPendingReturnAction?.record ? [dartPendingReturnAction.record] : []);
      if (!records.length || dartPendingReturnAction?.decision !== "assign") return;
      const representativeId = document.getElementById("return-rep-assignment-select")?.value;
      if (records.length > 1 && !window.DartGroups?.sameRoute?.(records)) {
        window.DartDialog.alert("لا يمكن جمع إلا طلبات نفس العميل ونفس الدولة والمحافظة والمنطقة والشارع.");
        return;
      }
      const pickupGroupId = window.DartGroups?.newId?.("RPG") || `RPG-${Date.now()}`;
      for (const record of records) {
        const result = await dartAssignReturnRepresentative(record, representativeId, pickupGroupId);
        if (!result.ok) { window.DartDialog.alert(result.message || "Operation failed"); return; }
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-rep-assignment-modal"));
    });

  document.getElementById("assign-selected-returns")?.addEventListener("click", () => {
    const visibleIds = new Set(dartApplyFilters("returns", returnsData).map((row) => String(row.id)));
    const records = returnsData.filter((row) => row.isChecked && visibleIds.has(String(row.id)));
    if (!records.length) return window.DartDialog.alert("حدد طلب استبدال أو استرجاع واحدًا على الأقل.");
    if (records.some((row) => row.status !== "Approved - Awaiting Representative"))
      return window.DartDialog.alert("كل الطلبات المحددة يجب أن تكون Approved وتنتظر تعيين المندوب.");
    if (!window.DartGroups?.sameRoute?.(records))
      return window.DartDialog.alert("حدد طلبات نفس العميل ونفس الدولة والمحافظة والمنطقة والشارع فقط.");
    const select = document.getElementById("return-rep-assignment-select");
    select?.replaceChildren();
    dartActiveReps().forEach((representative) => {
      const option = document.createElement("option");
      option.value = representative.id;
      option.textContent = `${representative.name} — ${representative.repId}`;
      select?.appendChild(option);
    });
    if (!select?.options.length) return window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
    dartPendingReturnAction = { records, decision: "assign" };
    const summary = document.getElementById("return-rep-assignment-summary");
    if (summary) summary.textContent = `${records.length} selected request(s) · one pickup route · independent records`;
    openModal(document.getElementById("return-rep-assignment-modal"));
  });
  document
    .getElementById("confirm-rep-assignment")
    ?.addEventListener("click", async (event) => {
      if (!dartPendingOrderAction) return;
      const button = event.currentTarget;
      button.disabled = true;
      const rep = document.getElementById("rep-assignment-select").value;
      const { orders, target } = dartPendingOrderAction;
      try {
        const res =
          orders.length === 1
            ? await dartApplyTransition(orders[0], target, { representativeId: rep })
            : await dartBatchTransition(orders, target, { representativeId: rep });
        if (!res.ok) {
          window.DartDialog.alert(res.message || "Operation failed");
          return;
        }
        dartPendingOrderAction = null;
        closeModal(document.getElementById("rep-assignment-modal"));
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("confirm-order-reason")
    ?.addEventListener("click", async (event) => {
      if (!dartPendingOrderAction) return;
      const button = event.currentTarget;
      button.disabled = true;
      const reason = document.getElementById("order-reason-select").value,
        notes = document.getElementById("order-reason-notes").value;
      const { orders, target } = dartPendingOrderAction,
        meta = { reason, notes, actorRole: "Admin" };
      try {
        const res =
          orders.length === 1
            ? await dartApplyTransition(orders[0], target, meta)
            : await dartBatchTransition(orders, target, meta);
        if (!res.ok) {
          window.DartDialog.alert(res.message || "Operation failed");
          return;
        }
        dartPendingOrderAction = null;
        closeModal(document.getElementById("order-reason-modal"));
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("order-bulk-actions")
    ?.addEventListener("click", async (e) => {
      const target = e.target.closest("[data-bulk-order-status]")?.dataset
        .bulkOrderStatus;
      if (!target) return;
      const visibleIds = new Set(
        dartApplyFilters("orders", ordersData).map((x) => String(x.id)),
      );
      const selected = ordersData.filter(
        (o) => o.isChecked && visibleIds.has(String(o.id)),
      );
      if (!selected.length) {
        window.DartDialog.alert("حدد أوردر واحد على الأقل من الصفوف الظاهرة.");
        return;
      }
      await dartRequestOrderTransition(selected, target);
    });
}

function dartAutoAllocate(modelCode, color, size, qty, exclude = []) {
  const model = dartFindModelByCode(modelCode);
  if (!model || dartIsArchived(model))
    return { ok: false, message: "Model غير موجود أو مشطوب." };
  const excluded = new Set(exclude);
  const candidates = itemsData.filter(
    (i) =>
      dartIsActive(i) &&
      String(i.status).toLowerCase() === "in stock" &&
      String(i.modelId) === String(modelCode) &&
      String(i.color).toLowerCase() === String(color).toLowerCase() &&
      String(i.size).toLowerCase() === String(size).toLowerCase() &&
      !excluded.has(i.itemCode),
  );
  if (candidates.length < qty)
    return {
      ok: false,
      message: `المتاح ${candidates.length} فقط من ${modelCode} / ${color} / ${size}.`,
    };
  return { ok: true, codes: candidates.slice(0, qty).map((i) => i.itemCode) };
}

function setupItemModal() {
  return DartInventory.setupItemModal();
}
function dartRevalidateAllocatedItem(item, old) {
  const order = ordersData.find(
    (o) =>
      o.orderId === item.orderId && !DART_FINAL_ORDER_STATES.includes(o.status),
  );
  if (!order) return;
  const expected = (order.priceSnapshot || []).find(
    (l) => l.itemCode === old.itemCode,
  ) || { modelCode: old.modelId, color: old.color, size: old.size };
  const matches =
    item.modelId === expected.modelCode &&
    String(item.color).toLowerCase() === String(expected.color).toLowerCase() &&
    String(item.size).toLowerCase() === String(expected.size).toLowerCase();
  if (matches) return;
  const r = dartAutoAllocate(
    expected.modelCode,
    expected.color,
    expected.size,
    1,
    [item.itemCode],
  );
  if (r.ok) {
    const replacement = dartFindItemByCode(r.codes[0]),
      idx = order.items.indexOf(item.itemCode);
    replacement.status = "Processing/Held";
    replacement.orderId = order.orderId;
    replacement.clientId = order.clientId;
    replacement.clientName = order.clientName;
    if (idx >= 0) order.items[idx] = replacement.itemCode;
    item.status = "In stock";
    item.orderId = "";
    order.priceSnapshot = dartPriceSnapshotForCodes(order.items);
    dartLogOrder(order, "ITEM_REALLOCATED", order.status, order.status, {
      notes: `${old.itemCode} → ${replacement.itemCode}`,
    });
    dartNotify(
      "item_allocation_changed",
      `${order.orderId}: item allocation changed`,
      `${old.itemCode} → ${replacement.itemCode}`,
      "orders",
      order.id,
    );
  } else {
    const prev = order.status;
    order.previousOperationalStatus = prev;
    order.status = "Needs Attention";
    order.needsAttentionAt = dartNowISO();
    order.needsAttentionReason = `No ${expected.modelCode} / ${expected.color} / ${expected.size} available after ${item.itemCode} edit.`;
    dartLogOrder(order, "INVENTORY_CONFLICT", prev, "Needs Attention", {
      notes: order.needsAttentionReason,
    });
    dartNotify(
      "needs_attention",
      `${order.orderId} needs attention`,
      order.needsAttentionReason,
      "orders",
      order.id,
      "warning",
    );
  }
}

function dartSetupDamageModal() {
  const modal = document.getElementById("damage-modal"),
    form = document.getElementById("damage-form");
  document.getElementById("add-damage-btn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("damage-edit-id").value = "";
    openModal(modal);
  });
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("damage-edit-id").value,
      code = document.getElementById("damage-item-code").value.trim(),
      it = dartFindItemByCode(code);
    if (!it) {
      window.DartDialog.alert("Item Code غير موجود.");
      return;
    }
    const p = {
      itemCode: code,
      modelId: it.modelId,
      img: it.img || "",
      color: it.color,
      size: it.size,
      reason: document.getElementById("damage-reason").value,
      notes: document.getElementById("damage-notes").value,
      status: document.getElementById("damage-status").value,
      date: new Date().toLocaleDateString("en-GB"),
    };
    if (id) {
      const d = damageData.find((x) => String(x.id) === String(id)),
        old = { ...d };
      Object.assign(d, p);
      dartAudit("EDIT", "damage", d.id, old, p);
      dartSetDamageStatus(d, p.status);
    } else {
      const d = {
        id: dartUid("DMGDB"),
        damageId: dartUid("DMG"),
        createdAt: dartNowISO(),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      damageData.push(d);
      it.status = p.status === "Repaired" ? "In stock" : p.status;
      dartAudit("CREATE", "damage", d.id, {}, d);
      dartNotify(
        "item_damaged",
        `${code}: ${p.status}`,
        p.reason,
        "damage",
        d.id,
        "warning",
      );
      dartSaveAll();
      dartRefreshAll();
    }
    closeModal(modal);
  });
}

function dartShowOrderHistory(o) {
  const modal = document.getElementById("history-modal"),
    body = document.getElementById("history-modal-body");
  document.getElementById("history-modal-title").textContent =
    `Activity — ${o.orderId}`;
  body.innerHTML = `<div><b>Status:</b> ${dartEsc(o.status)} · <b>Payment:</b> ${dartEsc(o.paymentStatus)} · <b>Source:</b> ${dartEsc(o.orderSource)}</div><div class="dart-timeline">${
    (o.activityLog || [])
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="dart-timeline-item"><b>${dartEsc(e.type)}</b> ${dartEsc(e.previousStatus || "")} ${e.previousStatus ? "→" : ""} ${dartEsc(e.newStatus || "")}<div>${dartEsc(e.reason || e.notes || "")}</div><small>${dartEsc(new Date(e.timestamp).toLocaleString())} · ${dartEsc(e.actorRole || "")}</small></div>`,
      )
      .join("") || '<div class="dart-empty-state">No activity yet</div>'
  }</div>`;
  openModal(modal);
}

function dartShowClientProfile(c) {
  const st = dartCustomerStats(c.clientId),
    os = ordersData
      .filter((o) => o.clientId === c.clientId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  document.getElementById("history-modal-title").textContent =
    `Client — ${c.clientName}`;
  const trend = dartClientPurchaseTrend(c.clientId);
  document.getElementById("history-modal-body").innerHTML =
    `<div><b>${dartEsc(c.clientId)}</b> · ${dartEsc(c.phone1)} · ${dartEsc(c.email || "-")}</div><p>Orders: <b>${st.orders}</b> · Delivered: <b>${st.delivered}</b> · Items: <b>${st.purchased}</b> · Spent: <b>${dartMoney(st.spent)}</b></p><p class="dart-purchase-trend ${trend.direction}"><b>Purchase trend:</b> Orders ${dartEsc(trend.orders)} · Spending ${dartEsc(trend.spending)} <small>(last complete month vs previous month)</small></p><div class="dart-timeline">${os.map((o) => `<div class="dart-timeline-item"><b>${dartEsc(o.orderId)}</b> — ${dartEsc(o.status)}<div>${(o.items || []).map(dartEsc).join(", ")}</div><small>${dartEsc(o.date || "")} · ${dartMoney(dartOrderNet(o))}</small></div>`).join("") || '<div class="dart-empty-state">No orders</div>'}</div>`;
  openModal(document.getElementById("history-modal"));
}

function updateOrderCards() {
  const sec = document.getElementById("orders");
  if (!sec) return;
  const cards = sec.querySelectorAll(".cont-card-info .card-inf .numebr");
  if (cards.length >= 4) {
    cards[0].textContent = ordersData.filter(
      (o) => !DART_FINAL_ORDER_STATES.includes(o.status),
    ).length;
    cards[1].textContent = ordersData.filter(
      (o) => o.status === "Delivered",
    ).length;
    cards[2].textContent = ordersData.filter((o) => o.status === "New").length;
    cards[3].textContent = dartMoney(
      ordersData
        .filter((o) => o.status === "Delivered")
        .reduce(
          (a, o) =>
            a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
          0,
        ),
    );
  }
}

function dartDeadStockItems() {
  const now = Date.now(),
    ms = DART_DEAD_STOCK_DAYS * 864e5;
  return itemsData
    .filter(
      (i) => dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
    )
    .filter((i) => {
      const d = dartDateValue(i.regDate);
      return d && now - d.getTime() >= ms;
    });
}

function setupGlobalModalTriggers() {
  if (document.documentElement.dataset.dartModalReady) return;
  document.documentElement.dataset.dartModalReady = "1";
  document.addEventListener("click", (e) => {
    if (e.target.closest(".close-modal")) {
      closeModal(e.target.closest(".modal"));
      return;
    }
    if (e.target.classList.contains("modal")) closeModal(e.target);
  });
}

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
// ============================================================================
const DART_PANTS_SIZES = [
  "26",
  "28",
  "30",
  "32",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "46",
  "48",
  "50",
  "52",
];
const DART_TOP_SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
];


function loadAllDataFromStorage(_persistMigrations = true) {
  const load = (key, fallback) => window.DartState?.read?.(key, fallback) ?? fallback;
  modelsData = load("dart_models", modelsData);
  itemsData = load("dart_items", itemsData);
  customersData = load("dart_customers", customersData);
  ordersData = load("dart_orders", ordersData);
  returnsData = load("dart_returns", returnsData);
  reviewsData = load("dart_reviews", reviewsData);
  cardsData = load("dart_cards", cardsData);
  representativeData = load("dart_representatives", representativeData);
  damageData = load("dart_damage", []);
  notificationData = load("dart_notifications", []);
  auditData = load("dart_audit", []);
}

function renderModels(dataArray) {
  const c = document.getElementById("models-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((m) => {
    const d = dartModelDerived(m),
      out = d.count === 0 ? "Out of stock" : m.status || "Active";
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(m)}" data-id="${dartEsc(m.id)}"><input type="checkbox" class="model-checkbox" ${m.isChecked ? "checked" : ""} ${dartIsArchived(m) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(m) ? "استعادة" : "شطب"}"><i class="bx ${dartIsArchived(m) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="models" title="Audit History"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(d.img || "https://via.placeholder.com/50")}" class="product-img model-img"></div><span class="text-item w150">${dartEsc(m.modelId)}</span><span class="text-item w150">${dartEsc(m.name)}</span><span class="text-item w150">${dartEsc(m.category)}</span><span class="text-item w200">${dartEsc(m.description)}</span><span class="text-item w150">${d.count}</span><span class="text-item w150">${d.total}</span><span class="text-item w150">${d.sold}</span><span class="text-item w150">${d.damaged}</span><span class="text-item w150">${dartMoney(m.cost)}</span><span class="text-item w150">${dartMoney(m.selling)}</span><span class="text-item w150">${Number(m.discount) || 0}%</span><span class="text-item w150">${dartMoney(m.discountedPrice ?? m.selling)}</span><span class="text-item w300">${dartEsc(d.colors.join(", ") || "-")}</span><span class="text-item w300">${dartEsc(d.sizes.join(", ") || "-")}</span><span class="text-item w150">• ${dartEsc(out)}</span><span class="text-item w150">${dartEsc(m.date || "-")}</span></div>`,
    );
  });
}

function renderItems(dataArray) {
  return DartInventory.renderItems(dataArray);
}

function dartDeliveredInMonth(clientId, year, month) {
  return ordersData
    .filter((o) => o.clientId === clientId && o.status === "Delivered")
    .filter((o) => {
      const d = new Date(o.deliveredAt || o.createdAt || 0);
      return d.getFullYear() === year && d.getMonth() === month;
    });
}
function dartCurrentMonthlyOrders(clientId) {
  const n = new Date();
  return dartDeliveredInMonth(clientId, n.getFullYear(), n.getMonth()).length;
}

// BEGIN Monthly purchase direction — compare the last two complete months.
function dartDeliveredPeriodStats(clientId, start, end) {
  const rows = ordersData.filter((order) => {
    const date = new Date(order.deliveredAt || order.createdAt || 0);
    return (
      order.status === "Delivered" &&
      order.clientId === clientId &&
      !Number.isNaN(date.getTime()) &&
      date >= start &&
      date < end
    );
  });
  return {
    orders: rows.length,
    spending: rows.reduce(
      (sum, order) =>
        sum +
        Math.max(0, dartOrderNet(order) - (Number(order.amountRefunded) || 0)),
      0,
    ),
  };
}
function dartTrendValue(current, previous) {
  const percent = previous
    ? Math.round(((current - previous) / previous) * 100)
    : current
      ? 100
      : 0;
  const arrow = percent > 0 ? "↑" : percent < 0 ? "↓" : "→";
  return `${arrow} ${Math.abs(percent)}%`;
}
function dartClientPurchaseTrend(clientId) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const last = dartDeliveredPeriodStats(
    clientId,
    lastMonthStart,
    currentMonthStart,
  );
  const previous = dartDeliveredPeriodStats(
    clientId,
    previousMonthStart,
    lastMonthStart,
  );
  const orderChange = last.orders - previous.orders;
  const spendingChange = last.spending - previous.spending;
  return {
    orders: dartTrendValue(last.orders, previous.orders),
    spending: dartTrendValue(last.spending, previous.spending),
    direction:
      orderChange > 0 || (orderChange === 0 && spendingChange > 0)
        ? "is-up"
        : orderChange < 0 || spendingChange < 0
          ? "is-down"
          : "is-flat",
  };
}
// END Monthly purchase direction.
function renderCustomers(dataArray) {
  const c = document.getElementById("customers-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((x) => {
    const st = dartCustomerStats(x.clientId),
      monthly = dartCurrentMonthlyOrders(x.clientId);
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(x)}" data-id="${dartEsc(x.id)}"><input type="checkbox" class="model-checkbox" ${x.isChecked ? "checked" : ""} ${dartIsArchived(x) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(x) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-client-profile="1" title="Client history"><i class="bx bx-history"></i></button><button class="dart-reset-password-btn" title="Reset Password"><i class="bx bx-key"></i></button></div><span class="text-item w150">${dartEsc(x.birthday || "-")}</span><span class="text-item w150">${dartEsc(x.clientName)}</span><span class="text-item w150">${dartEsc(x.clientId)}</span><span class="text-item w150">${dartEsc(x.phone1)}</span><span class="text-item w150">${dartEsc(x.phone2 || "-")}</span><span class="text-item w200">${dartEsc(x.email || "-")}</span><span class="text-item w150">${dartEsc(x.country || "Egypt")}</span><span class="text-item w200">${dartEsc(x.governorate || "-")}</span><span class="text-item w150">${monthly}</span><span class="text-item w150">${st.delivered}</span><span class="text-item w300">${dartMoney(st.spent)}<small class="dart-kpi-inline">${st.purchased} items · last ${dartEsc(st.lastPurchase)}</small></span><span class="text-item w200">${dartEsc(x.dartCard || "no")}</span><span class="text-item w100">${dartEsc(dartClientAge(x.birthday))}</span></div>`,
    );
  });
}

function dartPreviousStatus(status) {
  const i = DART_ORDER_FLOW.indexOf(status);
  return i > 0 ? DART_ORDER_FLOW[i - 1] : null;
}
async function dartRollbackOrderOneStep(order) {
  if (
    !order ||
    dartIsArchived(order) ||
    ["New", "Refused", "Cancelled", "Needs Attention"].includes(order.status)
  )
    return { ok: false, message: "لا يمكن الرجوع خطوة من هذه الحالة." };
  const prevStatus = order.status,
    target = dartPreviousStatus(prevStatus),
    serverAuthoritative = Boolean(window.DartOrdersApi);
  if (!target) return { ok: false, message: "لا توجد خطوة سابقة." };
  if (
    !await window.DartDialog.confirm(
      `رجوع ${order.orderId} من ${prevStatus} إلى ${target}؟ سيتم عكس أي تأثير مالي/مخزني مرتبط بهذه الخطوة.`,
    )
  )
    return { ok: false, message: "cancelled" };
  if (window.DartOrdersApi?.workflow) {
    try {
      await window.DartOrdersApi.workflow(order.orderId || order.id, {
        expectedStatus: prevStatus,
        target,
        reason: "Manual one-step rollback",
      });
      return { ok: true };
    } catch (error) {
      if (error?.code === "ORDER_STATE_STALE") {
        await window.DartOrdersApi.hydrate(true).catch(() => {});
      }
      return {
        ok: false,
        message: error?.message || "Order rollback was not committed to the server.",
      };
    }
  }
  if (prevStatus === "Delivered") {
    if (!serverAuthoritative) {
      (order.items || []).forEach((code) => {
        const it = dartFindItemByCode(code);
        if (it && it.status === "Sold") {
          it.status = "Processing/Held";
          it.purchaseDate = "";
        }
      });
    }
    order.deliveredAt = null;
    if (
      order.paymentMethod &&
      String(order.paymentMethod).toLowerCase().includes("cash") &&
      order.paidAt
    ) {
      order.paymentStatus = "Unpaid";
      order.amountPaid = 0;
      order.paidAt = null;
    }
    if (!serverAuthoritative && order.birthdayRewardId) {
      let rewards;
      try {
        rewards = window.DartState?.read?.("dart_birthday_rewards", []) || [];
      } catch {
        rewards = [];
      }
      const reward = rewards.find((row) => row.id === order.birthdayRewardId);
      if (reward) {
        reward.status =
          new Date() < new Date(reward.expiresAt) ? "Reserved" : "Expired";
        reward.usedCount = 0;
        reward.usedAt = null;
        reward.orderId = order.orderId;
        order.birthdayRewardUsageRecorded = false;
        if (window.DartDomainState?.write) {
          window.DartDomainState.write("dart_birthday_rewards", rewards);
        } else {
          window.DartState?.write?.("dart_birthday_rewards", rewards, { source: "dashboard" });
        }
      }
    }
  }
  if (prevStatus === "Representative On The Way")
    order.representativeOnWayAt = null;
  if (prevStatus === "Out With Representative") {
    order.outWithRepresentativeAt = null;
    order.representativeId = null;
    order.representativeName = "";
    order.deliveryGroupId = "";
  }
  if (prevStatus === "Preparing") order.preparingAt = null;
  if (prevStatus === "Accepted") order.acceptedAt = null;
  order.status = target;
  dartLogOrder(order, "STATUS_ROLLBACK", prevStatus, target, {
    notes: "Admin rolled order back one step",
  });
  dartAudit(
    "ORDER_STATUS_ROLLBACK",
    "orders",
    order.id,
    { status: prevStatus },
    { status: target },
    "Manual one-step rollback",
  );
  dartNotify(
    "order_rollback",
    `${order.orderId}: moved back one step`,
    `${prevStatus} → ${target}`,
    "orders",
    order.id,
    "warning",
  );
  dartPersistOrderWorkflow();
  dartRefreshAll();
  return { ok: true };
}

function renderOrders(dataArray) {
  const c = document.getElementById("orders-container");
  if (!c) return;
  c.innerHTML = "";
  const sorted = getSortedData(dataArray).sort((a, b) => {
    if (dartIsArchived(a) !== dartIsArchived(b))
      return Number(dartIsArchived(a)) - Number(dartIsArchived(b));
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const operationalGroups = window.DartGroups?.groupOrders?.(sorted) || [];
  const activeGroupedIds = new Set(operationalGroups.flatMap((group) => group.records.map((row) => String(row.id))));
  const orderedRows = [...operationalGroups.flatMap((group) => group.records), ...sorted.filter((row) => !activeGroupedIds.has(String(row.id)))];
  const groupMeta = new Map();
  operationalGroups.forEach((group) => group.records.forEach((row, index) => groupMeta.set(String(row.id), { ...group, index })));
  orderedRows.forEach((o) => {
    const meta = groupMeta.get(String(o.id));
    if (meta?.records.length > 1 && meta.index === 0)
      dartAppendOperationGroupHeading(c, "Delivery", meta.records.length, "orders", o, "Each order and item remains independent.", meta.key);
    const next = dartNextStatus(o.status),
      net = dartOrderNet(o),
      verificationStatus = String(
        o.verificationStatus || o.codVerificationStatus || "Not Required",
      ),
      riskLevel = String(o.riskLevel || "Low"),
      customerRiskLevel = String(o.customerRiskLevel || riskLevel),
      isCashOrder = String(o.paymentMethod || "").toLowerCase().includes("cash"),
      codBlocked =
        isCashOrder && !["Not Required", "Verified"].includes(verificationStatus),
      refusalHistory = Array.isArray(o.refusalHistory) ? o.refusalHistory : [],
      refusalSummary = refusalHistory
        .slice(0, 10)
        .map(
          (row) =>
            `${row.orderId || "-"} · ${String(row.refusedAt || "-").slice(0, 10)} · ${row.reason || "Other"}`,
        )
        .join(" | "),
      riskMeta =
        `<small class="dart-kpi-inline" title="${dartEsc(refusalSummary || "No refusal history")}">Order risk ${dartEsc(riskLevel)} (${Number(o.riskScore) || 0}) · Customer ${dartEsc(customerRiskLevel)} · Verification ${dartEsc(verificationStatus)} · Refusals ${Number(o.refusalsInWindow) || 0}</small>`,
      rep =
        o.representativeName ||
        dartFindRepById(o.representativeId)?.name ||
        "-",
      chips =
        (o.items || [])
          .map((x) => `<div class="order-item-chip">${dartEsc(x)}</div>`)
          .join("") || "-";
    const nextBtn =
        next && dartCanTransition(o, next)
          ? `<button class="dart-status-btn" data-order-target="${dartEsc(next)}">${dartEsc(next)}</button>`
          : next === "Preparing" && codBlocked
            ? '<button class="dart-status-btn" disabled title="COD verification required">Verify first</button>'
            : "",
      codActions =
        codBlocked &&
        ["New", "Accepted"].includes(o.status) &&
        window.DartAdminAccess?.can?.("orders.verify_cod") === true
          ? '<button class="dart-status-btn" data-order-cod-decision="verify">Verify COD</button><button class="dart-cancel-btn" data-order-cod-decision="fail">Fail COD</button>'
          : "",
      back =
        dartPreviousStatus(o.status) &&
        !["Refused", "Cancelled", "Needs Attention"].includes(o.status)
          ? '<button class="dart-back-btn" title="Back one step"><i class="bx bx-undo"></i></button>'
          : "",
      refuse = [
        "Out With Representative",
        "Representative On The Way",
      ].includes(o.status)
        ? '<button class="dart-refuse-btn" data-order-target="Refused">Refuse</button>'
        : "",
      cancel = !DART_FINAL_ORDER_STATES.includes(o.status)
        ? '<button class="dart-cancel-btn" data-order-target="Cancelled">Cancel</button>'
        : "",
      pickup =
        o.status === "Out With Representative"
          ? '<button class="dart-pickup-cancel-btn">Cancel Pickup</button>'
          : "";
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(o)}" data-id="${dartEsc(o.id)}"><input type="checkbox" class="model-checkbox" ${o.isChecked ? "checked" : ""} ${dartIsArchived(o) ? "disabled" : ""}><div class="w500 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(o) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-order-history="1"><i class="bx bx-history"></i></button>${back}<span class="dart-status-actions">${nextBtn}${codActions}${refuse}${cancel}${pickup}</span></div><span class="text-item w150">${dartEsc(o.orderId)}</span><span class="text-item w150">${dartEsc(o.date || "-")}</span><span class="text-item w150">${dartEsc(o.time || "-")}</span><span class="text-item w200"><span class="status-pill ${dartStatusClass(o.status)}">${dartEsc(o.status)}</span>${riskMeta}</span><span class="text-item w150">${dartEsc(o.clientId || "-")}</span><span class="text-item w200">${dartEsc(o.clientName)}</span><span class="text-item w150">${dartEsc(o.phone1)}</span><span class="text-item w150">${dartEsc(o.phone2 || "-")}</span><span class="text-item w150">${dartEsc(o.email || "-")}</span><span class="text-item w150">${(o.items || []).length}</span><div class="text-item w500"><div class="order-items-grid">${chips}</div></div><span class="text-item w150">${dartMoney(o.totalPrice)}</span><span class="text-item w150">${Number(o.discount) || 0}%</span><span class="text-item w150">${dartEsc(o.reasonDeduction || "-")}</span><span class="text-item w150 order-final-amount">${dartMoney(net)}</span><span class="text-item w150"><span class="payment-cell"><i class="${dartPaymentIcon(o.paymentMethod)}"></i>${dartEsc(o.paymentMethod || "-")}</span></span><span class="text-item w150">${dartEsc(o.paymentStatus || "Unpaid")}</span><span class="text-item w150">${dartEsc(o.orderSource || "Manual")}</span><span class="text-item w150">${dartEsc(rep)}</span><span class="text-item w150">${dartEsc(o.deliveryNotes || "-")}</span><span class="text-item w150">${dartEsc(o.country || "Egypt")}</span><span class="text-item w150">${dartEsc(o.governorate || "-")}</span><span class="text-item w150">${dartEsc(o.area || "-")}</span><span class="text-item w150">${dartEsc(o.street || "-")}</span><span class="text-item w150">${dartEsc(o.building || "-")}</span><span class="text-item w150">${dartEsc(o.floor || "-")}</span></div>`,
    );
  });
  updateOrderCards();
}

function dartAppendOperationGroupHeading(container, type, count, noun, record, note, groupKey = "") {
  const template = document.getElementById("dashboard-operation-group-template");
  if (!template) return;
  const fragment = template.content.cloneNode(true);
  const heading = fragment.querySelector("[data-operation-group-heading]");
  if (heading) {
    heading.dataset.operationGroupCount = String(count);
    if (groupKey) heading.dataset.operationGroupKey = String(groupKey);
  }
  fragment.querySelector('[data-operation-group-field="title"]').textContent = `${type} group · ${count} ${noun}`;
  fragment.querySelector('[data-operation-group-field="route"]').textContent = `${record.clientName || record.clientId || "Customer"} · ${[record.street, record.area, record.governorate].filter(Boolean).join("، ")}`;
  fragment.querySelector('[data-operation-group-field="note"]').textContent = note;
  container.appendChild(fragment);
}

function renderReturns(dataArray) {
  const c = document.getElementById("returns-container");
  if (!c) return;
  const template = document.getElementById("dashboard-return-row-template");
  c.replaceChildren();
  if (!template) return;
  const sorted = getSortedData(dataArray).sort(
    (a, b) =>
      new Date(b.createdAt || dartDateValue(b.date) || 0) -
      new Date(a.createdAt || dartDateValue(a.date) || 0),
  );
  const operationalGroups = window.DartGroups?.groupReturns?.(sorted) || [];
  const activeGroupedIds = new Set(operationalGroups.flatMap((group) => group.records.map((row) => String(row.id))));
  const orderedRows = [...operationalGroups.flatMap((group) => group.records), ...sorted.filter((row) => !activeGroupedIds.has(String(row.id)))];
  const groupMeta = new Map();
  operationalGroups.forEach((group) => group.records.forEach((row, index) => groupMeta.set(String(row.id), { ...group, index })));
  orderedRows.forEach((r) => {
      const meta = groupMeta.get(String(r.id));
      if (meta?.records.length > 1 && meta.index === 0) {
        dartAppendOperationGroupHeading(c, "Pickup", meta.records.length, "requests", r, "Each return and physical item remains independent.", meta.key);
      }
      const fragment = template.content.cloneNode(true);
      const row = fragment.querySelector("[data-return-row]");
      row.className = getRowClass(r);
      row.dataset.id = r.id;
      const checkbox = row.querySelector("[data-return-checkbox]");
      checkbox.checked = Boolean(r.isChecked);
      checkbox.disabled = dartIsArchived(r);
      const archiveIcon = row.querySelector(".btn-delete i");
      archiveIcon.className = `bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}`;
      const mayDecide = r.status === "Pending Request";
      const mayAssign = r.status === "Approved - Awaiting Representative";
      const mayInspect = r.status === "Pending Inspection" ||
        (r.isPostDeliveryReturn && r.status === "Completed" && (r.inspectionStatus || "Pending") === "Pending");
      row.querySelector(".return-accept-btn").hidden = !mayDecide;
      row.querySelector(".return-reject-btn").hidden = !mayDecide;
      row.querySelector(".return-assign-btn").hidden = !mayAssign;
      row.querySelector(".return-good-btn").hidden = !mayInspect;
      row.querySelector(".return-bad-btn").hidden = !mayInspect;
      row.querySelector(".return-rollback-btn").hidden = !window.DartReturns?.canRollback?.(r);
      const customerFee = Number(r.customerCourierFee) || 0;
      const brandFee = Number(r.brandCourierFee) || 0;
      const replacement = r.replacementItemCode ||
        (dartReturnIsExchange(r) ? `${r.requestedColor || "-"} / ${r.requestedSize || "-"}` : "-");
      const values = {
        returnId: r.returnId || "-",
        requestType: r.requestType || (r.isPostDeliveryReturn ? "Refund" : "Refusal"),
        modelId: r.modelId || "-",
        itemCode: r.itemCode || "-",
        replacement,
        status: dartReturnRules()?.publicStatus?.(r) || r.status || "-",
        inspection: r.inspectionStatus || (r.status === "Good" || r.status === "Damaged" ? r.status : "Pending"),
        date: r.date || "-",
        clientName: r.clientName || "-",
        clientId: r.clientId || "-",
        phone1: r.phone1 || "-",
        courierFee: customerFee > 0
          ? `${dartMoney(customerFee)} · Customer → Representative`
          : brandFee > 0
            ? `${dartMoney(brandFee)} · Dart → Representative`
            : "No fee",
        representative: r.representativeName || r.representativeBusinessId || "Not assigned",
        pickupAddress: dartReturnPickupAddress(r) || "-",
        reason: r.reason || "-",
        rejectionReason: r.rejectionReason || "-",
        orderId: r.orderId || "-",
      };
      Object.entries(values).forEach(([field, value]) => {
        const element = row.querySelector(`[data-return-field="${field}"]`);
        if (element) element.textContent = value;
      });
      const status = row.querySelector('[data-return-field="status"]');
      status?.classList.toggle("return-status-good", ["Completed", "Good"].includes(r.status));
      c.appendChild(fragment);
    });
}

function renderReviews(dataArray) {
  const c = document.getElementById("review-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .forEach((r) => {
      const active = r.status === "Active";
      const source =
        r.source || (r.recordType === "contact" ? "Contact Us" : "Review");
      const isContact = source === "Contact Us";
      const visibilityButton = isContact
        ? ""
        : `<button class="btn-toggle-review review-toggle-btn ${active ? "review-status-active" : "review-status-hidden"}">${active ? "Hide" : "Activate"}</button>`;
      c.insertAdjacentHTML(
        "beforeend",
        `<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked ? "checked" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${visibilityButton}</div><span class="text-item w200">${dartEsc(new Date(r.createdAt).toLocaleString())}</span><span class="text-item w150">${dartEsc(source)}</span><span class="text-item w200">${dartEsc(r.clientName || "-")}</span><span class="text-item w150">${dartEsc(r.clientId || "-")}</span><span class="text-item w150 status-text" style="color:${isContact ? "#64748b" : active ? "green" : "red"}">${dartEsc(r.status || "-")}</span><span class="text-item w100">${isContact ? "-" : `${dartEsc(r.rating || "-")} / 5`}</span><span class="text-item w300">${dartEsc(r.title || "-")}</span><span class="text-item w500 overflow">${dartEsc(r.review || "-")}</span><span class="text-item w150">${dartEsc(r.phone1 || "-")}</span><span class="text-item w150">${dartEsc(r.phone2 || "-")}</span><span class="text-item w150">${dartEsc(r.email || "-")}</span></div>`,
      );
    });
}

function renderRepresentative(dataArray) {
  const c = document.getElementById("representative-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((r) => {
    const current = ordersData.filter(
        (o) =>
          String(o.representativeId) === String(r.id) &&
          !DART_FINAL_ORDER_STATES.includes(o.status),
      ).length,
      total = ordersData.filter(
        (o) => String(o.representativeId) === String(r.id),
      ).length,
      pending = r.serverAuthoritative && r.status === "Pending Approval",
      secureActions = r.serverAuthoritative
        ? `<button class="action-btn dart-rep-docs" title="Verification documents"><i class="bx bx-id-card"></i></button>
           ${pending ? '<button class="action-btn dart-rep-approve" title="Approve"><i class="bx bx-check-circle"></i></button><button class="action-btn dart-rep-reject" title="Reject"><i class="bx bx-x-circle"></i></button>' : ""}`
        : "",
      maskedNationalId = r.nationalIdLast4
        ? `••••••••••${dartEsc(r.nationalIdLast4)}`
        : "-";
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked ? "checked" : ""}><div class="w300 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button>${secureActions}</div><span class="text-item w200">${dartEsc(r.name)}</span><span class="text-item w150">${dartEsc(r.repId)}</span><span class="text-item w150" style="color:${r.status === "Active" ? "#10b981" : r.status === "Pending Approval" ? "#f59e0b" : "#ef4444"}">${dartEsc(r.status)}</span><span class="text-item w150">${maskedNationalId}</span><span class="text-item w150">${current}</span><span class="text-item w100">${total}</span><span class="text-item w150">${dartEsc(r.phone1)}</span><span class="text-item w150">${dartEsc(r.phone2 || "-")}</span><span class="text-item w200">${dartEsc(r.address || "-")}</span><span class="text-item w150">${dartEsc(r.createdAt ? new Date(r.createdAt).toLocaleDateString() : r.date || "-")}</span></div>`,
    );
  });
}

async function dartRefreshRepresentativesFromServer() {
  if (!window.DartDomainState?.hydrateDomain) return;
  await window.DartDomainState.hydrateDomain("representatives", true);
}

async function dartReviewRepresentativeDocuments(representativeId) {
  if (!window.DartAdminApi?.request) {
    throw new Error("Secure admin API is unavailable.");
  }
  const types = [
    ["id_front", "National ID — front"],
    ["id_back", "National ID — back"],
    ["face", "Face verification"],
  ];
  const documents = [];
  for (const [type, label] of types) {
    const payload = await window.DartAdminApi.request(
      `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/documents/${type}`,
    );
    documents.push({ label, dataUrl: payload.document?.dataUrl || "" });
  }
  const viewer = window.open("", "_blank", "noopener,noreferrer");
  if (!viewer) throw new Error("Allow pop-ups to review verification documents.");
  viewer.document.title = "Dart Representative Verification";
  viewer.document.body.innerHTML =
    '<main style="font-family:Arial,sans-serif;max-width:900px;margin:30px auto;padding:0 20px"><h1>Representative verification</h1><p>Private review session. Do not share these documents.</p></main>';
  const main = viewer.document.querySelector("main");
  documents.forEach(({ label, dataUrl }) => {
    const section = viewer.document.createElement("section");
    section.style.marginBottom = "28px";
    const heading = viewer.document.createElement("h2");
    heading.textContent = label;
    const image = viewer.document.createElement("img");
    image.src = dataUrl;
    image.alt = label;
    image.style.maxWidth = "100%";
    image.style.borderRadius = "12px";
    section.append(heading, image);
    main.appendChild(section);
  });
}

document.addEventListener("click", async (event) => {
  const row = event.target.closest("#representative-container [data-id]");
  if (!row) return;
  const representativeId = row.dataset.id;
  const approve = event.target.closest(".dart-rep-approve");
  const reject = event.target.closest(".dart-rep-reject");
  const docs = event.target.closest(".dart-rep-docs");
  if (!approve && !reject && !docs) return;

  try {
    if (docs) {
      await dartReviewRepresentativeDocuments(representativeId);
      return;
    }
    if (!window.DartAdminApi?.request) {
      throw new Error("Secure admin API is unavailable.");
    }
    if (approve) {
      if (!await window.DartDialog.confirm("Approve this representative account?")) return;
      await window.DartAdminApi.request(
        `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/approve`,
        { method: "POST" },
      );
    }
    if (reject) {
      const reason = await window.DartDialog.prompt("Reason for rejecting this representative:");
      if (!reason || reason.trim().length < 3) return;
      await window.DartAdminApi.request(
        `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/reject`,
        { method: "POST", body: { reason: reason.trim() } },
      );
    }
    await dartRefreshRepresentativesFromServer();
  } catch (error) {
    window.DartDialog.alert(error.message || "Representative action failed.");
  }
});

function dartApplyFilters(key, data) {
  const state = dartFilterState[key] || {},
    raw = [...(data || [])];
  let out = raw;
  if (state.search)
    out = out.filter((x) => dartSectionSearchText(x).includes(state.search));
  if (state.archive === "active") out = out.filter(dartIsActive);
  else if (state.archive === "archived") out = out.filter(dartIsArchived);
  const eq = (field, val, derive) => {
    if (!val || val === "all") return;
    out = out.filter(
      (x) =>
        String(derive ? derive(x) : x[field] || "").toLowerCase() ===
        String(val).toLowerCase(),
    );
  };
  if (key === "models") {
    eq("category", state.category);
    if (state.status && state.status !== "all")
      out = out.filter((m) => {
        const d = dartModelDerived(m);
        return state.status === "out-of-stock"
          ? d.count === 0
          : String(m.status || "Active").toLowerCase() ===
              state.status.toLowerCase();
      });
    if (state.priceRange && state.priceRange !== "all")
      out = out.filter((m) => {
        const p = Number(m.discountedPrice ?? m.selling) || 0;
        return state.priceRange === "0-500"
          ? p <= 500
          : state.priceRange === "500-1000"
            ? p > 500 && p <= 1000
            : p > 1000;
      });
  }
  if (key === "items") {
    if (state.category && state.category !== "all")
      out = out.filter(
        (i) =>
          String(
            dartFindModelByCode(i.modelId)?.category || "",
          ).toLowerCase() === state.category.toLowerCase(),
      );
    if (state.status && state.status !== "all")
      out = out.filter((i) =>
        String(i.status)
          .toLowerCase()
          .includes(
            state.status
              .toLowerCase()
              .replace("active", "in stock")
              .replace("out-of-stock", "sold"),
          ),
      );
    if (state.sizeProfile === "pants")
      out = out.filter((i) => DART_PANTS_SIZES.includes(String(i.size)));
    if (state.sizeProfile === "tops")
      out = out.filter((i) =>
        DART_TOP_SIZES.includes(String(i.size).toUpperCase()),
      );
    eq("size", state.size);
    eq("color", state.color);
  }
  if (key === "customers") {
    if (state.dartCard && state.dartCard !== "all")
      eq("dartCard", state.dartCard);
    if (state.monthlyOrders === "up")
      out.sort(
        (a, b) =>
          dartCurrentMonthlyOrders(b.clientId) -
          dartCurrentMonthlyOrders(a.clientId),
      );
    if (state.monthlyOrders === "low")
      out.sort(
        (a, b) =>
          dartCurrentMonthlyOrders(a.clientId) -
          dartCurrentMonthlyOrders(b.clientId),
      );
    if (state.birthday && state.birthday !== "all") {
      const now = new Date(),
        target = new Date(now);
      if (state.birthday === "tomorrow") target.setDate(now.getDate() + 1);
      if (state.birthday === "yesterday") target.setDate(now.getDate() - 1);
      out = out.filter((c) => {
        const d = dartDateValue(c.birthday);
        return (
          d &&
          d.getDate() === target.getDate() &&
          d.getMonth() === target.getMonth()
        );
      });
    }
  }
  if (key === "orders") {
    eq("status", state.status);
    if (state.totalPrice === "up")
      out.sort((a, b) => dartOrderNet(b) - dartOrderNet(a));
    else if (state.totalPrice === "low")
      out.sort((a, b) => dartOrderNet(a) - dartOrderNet(b));
    else
      out.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
    if (state.date && state.date !== "all") {
      const now = Date.now();
      out = out.filter((o) => {
        const d = new Date(o.createdAt || 0);
        if (Number.isNaN(d.getTime())) return false;
        const age = now - d.getTime();
        if (state.date === "an-hour-ago") return age <= 3600000;
        if (state.date === "two-hours-ago") return age <= 7200000;
        if (state.date === "five-hours-ago") return age <= 18000000;
        const today = new Date(),
          od = d.toDateString();
        if (state.date === "today") return od === today.toDateString();
        if (state.date === "yesterday") {
          const y = new Date(today);
          y.setDate(today.getDate() - 1);
          return od === y.toDateString();
        }
        return true;
      });
    }
  }
  if (key === "returns") {
    eq("status", state.status);
    if (state.reason && state.reason !== "all")
      out = out.filter((r) =>
        String(r.reason || "")
          .toLowerCase()
          .includes(String(state.reason).replace(/_/g, " ").toLowerCase()),
      );
    out.sort(
      (a, b) =>
        new Date(b.createdAt || dartDateValue(b.date) || 0) -
        new Date(a.createdAt || dartDateValue(a.date) || 0),
    );
  }
  if (key === "review") {
    if (state.status && state.status !== "all") eq("status", state.status);
    if (state.rating === "up" || state.rating === "Up")
      out.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    else if (state.rating === "low")
      out.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
    else
      out.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
    if (state.source && state.source !== "all")
      out = out.filter((r) =>
        String(
          r.source || (r.recordType === "contact" ? "Contact Us" : "Review"),
        )
          .toLowerCase()
          .includes(state.source.toLowerCase()),
      );
  }
  if (key === "representative") {
    if (state.status && state.status !== "all")
      out = out.filter(
        (r) =>
          String(r.status || "").toLowerCase() ===
          String(state.status).toLowerCase().replace("hidden", "not available"),
      );
  }
  if (key === "card") {
    if (state.status && state.status !== "all") eq("status", state.status);
  }
  if (key === "damage") {
    if (state.status && state.status !== "all") eq("status", state.status);
  }
  return out;
}

function dartNotificationCategory(n) {
  const t = String(n.type || "").toLowerCase();
  if (t.includes("damage") || t.includes("destroy") || t.includes("repair"))
    return "damage";
  if (t.includes("return") || t.includes("refus")) return "return";
  if (t.includes("payment") || t.includes("refund")) return "payment";
  if (t.includes("stock") || t.includes("item") || t.includes("inventory"))
    return "inventory";
  if (t.includes("client") || t.includes("password")) return "customer";
  if (
    t.includes("order") ||
    t.includes("representative") ||
    t.includes("pickup") ||
    t.includes("attention")
  )
    return "order";
  return "system";
}
function dartNotificationIcon(cat) {
  return (
    {
      order: "fa-solid fa-box",
      inventory: "fa-solid fa-shirt",
      return: "fa-solid fa-rotate-left",
      damage: "fa-solid fa-triangle-exclamation",
      payment: "fa-solid fa-wallet",
      customer: "fa-solid fa-user",
      system: "fa-solid fa-circle-info",
    }[cat] || "fa-solid fa-bell"
  );
}
function renderNotifications() {
  const feed = document.getElementById("updates-feed");
  if (!feed) return;
  const filter = document.getElementById("notificationFilter")?.value || "all",
    list = notificationData
      .filter((n) => filter === "all" || dartNotificationCategory(n) === filter)
      .slice(0, 80);
  feed.innerHTML =
    list
      .map((n) => {
        const cat = dartNotificationCategory(n);
        return `<div class="dart-notification notif-${cat} ${n.read ? "read" : "unread"}" data-notification-id="${dartEsc(n.id)}"><span class="notif-icon"><i class="${dartNotificationIcon(cat)}"></i></span><div class="notif-main"><div class="notif-title">${dartEsc(n.title)}</div><small>${dartEsc(n.message)}</small></div><time>${dartEsc(new Date(n.timestamp).toLocaleString())}</time></div>`;
      })
      .join("") || '<div class="dart-empty-state">No updates yet</div>';
  if (!feed.dataset.dartBound) {
    feed.dataset.dartBound = "1";
    feed.addEventListener("click", (e) => {
      const el = e.target.closest("[data-notification-id]");
      if (!el) return;
      const n = notificationData.find(
        (x) => x.id === el.dataset.notificationId,
      );
      if (!n) return;
      n.read = true;
      dartSaveAll();
      renderNotifications();
      if (n.relatedEntityType && document.getElementById(n.relatedEntityType)) {
        document
          .querySelector(`[data-target="${n.relatedEntityType}"]`)
          ?.click();
        setTimeout(
          () =>
            document
              .querySelector(
                `#${n.relatedEntityType} .model-row[data-id="${CSS.escape(n.relatedEntityId)}"]`,
              )
              ?.scrollIntoView({ behavior: "smooth", block: "center" }),
          50,
        );
      }
    });
  }
  const f = document.getElementById("notificationFilter");
  if (f && !f.dataset.dartBound) {
    f.dataset.dartBound = "1";
    f.addEventListener("change", renderNotifications);
  }
}

function dartCairoCalendar(reference = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(reference)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}
function dartBirthdayMonthDay(value) {
  const text = String(value || "").trim(),
    yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/),
    dayFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (yearFirst)
    return { month: Number(yearFirst[2]), day: Number(yearFirst[3]) };
  if (dayFirst)
    return { month: Number(dayFirst[2]), day: Number(dayFirst[1]) };
  const parsed = dartDateValue(value);
  return parsed
    ? { month: parsed.getMonth() + 1, day: parsed.getDate() }
    : null;
}
function dartBirthdayMessageBatch(reference = new Date()) {
  const cairo = dartCairoCalendar(reference);
  const targetOffset = cairo.hour >= 20 ? 1 : 0;
  const targetDate = new Date(
      Date.UTC(cairo.year, cairo.month - 1, cairo.day + targetOffset),
    ),
    target = {
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
    },
    key = `${target.year}-${String(target.month).padStart(2, "0")}-${String(target.day).padStart(2, "0")}`,
    history = window.DartState?.read?.("dart_birthday_messages", []) || [],
    all = customersData.filter(dartIsActive).filter((customer) => {
      const birthday = dartBirthdayMonthDay(customer.birthday);
      return (
        birthday &&
        birthday.day === target.day &&
        birthday.month === target.month
      );
    }),
    sent = new Set(
      history
        .filter((row) => row.birthdayDate === key)
        .flatMap((row) => [String(row.customerRecordId || ""), String(row.clientId || "")]),
    ),
    rows = all.filter(
      (customer) =>
        !sent.has(String(customer.id)) && !sent.has(String(customer.clientId)),
    );
  return { open: true, key, target, all, rows };
}
function renderBirthdayWidget() {
  const feed = document.getElementById("birthday-feed");
  if (!feed) return;
  const batch = dartBirthdayMessageBatch(),
    rows = batch.rows,
    label = document.getElementById("birthdayWindowLabel"),
    send = document.getElementById("sendBdayBtn");
  if (label)
    label.textContent = `Birthday messages for ${batch.key} · unsent only · refreshes at 8:00 PM Cairo`;
  if (!batch.all.length)
    feed.innerHTML =
      '<div class="dart-empty-state">No customer birthdays in the current message list.</div>';
  else if (!rows.length)
    feed.innerHTML =
      '<div class="dart-empty-state dart-birthday-all-sent">All birthday messages in this list have been queued.</div>';
  else
    feed.innerHTML = rows
      .map(
        (c) =>
          `<div class="bday-item overflow" data-client-id="${dartEsc(c.id)}" data-birthday-date="${dartEsc(batch.key)}"><input type="checkbox" class="bday-checkbox"><span class="bday-date w100">${dartEsc(c.birthday)}</span><span class="bday-name w150">${dartEsc(c.clientName)}</span><span class="bday-age w100">${dartEsc(dartClientAgeLabel(c.birthday))}</span><span class="bday-phone w100">${dartEsc(c.phone1)}</span><span class="orders w100">${dartCurrentMonthlyOrders(c.clientId)} Order</span><span class="from w100">${dartEsc(c.governorate || c.country || "-")}</span></div>`,
      )
      .join("");
  if (send) send.disabled = !rows.length;
  const master = document.getElementById("selectAllBirthdays");
  if (master) {
    master.disabled = !rows.length;
    master.checked = false;
    master.indeterminate = false;
    const boxes = [...feed.querySelectorAll(".bday-checkbox")];
    master.onchange = () => boxes.forEach((b) => (b.checked = master.checked));
    feed.onchange = () => {
      const checked = boxes.filter((b) => b.checked).length;
      master.checked = boxes.length > 0 && checked === boxes.length;
      master.indeterminate = checked > 0 && checked < boxes.length;
    };
  }
}

/* BEGIN Brand — birthday message queue action */
function setupBirthdayMessageActions() {
  const send = document.getElementById("sendBdayBtn");
  if (!send || send.dataset.dartBirthdayBound) return;
  send.dataset.dartBirthdayBound = "1";

  send.addEventListener("click", async () => {
    const selected = [...document.querySelectorAll("#birthday-feed .bday-checkbox:checked")]
      .map((box) => box.closest("[data-client-id]"))
      .filter(Boolean);
    if (!selected.length) {
      window.DartDialog.alert("Select at least one customer.");
      return;
    }

    const queue = structuredClone(
      window.DartState?.read?.("dart_message_queue", []) || [],
    );
    const history = structuredClone(
      window.DartState?.read?.("dart_birthday_messages", []) || [],
    );
    const birthdayDiscountPercent = Math.max(
      0,
      Math.min(
        100,
        Number(window.DartSiteSettings?.get?.().birthdayDiscountPercent) || 30,
      ),
    );

    selected.forEach((row, index) => {
      const recordId = row.dataset.clientId;
      const birthdayDate = row.dataset.birthdayDate;
      const customer = customersData.find(
        (item) => String(item.id) === String(recordId),
      );
      const alreadyQueued = history.some(
        (item) =>
          item.birthdayDate === birthdayDate &&
          (String(item.customerRecordId) === String(recordId) ||
            String(item.clientId) === String(customer?.clientId)),
      );
      if (!customer || alreadyQueued) return;

      const messageId = `BDAY-${birthdayDate}-${customer.clientId}`;
      queue.unshift({
        id: `${messageId}-${Date.now()}-${index}`,
        messageKey: messageId,
        customerId: customer.clientId,
        customerName: customer.clientName,
        phone: customer.phone1,
        birthdayDate,
        type: "birthday-discount",
        discountPercent: birthdayDiscountPercent,
        rewardDays: 7,
        status: "Pending API",
        createdAt: new Date().toISOString(),
      });
      history.unshift({
        id: messageId,
        customerRecordId: recordId,
        clientId: customer.clientId,
        birthdayDate,
        queuedAt: new Date().toISOString(),
        status: "Queued for Backend",
      });
    });

    if (!window.DartDomainState?.write) {
      window.DartDialog.alert("Birthday messaging requires the secure server state.");
      return;
    }

    window.DartDomainState.write("dart_message_queue", queue);
    window.DartDomainState.write("dart_birthday_messages", history);
    await Promise.all([
      window.DartDomainState.syncDomain?.("message_queue"),
      window.DartDomainState.syncDomain?.("birthday_messages"),
    ]);
    renderBirthdayWidget();
    window.DartDialog.alert(
      `Birthday discount messages (${birthdayDiscountPercent}%) were queued for backend delivery.`,
    );
  });
}
/* END Brand — birthday message queue action */

function renderTopClients() {
  const feed = document.getElementById("top-clients-feed");
  if (!feed) return;

  // BEGIN Exclusive month/year filters. Both None falls back to This Month.
  const monthFilter = document.getElementById("topClientsMonthFilter");
  const yearFilter = document.getElementById("topClientsYearFilter");
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const deliveredDates = ordersData
    .filter((order) => order.status === "Delivered")
    .map((order) => new Date(order.deliveredAt || order.createdAt || 0))
    .filter((date) => !Number.isNaN(date.getTime()));
  const registeredDates = customersData
    .map((customer) => new Date(customer.registeredAt || 0))
    .filter(
      (date) => !Number.isNaN(date.getTime()) && date.getFullYear() > 2000,
    );
  const firstBusinessDate =
    [...deliveredDates, ...registeredDates].sort((a, b) => a - b)[0] || now;
  const monthKeys = [];
  for (
    let cursor = new Date(
      firstBusinessDate.getFullYear(),
      firstBusinessDate.getMonth(),
      1,
    );
    cursor <= new Date(now.getFullYear(), now.getMonth(), 1);
    cursor.setMonth(cursor.getMonth() + 1)
  )
    monthKeys.unshift(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    );
  const years = Array.from(
    { length: now.getFullYear() - firstBusinessDate.getFullYear() + 1 },
    (_, index) => now.getFullYear() - index,
  );

  if (monthFilter && !monthFilter.dataset.optionsReady) {
    monthFilter.dataset.optionsReady = "1";
  }
  if (monthFilter) {
    const previous = monthFilter.value || "current";
    monthFilter.innerHTML =
      '<option value="current">This Month</option><option value="none">None</option>' +
      monthKeys
        .filter((key) => key !== currentMonth)
        .map((key) => {
          const [year, month] = key.split("-").map(Number);
          const label = new Intl.DateTimeFormat("en", {
            month: "long",
            year: "numeric",
          }).format(new Date(year, month - 1, 1));
          return `<option value="${key}">${dartEsc(label)}</option>`;
        })
        .join("");
    monthFilter.value = [...monthFilter.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : "current";
  }
  if (yearFilter) {
    const previous = yearFilter.value || "none";
    yearFilter.innerHTML =
      '<option value="none">None</option>' +
      years.map((year) => `<option value="${year}">${year}</option>`).join("");
    yearFilter.value = [...yearFilter.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : "none";
  }
  if (monthFilter && yearFilter && !monthFilter.dataset.dartBound) {
    monthFilter.dataset.dartBound = "1";
    yearFilter.dataset.dartBound = "1";
    monthFilter.addEventListener("change", () => {
      if (monthFilter.value !== "none") yearFilter.value = "none";
      if (monthFilter.value === "none" && yearFilter.value === "none")
        monthFilter.value = "current";
      renderTopClients();
    });
    yearFilter.addEventListener("change", () => {
      if (yearFilter.value !== "none") monthFilter.value = "none";
      if (yearFilter.value === "none" && monthFilter.value === "none")
        monthFilter.value = "current";
      renderTopClients();
    });
  }
  const selectedYear = yearFilter?.value || "none";
  const selectedMonth =
    monthFilter?.value === "current"
      ? currentMonth
      : monthFilter?.value || "current";
  // END Exclusive period filters.

  const rows = customersData
    .filter(dartIsActive)
    .map((c) => {
      const eligible = ordersData.filter((order) => {
        if (order.status !== "Delivered" || order.clientId !== c.clientId)
          return false;
        const date = new Date(order.deliveredAt || order.createdAt || 0);
        if (Number.isNaN(date.getTime())) return false;
        if (selectedYear !== "none")
          return date.getFullYear() === Number(selectedYear);
        return (
          `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` ===
          selectedMonth
        );
      });
      return {
        c,
        s: {
          delivered: eligible.length,
          spent: eligible.reduce(
            (sum, order) =>
              sum +
              Math.max(
                0,
                dartOrderNet(order) - (Number(order.amountRefunded) || 0),
              ),
            0,
          ),
        },
      };
    })
    .filter(({ s }) => s.delivered > 0)
    .sort((a, b) => b.s.delivered - a.s.delivered || b.s.spent - a.s.spent)
    .slice(0, 100);
  feed.innerHTML =
    rows
      .map(
        ({ c, s }, i) =>
          `<div class="bday-item overflow"><span class="bday-num">${i + 1})</span><span class="bday-date w100">${dartEsc(c.birthday || "-")}</span><span class="bday-age w100">${dartEsc(dartClientAgeLabel(c.birthday))}</span><span class="bday-name w150">${dartEsc(c.clientName)}</span><span class="bday-id w100">${dartEsc(c.clientId)}</span><span class="bday-phone w100">${dartEsc(c.phone1)}</span><span class="bday-orders w100">${s.delivered} Order</span><span class="bday-amount w150">${dartMoney(s.spent)}</span><span class="bday-from w100">${dartEsc(c.governorate || c.country || "-")}</span></div>`,
      )
      .join("") ||
    '<div class="dart-empty-state">No delivered orders in this period</div>';
}


function dartInStockSellingValue() {
  return itemsData
    .filter(
      (i) => dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
    )
    .reduce((a, i) => {
      const m = dartFindModelByCode(i.modelId);
      return a + (Number(m?.discountedPrice ?? m?.selling) || 0);
    }, 0);
}
function dartDamageLoss() {
  return itemsData
    .filter((i) => ["Damaged", "Destroyed"].includes(i.status))
    .reduce((a, i) => {
      const m = dartFindModelByCode(i.modelId);
      return a + (Number(m?.cost) || 0);
    }, 0);
}
function dartInfoButton(title, text) {
  return `<button type="button" class="dart-info-btn" data-info-title="${dartEsc(title)}" data-info-text="${dartEsc(text)}" title="Info"><i class="fa-solid fa-info"></i></button>`;
}
function updateBrandAnalytics() {
  const delivered = ordersData.filter((o) => o.status === "Delivered"),
    revenue = delivered.reduce(
      (a, o) =>
        a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
      0,
    ),
    totalCost = dartTotalInventoryCost(),
    stockSell = dartInStockSellingValue(),
    damageLoss = dartDamageLoss(),
    soldCost = delivered
      .flatMap((o) => o.priceSnapshot || [])
      .reduce(
        (a, l) => a + (Number(l.costSnapshot) || 0) * (Number(l.qty) || 1),
        0,
      ),
    profit = revenue - soldCost - damageLoss;
  const set = (sel, v) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = v;
  };
  set(
    "#brand .customar-card .numebr",
    customersData.filter(dartIsActive).length,
  );
  set("#brand .orders-card .numebr", ordersData.length);
  set(
    "#brand .stock-card .numebr",
    itemsData.filter(
      (i) => dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
    ).length,
  );
  set(
    "#brand .sold-card .numebr",
    itemsData.filter((i) => i.status === "Sold").length,
  );
  set("#brand .sales-cont .sales", dartMoney(revenue));
  set("#brand .cost-cont .sales", dartMoney(totalCost));
  set("#brand .profit-cont .sales", dartMoney(profit));
  const successfulLines = delivered.flatMap((o) => o.priceSnapshot || []),
    aov = delivered.length ? revenue / delivered.length : 0,
    margin = revenue ? (profit / revenue) * 100 : 0,
    deliveryRate = ordersData.length
      ? (delivered.length / ordersData.length) * 100
      : 0,
    refusalRate = ordersData.length
      ? (ordersData.filter((o) => o.status === "Refused").length /
          ordersData.length) *
        100
      : 0,
    returnRate = successfulLines.length
      ? (returnsData.filter((r) => r.isPostDeliveryReturn).length /
          successfulLines.length) *
        100
      : 0,
    topModel = dartTopBy(successfulLines.map((l) => l.modelCode)),
    topColor = dartTopBy(successfulLines.map((l) => l.color)),
    topSize = dartTopBy(successfulLines.map((l) => l.size));
  const cards = [
    [
      "In Stock Selling Value",
      dartMoney(stockSell),
      "Total current selling value of active In Stock physical items",
      "fa-solid fa-tags",
    ],
    [
      "Damage Loss",
      dartMoney(damageLoss),
      "Cost value of Damaged and Destroyed physical items",
      "fa-solid fa-triangle-exclamation",
    ],
    [
      "Gross Margin",
      `${margin.toFixed(1)}%`,
      "Net profit after sold cost and damage loss divided by sales",
      "fa-solid fa-percent",
    ],
    [
      "AOV",
      dartMoney(aov),
      "Average value of Delivered orders",
      "fa-solid fa-receipt",
    ],
    [
      "Delivery Rate",
      `${deliveryRate.toFixed(1)}%`,
      "Delivered orders ÷ all orders",
      "fa-solid fa-truck-fast",
    ],
    [
      "Refusal Rate",
      `${refusalRate.toFixed(1)}%`,
      "Refused orders ÷ all orders",
      "fa-solid fa-ban",
    ],
    [
      "Return Rate",
      `${returnRate.toFixed(1)}%`,
      "Post-delivery returned items ÷ sold items",
      "fa-solid fa-rotate-left",
    ],
    [
      "Top Model",
      topModel[0],
      `${topModel[1]} sold item(s)`,
      "fa-solid fa-shirt",
    ],
    [
      "Top Color",
      topColor[0],
      `${topColor[1]} sold item(s)`,
      "fa-solid fa-palette",
    ],
    ["Top Size", topSize[0], `${topSize[1]} sold item(s)`, "fa-solid fa-ruler"],
    [
      "Low Stock",
      String(
        modelsData.filter(dartIsActive).filter((m) => {
          const n = dartModelDerived(m).count;
          return n > 0 && n <= DART_LOW_STOCK_THRESHOLD;
        }).length,
      ),
      "Models at 5 or fewer available items",
      "fa-solid fa-boxes-stacked",
    ],
    [
      "Dead Stock",
      String(dartDeadStockItems().length),
      "In Stock items unsold for 60+ days",
      "fa-solid fa-clock",
    ],
  ];
  const grid = dartEnsureAnalyticsGrid();
  // Analytics card markup is static in Dart Eye.html; dart-finance.js updates it by ID.
  if (grid) grid.dataset.dartMetricsMarkup = "static";
  document
    .querySelectorAll(
      "#brand .card-inf-2,#brand .sales-cont,#brand .cost-cont,#brand .profit-cont",
    )
    .forEach((el, i) => {
      if (!el.querySelector(".dart-info-btn"))
        el.insertAdjacentHTML(
          "afterbegin",
          dartInfoButton(
            el.querySelector("h5,h4")?.textContent || "Metric",
            [
              "Live value calculated from connected dashboard data.",
              "Total orders currently stored.",
              "Customer rating based on Review data.",
              "Physical items currently available.",
              "Physical items successfully sold.",
              "Net Delivered order sales after refunds.",
              "Total cost price of all physical items in the system.",
              "Sales minus sold cost and damage loss.",
            ][i] || "Live dashboard metric.",
          ),
        );
    });
  try {
    if (typeof updateChart === "function") updateChart();
  } catch (err) {
    console.warn("Dart sales chart update skipped:", err);
  }
  renderBirthdayWidget();
  if (!window.dartBirthdayWidgetTimer)
    window.dartBirthdayWidgetTimer = setInterval(renderBirthdayWidget, 30000);
  renderTopClients();
  dartCheckStockAlerts();
}

function setupModelModal() {
  return DartInventory.setupModelModal();
}

/* BEGIN Clients — identity normalization and duplicate guard */
function dartNormalizeCustomerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function dartNormalizeCustomerPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("20") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("01") && digits.length === 11) return `+2${digits}`;
  return digits ? `+${digits}` : "";
}

function dartCustomerConflict(payload, editId = "") {
  const wantedEmail = dartNormalizeCustomerEmail(payload?.email);
  const wantedPhones = [payload?.phone1, payload?.phone2]
    .map(dartNormalizeCustomerPhone)
    .filter(Boolean);

  return customersData.find((customer) => {
    if (String(customer.id) === String(editId || "")) return false;
    const sameEmail =
      wantedEmail &&
      dartNormalizeCustomerEmail(customer.email) === wantedEmail;
    const currentPhones = [customer.phone1, customer.phone2]
      .map(dartNormalizeCustomerPhone)
      .filter(Boolean);
    return sameEmail || wantedPhones.some((phone) => currentPhones.includes(phone));
  }) || null;
}
/* END Clients — identity normalization and duplicate guard */

function setupCustomerModal() {
  const modal = document.getElementById("customerModal"),
    form = document.getElementById("customerForm");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";
  document
    .getElementById("openCustomerModalBtn")
    ?.addEventListener("click", () => {
      form.reset();
      document.getElementById("modal-customer-edit-id").value = "";
      document.getElementById("custCountry").value = "Egypt";
      openModal(modal);
    });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("modal-customer-edit-id").value,
      p = {
        clientName: document.getElementById("custName").value.trim(),
        birthday: document.getElementById("custBirthday").value || "-",
        phone1: document.getElementById("custPhone1").value.trim(),
        phone2: document.getElementById("custPhone2").value.trim() || "-",
        email: document.getElementById("custEmail").value.trim(),
        country: document.getElementById("custCountry").value || "Egypt",
        governorate: document.getElementById("custGovernorate").value || "",
      };

    if (dartCustomerConflict(p, id)) {
      window.DartDialog.alert("Email or phone is already registered.");
      return;
    }

    if (id) {
      const x = customersData.find((customer) => String(customer.id) === String(id));
      if (!x) return;
      const oldValues = { ...x };

      if (x.serverAuthoritative) {
        if (!window.DartAdminApi?.request) {
          window.DartDialog.alert("Secure admin API is unavailable.");
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/customers/${encodeURIComponent(x.id)}`,
            {
              method: "PATCH",
              body: {
                name: p.clientName,
                email: p.email,
                phone1: p.phone1,
                ...(p.phone2 && p.phone2 !== "-" ? { phone2: p.phone2 } : {}),
                birthday: p.birthday && p.birthday !== "-" ? p.birthday : null,
                dartCardDrawEligible: x.dartCardDrawEligible !== false,
              },
            },
          );
        } catch (error) {
          window.DartDialog.alert(error.message || "Customer update failed.");
          return;
        }
      }

      Object.assign(x, p);
      dartAudit("EDIT", "customers", x.id, oldValues, p);

      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_customers", customersData);
        if (window.DartDomainState.syncDomain) {
          try {
            await window.DartDomainState.syncDomain("customers");
          } catch (error) {
            console.warn("Customer CRM state sync failed", error);
          }
        }
        if (x.serverAuthoritative && window.DartDomainState.hydrateDomain) {
          await window.DartDomainState.hydrateDomain("customers", true);
        }
      } else {
        dartSaveAll();
      }
    } else {
      const x = {
        id: dartUid("CDB"),
        clientId: dartNextBusinessCode("DA", customersData, "clientId"),
        dartCard: "no",
        serverAuthoritative: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        registeredAt: dartNowISO(),
        ...p,
      };
      customersData.push(x);
      dartAudit("CREATE", "customers", x.id, {}, x);
      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_customers", customersData);
      } else {
        dartSaveAll();
      }
    }

    dartRefreshAll();
    closeModal(modal);
  });
}
async function dartHashSensitiveValue(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function setupRepresentativeModal() {
  if (window.DartOperations?.active) return;
  const modal = document.getElementById("representative-modal"),
    form = document.getElementById("rep-form");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";

  document.getElementById("openRepModalBtn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-rep-id").value = "";
    const field = document.getElementById("modal-representative-id");
    if (field) {
      field.value = dartNextBusinessCode("Rep", representativeData, "repId");
      field.readOnly = false;
    }
    const nationalIdInput = document.getElementById("modal-representative-national-id");
    if (nationalIdInput) {
      nationalIdInput.value = "";
      nationalIdInput.readOnly = false;
      nationalIdInput.placeholder = "14-digit national ID";
    }
    openModal(modal);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("modal-rep-id").value;
    const existing = id
      ? representativeData.find((r) => String(r.id) === String(id))
      : null;
    const serverAuthoritative = Boolean(existing?.serverAuthoritative);
    const rawNationalId = document
      .getElementById("modal-representative-national-id")
      .value.trim();

    if (serverAuthoritative && rawNationalId) {
      window.DartDialog.alert("لا يمكن تغيير الرقم القومي للحساب المسجل من هذا المحرر.");
      return;
    }
    if (!serverAuthoritative && rawNationalId && !/^\d{14}$/.test(rawNationalId)) {
      window.DartDialog.alert("الرقم القومي يجب أن يكون 14 رقمًا.");
      return;
    }

    const requestedRepId =
      document.getElementById("modal-representative-id").value.trim();
    if (
      serverAuthoritative &&
      requestedRepId &&
      requestedRepId !== String(existing.repId || "")
    ) {
      window.DartDialog.alert("Rep ID للحساب المسجل ثابت ولا يمكن تغييره.");
      return;
    }

    const nationalIdHash = rawNationalId
      ? await dartHashSensitiveValue(rawNationalId)
      : existing?.nationalIdHash || "";
    const nationalIdLast4 = rawNationalId
      ? rawNationalId.slice(-4)
      : existing?.nationalIdLast4 || "";

    const p = {
      name: document.getElementById("modal-representative-name").value.trim(),
      repId: serverAuthoritative
        ? existing.repId
        : id
          ? requestedRepId
          : dartNextBusinessCode("Rep", representativeData, "repId"),
      nationalIdHash,
      nationalIdLast4,
      address: document.getElementById("modal-representative-address").value.trim(),
      phone1: document.getElementById("modal-rep-phone1").value.trim(),
      phone2: document.getElementById("modal-rep-phone2").value.trim() || "-",
      status: existing?.status || "Active",
    };

    if (
      representativeData.some(
        (r) => r.repId === p.repId && String(r.id) !== String(id),
      )
    ) {
      window.DartDialog.alert("Rep ID مستخدم بالفعل.");
      return;
    }

    if (existing) {
      const old = { ...existing };

      if (serverAuthoritative) {
        if (!window.DartAdminApi?.request) {
          window.DartDialog.alert("Secure admin API is unavailable.");
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/representatives/${encodeURIComponent(existing.id)}`,
            {
              method: "PATCH",
              body: {
                name: p.name,
                email: existing.email,
                phone1: p.phone1,
                ...(p.phone2 && p.phone2 !== "-" ? { phone2: p.phone2 } : {}),
                address: p.address,
              },
            },
          );
        } catch (error) {
          window.DartDialog.alert(error.message || "Representative update failed.");
          return;
        }
      }

      Object.assign(existing, p);
      dartAudit("EDIT", "representative", existing.id, old, p);

      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_representatives", representativeData);
        if (window.DartDomainState.syncDomain) {
          try {
            await window.DartDomainState.syncDomain("representatives");
          } catch (error) {
            console.warn("Representative CRM state sync failed", error);
          }
        }
        if (serverAuthoritative && window.DartDomainState.hydrateDomain) {
          await window.DartDomainState.hydrateDomain("representatives", true);
        }
      } else {
        dartSaveAll();
      }
    } else {
      const x = {
        id: dartUid("RDB"),
        date: new Date().toLocaleDateString("en-GB"),
        serverAuthoritative: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      representativeData.push(x);
      dartAudit("CREATE", "representative", x.id, {}, x);
      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_representatives", representativeData);
      } else {
        dartSaveAll();
      }
    }

    dartRefreshAll();
    closeModal(modal);
  });
}
function setupReviewModal() {
  const modal = document.getElementById("customer-review-modal"),
    form = document.getElementById("customer-review-form");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  document
    .getElementById("openReviewModalBtn")
    ?.addEventListener("click", () => {
      form.reset();
      document.getElementById("modal-review-edit-id").value = "";
      openModal(modal);
    });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("modal-review-edit-id").value,
      name = document.getElementById("modal-cust-rev-name").value,
      client = customersData.find((c) => c.clientName === name) || null,
      p = {
        clientName: name,
        clientId: client?.clientId || "",
        rating: document.getElementById("modal-cust-rating").value || "5",
        phone1:
          document.getElementById("modal-cust-rev-phone1").value ||
          client?.phone1 ||
          "",
        review: document.getElementById("modal-cust-review").value || "",
        phone2:
          document.getElementById("modal-cust-rev-phone2").value ||
          client?.phone2 ||
          "-",
        title: document.getElementById("modal-cust-title").value || "",
        email:
          document.getElementById("modal-cust-rev-email").value ||
          client?.email ||
          "",
        status: document.getElementById("modal-cust-status").value || "Active",
      };
    if (id) {
      const r = reviewsData.find((x) => String(x.id) === String(id)),
        old = { ...r };
      Object.assign(r, p);
      dartAudit("EDIT", "review", r.id, old, p);
    } else {
      const r = {
        id: dartUid("REVDB"),
        createdAt: dartNowISO(),
        date: new Date().toLocaleString(),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      reviewsData.push(r);
      dartAudit("CREATE", "review", r.id, {}, r);
    }
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
  });
}

function openEditModal(id, sectionKey) {
  if (sectionKey === "models" || sectionKey === "items")
    return DartInventory.openEditor(id, sectionKey);
  const info = sectionsMap[sectionKey],
    x = info?.data.find((v) => String(v.id) === String(id));
  if (!x) return;
  if (sectionKey === "review") {
    document.getElementById("modal-review-edit-id").value = x.id;
    document.getElementById("modal-cust-rev-name").value = x.clientName || "";
    document.getElementById("modal-cust-rating").value = x.rating || "5";
    document.getElementById("modal-cust-rev-phone1").value = x.phone1 || "";
    document.getElementById("modal-cust-review").value = x.review || "";
    document.getElementById("modal-cust-rev-phone2").value = x.phone2 || "";
    document.getElementById("modal-cust-title").value = x.title || "";
    document.getElementById("modal-cust-rev-email").value = x.email || "";
    document.getElementById("modal-cust-status").value = x.status || "Active";
    openModal(document.getElementById("customer-review-modal"));
    return;
  }
  if (sectionKey === "models") {
    document.getElementById("modal-edit-id").value = x.id;
    document.getElementById("modal-id").value = x.modelId || "";
    document.getElementById("modal-name").value = x.name || "";
    document.getElementById("modal-category").value = x.category || "";
    document.getElementById("modal-description").value = x.description || "";
    document.getElementById("modal-cost").value = x.cost || 0;
    document.getElementById("modal-selling").value = x.selling || 0;
    document.getElementById("modal-discount").value = x.discount || 0;
    document.getElementById("modal-final-price").textContent = dartMoney(
      x.discountedPrice ?? x.selling,
    );
    openModal(document.getElementById("model-modal"));
    return;
  }
  if (sectionKey === "items") {
    document.getElementById("modal-item-add-edit-id").value = x.id;
    document.getElementById("modal-item-model-id").value = x.modelId || "";
    document.getElementById("modal-item-code-pic").value = x.itemCode || "";
    document.getElementById("modal-item-color").value = x.color || "";
    document.getElementById("modal-item-size").value = x.size || "";
    openModal(document.getElementById("item-add-modal"));
    return;
  }
  if (sectionKey === "customers") {
    document.getElementById("modal-customer-edit-id").value = x.id;
    document.getElementById("custName").value = x.clientName || "";
    document.getElementById("custBirthday").value = x.birthday || "";
    document.getElementById("custPhone1").value = x.phone1 || "";
    document.getElementById("custPhone2").value = x.phone2 || "";
    document.getElementById("custEmail").value = x.email || "";
    document.getElementById("custCountry").value = x.country || "Egypt";
    document.getElementById("custGovernorate").value = x.governorate || "Cairo";
    openModal(document.getElementById("customerModal"));
    return;
  }
  if (sectionKey === "returns") {
    document.getElementById("modal-return-edit-id").value = x.id;
    document.getElementById("modal-return-name").value = x.clientName || "";
    document.getElementById("modal-return-item-code").value = x.itemCode || "";
    document.getElementById("modal-return-phone1").value = x.phone1 || "";
    document.getElementById("modal-return-model-id").value = x.modelId || "";
    document.getElementById("modal-return-phone2").value = x.phone2 || "";
    document.getElementById("modal-return-email").value = x.email || "";
    document.getElementById("modal-item-condition").value = [
      "Good",
      "Bad",
    ].includes(x.status)
      ? x.status
      : "Good";
    document.getElementById("modal-item-reason").value = x.reason || "سبب آخر";
    if (document.getElementById("modal-return-refund"))
      document.getElementById("modal-return-refund").value =
        x.refundAmount || 0;
    openModal(document.getElementById("return-modal"));
    return;
  }
  if (sectionKey === "card") {
    window.dartOpenCardEditor?.(x);
    return;
  }
  if (sectionKey === "representative") {
    document.getElementById("modal-rep-id").value = x.id;
    document.getElementById("modal-representative-name").value = x.name || "";
    const repIdInput = document.getElementById("modal-representative-id");
    repIdInput.value = x.repId || "";
    repIdInput.readOnly = Boolean(x.serverAuthoritative);
    const nationalIdInput = document.getElementById("modal-representative-national-id");
    nationalIdInput.value = "";
    nationalIdInput.readOnly = Boolean(x.serverAuthoritative);
    nationalIdInput.placeholder = x.nationalIdLast4
      ? `••••••••••${x.nationalIdLast4}`
      : "14-digit national ID";
    document.getElementById("modal-representative-address").value =
      x.address || "";
    document.getElementById("modal-rep-phone1").value = x.phone1 || "";
    document.getElementById("modal-rep-phone2").value = x.phone2 || "";
    openModal(document.getElementById("representative-modal"));
    return;
  }
  if (sectionKey === "orders") {
    document.getElementById("modal-order-edit-id").value = x.id;
    document.getElementById("clientName").value = x.clientName || "";
    document.getElementById("clientId").value = x.clientId || "";
    document.getElementById("phone1").value = x.phone1 || "";
    document.getElementById("phone2").value = x.phone2 || "";
    document.getElementById("email").value = x.email || "";
    document.getElementById("paymentMethod").value = x.paymentMethod || "";
    document.getElementById("paymentStatus").value =
      x.paymentStatus || "Unpaid";
    document.getElementById("amountPaid").value = x.amountPaid || 0;
    document.getElementById("amountRefunded").value = x.amountRefunded || 0;
    document.getElementById("orderSource").value = x.orderSource || "Manual";
    document.getElementById("deliveryNotes").value = x.deliveryNotes || "";
    document.getElementById("orderCountry").value = x.country || "";
    document.getElementById("governorate").value = x.governorate || "";
    document.getElementById("orderArea").value = x.area || "";
    document.getElementById("orderStreetName").value = x.street || "";
    document.getElementById("orderBuildingNumber").value = x.building || "";
    document.getElementById("orderFloor").value = x.floor || "";
    document.getElementById("deductions").value = x.discount || 0;
    window.loadOrderItemsForEdit?.(x.items || []);
    openModal(document.getElementById("orderModal"));
    return;
  }
  if (sectionKey === "damage") {
    document.getElementById("damage-edit-id").value = x.id;
    document.getElementById("damage-item-code").value = x.itemCode || "";
    document.getElementById("damage-reason").value = x.reason || "";
    document.getElementById("damage-notes").value = x.notes || "";
    document.getElementById("damage-status").value = x.status || "Damaged";
    openModal(document.getElementById("damage-modal"));
  }
}

function setupPasswordResetRequests() {
  const openButton = document.getElementById("openPasswordRequestsBtn");
  if (openButton && !openButton.dataset.dartBound) {
    openButton.dataset.dartBound = "1";
    openButton.addEventListener("click", async () => {
      try {
        await dartLoadPasswordResetRequests(true);
      } catch (error) {
        window.DartDialog.alert(error.message || "Could not load password reset requests.");
      }
    });
  }

  const list = document.getElementById("password-requests-list");
  if (list && !list.dataset.dartBound) {
    list.dataset.dartBound = "1";
    list.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-request-id]");
      if (!row) return;
      const requestId = row.dataset.requestId;

      if (event.target.closest(".dart-cancel-reset-request")) {
        if (!await window.DartDialog.confirm("Cancel this password reset request?")) return;
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/password-reset-requests/${encodeURIComponent(requestId)}/cancel`,
            { method: "POST" },
          );
          await dartLoadPasswordResetRequests(false);
        } catch (error) {
          window.DartDialog.alert(error.message || "Could not cancel the request.");
        }
        return;
      }

      if (event.target.closest(".dart-set-temporary-password")) {
        const input = row.querySelector("[data-temporary-password]");
        const temporaryPassword = String(input?.value || "");
        if (temporaryPassword.length < 12) {
          window.DartDialog.alert("Temporary password must be at least 12 characters.");
          input?.focus();
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/password-reset-requests/${encodeURIComponent(requestId)}/temporary-password`,
            {
              method: "POST",
              body: { temporaryPassword },
            },
          );
          if (input) input.value = "";
          await dartLoadPasswordResetRequests(false);
        } catch (error) {
          if (input) input.value = "";
          window.DartDialog.alert(error.message || "Could not set the temporary password.");
        }
      }
    });
  }

  // Password-reset requests are fetched on demand after authentication.
  // Do not call protected endpoints while the login/activation gate is visible.
}

function setupAllDelegatedEvents() {
  const map = {
    models: "models-container",
    items: "items-container",
    customers: "customers-container",
    orders: "orders-container",
    returns: "returns-container",
    review: "review-container",
    representative: "representative-container",
    card: "card-container",
    damage: "damage-container",
  };
  Object.entries(map).forEach(([k, id]) =>
    setupSectionEvents(id, sectionsMap[k]?.data, sectionsMap[k]?.render, k),
  );
  const orders = document.getElementById("orders-container");
  if (orders && !orders.dataset.dartV3Back) {
    orders.dataset.dartV3Back = "1";
    orders.addEventListener("click", async (e) => {
      const b = e.target.closest(".dart-back-btn");
      if (!b) return;
      const id = b.closest(".model-row")?.dataset.id,
        o = ordersData.find((x) => String(x.id) === String(id));
      if (!o) return;
      b.disabled = true;
      try {
        const result = await dartRollbackOrderOneStep(o);
        if (!result.ok && result.message !== "cancelled") {
          window.DartDialog.alert(result.message || "Order rollback failed.");
        }
      } finally {
        b.disabled = false;
      }
    });
  }
  const items = document.getElementById("items-container");
  if (items && !items.dataset.dartV3Img) {
    items.dataset.dartV3Img = "1";
    items.addEventListener("click", (e) => {
      const img = e.target.closest(".dart-item-thumb");
      if (!img) return;
      document.getElementById("full-item-image").src = img.dataset.fullImage;
      openModal(document.getElementById("image-preview-modal"));
    });
  }
  const reviews = document.getElementById("review-container");
  if (reviews && !reviews.dataset.dartV3Toggle) {
    reviews.dataset.dartV3Toggle = "1";
    reviews.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-toggle-review");
      if (!btn) return;
      const id = btn.closest(".model-row")?.dataset.id,
        r = reviewsData.find((x) => String(x.id) === String(id));
      if (!r) return;
      const old = r.status;
      r.status = old === "Active" ? "Hidden" : "Active";
      dartAudit(
        "REVIEW_VISIBILITY",
        "review",
        r.id,
        { status: old },
        { status: r.status },
      );
      dartSaveAll();
      dartRenderSection("review");
    });
  }
}

function setupOrderModal() {
  if (window.DartOperations?.active) return;
  const modal = document.getElementById("orderModal"),
    form = document.getElementById("orderForm");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";
  let selected = [];
  const list = document.getElementById("selectedProductsList"),
    codeInput = document.getElementById("productsInputCode");
  function renderSel() {
    if (list)
      list.innerHTML = selected
        .map(
          (code, i) =>
            `<span class="order-item-chip"><b>${dartEsc(code)}</b><button type="button" class="remove-item-btn" data-index="${i}">&times;</button></span>`,
        )
        .join("");
    calc();
  }
  function calc() {
    const snap = dartPriceSnapshotForCodes(selected),
      subtotal = snap.reduce((a, l) => a + l.finalUnitPrice, 0),
      pct = Number(document.getElementById("deductions")?.value) || 0,
      total = Math.max(0, subtotal - (subtotal * pct) / 100);
    document.getElementById("subtotalVal").textContent = dartMoney(subtotal);
    document.getElementById("discountVal").textContent = dartMoney(
      subtotal - total,
    );
    document.getElementById("totalVal").textContent = dartMoney(total);
    return { subtotal, pct, total, snap };
  }
  function populate() {
    const dl = document.getElementById("items-datalist");
    if (dl)
      dl.innerHTML = itemsData
        .filter(
          (i) =>
            dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
        )
        .map(
          (i) =>
            `<option value="${dartEsc(i.itemCode)}">${dartEsc(i.modelId)} - ${dartEsc(i.color)} (${dartEsc(i.size)})</option>`,
        )
        .join("");
    populateModelsDatalist();
  }
  document.getElementById("openModalBtn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-order-edit-id").value = "";
    selected = [];
    populate();
    renderSel();
    openModal(modal);
  });
  document.getElementById("addProductBtn")?.addEventListener("click", () => {
    const code = codeInput.value.trim(),
      it = dartFindItemByCode(code);
    if (
      !it ||
      dartIsArchived(it) ||
      String(it.status).toLowerCase() !== "in stock"
    ) {
      window.DartDialog.alert("القطعة غير متاحة.");
      return;
    }
    if (!selected.includes(code)) selected.push(code);
    codeInput.value = "";
    renderSel();
  });
  document
    .getElementById("autoAllocateProductBtn")
    ?.addEventListener("click", () => {
      const r = dartAutoAllocate(
        document.getElementById("orderModelCode").value.trim(),
        document.getElementById("orderItemColor").value.trim(),
        document.getElementById("orderItemSize").value.trim(),
        Math.max(1, Number(document.getElementById("orderItemQty").value) || 1),
        selected,
      );
      if (!r.ok) {
        window.DartDialog.alert(r.message);
        return;
      }
      selected.push(...r.codes);
      renderSel();
    });
  list?.addEventListener("click", (e) => {
    if (!e.target.classList.contains("remove-item-btn")) return;
    selected.splice(Number(e.target.dataset.index), 1);
    renderSel();
  });
  document.getElementById("deductions")?.addEventListener("input", calc);
  window.loadOrderItemsForEdit = (codes) => {
    selected = [...(codes || [])];
    populate();
    renderSel();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected.length) {
      window.DartDialog.alert("أضف قطعة واحدة على الأقل.");
      return;
    }
    const editId = document.getElementById("modal-order-edit-id").value,
      existing = ordersData.find((o) => String(o.id) === String(editId)),
      prices = calc(),
      selectedClientId = document.getElementById("clientId").value || "-",
      selectedClient = dartFindCustomerByCode(selectedClientId);
    if (selectedClient && dartIsArchived(selectedClient)) {
      window.DartDialog.alert("لا يمكن استخدام عميل مشطوب.");
      return;
    }
    const payload = {
      clientId: selectedClientId,
      clientName: document.getElementById("clientName").value,
      phone1: document.getElementById("phone1").value,
      phone2: document.getElementById("phone2").value || "-",
      email: document.getElementById("email").value || "-",
      paymentMethod:
        document.getElementById("paymentMethod").value || "Cash on Delivery",
      paymentStatus: document.getElementById("paymentStatus").value || "Unpaid",
      amountPaid: Number(document.getElementById("amountPaid").value) || 0,
      amountRefunded:
        Number(document.getElementById("amountRefunded").value) || 0,
      orderSource: document.getElementById("orderSource").value || "Manual",
      deliveryNotes: document.getElementById("deliveryNotes").value || "",
      items: [...selected],
      totalProducts: selected.length,
      totalPrice: prices.subtotal,
      discount: prices.pct,
      reasonDeduction: prices.pct ? "Order discount" : "-",
      country: document.getElementById("orderCountry").value || "Egypt",
      governorate: document.getElementById("governorate").value || "",
      area: document.getElementById("orderArea").value || "",
      street: document.getElementById("orderStreetName").value || "",
      building: document.getElementById("orderBuildingNumber").value || "",
      floor: document.getElementById("orderFloor").value || "",
    };

    if (!existing && window.DartOrdersApi?.createManual) {
      try {
        await window.DartOrdersApi.createManual({
          ...(selectedClientId && selectedClientId !== "-"
            ? { clientId: selectedClientId }
            : {}),
          clientName: payload.clientName,
          phone1: payload.phone1,
          ...(payload.phone2 && payload.phone2 !== "-" ? { phone2: payload.phone2 } : {}),
          ...(payload.email && payload.email !== "-" ? { email: payload.email } : {}),
          paymentMethod: payload.paymentMethod,
          paymentStatus: payload.paymentStatus,
          amountPaid: payload.amountPaid,
          amountRefunded: payload.amountRefunded,
          orderSource: payload.orderSource,
          deliveryNotes: payload.deliveryNotes,
          itemCodes: [...selected],
          discountPercent: prices.pct,
          country: payload.country,
          governorate: payload.governorate,
          area: payload.area,
          street: payload.street,
          building: payload.building,
          floor: payload.floor,
        });
        if (window.DartCatalog?.hydrate) await window.DartCatalog.hydrate(true);
        dartRefreshAll();
        closeModal(modal);
        form.reset();
        selected = [];
        renderSel();
        return;
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual order could not be created.");
        return;
      }
    }

    if (existing && window.DartOrdersApi?.updateManual) {
      try {
        await window.DartOrdersApi.updateManual(
          existing.orderId || existing.id,
          {
            ...(selectedClientId && selectedClientId !== "-"
              ? { clientId: selectedClientId }
              : {}),
            clientName: payload.clientName,
            phone1: payload.phone1,
            ...(payload.phone2 && payload.phone2 !== "-" ? { phone2: payload.phone2 } : {}),
            ...(payload.email && payload.email !== "-" ? { email: payload.email } : {}),
            paymentMethod: payload.paymentMethod,
            paymentStatus: payload.paymentStatus,
            amountPaid: payload.amountPaid,
            amountRefunded: payload.amountRefunded,
            orderSource: payload.orderSource,
            deliveryNotes: payload.deliveryNotes,
            itemCodes: [...selected],
            discountPercent: prices.pct,
            country: payload.country,
            governorate: payload.governorate,
            area: payload.area,
            street: payload.street,
            building: payload.building,
            floor: payload.floor,
          },
        );
        if (window.DartCatalog?.hydrate) await window.DartCatalog.hydrate(true);
        dartRefreshAll();
        closeModal(modal);
        form.reset();
        selected = [];
        renderSel();
        return;
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual order could not be updated.");
        return;
      }
    }

    if (existing) {
      const oldCodes = [...(existing.items || [])],
        newCodes = selected.filter((c) => !oldCodes.includes(c)),
        check = dartReserveItems(existing, newCodes);
      if (!check.ok) {
        window.DartDialog.alert(check.message);
        return;
      }
      oldCodes
        .filter((c) => !selected.includes(c))
        .forEach((c) => {
          const it = dartFindItemByCode(c);
          if (it && it.status === "Processing/Held") {
            it.status = "In stock";
            it.orderId = "";
          }
        });
      const old = { ...existing };
      Object.assign(existing, payload);
      existing.priceSnapshot = dartPriceSnapshotForCodes(selected);
      dartAudit("EDIT", "orders", existing.id, old, payload);
      dartLogOrder(existing, "ORDER_EDITED", existing.status, existing.status, {
        notes: "Order details edited",
      });
    } else {
      const order = {
        id: dartUid("ODB"),
        orderId: dartNextBusinessCode("K", ordersData, "orderId"),
        date: new Date().toLocaleDateString("en-GB"),
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: "New",
        createdAt: dartNowISO(),
        orderCreatedAt: dartNowISO(),
        activityLog: [],
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...payload,
      };
      const r = dartReserveItems(order, selected);
      if (!r.ok) {
        window.DartDialog.alert(r.message);
        return;
      }
      order.priceSnapshot = dartPriceSnapshotForCodes(selected);
      dartLogOrder(order, "ORDER_CREATED", null, "New");
      ordersData.push(order);
      dartAudit("CREATE", "orders", order.id, {}, order);
      dartNotify(
        "new_order",
        `New order ${order.orderId}`,
        `${order.clientName} — ${selected.length} item(s)`,
        "orders",
        order.id,
      );
    }
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
    form.reset();
    selected = [];
    renderSel();
  });
}

function setupSearchFilter() {
  document.querySelectorAll(".dashboard-section").forEach((sec) => {
    const key = sec.id;
    if (!sectionsMap[key]) return;
    dartFilterState[key] = dartFilterState[key] || { archive: "active" };
    const search = sec.querySelector(".search-box input,.search-bar input");
    if (search && !search.dataset.dartBound) {
      search.dataset.dartBound = "1";
      search.addEventListener("input", () => {
        dartFilterState[key].search = search.value.toLowerCase().trim();
        dartRenderSection(key);
      });
    }
    const selects = [...sec.querySelectorAll(".filter-bar select")],
      maps = {
        models: ["category", "status", "priceRange"],
        items: ["category", "status", "sizeProfile", "size", "color"],
        customers: ["monthlyOrders", "dartCard", "birthday"],
        orders: ["date", "status", "totalPrice"],
        returns: ["reason", "status"],
        review: ["rating", "status", "source"],
        representative: ["status"],
        card: ["status"],
        damage: ["status", "archive"],
      };
    (maps[key] || []).forEach((f, i) => {
      if (selects[i] && !selects[i].dataset.filterKey)
        selects[i].dataset.filterKey = f;
    });
    if (
      !selects.some((s) => s.dataset.filterKey === "archive") &&
      !["brand"].includes(key)
    ) {
      const wrap = document.createElement("div");
      wrap.className = "select-box";
      wrap.innerHTML =
        '<select data-filter-key="archive"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select><i class="bx bx-chevron-down arrow-icon"></i>';
      sec
        .querySelector(".filter-bar")
        ?.insertBefore(wrap, sec.querySelector(".filter-bar .add-btn"));
    }
    sec.querySelectorAll(".filter-bar select").forEach((sel) => {
      if (sel.dataset.dartBound) return;
      sel.dataset.dartBound = "1";
      sel.addEventListener("change", () => {
        const f = sel.dataset.filterKey;
        if (f) dartFilterState[key][f] = sel.value;
        if (key === "items" && f === "sizeProfile")
          dartPopulateItemSizeFilter(sel.value);
        dartRenderSection(key);
      });
    });
  });
  dartPopulateItemSizeFilter(
    document.getElementById("item-size-profile-filter")?.value || "all",
  );
}
function dartPopulateItemSizeFilter(profile) {
  const sel = document.getElementById("item-size-filter");
  if (!sel) return;
  const sizes =
    profile === "pants"
      ? DART_PANTS_SIZES
      : profile === "tops"
        ? DART_TOP_SIZES
        : [
            ...new Set([
              ...DART_PANTS_SIZES,
              ...DART_TOP_SIZES,
              ...itemsData.map((i) => String(i.size || "")).filter(Boolean),
            ]),
          ];
  const old = sel.value;
  sel.innerHTML =
    '<option value="all">All Sizes</option>' +
    sizes
      .map((s) => `<option value="${dartEsc(s)}">${dartEsc(s)}</option>`)
      .join("");
  if ([...sel.options].some((o) => o.value === old)) sel.value = old;
}

// Enhance Audit History to show what changed, not only the action name.
async function dartShowAuditFor(type, id) {
  const body = document.getElementById("history-modal-body");
  document.getElementById("history-modal-title").textContent =
    `Audit History — ${type}`;
  let rows = auditData.filter(
    (a) => a.entityType === type && String(a.entityId) === String(id),
  );
  if (window.DartDomainState?.auditFor) {
    try {
      rows = await window.DartDomainState.auditFor(type, id);
    } catch (error) {
      console.warn("Dart audit history request failed; using cached history.", error);
    }
  }
  body.innerHTML = `<div class="dart-timeline">${
    rows
      .map((a) => {
        const keys = [
          ...new Set([
            ...Object.keys(a.oldValues || {}),
            ...Object.keys(a.newValues || {}),
          ]),
        ].filter(
          (k) =>
            JSON.stringify(a.oldValues?.[k]) !==
            JSON.stringify(a.newValues?.[k]),
        );
        const changes = keys
          .map(
            (k) =>
              `<div><b>${dartEsc(k)}:</b> ${dartEsc(a.oldValues?.[k] ?? "-")} → ${dartEsc(a.newValues?.[k] ?? "-")}</div>`,
          )
          .join("");
        return `<div class="dart-timeline-item"><b>${dartEsc(a.action)}</b>${changes || `<div>${dartEsc(a.note || a.metadata?.message || "No field details")}</div>`}<small>${dartEsc(new Date(a.timestamp).toLocaleString())}</small></div>`;
      })
      .join("") || '<div class="dart-empty-state">No audit entries yet</div>'
  }</div>`;
  openModal(document.getElementById("history-modal"));
}

// V3 UI-only binding that does not depend on backend connectivity.
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".dart-info-btn");
    if (!b) return;
    window.DartDialog.alert(`${b.dataset.infoTitle}\n\n${b.dataset.infoText}`);
  });
  renderBirthdayWidget();
  renderTopClients();
  renderNotifications();
  updateBrandAnalytics();
});

// Keep the dashboard synchronized when a representative completes a delivery
// or return pickup in another browser tab.
window.addEventListener("storage", (event) => {
  if (
    ["dart_orders", "dart_returns", "dart_items", "dart_damage"].includes(
      event.key,
    )
  ) {
    loadAllDataFromStorage(false);
    dartRefreshAll();
  }
});

// Final V3 precision overrides.
function dartModelDerived(model) {
  const result = DartCatalog.groups(itemsData, modelsData, ordersData).filter(
    (g) => g.modelId === model.modelId,
  );
  return {
    count: result.reduce((n, g) => n + g.stock, 0),
    total: result.reduce((n, g) => n + g.total, 0),
    sold: result.reduce((n, g) => n + g.sold, 0),
    damaged: result.reduce((n, g) => n + g.damaged, 0),
    colors: DartCatalog.colors(model)
      .filter(DartCatalog.active)
      .map((c) => c.name),
    sizes: DartCatalog.sizes(model)
      .filter(DartCatalog.active)
      .map((s) => s.name),
    img: DartCatalog.cover(model),
  };
}
function dartSparkline(values) {
  const vals = values.map(Number),
    max = Math.max(1, ...vals),
    w = 120,
    h = 28,
    pts = vals
      .map(
        (v, i) =>
          `${((i / Math.max(1, vals.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`,
      )
      .join(" ");
  return `<svg class="dart-mini-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function dartLastSixMonthSeries(metric) {
  const now = new Date(),
    months = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1),
      y = d.getFullYear(),
      m = d.getMonth(),
      os = ordersData
        .filter((o) => o.status === "Delivered")
        .filter((o) => {
          const x = new Date(o.deliveredAt || o.createdAt || 0);
          return x.getFullYear() === y && x.getMonth() === m;
        });
    if (metric === "sales")
      months.push(
        os.reduce(
          (a, o) =>
            a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
          0,
        ),
      );
    else if (metric === "aov")
      months.push(
        os.length
          ? os.reduce(
              (a, o) =>
                a +
                Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
              0,
            ) / os.length
          : 0,
      );
    else {
      const ds = damageData.filter((x) => {
        const q = new Date(x.createdAt || dartDateValue(x.date) || 0);
        return (
          q.getFullYear() === y &&
          q.getMonth() === m &&
          ["Damaged", "Destroyed"].includes(x.status)
        );
      });
      months.push(
        ds.reduce((a, x) => {
          const it = dartFindItemByCode(x.itemCode),
            model = dartFindModelByCode(it?.modelId || x.modelId);
          return a + (Number(model?.cost) || 0);
        }, 0),
      );
    }
  }
  return months;
}
const dartUpdateBrandAnalyticsBase = updateBrandAnalytics;
updateBrandAnalytics = function () {
  dartUpdateBrandAnalyticsBase();
  const ratingCard = document.querySelectorAll("#brand .card-inf-2")[2];
  if (ratingCard) {
    const activeReviews = reviewsData.filter((r) => r.status === "Active"),
      avg = activeReviews.length
        ? activeReviews.reduce((a, r) => a + (Number(r.rating) || 0), 0) /
          activeReviews.length
        : 0;
    const n = ratingCard.querySelector(".numebr");
    if (n) n.textContent = avg.toFixed(1);
  }
  const grid = document.getElementById("dart-analytics-grid");
  if (grid) {
    const cards = [...grid.querySelectorAll(".dart-analytics-card")];
    const byTitle = (t) =>
      cards.find((c) => c.querySelector("h6")?.textContent === t);
    [
      ["In Stock Selling Value", "sales"],
      ["Damage Loss", "damage"],
      ["AOV", "aov"],
    ].forEach(([title, metric]) => {
      const c = byTitle(title);
      if (c && !c.querySelector(".dart-mini-chart"))
        c.insertAdjacentHTML(
          "beforeend",
          dartSparkline(dartLastSixMonthSeries(metric)),
        );
    });
  }
};

// Permanent monotonic counters: a business ID is never reused even after hard delete.
function dartNextBusinessCode(prefix, data, field) {
  const safePrefix = String(prefix || "").replace(/[^A-Za-z0-9_-]/g, "");
  const re = new RegExp("^" + safePrefix + "-(\\d+)$", "i");
  const existing = (data || []).reduce((max, row) => {
    const match = String(row?.[field] || "").match(re);
    return Math.max(max, match ? Number(match[1]) || 0 : 0);
  }, 0);
  return safePrefix + "-" + (existing + 1);
}

function dartCreateInspectionReturns(order, reason = "Refused delivery") {
  (order.items || []).forEach((code) => {
    const it = dartFindItemByCode(code);
    if (!it) return;
    it.status = "Return Inspection";
    const exists = returnsData.some(
      (r) =>
        r.orderId === order.orderId &&
        r.itemCode === code &&
        !r.isPostDeliveryReturn,
    );
    if (!exists)
      returnsData.push({
        id: dartUid("RETDB"),
        returnId: dartNextBusinessCode("R", returnsData, "returnId"),
        modelId: it.modelId,
        itemCode: code,
        status: "Pending Inspection",
        date: new Date().toLocaleDateString("en-GB"),
        createdAt: dartNowISO(),
        clientName: order.clientName,
        clientId: order.clientId,
        phone1: order.phone1,
        phone2: order.phone2,
        email: order.email,
        reason,
        orderId: order.orderId,
        isPostDeliveryReturn: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      });
  });
}

function setupReturnModal() {
  const modal = document.getElementById("return-modal"),
    form = document.getElementById("return-form");
  if (!form || form.dataset.dartV3Final) return;
  form.dataset.dartV3Final = "1";
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";

  document.getElementById("add-return-btn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-return-edit-id").value = "";
    openModal(modal);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("modal-return-edit-id").value,
      code = document.getElementById("modal-return-item-code").value.trim(),
      it = dartFindItemByCode(code);

    if (!it) {
      window.DartDialog.alert("Item Code غير موجود.");
      return;
    }

    const order = ordersData.find(
      (o) => (o.items || []).includes(code) && o.status === "Delivered",
    );
    if (!order) {
      window.DartDialog.alert("Manual return requires a delivered order containing this item.");
      return;
    }

    const refundAmount =
      Number(document.getElementById("modal-return-refund")?.value) || 0;
    const remainingRefund = Math.max(
      0,
      dartOrderNet(order) - (Number(order.amountRefunded) || 0),
    );
    const duplicateReturn = returnsData.some(
      (row) =>
        String(row.id) !== String(id || "") &&
        row.itemCode === code &&
        !["Rejected", "Closed"].includes(row.status),
    );
    if (duplicateReturn) {
      window.DartDialog.alert("There is already an active return for this item.");
      return;
    }
    if (refundAmount < 0 || refundAmount > remainingRefund) {
      window.DartDialog.alert(`Maximum remaining refund is ${Math.trunc(remainingRefund)} EGP.`);
      return;
    }

    const condition =
      document.getElementById("modal-item-condition").value || "Good";
    const payload = {
      ...(id ? { existingReturnId: id } : {}),
      itemCode: code,
      reason: document.getElementById("modal-item-reason").value || "Other",
      condition: condition === "Bad" ? "Bad" : "Good",
      refundAmount,
      clientName:
        document.getElementById("modal-return-name").value ||
        order.clientName ||
        "",
      phone1:
        document.getElementById("modal-return-phone1").value ||
        order.phone1 ||
        "",
      phone2:
        document.getElementById("modal-return-phone2").value ||
        order.phone2 ||
        "-",
      email:
        document.getElementById("modal-return-email").value ||
        order.email ||
        "",
    };

    if (window.DartAdminApi?.request) {
      try {
        await window.DartAdminApi.request("/api/v1/admin/returns/manual", {
          method: "POST",
          body: payload,
        });

        await Promise.allSettled([
          window.DartDomainState?.hydrateDomain?.("returns", true),
          window.DartDomainState?.hydrateDomain?.("damage", true),
          window.DartCatalog?.hydrate?.(true),
          window.DartOrdersApi?.hydrate?.(true),
          window.DartDomainState?.hydrateAudit?.(),
        ]);

        dartRefreshAll();
        closeModal(modal);
        form.reset();
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual return could not be saved.");
      }
      return;
    }

    const p = {
      clientName: payload.clientName,
      clientId: order.clientId || "",
      itemCode: code,
      modelId:
        document.getElementById("modal-return-model-id").value || it.modelId,
      phone1: payload.phone1,
      phone2: payload.phone2,
      email: payload.email,
      reason: payload.reason,
      status: payload.condition,
      date: new Date().toLocaleDateString("en-GB"),
      orderId: order.orderId || "",
      isPostDeliveryReturn: true,
      refundAmount: payload.refundAmount,
      createdAt: dartNowISO(),
    };

    let r;
    if (id) {
      r = returnsData.find((x) => String(x.id) === String(id));
      const previous = { ...r };
      Object.assign(r, p);
      dartAudit("EDIT", "returns", r.id, previous, p);
    } else {
      r = {
        id: dartUid("RETDB"),
        returnId: dartNextBusinessCode("R", returnsData, "returnId"),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      returnsData.push(r);
      dartAudit("CREATE", "returns", r.id, {}, r);
    }

    if (payload.condition === "Good") {
      it.status = "In stock";
      it.orderId = "";
      it.clientId = "";
      it.clientName = "";
      it.purchaseDate = "";
    } else {
      it.status = "Damaged";
    }

    if (payload.refundAmount > 0) {
      order.amountRefunded =
        (Number(order.amountRefunded) || 0) + payload.refundAmount;
      order.refundedAt = dartNowISO();
      order.paymentStatus =
        order.amountRefunded >= dartOrderNet(order)
          ? "Refunded"
          : "Partially Refunded";
    }

    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
  });
}

// Friendly mapping for the existing Return reason filter values to Arabic stored reasons.
const dartApplyFiltersV3Base = dartApplyFilters;
dartApplyFilters = function (key, data) {
  let out = dartApplyFiltersV3Base(key, data);
  if (key === "returns") {
    const state = dartFilterState.returns || {},
      v = state.reason;
    if (v && v !== "all") {
      const map = {
          wrong_size: ["مقاس", "size"],
          defective: ["عيب", "تلف", "defect"],
          not_as_described: ["صورة", "وصف", "different"],
          wrong_item: ["مختلف", "wrong"],
          quality_issue: ["خامة", "quality"],
          changed_mind: ["رأي", "بحاجة", "mind"],
          missing_parts: ["نقص", "missing"],
          other: ["آخر", "other"],
        },
        terms = map[v] || [String(v).replace(/_/g, " ")];
      out = [...(data || [])].filter((r) =>
        terms.some((t) =>
          String(r.reason || "")
            .toLowerCase()
            .includes(String(t).toLowerCase()),
        ),
      );
      const st = dartFilterState.returns;
      if (st.search)
        out = out.filter((x) => dartSectionSearchText(x).includes(st.search));
      if (st.archive === "active") out = out.filter(dartIsActive);
      else if (st.archive === "archived") out = out.filter(dartIsArchived);
      if (st.status && st.status !== "all")
        out = out.filter(
          (r) =>
            String(r.status).toLowerCase() === String(st.status).toLowerCase(),
        );
      out.sort(
        (a, b) =>
          new Date(b.createdAt || dartDateValue(b.date) || 0) -
          new Date(a.createdAt || dartDateValue(a.date) || 0),
      );
    }
  }
  return out;
};
// Brand Total Cost owns each physical piece once, regardless of its current status.
function dartTotalInventoryCost() {
  return itemsData
    .filter((i) => !i.isDeleted)
    .reduce((a, i) => {
      const m = dartFindModelByCode(i.modelId);
      return a + (Number(i.costSnapshot ?? m?.cost) || 0);
    }, 0);
}

// END DART EYE | DASHBOARD CORE
