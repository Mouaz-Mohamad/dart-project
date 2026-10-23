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


function dartFeedbackRows() {
  return [...(window.DartState?.read?.("dart_reviews", []) || []),
    ...(window.DartState?.read?.("dart_contact_messages", []) || [])];
}

function loadAllDataFromStorage(_persistMigrations = true) {
  const load = (key, fallback) => window.DartState?.read?.(key, fallback) ?? fallback;
  modelsData = load("dart_models", modelsData);
  itemsData = load("dart_items", itemsData);
  customersData = load("dart_customers", customersData);
  ordersData = load("dart_orders", ordersData);
  returnsData = load("dart_returns", returnsData);
  reviewsData = dartFeedbackRows();
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
      `<div class="${getRowClass(m)}" data-id="${dartEsc(m.id)}"><input type="checkbox" class="model-checkbox" ${m.isChecked ? "checked" : ""} ${dartIsArchived(m) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(m) ? "استعادة" : "شطب"}"><i class="bx ${dartIsArchived(m) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="models" title="Audit History"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(d.img || "https://via.placeholder.com/50")}" class="product-img model-img"></div><span class="text-item w150">${dartEsc(m.modelId)}</span><span class="text-item w150">${dartEsc(m.name)}</span><span class="text-item w150">${dartEsc(m.category)}</span><span class="text-item w200">${dartEsc(m.description)}</span><span class="text-item w150">${d.count}</span><span class="text-item w150">${d.total}</span><span class="text-item w150">${d.sold}</span><span class="text-item w150">${d.damaged}</span><span class="text-item w150">${m.cost === undefined ? "Restricted" : dartMoney(m.cost)}</span><span class="text-item w150">${dartMoney(m.selling)}</span><span class="text-item w150">${Number(m.discount) || 0}%</span><span class="text-item w150">${dartMoney(m.discountedPrice ?? m.selling)}</span><span class="text-item w300">${dartEsc(d.colors.join(", ") || "-")}</span><span class="text-item w300">${dartEsc(d.sizes.join(", ") || "-")}</span><span class="text-item w150">• ${dartEsc(out)}</span><span class="text-item w150">${dartEsc(m.date || "-")}</span></div>`,
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
      `<div class="${getRowClass(x)}" data-id="${dartEsc(x.id)}" data-status="${dartEsc(x.accountStatus || x.status || "Active")}"><input type="checkbox" class="model-checkbox" ${x.isChecked ? "checked" : ""} ${dartIsArchived(x) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(x) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-client-profile="1" title="Client history"><i class="bx bx-history"></i></button><button class="dart-reset-password-btn" title="Reset Password"><i class="bx bx-key"></i></button></div><span class="text-item w150">${dartEsc(x.birthday || "-")}</span><span class="text-item w150">${dartEsc(x.clientName)}</span><span class="text-item w150">${dartEsc(x.clientId)}</span><span class="text-item w150">${dartEsc(x.phone1)}</span><span class="text-item w150">${dartEsc(x.phone2 || "-")}</span><span class="text-item w200">${dartEsc(x.email || "-")}</span><span class="text-item w150">${dartEsc(x.country || "Egypt")}</span><span class="text-item w200">${dartEsc(x.governorate || "-")}</span><span class="text-item w150">${monthly}</span><span class="text-item w150">${st.delivered}</span><span class="text-item w300">${dartMoney(st.spent)}<small class="dart-kpi-inline">${st.purchased} items · last ${dartEsc(st.lastPurchase)}</small></span><span class="text-item w200">${dartEsc(x.dartCard || "no")}</span><span class="text-item w100">${dartEsc(dartClientAge(x.birthday))}</span></div>`,
    );
  });
}

