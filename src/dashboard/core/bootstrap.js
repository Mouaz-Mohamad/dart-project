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

// In-memory projections; durable writes use the existing API adapters.
function saveDataToStorage(key, data, feedbackSplit = false) {
  if (key === "dart_reviews" && !feedbackSplit) {
    const isContact = (row) => row.recordType === "contact" || row.source === "Contact Us";
    saveDataToStorage("dart_reviews", data.filter((row) => !isContact(row)), true);
    saveDataToStorage("dart_contact_messages", data.filter(isContact), true);
    return;
  }
  // Legacy multi-section saves must never mark unrelated read-only domains dirty.
  if (window.DartAdminPermissions?.canPersist?.(key) === false) return;
  if (
    window.DartCatalog &&
    ["dart_models", "dart_items"].includes(key)
  ) {
    window.DartCatalog.write(key, data);
    return;
  }
  if (key === "dart_orders" && window.DartOrdersApi) {
    window.DartOrdersApi.write(data);
    ordersData = window.DartOrdersApi.read();
    return;
  }
  if (window.DartDomainState?.domainForStorageKey?.(key)) {
    window.DartDomainState.write(key, data);
    return;
  }
  window.DartState?.write?.(key, data, { source: "dashboard" });
}

// التحكم للنوافذ المنبثقة
function openModal(modal) {
  if (!modal) return;
  modal.dartPreviousFocus = document.activeElement;
  modal.style.display = "block";
  modal.classList.add("active");
  window.DartAdminPermissions?.refresh?.(modal);
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-hidden','false');
  setTimeout(()=>{if(modal.classList.contains('active')&&!modal.contains(document.activeElement))modal.querySelector('input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex="0"]')?.focus();},0);
}

function closeModal(modal) {
  if (!modal) return;
  if (modal.id === 'orderModal' && document.getElementById('orderForm')?.getAttribute('aria-busy') === 'true') return;
  modal.style.display = "none";
  modal.classList.remove("active");
  modal.setAttribute('aria-hidden','true');
  if(modal.dartPreviousFocus?.isConnected)modal.dartPreviousFocus.focus({preventScroll:true});
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

// ==========================================
// 3. قسم القطع (Items Module)
// ==========================================

// البيانات الأولية للقطع
let itemsData = [];

// ==========================================
// 4. قسم العملاء (Customers Module)
// ==========================================

// البيانات الأولية للعملاء
let customersData = [];

// ==========================================
// 5. قسم الطلبات (Orders Module)
// ==========================================

// البيانات الأولية للطلبات
let ordersData = [];
let dartOrdersView = "all";

// ==========================================
// 6. قسم المرتجعات (Returns Module)
// ==========================================

// البيانات الأولية للمرتجعات
let returnsData = [];

// ==========================================
// 7. قسم التقييمات (Reviews Module)
// ==========================================

// البيانات الأولية للتقييمات
let reviewsData = [];

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
