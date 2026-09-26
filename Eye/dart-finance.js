// DART CODE GUIDE | Eye/dart-finance.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-finance.js
// Finance calculations, filters, charts, goals, marketing, and management UI.
// BEGIN MODULE

/* ========================================================================== */
/* DART FINANCE V1 — dashboard finance, goals and server-backed draw eligibility */
/* Draw eligibility changes use the secure API; winner selection stays server-owned. */
/* Money is kept as decimal EGP in the prototype; production stores minor      */
/* units as integers and performs every authoritative calculation server-side. */
/* ========================================================================== */
(function (root) {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    expenses: "dart_finance_expenses",
    budgets: "dart_finance_budgets",
    invoices: "dart_finance_invoices",
    goals: "dart_finance_goals",
    marketing: "dart_finance_marketing",
    settlements: "dart_finance_cod_settlements",
    audit: "dart_finance_audit",
    drawAudit: "dart_draw_eligibility_audit",
    period: "dart_finance_period",
  });

  const GOAL_METRICS = Object.freeze({
    revenue: { label: "Net Revenue", unit: "money", direction: "min" },
    units: { label: "Net Units Sold", unit: "number", direction: "min" },
    orders: { label: "Delivered Orders", unit: "number", direction: "min" },
    net_profit: { label: "Net Profit", unit: "money", direction: "min" },
    repeat_rate: { label: "Returning Customer Rate", unit: "percent", direction: "min" },
    marketing_roas: { label: "Marketing ROAS", unit: "ratio", direction: "min" },
    expense_limit: { label: "Operating Expense Limit", unit: "money", direction: "max" },
  });

  const COLLECTIONS = ["expenses", "budgets", "invoices", "goals", "marketing", "settlements"];
  const EXPORT_FIELDS = Object.freeze({
    expenses: ["id", "date", "category", "vendor", "description", "status", "amount", "paidAt", "paymentMethod", "invoiceNumber", "notes"],
    budgets: ["id", "name", "category", "amount", "warningPercent", "startDate", "endDate"],
    invoices: ["id", "number", "type", "issueDate", "dueDate", "linkedId", "total", "amountPaid", "status", "notes"],
    goals: ["id", "name", "metric", "target", "startDate", "endDate", "status"],
    marketing: ["id", "date", "channel", "campaign", "spend", "impressions", "clicks", "orders", "attributedRevenue", "linkedExpenseId"],
    settlements: ["id", "orderId", "settlementDate", "amountReceived", "fee", "reference", "status", "notes"],
  });
  const state = {
    period: null,
    financeTab: "overview",
    charts: {},
    modalResource: null,
    modalId: null,
  };
  const requestedInitialSection = getStorage()?.getItem("dart_active_section") || "";
  const serverFinanceSummaries = new Map();
  const serverFinancePending = new Map();
  const serverFinanceErrors = new Map();
  let serverFinanceDenied = false;
  let serverFinanceRefreshTimer = 0;
  let adminAuthenticated = false;
  let financeBackoffMs = 5_000;
  let financeLastAttemptAt = 0;
  let financeWarnedBackoffMs = 0;
  const FINANCE_REFRESH_MS = 30_000;
  const FINANCE_MAX_BACKOFF_MS = 300_000;

  function getStorage() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function readJSON(key, fallback) {
    if (root.DartState?.isBusinessKey?.(key)) return root.DartState.read(key, fallback);
    const storage = getStorage();
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    if (root.DartDomainState?.domainForStorageKey?.(key)) {
      root.DartDomainState.write(key, value);
      return;
    }
    if (root.DartState?.isBusinessKey?.(key)) {
      root.DartState.write(key, value, { source: "finance" });
      return;
    }
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(key, JSON.stringify(value));
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundMoney(value) {
    return Math.round((finiteNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function money(value) {
    const amount = roundMoney(value);
    return `${new Intl.NumberFormat("en-EG", {
      minimumFractionDigits: amount % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount)} EGP`;
  }

  function percent(value) {
    return `${finiteNumber(value).toFixed(1)}%`;
  }

  function decimal(value, digits = 2) {
    return new Intl.NumberFormat("en-EG", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(finiteNumber(value));
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>'"]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char],
    );
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
    const text = String(value).trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    match = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function startOfDay(value) {
    const date = parseDate(value) || new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function endOfDay(value) {
    const date = parseDate(value) || new Date();
    date.setHours(23, 59, 59, 999);
    return date;
  }

  function addDays(value, amount) {
    const date = parseDate(value) || new Date();
    date.setDate(date.getDate() + amount);
    return date;
  }

  function dateInputValue(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function daysInclusive(start, end) {
    return Math.max(1, Math.round((startOfDay(end) - startOfDay(start)) / 864e5) + 1);
  }

  function within(value, range) {
    const date = parseDate(value);
    return Boolean(date && date >= range.start && date <= range.end);
  }

  function periodRange(preset = "this_month", custom = {}, reference = new Date()) {
    const now = endOfDay(reference);
    let start;
    let end = now;
    let label;
    let previousStart;
    let previousEnd;

    if (preset === "last_7") {
      start = startOfDay(addDays(now, -6));
      label = "Last 7 Days";
    } else if (preset === "last_30") {
      start = startOfDay(addDays(now, -29));
      label = "Last 30 Days";
    } else if (preset === "last_month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      previousStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      previousEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 0));
      label = start.toLocaleDateString("en-EG", { month: "long", year: "numeric" });
    } else if (preset === "this_quarter") {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterMonth, 1);
      const elapsed = daysInclusive(start, end);
      previousStart = new Date(now.getFullYear(), quarterMonth - 3, 1);
      previousEnd = endOfDay(addDays(previousStart, elapsed - 1));
      const cap = endOfDay(new Date(start.getFullYear(), start.getMonth(), 0));
      if (previousEnd > cap) previousEnd = cap;
      label = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()} to date`;
    } else if (preset === "this_year") {
      start = new Date(now.getFullYear(), 0, 1);
      previousStart = new Date(now.getFullYear() - 1, 0, 1);
      const previousMonthLastDay = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0).getDate();
      previousEnd = endOfDay(new Date(now.getFullYear() - 1, now.getMonth(), Math.min(now.getDate(), previousMonthLastDay)));
      label = `${now.getFullYear()} to date`;
    } else if (preset === "custom") {
      start = startOfDay(custom.start || now);
      end = endOfDay(custom.end || custom.start || now);
      if (start > end) [start, end] = [startOfDay(end), endOfDay(start)];
      label = `${dateInputValue(start)} → ${dateInputValue(end)}`;
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      const elapsedDay = now.getDate();
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() - 1, elapsedDay));
      const previousMonthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      if (previousEnd > previousMonthEnd) previousEnd = previousMonthEnd;
      label = `${now.toLocaleDateString("en-EG", { month: "long", year: "numeric" })} to date`;
      preset = "this_month";
    }

    start = startOfDay(start);
    end = endOfDay(end);
    if (!previousStart || !previousEnd) {
      const length = daysInclusive(start, end);
      previousEnd = endOfDay(addDays(start, -1));
      previousStart = startOfDay(addDays(previousEnd, -(length - 1)));
    }
    return {
      preset,
      start,
      end,
      label,
      previous: {
        start: startOfDay(previousStart),
        end: endOfDay(previousEnd),
        label: `${dateInputValue(previousStart)} → ${dateInputValue(previousEnd)}`,
      },
    };
  }

  const FinanceRepository = {
    list(resource) {
      if (!COLLECTIONS.includes(resource)) return [];
      return readJSON(STORAGE_KEYS[resource], []);
    },
    replace(resource, rows) {
      if (!COLLECTIONS.includes(resource)) throw new Error("Unknown finance resource");
      writeJSON(STORAGE_KEYS[resource], rows);
      return rows;
    },
    upsert(resource, record) {
      const rows = this.list(resource);
      const index = rows.findIndex((row) => String(row.id) === String(record.id));
      if (index >= 0) rows[index] = record;
      else rows.unshift(record);
      this.replace(resource, rows);
      return record;
    },
    archive(resource, id) {
      const rows = this.list(resource);
      const row = rows.find((item) => String(item.id) === String(id));
      if (!row) return null;
      row.archivedAt = new Date().toISOString();
      row.updatedAt = row.archivedAt;
      this.replace(resource, rows);
      return row;
    },
    // BACKEND: POST every event to an append-only admin audit endpoint.
    audit(action, resource, id, before, after, note = "") {
      const rows = readJSON(STORAGE_KEYS.audit, []);
      const event = {
        id: uid("FAUD"),
        action,
        resource,
        entityId: String(id || ""),
        before: before || null,
        after: after || null,
        note,
        actorRole: "Admin",
        actorId: null,
        timestamp: new Date().toISOString(),
      };
      rows.unshift(event);
      if (rows.length > 2000) rows.length = 2000;
      writeJSON(STORAGE_KEYS.audit, rows);
      try {
        if (typeof dartAudit === "function") dartAudit(action, `finance:${resource}`, id, before || {}, after || {}, note);
      } catch {
        // The standalone finance tests intentionally run without the dashboard audit layer.
      }
      return event;
    },
  };

  function uid(prefix) {
    if (root.crypto?.randomUUID) return `${prefix}-${root.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function active(row) {
    return Boolean(row) && !row.archivedAt && !row.isArchived && !row.isDeleted;
  }

  function dashboardData(overrides = null) {
    if (overrides) return {
      orders: overrides.orders || [],
      returns: overrides.returns || [],
      items: overrides.items || [],
      models: overrides.models || [],
      customers: overrides.customers || [],
      reviews: overrides.reviews || [],
      damage: overrides.damage || [],
      expenses: overrides.expenses || [],
      budgets: overrides.budgets || [],
      invoices: overrides.invoices || [],
      goals: overrides.goals || [],
      marketing: overrides.marketing || [],
      settlements: overrides.settlements || [],
    };
    return {
      orders: typeof ordersData !== "undefined" ? ordersData : readJSON("dart_orders", []),
      returns: typeof returnsData !== "undefined" ? returnsData : readJSON("dart_returns", []),
      items: typeof itemsData !== "undefined" ? itemsData : readJSON("dart_items", []),
      models: typeof modelsData !== "undefined" ? modelsData : readJSON("dart_models", []),
      customers: typeof customersData !== "undefined" ? customersData : readJSON("dart_customers", []),
      reviews: typeof reviewsData !== "undefined" ? reviewsData : readJSON("dart_reviews", []),
      damage: typeof damageData !== "undefined" ? damageData : readJSON("dart_damage", []),
      expenses: FinanceRepository.list("expenses"),
      budgets: FinanceRepository.list("budgets"),
      invoices: FinanceRepository.list("invoices"),
      goals: FinanceRepository.list("goals"),
      marketing: FinanceRepository.list("marketing"),
      settlements: FinanceRepository.list("settlements"),
    };
  }

  function orderAmount(order) {
    if (Number.isFinite(Number(order?.finalAmount))) return Math.max(0, finiteNumber(order.finalAmount));
    if (Array.isArray(order?.priceSnapshot) && order.priceSnapshot.length) {
      return Math.max(
        0,
        order.priceSnapshot.reduce(
          (sum, line) => sum + finiteNumber(line.finalUnitPrice) * Math.max(1, finiteNumber(line.qty, 1)),
          0,
        ) - finiteNumber(order.orderLevelDiscountAmount),
      );
    }
    const subtotal = finiteNumber(order?.totalPrice);
    return Math.max(0, subtotal - (subtotal * finiteNumber(order?.discount)) / 100);
  }

  function orderEventDate(order) {
    return order?.deliveredAt || order?.deliveryDate || order?.date || order?.createdAt;
  }

  function returnEventDate(record) {
    return record?.completedAt || record?.resolvedAt || record?.updatedAt || record?.date || record?.createdAt;
  }

  function isExchangeReturn(record) {
    if (root.DartReturns?.isExchange) return root.DartReturns.isExchange(record);
    return String(record?.requestType || "").toLowerCase().includes("exchange");
  }

  function isRefundReturn(record) {
    return !isExchangeReturn(record);
  }

  function returnInspection(record) {
    if (root.DartReturns?.inspectionStatus) return root.DartReturns.inspectionStatus(record);
    const value = String(record?.inspectionStatus || record?.status || "").toLowerCase();
    if (value === "good") return "Good";
    if (["damaged", "bad"].includes(value)) return "Damaged";
    return "Pending";
  }

  function completedReturn(record) {
    const legacy = ["completed", "good", "damaged", "bad"].includes(String(record?.status || "").toLowerCase());
    return active(record) && record?.isPostDeliveryReturn === true && Boolean(record?.completedAt || legacy);
  }

  function uniqueCompletedReturns(data, range = null) {
    const records = data.returns
      .filter(completedReturn)
      .filter((record) => !range || within(returnEventDate(record), range))
      .sort((a, b) => (parseDate(returnEventDate(a)) || 0) - (parseDate(returnEventDate(b)) || 0));
    const unique = new Map();
    records.forEach((record) => {
      const key = `${record.orderId || ""}:${record.itemCode || record.id}`;
      unique.set(key, record);
    });
    return [...unique.values()];
  }

  function modelFor(data, modelCode) {
    return data.models.find((model) => String(model.modelId || model.id) === String(modelCode));
  }

  function itemFor(data, itemCode) {
    return data.items.find((item) => String(item.itemCode) === String(itemCode));
  }

  function orderForReturn(data, record) {
    return data.orders.find(
      (order) =>
        (record.orderId && String(order.orderId || order.id) === String(record.orderId)) ||
        (record.itemCode && (order.items || []).some((code) => String(code) === String(record.itemCode))),
    );
  }

  function costForLine(data, line, order) {
    if (Object.prototype.hasOwnProperty.call(line || {}, "costSnapshot") && Number.isFinite(Number(line.costSnapshot))) {
      return Math.max(0, finiteNumber(line.costSnapshot));
    }
    const item = itemFor(data, line?.itemCode);
    if (item && Number.isFinite(Number(item.costSnapshot))) return Math.max(0, finiteNumber(item.costSnapshot));
    const model = modelFor(data, line?.modelCode || item?.modelId);
    if (model && Number.isFinite(Number(model.cost))) return Math.max(0, finiteNumber(model.cost));
    return 0;
  }

  function orderLines(order) {
    if (Array.isArray(order?.priceSnapshot) && order.priceSnapshot.length) return order.priceSnapshot;
    return (order?.items || []).map((itemCode) => ({ itemCode, qty: 1 }));
  }

  function deliveryCostForOrder(order) {
    if (Number.isFinite(Number(order?.deliveryCost))) {
      return Math.max(0, finiteNumber(order.deliveryCost));
    }
    const settings = root.DartSiteSettings?.get?.() || {};
    const configured = Number(
      settings.courierFeePerOrder ?? settings.deliveryCostPerPiece,
    );
    return roundMoney(Math.max(
      0,
      Number.isFinite(configured) ? configured : 100,
    ));
  }

  function codDueForOrder(order) {
    const orderTotal = roundMoney(
      Math.max(0, orderAmount(order) - finiteNumber(order?.amountRefunded)),
    );
    const courierDue = Math.min(orderTotal, deliveryCostForOrder(order));
    const dueToDart = roundMoney(Math.max(0, orderTotal - courierDue));
    return { orderTotal, courierDue, dueToDart };
  }
  function deliveredDeliveryCost(data, range) {
    return roundMoney(
      deliveredOrders(data, range).reduce(
        (sum, order) => sum + deliveryCostForOrder(order),
        0,
      ),
    );
  }

  function refundAmountForRange(data, range) {
    const returns = data.returns.filter(completedReturn);
    let total = uniqueCompletedReturns(data, range)
      .filter(isRefundReturn)
      .reduce((sum, record) => sum + Math.max(0, finiteNumber(record.refundAmount)), 0);
    const ordersWithDetailedRefunds = new Set(
      returns
        .filter((record) => finiteNumber(record.refundAmount) > 0)
        .map((record) => String(record.orderId || orderForReturn(data, record)?.orderId || ""))
        .filter(Boolean),
    );
    data.orders.forEach((order) => {
      const orderKey = String(order.orderId || order.id || "");
      if (
        finiteNumber(order.amountRefunded) > 0 &&
        !ordersWithDetailedRefunds.has(orderKey) &&
        within(order.refundedAt, range)
      ) {
        total += finiteNumber(order.amountRefunded);
      }
    });
    return roundMoney(total);
  }

  function returnedGoodCost(data, range) {
    const unique = new Map();
    data.returns
      .filter(completedReturn)
      .filter(isRefundReturn)
      .filter((record) => returnInspection(record) === "Good")
      .filter((record) => within(record.inspectedAt || returnEventDate(record), range))
      .sort((a, b) => (parseDate(a.inspectedAt || returnEventDate(a)) || 0) - (parseDate(b.inspectedAt || returnEventDate(b)) || 0))
      .forEach((record) => unique.set(`${record.orderId || ""}:${record.itemCode || record.id}`, record));
    return roundMoney(
      [...unique.values()].reduce((sum, record) => {
          const order = orderForReturn(data, record);
          const line = orderLines(order).find((entry) => String(entry.itemCode) === String(record.itemCode));
          return sum + costForLine(data, record.originalLineSnapshot || line || { itemCode: record.itemCode, modelCode: record.modelId }, order);
      }, 0),
    );
  }

  function recognizedExpenses(data, range) {
    return data.expenses.filter(active).filter((expense) => String(expense.status || "").toLowerCase() !== "void").filter((expense) => within(expense.date, range));
  }

  function paidExpenses(data, range) {
    return data.expenses
      .filter(active)
      .filter((expense) => String(expense.status || "").toLowerCase() === "paid")
      .filter((expense) => within(expense.paidAt || expense.date, range));
  }

  function deliveredOrders(data, range) {
    return data.orders
      .filter(active)
      .filter((order) => String(order.status || "").toLowerCase() === "delivered")
      .filter((order) => within(orderEventDate(order), range));
  }

  function damageWriteOff(data, range) {
    const deliveredCodes = new Set(
      data.orders
        .filter((order) => String(order.status || "").toLowerCase() === "delivered")
        .flatMap((order) => orderLines(order).map((line) => String(line.itemCode || "")))
        .filter(Boolean),
    );
    const seen = new Set();
    return roundMoney(
      data.damage
        .filter(active)
        .filter((record) => ["damaged", "destroyed"].includes(String(record.status || "").toLowerCase()))
        .filter((record) => within(record.destroyedAt || record.inspectedAt || record.updatedAt || record.date || record.createdAt, range))
        .reduce((sum, record) => {
          const code = String(record.itemCode || record.id || "");
          // A refunded damaged piece is already present in delivered COGS.
          // An exchanged damaged piece is no longer the delivered order line, so
          // its loss is recognized once here in addition to the replacement COGS.
          if (seen.has(code) || deliveredCodes.has(code)) return sum;
          seen.add(code);
          const item = itemFor(data, record.itemCode);
          const model = modelFor(data, record.modelId || item?.modelId);
          const cost = Number.isFinite(Number(record.costSnapshot))
            ? finiteNumber(record.costSnapshot)
            : Number.isFinite(Number(item?.costSnapshot))
              ? finiteNumber(item.costSnapshot)
              : finiteNumber(model?.cost);
          return sum + Math.max(0, cost);
        }, 0),
    );
  }

  function damagedInventoryValue(data, range) {
    const records = new Map();
    data.damage
      .filter(active)
      .filter((record) => ["damaged", "destroyed"].includes(String(record.status || "").toLowerCase()))
      .filter((record) => within(record.destroyedAt || record.inspectedAt || record.updatedAt || record.date || record.createdAt, range))
      .forEach((record) => records.set(String(record.itemCode || record.id), record));
    data.items
      .filter(active)
      .filter((item) => ["damaged", "destroyed"].includes(String(item.status || "").toLowerCase()))
      .filter((item) => within(item.destroyedAt || item.updatedAt || item.damageDate || item.date || item.createdAt, range))
      .forEach((item) => {
        const key = String(item.itemCode || item.id);
        if (!records.has(key)) records.set(key, item);
      });
    return roundMoney(
      [...records.values()].reduce((sum, record) => {
        const item = itemFor(data, record.itemCode) || record;
        const model = modelFor(data, record.modelId || item?.modelId);
        const cost = Number.isFinite(Number(record.costSnapshot))
          ? finiteNumber(record.costSnapshot)
          : Number.isFinite(Number(item?.costSnapshot))
            ? finiteNumber(item.costSnapshot)
            : finiteNumber(model?.cost);
        return sum + Math.max(0, cost);
      }, 0),
    );
  }

  function returnLogisticsCost(data, range) {
    return roundMoney(
      uniqueCompletedReturns(data, range)
        .filter(isExchangeReturn)
        .reduce((sum, record) => sum + Math.max(0, finiteNumber(record.brandCourierFee)), 0),
    );
  }

  function isCOD(order) {
    const method = String(order?.paymentMethod || "Cash on Delivery").toLowerCase();
    return method === "cod" || method.includes("cash on") || method === "cash";
  }

  function settlementAmountForOrder(data, order) {
    const orderId = String(order.orderId || order.id || "");
    return roundMoney(
      data.settlements
        .filter(active)
        .filter((entry) => String(entry.orderId) === orderId)
        .reduce((sum, entry) => sum + Math.max(0, finiteNumber(entry.amountReceived)), 0),
    );
  }

  function marketingStats(data, range) {
    const rows = data.marketing.filter(active).filter((entry) => within(entry.date, range));
    const result = rows.reduce(
      (totals, entry) => {
        totals.spend += Math.max(0, finiteNumber(entry.spend));
        totals.revenue += Math.max(0, finiteNumber(entry.attributedRevenue));
        totals.impressions += Math.max(0, finiteNumber(entry.impressions));
        totals.clicks += Math.max(0, finiteNumber(entry.clicks));
        totals.orders += Math.max(0, finiteNumber(entry.orders));
        return totals;
      },
      { spend: 0, revenue: 0, impressions: 0, clicks: 0, orders: 0 },
    );
    result.spend = roundMoney(result.spend);
    result.revenue = roundMoney(result.revenue);
    result.roas = result.spend ? result.revenue / result.spend : 0;
    result.cac = result.orders ? result.spend / result.orders : 0;
    result.ctr = result.impressions ? (result.clicks / result.impressions) * 100 : 0;
    result.cpc = result.clicks ? result.spend / result.clicks : 0;
    result.conversion = result.clicks ? (result.orders / result.clicks) * 100 : 0;
    result.rows = rows;
    return result;
  }

  function physicalItemAcquisitionCost(data, range) {
    const seen = new Set();
    return roundMoney(data.items.filter((item) => !item.isDeleted)
      .filter((item) => within(recordCreatedAt(item), range))
      .reduce((sum, item) => {
        const key = String(item.itemCode || item.id || "");
        if (seen.has(key)) return sum;
        seen.add(key);
        const model = modelFor(data, item.modelId);
        const cost = Number.isFinite(Number(item.costSnapshot)) ? finiteNumber(item.costSnapshot) : finiteNumber(model?.cost);
        return sum + Math.max(0, cost);
      }, 0));
  }

  function incrementalDamageCost(data, range) {
    const acquired = new Set(data.items.filter((item) => within(recordCreatedAt(item), range)).map((item) => String(item.itemCode || item.id)));
    const seen = new Set();
    return roundMoney(data.damage.filter(active)
      .filter((record) => ["damaged", "destroyed"].includes(String(record.status || "").toLowerCase()))
      .filter((record) => within(record.destroyedAt || record.inspectedAt || record.updatedAt || record.date || record.createdAt, range))
      .reduce((sum, record) => {
        const key = String(record.itemCode || record.id || "");
        if (seen.has(key) || acquired.has(key)) return sum;
        seen.add(key);
        const item = itemFor(data, record.itemCode), model = modelFor(data, record.modelId || item?.modelId);
        const cost = Number.isFinite(Number(record.costSnapshot)) ? finiteNumber(record.costSnapshot) : Number.isFinite(Number(item?.costSnapshot)) ? finiteNumber(item.costSnapshot) : finiteNumber(model?.cost);
        return sum + Math.max(0, cost);
      }, 0));
  }

  function calculateSummary(input, range) {
    const data = dashboardData(input);
    const delivered = deliveredOrders(data, range);
    const grossRevenue = roundMoney(delivered.reduce((sum, order) => sum + orderAmount(order), 0));
    const refunds = refundAmountForRange(data, range);
    const netRevenue = roundMoney(grossRevenue - refunds);
    const grossCogs = roundMoney(
      delivered.reduce(
        (sum, order) =>
          sum +
          orderLines(order).reduce(
            (lineTotal, line) => lineTotal + costForLine(data, line, order) * Math.max(1, finiteNumber(line.qty, 1)),
            0,
          ),
        0,
      ),
    );
    const cogsReversal = returnedGoodCost(data, range);
    const netCogs = roundMoney(grossCogs - cogsReversal);
    const expenseRows = recognizedExpenses(data, range);
    const operatingExpenses = roundMoney(expenseRows.reduce((sum, expense) => sum + Math.max(0, finiteNumber(expense.amount)), 0));
    const settlementsInPeriod = data.settlements.filter(active).filter((entry) => within(entry.settlementDate, range));
    const codFees = roundMoney(settlementsInPeriod.reduce((sum, entry) => sum + Math.max(0, finiteNumber(entry.fee)), 0));
    const damageLoss = damageWriteOff(data, range);
    const damageValue = damagedInventoryValue(data, range);
    const returnCourierCosts = returnLogisticsCost(data, range);
    const deliveryCosts = deliveredDeliveryCost(data, range);
    const totalOperatingExpenses = roundMoney(
      operatingExpenses + codFees + damageLoss + returnCourierCosts,
    );
    const totalCost = roundMoney(netCogs + totalOperatingExpenses);
    const grossProfit = roundMoney(netRevenue - netCogs);
    const netProfit = roundMoney(netRevenue - totalCost);
    const physicalItemCost = physicalItemAcquisitionCost(data, range);
    const incrementalDamage = incrementalDamageCost(data, range);
    const brandTotalCost = roundMoney(
      physicalItemCost +
        operatingExpenses +
        codFees +
        returnCourierCosts +
        incrementalDamage,
    );
    const brandNetProfit = roundMoney(netRevenue - brandTotalCost);
    const grossSoldUnits = delivered.reduce(
      (sum, order) => sum + orderLines(order).reduce((lineTotal, line) => lineTotal + Math.max(1, finiteNumber(line.qty, 1)), 0),
      0,
    );
    const returnedUnits = uniqueCompletedReturns(data, range).filter(isRefundReturn).length;
    const soldUnits = grossSoldUnits - returnedUnits;

    const customerOrders = new Map();
    delivered.forEach((order) => {
      const key = String(order.clientId || order.customerId || order.phone1 || order.orderId || order.id);
      customerOrders.set(key, (customerOrders.get(key) || 0) + 1);
    });
    const orderCounts = [...customerOrders.values()];
    const uniqueCustomers = customerOrders.size;
    const returningCustomers = orderCounts.filter((count) => count >= 2).length;
    const oneTimeCustomers = orderCounts.filter((count) => count === 1).length;
    const orderFrequencyBuckets = {
      oneOrder: orderCounts.filter((count) => count === 1).length,
      twoOrders: orderCounts.filter((count) => count === 2).length,
      threeOrders: orderCounts.filter((count) => count === 3).length,
      fourOrders: orderCounts.filter((count) => count === 4).length,
      fivePlusOrders: orderCounts.filter((count) => count >= 5).length,
    };

    const settledOrderIds = new Set(data.settlements.filter(active).map((entry) => String(entry.orderId)));
    let fallbackCODInflow = 0;
    data.orders
      .filter(active)
      .filter(isCOD)
      .filter((order) => String(order.status || "").toLowerCase() === "delivered")
      .filter((order) => !settledOrderIds.has(String(order.orderId || order.id)))
      .filter((order) => ["paid", "partially refunded", "refunded"].includes(String(order.paymentStatus || "").toLowerCase()))
      .filter((order) => within(order.paymentReceivedAt || order.paidAt || order.deliveredAt, range))
      .forEach((order) => {
        const paidAmount = finiteNumber(order.amountPaid) > 0 ? finiteNumber(order.amountPaid) : orderAmount(order);
        const grossCollected = Math.max(0, paidAmount);
        fallbackCODInflow += Math.max(
          0,
          grossCollected - Math.min(grossCollected, deliveryCostForOrder(order)),
        );
      });
    const codCashIn = roundMoney(
      settlementsInPeriod.reduce((sum, entry) => sum + Math.max(0, finiteNumber(entry.amountReceived)), 0) + fallbackCODInflow,
    );
    const paidExpenseCashOut = roundMoney(paidExpenses(data, range).reduce((sum, expense) => sum + Math.max(0, finiteNumber(expense.amount)), 0));
    const refundCashOut = refunds;
    const cashOut = roundMoney(
      paidExpenseCashOut + codFees + returnCourierCosts + refundCashOut,
    );

    const marketing = marketingStats(data, range);
    return {
      grossRevenue,
      refunds,
      netRevenue,
      grossCogs,
      cogsReversal,
      netCogs,
      operatingExpenses,
      codFees,
      damageLoss,
      damageValue,
      returnCourierCosts,
      deliveryCosts,
      totalOperatingExpenses,
      totalCost,
      grossProfit,
      netProfit,
      physicalItemCost,
      incrementalDamage,
      brandTotalCost,
      brandNetProfit,
      margin: netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0,
      grossMargin: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
      marginApplicable: netRevenue > 0,
      deliveredOrders: delivered.length,
      grossSoldUnits,
      returnedUnits,
      soldUnits,
      averageOrderValue: delivered.length ? netRevenue / delivered.length : 0,
      uniqueCustomers,
      returningCustomers,
      oneTimeCustomers,
      orderFrequencyBuckets,
      repeatRate: uniqueCustomers ? (returningCustomers / uniqueCustomers) * 100 : 0,
      cashIn: codCashIn,
      cashOut,
      netCashFlow: roundMoney(codCashIn - cashOut),
      paidExpenseCashOut,
      refundCashOut,
      marketing,
    };
  }

  function comparison(current, previous) {
    const a = finiteNumber(current);
    const b = finiteNumber(previous);
    if (b === 0 && a === 0) return { text: "— 0%", direction: "flat", percent: 0 };
    if (b === 0) return { text: "New", direction: a > 0 ? "up" : "down", percent: null };
    const change = ((a - b) / Math.abs(b)) * 100;
    return {
      text: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
      direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
      percent: change,
    };
  }

  function invoiceStatus(invoice, reference = new Date()) {
    if (!active(invoice) || String(invoice.status).toLowerCase() === "void") return "Void";
    const total = Math.max(0, finiteNumber(invoice.total));
    const paid = Math.max(0, finiteNumber(invoice.amountPaid));
    if (total > 0 && paid >= total) return "Paid";
    const due = parseDate(invoice.dueDate);
    if (due && endOfDay(due) < startOfDay(reference)) return paid > 0 ? "Partially Paid · Overdue" : "Overdue";
    return paid > 0 ? "Partially Paid" : "Open";
  }

  function budgetRows(data, referenceRange) {
    return data.budgets.filter(active).map((budget) => {
      const range = { start: startOfDay(budget.startDate), end: endOfDay(budget.endDate) };
      const actual = data.expenses
        .filter(active)
        .filter((expense) => String(expense.status || "").toLowerCase() !== "void")
        .filter((expense) => budget.category === "All" || expense.category === budget.category)
        .filter((expense) => within(expense.date, range))
        .reduce((sum, expense) => sum + Math.max(0, finiteNumber(expense.amount)), 0);
      const amount = Math.max(0, finiteNumber(budget.amount));
      return {
        ...budget,
        actual: roundMoney(actual),
        remaining: roundMoney(amount - actual),
        utilization: amount ? (actual / amount) * 100 : 0,
        visible: !referenceRange || range.start <= referenceRange.end && range.end >= referenceRange.start,
      };
    });
  }

  function goalActual(goal, data) {
    const range = { start: startOfDay(goal.startDate), end: endOfDay(goal.endDate) };
    let summary = authoritativeSummary(range);
    if (!summary && typeof document === "undefined") summary = calculateSummary(data, range);
    if (!summary) {
      void hydrateServerFinanceSummary(range)
        .then(() => renderAllFinance())
        .catch(() => undefined);
      return null;
    }
    const values = {
      revenue: summary.netRevenue,
      units: summary.soldUnits,
      orders: summary.deliveredOrders,
      net_profit: summary.netProfit,
      repeat_rate: summary.repeatRate,
      marketing_roas: summary.marketing.roas,
      expense_limit: summary.totalOperatingExpenses,
    };
    return finiteNumber(values[goal.metric]);
  }

  function goalRows(data, referenceRange) {
    return data.goals.filter(active).map((goal) => {
      const metric = GOAL_METRICS[goal.metric] || GOAL_METRICS.revenue;
      const rawActual = goalActual(goal, data);
      const loading = rawActual === null;
      const actual = loading ? 0 : rawActual;
      const target = Math.max(0, finiteNumber(goal.target));
      const rawProgress = target && !loading ? (actual / target) * 100 : 0;
      const achieved = !loading && (metric.direction === "max" ? actual <= target : actual >= target);
      return {
        ...goal,
        metricDefinition: metric,
        actual,
        loading,
        progress: rawProgress,
        achieved,
        visible:
          !referenceRange ||
          startOfDay(goal.startDate) <= referenceRange.end && endOfDay(goal.endDate) >= referenceRange.start,
      };
    });
  }

  function modelProfitability(data, range) {
    const groups = new Map();
    deliveredOrders(data, range).forEach((order) => {
      orderLines(order).forEach((line) => {
        const code = String(line.modelCode || itemFor(data, line.itemCode)?.modelId || "Unknown");
        const model = modelFor(data, code);
        const group = groups.get(code) || { modelCode: code, modelName: model?.name || code, units: 0, revenue: 0, cogs: 0, refunds: 0 };
        const qty = Math.max(1, finiteNumber(line.qty, 1));
        group.units += qty;
        group.revenue += finiteNumber(line.finalUnitPrice) * qty;
        group.cogs += costForLine(data, line, order) * qty;
        groups.set(code, group);
      });
    });
    uniqueCompletedReturns(data, range)
      .filter(isRefundReturn)
      .forEach((record) => {
        const order = orderForReturn(data, record);
        const line = orderLines(order).find((entry) => String(entry.itemCode) === String(record.itemCode));
        const code = String(line?.modelCode || record.modelId || itemFor(data, record.itemCode)?.modelId || "Unknown");
        const model = modelFor(data, code);
        const group = groups.get(code) || { modelCode: code, modelName: model?.name || code, units: 0, revenue: 0, cogs: 0, refunds: 0 };
        group.refunds += Math.max(0, finiteNumber(record.refundAmount));
        group.units -= 1;
        if (returnInspection(record) === "Good") group.cogs -= costForLine(data, record.originalLineSnapshot || line || record, order);
        groups.set(code, group);
      });
    return [...groups.values()]
      .map((group) => {
        group.revenue = roundMoney(group.revenue - group.refunds);
        group.cogs = roundMoney(group.cogs);
        group.profit = roundMoney(group.revenue - group.cogs);
        group.margin = group.revenue ? (group.profit / group.revenue) * 100 : 0;
        return group;
      })
      .sort((a, b) => b.profit - a.profit);
  }

  function dataQualityIssues(data, range) {
    const issues = [];
    deliveredOrders(data, range).forEach((order) => {
      if (!Array.isArray(order.priceSnapshot) || !order.priceSnapshot.length) {
        issues.push({ severity: "warning", title: `Order ${order.orderId || order.id} has no price snapshot`, text: "Revenue may use the legacy order total and COGS cannot be verified." });
        return;
      }
      order.priceSnapshot.forEach((line) => {
        if (!Number.isFinite(Number(line.costSnapshot))) {
          issues.push({ severity: "warning", title: `Missing cost snapshot · ${line.itemCode || order.orderId}`, text: "The current model cost is used as a fallback. Save immutable costSnapshot values in the backend." });
        }
      });
    });
    return issues;
  }

  function operationalAlerts(data, range, summary) {
    const alerts = dataQualityIssues(data, range);
    budgetRows(data, range).filter((row) => row.visible).forEach((budget) => {
      const threshold = Math.max(1, finiteNumber(budget.warningPercent, 80));
      if (budget.utilization >= 100) alerts.push({ severity: "danger", title: `Budget exceeded · ${budget.name}`, text: `${money(budget.actual)} spent from ${money(budget.amount)}.` });
      else if (budget.utilization >= threshold) alerts.push({ severity: "warning", title: `Budget near limit · ${budget.name}`, text: `${percent(budget.utilization)} utilized.` });
    });
    data.invoices.filter(active).forEach((invoice) => {
      if (invoiceStatus(invoice).includes("Overdue")) alerts.push({ severity: "danger", title: `Overdue invoice · ${invoice.number}`, text: `${money(finiteNumber(invoice.total) - finiteNumber(invoice.amountPaid))} remains due.` });
    });
    const now = new Date();
    data.orders
      .filter(active)
      .filter(isCOD)
      .filter((order) => String(order.status || "").toLowerCase() === "delivered")
      .forEach((order) => {
        const due = Math.max(0, orderAmount(order) - finiteNumber(order.amountRefunded));
        const received = settlementAmountForOrder(data, order);
        const deliveredAt = parseDate(order.deliveredAt || order.date);
        if (due - received > 0.009 && deliveredAt && now - deliveredAt > 2 * 864e5) {
          alerts.push({ severity: "warning", title: `COD settlement pending · ${order.orderId || order.id}`, text: `${money(due - received)} has not been recorded as received.` });
        }
      });
    if (summary.netRevenue > 0 && summary.netProfit < 0) alerts.push({ severity: "danger", title: "Negative net profit", text: `The selected period is losing ${money(Math.abs(summary.netProfit))}.` });
    if (summary.netRevenue > 0 && summary.grossMargin < 20) alerts.push({ severity: "warning", title: "Low gross margin", text: `Gross margin is ${percent(summary.grossMargin)} before operating expenses.` });
    data.marketing.filter(active).filter((entry) => within(entry.date, range)).forEach((entry) => {
      if (finiteNumber(entry.spend) > 0 && !entry.linkedExpenseId) alerts.push({ severity: "info", title: `Marketing spend is not linked · ${entry.campaign || entry.channel}`, text: "It is included in marketing analytics but not in P&L until linked to an expense record." });
    });
    goalRows(data, range).filter((goal) => goal.visible).forEach((goal) => {
      if (endOfDay(goal.endDate) < now && !goal.achieved) alerts.push({ severity: "warning", title: `Goal ended below target · ${goal.name}`, text: `${formatMetric(goal.actual, goal.metricDefinition)} of ${formatMetric(goal.target, goal.metricDefinition)}.` });
    });
    return alerts;
  }

  function formatMetric(value, definition) {
    if (definition?.unit === "money") return money(value);
    if (definition?.unit === "percent") return percent(value);
    if (definition?.unit === "ratio") return `${decimal(value)}x`;
    return new Intl.NumberFormat("en-EG", { maximumFractionDigits: 2 }).format(finiteNumber(value));
  }

  const api = {
    STORAGE_KEYS,
    GOAL_METRICS,
    repository: FinanceRepository,
    parseDate,
    periodRange,
    currentRangeSelection,
    calculateSummary,
    authoritativeSummary,
    hydrateAuthoritativeFinance,
    comparison,
    invoiceStatus,
    budgetRows,
    goalRows,
    modelProfitability,
    operationalAlerts,
    damagedInventoryValue,
    returnLogisticsCost,
    deliveryCostForOrder,
    deliveredDeliveryCost,
    brandMetrics,
    dashboardData,
    money,
  };
  root.DartFinance = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (!root.document) return;

  function loadPeriodState() {
    const saved = readJSON(STORAGE_KEYS.period, {});
    const preset = ["this_month", "last_month", "this_quarter", "this_year", "last_7", "last_30", "custom"].includes(saved.preset)
      ? saved.preset
      : "this_month";
    state.period = {
      preset,
      start: saved.start || dateInputValue(new Date()),
      end: saved.end || dateInputValue(new Date()),
    };
  }

  function currentRange() {
    if (!state.period) loadPeriodState();
    return periodRange(state.period.preset, state.period);
  }

  function currentRangeSelection() {
    const range = currentRange();
    return {
      preset: range.preset,
      start: dateInputValue(range.start),
      end: dateInputValue(range.end),
      label: range.label,
    };
  }

  function financeRangeKey(range) {
    return `${dateInputValue(range.start)}:${dateInputValue(range.end)}`;
  }

  function authoritativeSummary(range) {
    return serverFinanceSummaries.get(financeRangeKey(range)) || null;
  }

  function financeSummaryError(range) {
    return serverFinanceErrors.get(financeRangeKey(range)) || null;
  }

  async function hydrateServerFinanceSummary(range, force = false) {
    if (!root.DartAdminApi?.request || serverFinanceDenied) return null;
    const key = financeRangeKey(range);
    if (!force && serverFinanceSummaries.has(key)) {
      return serverFinanceSummaries.get(key);
    }
    if (serverFinancePending.has(key)) return serverFinancePending.get(key);

    const promise = root.DartAdminApi.request(
      `/api/v1/admin/finance/summary?start=${encodeURIComponent(dateInputValue(range.start))}&end=${encodeURIComponent(dateInputValue(range.end))}`,
    )
      .then((payload) => {
        const summary = payload?.summary || null;
        if (!summary) throw new Error("Finance summary response is incomplete.");
        serverFinanceSummaries.set(key, summary);
        serverFinanceErrors.delete(key);
        return summary;
      })
      .catch((error) => {
        serverFinanceErrors.set(key, error);
        if (error?.status === 401 || error?.status === 403) serverFinanceDenied = true;
        throw error;
      })
      .finally(() => serverFinancePending.delete(key));

    serverFinancePending.set(key, promise);
    return promise;
  }

  async function hydrateAuthoritativeFinance(range = currentRange(), force = false) {
    if (serverFinanceDenied || !adminAuthenticated || document.hidden) return false;
    try {
      await Promise.all([
        hydrateServerFinanceSummary(range, force),
        hydrateServerFinanceSummary(range.previous, force),
      ]);
      return true;
    } catch (error) {
      if (
        error?.status !== 401 &&
        error?.status !== 403 &&
        financeWarnedBackoffMs !== financeBackoffMs
      ) {
        financeWarnedBackoffMs = financeBackoffMs;
        console.warn("Dart server finance summary refresh failed; retry is backed off.");
      }
      return false;
    } finally {
      renderAllFinance();
    }
  }

  function scheduleFinanceRefresh(delayMs = FINANCE_REFRESH_MS) {
    clearTimeout(serverFinanceRefreshTimer);
    if (!adminAuthenticated || serverFinanceDenied || document.hidden) return;
    const jitter = delayMs >= FINANCE_REFRESH_MS
      ? Math.floor(Math.random() * Math.min(5_000, delayMs * 0.1))
      : 0;
    serverFinanceRefreshTimer = root.setTimeout(
      () => void refreshFinanceFromServer(true),
      delayMs + jitter,
    );
  }

  async function refreshFinanceFromServer(force = true) {
    if (!adminAuthenticated || serverFinanceDenied || document.hidden) return;
    financeLastAttemptAt = Date.now();
    const ok = await hydrateAuthoritativeFinance(currentRange(), force);
    if (ok) {
      financeBackoffMs = 5_000;
      financeWarnedBackoffMs = 0;
      scheduleFinanceRefresh(FINANCE_REFRESH_MS);
      return;
    }
    if (!serverFinanceDenied) {
      const nextDelay = financeBackoffMs;
      financeBackoffMs = Math.min(FINANCE_MAX_BACKOFF_MS, financeBackoffMs * 2);
      scheduleFinanceRefresh(nextDelay);
    }
  }

  function invalidateAuthoritativeFinance() {
    serverFinanceSummaries.clear();
    serverFinanceErrors.clear();
    clearTimeout(serverFinanceRefreshTimer);
    if (!adminAuthenticated) return;
    serverFinanceRefreshTimer = root.setTimeout(
      () => void refreshFinanceFromServer(true),
      120,
    );
  }

  function financeSummaryStatusMarkup(range) {
    if (serverFinanceDenied) {
      return '<div class="dart-finance-empty">Finance access is not available for this account.</div>';
    }
    const error = financeSummaryError(range) || financeSummaryError(range.previous);
    if (error) {
      return '<div class="dart-finance-empty">Authoritative finance totals are temporarily unavailable. No browser-calculated totals are being shown.</div>';
    }
    return '<div class="dart-finance-empty">Loading authoritative finance totals…</div>';
  }

  function savePeriodState() {
    writeJSON(STORAGE_KEYS.period, state.period);
  }

  function renderPeriodControls() {
    syncPeriodInputs();
  }

  function syncPeriodInputs() {
    document.querySelectorAll("[data-period-preset]").forEach((select) => { select.value = state.period.preset; });
    document.querySelectorAll("[data-period-start]").forEach((input) => { input.value = state.period.start || ""; });
    document.querySelectorAll("[data-period-end]").forEach((input) => { input.value = state.period.end || ""; });
    document.querySelectorAll(".dart-custom-period").forEach((box) => box.classList.toggle("is-visible", state.period.preset === "custom"));
    document.querySelectorAll("[data-period-label]").forEach((label) => { label.textContent = currentRange().label; });
  }

  function setPeriod(patch) {
    state.period = { ...state.period, ...patch };
    if (state.period.preset === "custom" && state.period.start && state.period.end && parseDate(state.period.start) > parseDate(state.period.end)) {
      state.period.end = state.period.start;
    }
    savePeriodState();
    syncPeriodInputs();
    root.dispatchEvent(new CustomEvent("dart:finance-period-changed", {
      detail: currentRangeSelection(),
    }));
    invalidateAuthoritativeFinance();
    renderAllFinance();
  }

  function setComparisonBadge(element, current, previous, inverse = false) {
    if (!element) return;
    const result = comparison(current, previous);
    const direction = inverse && result.direction !== "flat" ? (result.direction === "up" ? "down" : "up") : result.direction;
    element.textContent = result.text;
    element.className = `variance dart-variance is-${direction}`;
    element.title = `Previous period: ${money(previous)}`;
  }

  function recordCreatedAt(record) {
    return record?.createdAt || record?.orderCreatedAt || record?.registeredAt || record?.regDate || record?.date;
  }

  function inStockItems(data, range) {
    return data.items
      .filter(active)
      .filter((item) => String(item.status || "").toLowerCase() === "in stock")
      .filter((item) => within(recordCreatedAt(item), range));
  }

  function currentItemCost(data, item) {
    if (Number.isFinite(Number(item?.costSnapshot))) return Math.max(0, finiteNumber(item.costSnapshot));
    return Math.max(0, finiteNumber(modelFor(data, item?.modelId)?.cost));
  }

  function currentItemSelling(data, item) {
    const model = modelFor(data, item?.modelId);
    if (!model) return 0;
    if (Number.isFinite(Number(model.discountedPrice))) return Math.max(0, finiteNumber(model.discountedPrice));
    const selling = Math.max(0, finiteNumber(model.selling));
    return Math.max(0, roundMoney(selling - (selling * finiteNumber(model.discount)) / 100));
  }

  function topValue(values) {
    const counts = new Map();
    values.filter(Boolean).forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
    return [...counts.entries()].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))[0] || ["—", 0];
  }

  function brandMetrics(data, range, summary) {
    const stock = inStockItems(data, range);
    const periodOrders = data.orders.filter(active).filter((order) => within(recordCreatedAt(order), range));
    const delivered = deliveredOrders(data, range);
    const refundedCodes = new Set(
      uniqueCompletedReturns(data, range)
        .filter(isRefundReturn)
        .map((record) => String(record.itemCode)),
    );
    const soldLines = delivered
      .flatMap((order) => orderLines(order))
      .filter((line) => !refundedCodes.has(String(line.itemCode)));
    const stockPerModel = new Map();
    stock.forEach((item) => stockPerModel.set(String(item.modelId), (stockPerModel.get(String(item.modelId)) || 0) + 1));
    const ratingRows = data.reviews
      .filter(active)
      .filter((review) => String(review.source || "Review") !== "Contact Us")
      .filter((review) => String(review.status || "").toLowerCase() === "active")
      .filter((review) => within(recordCreatedAt(review), range))
      .filter((review) => Number.isFinite(Number(review.rating)));
    const referenceTime = range.end.getTime();
    return {
      customers: data.customers.filter(active).filter((customer) => within(recordCreatedAt(customer), range)).length,
      orders: periodOrders.length,
      rating: ratingRows.length ? ratingRows.reduce((sum, review) => sum + finiteNumber(review.rating), 0) / ratingRows.length : 0,
      stockCount: stock.length,
      soldCount: summary.soldUnits,
      inStockSelling: roundMoney(stock.reduce((sum, item) => sum + currentItemSelling(data, item), 0)),
      inStockCost: roundMoney(stock.reduce((sum, item) => sum + currentItemCost(data, item), 0)),
      damageValue: summary.damageValue,
      grossMargin: summary.grossMargin,
      aov: summary.averageOrderValue,
      deliveryRate: periodOrders.length ? (periodOrders.filter((order) => String(order.status).toLowerCase() === "delivered").length / periodOrders.length) * 100 : 0,
      refusalRate: periodOrders.length ? (periodOrders.filter((order) => String(order.status).toLowerCase() === "refused").length / periodOrders.length) * 100 : 0,
      returnRate: summary.grossSoldUnits ? (summary.returnedUnits / summary.grossSoldUnits) * 100 : 0,
      topModel: topValue(soldLines.map((line) => line.modelCode || itemFor(data, line.itemCode)?.modelId)),
      topColor: topValue(soldLines.map((line) => line.color || itemFor(data, line.itemCode)?.color)),
      topSize: topValue(soldLines.map((line) => line.size || itemFor(data, line.itemCode)?.size)),
      lowStock: [...stockPerModel.values()].filter((count) => count > 0 && count <= 5).length,
      deadStock: stock.filter((item) => {
        const created = parseDate(recordCreatedAt(item));
        return created && referenceTime - created.getTime() >= 60 * 864e5;
      }).length,
    };
  }

  function setBrandMetric(id, value, current, previous, inverse = false) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
    const change = document.getElementById(id.replace(/-value$/, "-change"));
    if (change) setComparisonBadge(change, current, previous, inverse);
  }

  function renderBrandMetricCards(data, range, current, previous) {
    const metrics = brandMetrics(data, range, current);
    const prior = brandMetrics(data, range.previous, previous);
    const numberFormat = new Intl.NumberFormat("en-EG", { maximumFractionDigits: 1 });

    const mainCards = [
      ["#brand .customar-card .numebr", metrics.customers],
      ["#brand .orders-card .numebr", metrics.orders],
      ["#brand .card-inf-2:nth-child(3) .numebr", metrics.rating ? metrics.rating.toFixed(1) : "0"],
      ["#brand .stock-card .numebr", metrics.stockCount],
      ["#brand .sold-card .numebr", metrics.soldCount],
    ];
    mainCards.forEach(([selector, value]) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    });

    setBrandMetric("brand-in-stock-selling-value", money(metrics.inStockSelling), metrics.inStockSelling, prior.inStockSelling);
    setBrandMetric("brand-in-stock-cost-value", money(metrics.inStockCost), metrics.inStockCost, prior.inStockCost, true);
    setBrandMetric("brand-damage-loss-value", money(metrics.damageValue), metrics.damageValue, prior.damageValue, true);
    setBrandMetric("brand-gross-margin-value", percent(metrics.grossMargin), metrics.grossMargin, prior.grossMargin);
    setBrandMetric("brand-aov-value", money(metrics.aov), metrics.aov, prior.aov);
    setBrandMetric("brand-delivery-rate-value", percent(metrics.deliveryRate), metrics.deliveryRate, prior.deliveryRate);
    setBrandMetric("brand-refusal-rate-value", percent(metrics.refusalRate), metrics.refusalRate, prior.refusalRate, true);
    setBrandMetric("brand-return-rate-value", percent(metrics.returnRate), metrics.returnRate, prior.returnRate, true);
    setBrandMetric("brand-low-stock-value", numberFormat.format(metrics.lowStock), metrics.lowStock, prior.lowStock, true);
    setBrandMetric("brand-dead-stock-value", numberFormat.format(metrics.deadStock), metrics.deadStock, prior.deadStock, true);

    [["model", metrics.topModel], ["color", metrics.topColor], ["size", metrics.topSize]].forEach(([name, entry]) => {
      const value = document.getElementById(`brand-top-${name}-value`);
      const note = document.getElementById(`brand-top-${name}-note`);
      if (value) value.textContent = entry[0];
      if (note) note.textContent = `${entry[1]} sold item(s)`;
    });
  }

  function renderBrandFinance() {
    if (!document.getElementById("brand")) return;
    const data = dashboardData();
    const range = currentRange();
    const current = authoritativeSummary(range);
    const previous = authoritativeSummary(range.previous);

    if (!current || !previous) {
      void hydrateAuthoritativeFinance(range);
      const unavailable = serverFinanceDenied || financeSummaryError(range);
      [
        [".sales-cont", unavailable ? "Unavailable" : "Loading…"],
        [".cost-cont", unavailable ? "Unavailable" : "Loading…"],
        [".profit-cont", unavailable ? "Unavailable" : "Loading…"],
      ].forEach(([selector, label]) => {
        const card = document.querySelector(`#brand ${selector}`);
        const amount = card?.querySelector(".sales");
        const variance = card?.querySelector(".variance");
        if (amount) amount.textContent = label;
        if (variance) variance.textContent = "";
      });
      return;
    }

    const mappings = [
      [".sales-cont", current.netRevenue, previous.netRevenue, false],
      [".cost-cont", current.brandTotalCost, previous.brandTotalCost, true],
      [".profit-cont", current.brandNetProfit, previous.brandNetProfit, false],
    ];
    mappings.forEach(([selector, value, prior, inverse]) => {
      const card = document.querySelector(`#brand ${selector}`);
      if (!card) return;
      const amount = card.querySelector(".sales");
      if (amount) amount.textContent = money(value);
      setComparisonBadge(card.querySelector(".variance"), value, prior, inverse);
    });
    [
      [".sales-cont", "Total Selling", "Delivered sales less completed refunds recorded inside the selected period."],
      [".cost-cont", "Owner Total Cost", "Cost of every physical item added in the period, plus expenses, COD fees, Dart-paid representative fees and non-duplicated damage from older stock. Regular courier allocation is already included inside item cost and is not added again."],
      [".profit-cont", "Owner Net Result", "Total Selling minus Owner Total Cost for the selected period. This is an owner cash-investment view, not the accrual P&L net profit."],
    ].forEach(([selector, title, description]) => {
      const info = document.querySelector(`#brand ${selector} .dart-info-btn`);
      if (info) {
        info.dataset.infoTitle = title;
        info.dataset.infoText = description;
      }
    });
    const costTitle = document.querySelector("#brand .cost-cont h4");
    if (costTitle) costTitle.innerHTML = '<i class="fa-solid fa-coins"></i> Owner Total Cost';
    renderBrandMetricCards(data, range, current, previous);
    document.getElementById("dart-repeat-rate")?.replaceChildren(document.createTextNode(percent(current.repeatRate)));
    document.getElementById("dart-financial-period")?.replaceChildren(document.createTextNode(range.label));
    const currentFrequency = current.orderFrequencyBuckets ? current : calculateSummary(data, range);
    const previousFrequency = previous.orderFrequencyBuckets ? previous : calculateSummary(data, range.previous);
    renderReturningChart(currentFrequency, previousFrequency);
    renderGoalsChart(data, range);
    renderFinancialChart(data, range, current);
  }

  function chartAvailable() {
    return typeof root.Chart === "function";
  }

  function replaceChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !chartAvailable()) return null;
    if (state.charts[key]?.destroy) state.charts[key].destroy();
    state.charts[key] = new root.Chart(canvas.getContext("2d"), config);
    return state.charts[key];
  }

  function toggleChartEmpty(id, empty) {
    const element = document.getElementById(id);
    if (element) element.hidden = !empty;
  }

  const RETURNING_ORDER_BUCKETS = Object.freeze([
    { key: "oneOrder", label: "1 Order", color: "#F2E3E7" },
    { key: "twoOrders", label: "2 Orders", color: "#E3B7C2" },
    { key: "threeOrders", label: "3 Orders", color: "#D18498" },
    { key: "fourOrders", label: "4 Orders", color: "#BF506D" },
    { key: "fivePlusOrders", label: "5+ Orders", color: "#AB012B" },
  ]);

  function orderBucketComparison(current, previous) {
    const now = Math.max(0, finiteNumber(current));
    const before = Math.max(0, finiteNumber(previous));
    if (before === 0) return now > 0 ? "New" : "No Change";
    const change = ((now - before) / before) * 100;
    if (Math.abs(change) < 0.05) return "No Change";
    return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  }

  function renderReturningChart(summary, previousSummary) {
    const empty = summary.uniqueCustomers === 0;
    toggleChartEmpty("dart-returning-empty", empty);
    const canvas = document.getElementById("dart-returning-chart");
    if (canvas) canvas.hidden = empty;
    if (empty || !chartAvailable()) return;

    const currentBuckets = summary.orderFrequencyBuckets || {};
    const previousBuckets = previousSummary?.orderFrequencyBuckets || {};
    const values = RETURNING_ORDER_BUCKETS.map((bucket) => Math.max(0, finiteNumber(currentBuckets[bucket.key])));
    const previousValues = RETURNING_ORDER_BUCKETS.map((bucket) => Math.max(0, finiteNumber(previousBuckets[bucket.key])));
    const total = values.reduce((sum, value) => sum + value, 0);
    const percentages = values.map((value) => total ? (value / total) * 100 : 0);
    const changes = values.map((value, index) => orderBucketComparison(value, previousValues[index]));

    replaceChart("returning", "dart-returning-chart", {
      type: "doughnut",
      data: {
        labels: RETURNING_ORDER_BUCKETS.map((bucket) => bucket.label),
        datasets: [{
          data: values,
          backgroundColor: RETURNING_ORDER_BUCKETS.map((bucket) => bucket.color),
          borderColor: "#FFFCF6",
          borderWidth: 2,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              boxWidth: 9,
              padding: 14,
              generateLabels: (chart) =>
                RETURNING_ORDER_BUCKETS.map((bucket, index) => ({
                  text: `${bucket.label}: ${values[index]} · ${percentages[index].toFixed(1)}% · ${changes[index]}`,
                  fillStyle: bucket.color,
                  strokeStyle: bucket.color,
                  lineWidth: 0,
                  hidden: !chart.getDataVisibility(index),
                  index,
                })),
            },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.label}: ${context.raw} customer(s) · ${percentages[context.dataIndex].toFixed(1)}%`,
              afterLabel: (context) =>
                `Previous: ${previousValues[context.dataIndex]} · Change: ${changes[context.dataIndex]}`,
            },
          },
        },
      },
    });
  }

  function renderGoalsChart(data, range) {
    const goals = goalRows(data, range).filter((goal) => goal.visible && String(goal.status || "Active") === "Active");
    const badge = document.getElementById("dart-goals-count");
    if (badge) badge.textContent = `${goals.length} active`;
    const empty = goals.length === 0;
    toggleChartEmpty("dart-goals-empty", empty);
    const canvas = document.getElementById("dart-goals-chart");
    if (canvas) canvas.hidden = empty;
    if (empty || !chartAvailable()) return;
    replaceChart("goals", "dart-goals-chart", {
      type: "bar",
      data: {
        labels: goals.map((goal) => goal.name),
        datasets: [{ label: "Progress", data: goals.map((goal) => Math.max(0, Math.min(150, goal.progress))), backgroundColor: goals.map((goal) => goal.achieved ? "#17825B" : "#AB012B"), borderRadius: 7, barThickness: 16 }],
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, suggestedMax: 100, ticks: { callback: (value) => `${value}%` }, grid: { color: "rgba(15,23,42,.06)" } }, y: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${goals[context.dataIndex].progress.toFixed(1)}%` } } } },
    });
  }

  function financialBuckets(data, range) {
    void data;
    const totalDays = daysInclusive(range.start, range.end);
    const step = Math.max(1, Math.ceil(totalDays / 12));
    const buckets = [];
    const missing = [];
    let cursor = startOfDay(range.start);
    while (cursor <= range.end) {
      const bucketStart = startOfDay(cursor);
      const bucketEnd = endOfDay(addDays(bucketStart, step - 1));
      if (bucketEnd > range.end) bucketEnd.setTime(range.end.getTime());
      const bucketRange = { start: bucketStart, end: bucketEnd };
      const summary = authoritativeSummary(bucketRange);
      if (!summary) {
        missing.push(hydrateServerFinanceSummary(bucketRange));
      } else {
        buckets.push({
          label: step === 1
            ? bucketStart.toLocaleDateString("en-EG", { day: "numeric", month: "short" })
            : `${bucketStart.toLocaleDateString("en-EG", { day: "numeric", month: "short" })}–${bucketEnd.toLocaleDateString("en-EG", { day: "numeric", month: "short" })}`,
          revenue: summary.netRevenue,
          cost: summary.brandTotalCost,
          profit: summary.brandNetProfit,
        });
      }
      cursor = startOfDay(addDays(bucketEnd, 1));
    }
    if (missing.length) {
      void Promise.allSettled(missing).then(() => {
        renderBrandFinance();
        if (state.financeTab === "overview") renderFinanceSection();
      });
      return null;
    }
    return buckets;
  }

  function renderFinancialChart(data, range, summary) {
    const empty = summary.netRevenue === 0 && summary.brandTotalCost === 0;
    toggleChartEmpty("dart-financial-empty", empty);
    const canvas = document.getElementById("dart-financial-chart");
    if (canvas) canvas.hidden = empty;
    if (empty || !chartAvailable()) return;
    const buckets = financialBuckets(data, range);
    if (!buckets) {
      if (canvas) canvas.hidden = true;
      const loading = document.getElementById("dart-financial-empty");
      if (loading) {
        loading.hidden = false;
        loading.textContent = "Loading authoritative finance series…";
      }
      return;
    }
    const emptyState = document.getElementById("dart-financial-empty");
    if (emptyState) emptyState.textContent = "No financial activity in this period.";
    replaceChart("financial", "dart-financial-chart", {
      type: "bar",
      data: {
        labels: buckets.map((bucket) => bucket.label),
        datasets: [
          { label: "Revenue", data: buckets.map((bucket) => bucket.revenue), backgroundColor: "rgba(23,130,91,.78)", borderRadius: 5 },
          { label: "Owner Total Cost", data: buckets.map((bucket) => bucket.cost), backgroundColor: "rgba(171,1,43,.22)", borderRadius: 5 },
          { type: "line", label: "Owner Net Result", data: buckets.map((bucket) => bucket.profit), borderColor: "#AB012B", backgroundColor: "#AB012B", tension: .32, pointRadius: 2, borderWidth: 2 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(15,23,42,.06)" }, ticks: { callback: (value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value } } }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } } },
    });
  }

  function kpiCard(title, value, subtitle, icon, tone = "neutral", compare = null, inverse = false) {
    let comparisonMarkup = "";
    if (compare) {
      const result = comparison(compare.current, compare.previous);
      const direction = inverse && result.direction !== "flat" ? (result.direction === "up" ? "down" : "up") : result.direction;
      comparisonMarkup = `<span class="dart-kpi-change is-${direction}">${escapeHTML(result.text)} vs previous</span>`;
    }
    return `<article class="dart-finance-kpi tone-${tone}"><div class="dart-finance-kpi-icon"><i class="${icon}"></i></div><div><p>${escapeHTML(title)}</p><strong>${escapeHTML(value)}</strong><small>${escapeHTML(subtitle)}</small>${comparisonMarkup}</div></article>`;
  }

  function tableShell(headers, rows, emptyMessage = "No records in this view.") {
    return `<div class="dart-finance-table-wrap"><table class="dart-finance-table"><thead><tr>${headers.map((header) => `<th>${escapeHTML(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="dart-finance-empty-cell">${escapeHTML(emptyMessage)}</td></tr>`}</tbody></table></div>`;
  }

  function sectionToolbar(title, description, actions = "") {
    return `<div class="dart-finance-section-head"><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div><div class="dart-finance-actions">${actions}</div></div>`;
  }

  function actionButtons(resource, id) {
    return `<div class="dart-row-actions"><button type="button" data-finance-edit="${resource}" data-id="${escapeHTML(id)}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button><button type="button" data-finance-delete="${resource}" data-id="${escapeHTML(id)}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></div>`;
  }

  function renderFinanceOverview(data, range, current, previous) {
    const budgets = budgetRows(data, range).filter((row) => row.visible);
    const alerts = operationalAlerts(data, range, current);
    const marginText = current.marginApplicable !== false && current.netRevenue > 0
      ? `${percent(current.margin)} net margin`
      : current.refunds > 0
        ? "Return adjustment period · margin N/A"
        : "Margin N/A";
    return `${sectionToolbar("Financial Overview", `${range.label} · previous comparison uses ${range.previous.label}`)}
      <div class="dart-finance-kpi-grid">
        ${kpiCard("Net Revenue", money(current.netRevenue), "Delivered sales less period refunds", "fa-solid fa-arrow-trend-up", "green", { current: current.netRevenue, previous: previous.netRevenue })}
        ${kpiCard("P&L Total Cost", money(current.totalCost), "Net COGS + recognized period operating costs", "fa-solid fa-coins", "burgundy", { current: current.totalCost, previous: previous.totalCost }, true)}
        ${kpiCard("Net Profit", money(current.netProfit), marginText, "fa-solid fa-chart-line", current.netProfit >= 0 ? "green" : "red", { current: current.netProfit, previous: previous.netProfit })}
        ${kpiCard("Net Cash Flow", money(current.netCashFlow), `${money(current.cashIn)} in · ${money(current.cashOut)} out`, "fa-solid fa-money-bill-transfer", current.netCashFlow >= 0 ? "blue" : "red", { current: current.netCashFlow, previous: previous.netCashFlow })}
        ${kpiCard("Inventory Investment", money(current.physicalItemCost), "Cost snapshot of physical items entered in the selected period", "fa-solid fa-boxes-stacked", "neutral", { current: current.physicalItemCost, previous: previous.physicalItemCost }, true)}
        ${kpiCard("Returning Customers", percent(current.repeatRate), `${current.returningCustomers} of ${current.uniqueCustomers} buyers`, "fa-solid fa-rotate", "blue")}
        ${kpiCard("Marketing ROAS", `${decimal(current.marketing.roas)}x`, `${money(current.marketing.spend)} tracked spend`, "fa-solid fa-bullhorn", "neutral")}
      </div>
      <div class="dart-finance-two-col">
        <article class="dart-finance-panel">${sectionToolbar("P&L Snapshot", "Revenue is recognized on delivery; expenses on their expense date.", '<button type="button" class="dart-link-btn" data-finance-tab="pnl">Full report</button>')}
          <dl class="dart-statement-list"><div><dt>Gross delivered revenue</dt><dd>${money(current.grossRevenue)}</dd></div><div><dt>Refunds in period</dt><dd>(${money(current.refunds)})</dd></div><div class="is-subtotal"><dt>Total Selling</dt><dd>${money(current.netRevenue)}</dd></div><div><dt>Sold-piece cost</dt><dd>(${money(current.netCogs)})</dd></div><div><dt>Operating expenses</dt><dd>(${money(current.operatingExpenses)})</dd></div><div><dt>Courier allocation (included in item cost)</dt><dd>${money(current.deliveryCosts)}</dd></div><div><dt>Representative exchange fees</dt><dd>(${money(current.returnCourierCosts)})</dd></div><div><dt>Non-duplicated damage loss</dt><dd>(${money(current.damageLoss)})</dd></div><div class="is-total"><dt>Total Profit</dt><dd>${money(current.netProfit)}</dd></div></dl>
        </article>
        <article class="dart-finance-panel">${sectionToolbar("Budget Control", "Actual recognized expenses against active budgets.", '<button type="button" class="dart-link-btn" data-finance-tab="budgets">Manage budgets</button>')}
          <div class="dart-budget-stack">${budgets.length ? budgets.slice(0, 5).map((budget) => `<div class="dart-budget-line"><div><strong>${escapeHTML(budget.name)}</strong><span>${money(budget.actual)} / ${money(budget.amount)}</span></div><div class="dart-progress"><span style="width:${Math.min(100, Math.max(0, budget.utilization))}%" class="${budget.utilization >= 100 ? "is-over" : ""}"></span></div><small>${percent(budget.utilization)} used · ${money(budget.remaining)} remaining</small></div>`).join("") : '<div class="dart-finance-empty">No budgets have been added.</div>'}</div>
        </article>
      </div>
      <article class="dart-finance-panel">${sectionToolbar("Priority Alerts", "Operational and financial exceptions only; no synthetic alerts.", '<button type="button" class="dart-link-btn" data-finance-tab="alerts">View all</button>')}<div class="dart-alert-list">${renderAlertRows(alerts.slice(0, 6))}</div></article>`;
  }

  function renderExpenses(data, range) {
    const rows = data.expenses.filter(active).filter((entry) => within(entry.date, range)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `${sectionToolbar("Expenses", "Accrual view: Paid and Unpaid records affect P&L on the expense date. Void records are excluded.", `<button type="button" class="dart-finance-secondary" data-finance-export="expenses">Export CSV</button><button type="button" class="dart-finance-primary" data-finance-add="expenses"><i class="fa-solid fa-plus"></i> Add Expense</button>`)}
      <div class="dart-accounting-note"><i class="fa-solid fa-circle-info"></i><span>Do not re-enter the physical product cost here when it already exists in the model/order cost snapshot; that would double-count COGS.</span></div>
      ${tableShell(["Date", "Category", "Vendor", "Description", "Status", "Amount", "Payment", "Actions"], rows.map((row) => `<tr><td>${escapeHTML(row.date)}</td><td>${escapeHTML(row.category)}</td><td>${escapeHTML(row.vendor || "-")}</td><td>${escapeHTML(row.description || "-")}</td><td><span class="dart-status-chip is-${String(row.status || "unpaid").toLowerCase()}">${escapeHTML(row.status || "Unpaid")}</span></td><td>${money(row.amount)}</td><td>${escapeHTML(row.paymentMethod || "-")}</td><td>${actionButtons("expenses", row.id)}</td></tr>`).join(""), "No expenses exist in the selected period.")}`;
  }

  function renderBudgets(data, range) {
    const budgets = budgetRows(data, range).filter((row) => row.visible);
    return `${sectionToolbar("Budgets", "Flexible category budgets with live utilization and warning thresholds.", `<button type="button" class="dart-finance-secondary" data-finance-export="budgets">Export CSV</button><button type="button" class="dart-finance-primary" data-finance-add="budgets"><i class="fa-solid fa-plus"></i> Add Budget</button>`)}
      ${tableShell(["Budget", "Category", "Period", "Limit", "Actual", "Remaining", "Used", "Actions"], budgets.map((row) => `<tr><td><strong>${escapeHTML(row.name)}</strong></td><td>${escapeHTML(row.category)}</td><td>${escapeHTML(row.startDate)} → ${escapeHTML(row.endDate)}</td><td>${money(row.amount)}</td><td>${money(row.actual)}</td><td class="${row.remaining < 0 ? "is-negative" : ""}">${money(row.remaining)}</td><td><div class="dart-table-progress"><span style="width:${Math.min(100, Math.max(0, row.utilization))}%" class="${row.utilization >= 100 ? "is-over" : ""}"></span></div><small>${percent(row.utilization)}</small></td><td>${actionButtons("budgets", row.id)}</td></tr>`).join(""), "No budgets overlap the selected period.")}`;
  }

  function renderInvoices(data, range) {
    const rows = data.invoices.filter(active).filter((invoice) => within(invoice.issueDate, range)).sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)));
    return `${sectionToolbar("Invoices", "Document control only. Sales stay linked to delivered orders and supplier invoices to expense records, preventing double counting.", `<button type="button" class="dart-finance-secondary" data-finance-export="invoices">Export CSV</button><button type="button" class="dart-finance-primary" data-finance-add="invoices"><i class="fa-solid fa-plus"></i> Add Invoice</button>`)}
      ${tableShell(["Invoice", "Type", "Issue", "Due", "Linked Record", "Total", "Paid", "Status", "Actions"], rows.map((row) => `<tr><td><strong>${escapeHTML(row.number)}</strong></td><td>${escapeHTML(row.type)}</td><td>${escapeHTML(row.issueDate)}</td><td>${escapeHTML(row.dueDate)}</td><td>${escapeHTML(row.linkedId || "-")}</td><td>${money(row.total)}</td><td>${money(row.amountPaid)}</td><td><span class="dart-status-chip">${escapeHTML(invoiceStatus(row))}</span></td><td>${actionButtons("invoices", row.id)}</td></tr>`).join(""), "No invoices were issued in the selected period.")}`;
  }

  function renderGoals(data, range) {
    const goals = goalRows(data, range).filter((goal) => goal.visible);
    return `${sectionToolbar("Goals", "Add, edit or archive measurable goals. Actual values always come from saved dashboard and finance records.", `<button type="button" class="dart-finance-secondary" data-finance-export="goals">Export CSV</button><button type="button" class="dart-finance-primary" data-finance-add="goals"><i class="fa-solid fa-plus"></i> Add Goal</button>`)}
      <div class="dart-goal-grid">${goals.length ? goals.map((goal) => `<article class="dart-goal-card ${goal.achieved ? "is-achieved" : ""}"><div class="dart-goal-card-head"><div><span>${escapeHTML(goal.metricDefinition.label)}</span><h3>${escapeHTML(goal.name)}</h3></div>${actionButtons("goals", goal.id)}</div><div class="dart-goal-values"><strong>${goal.loading ? "Loading…" : formatMetric(goal.actual, goal.metricDefinition)}</strong><span>of ${formatMetric(goal.target, goal.metricDefinition)}</span></div><div class="dart-progress"><span style="width:${Math.min(100, Math.max(0, goal.progress))}%"></span></div><div class="dart-goal-meta"><span>${goal.loading ? "Loading authoritative actual…" : `${percent(goal.progress)} progress`}</span><span>${escapeHTML(goal.startDate)} → ${escapeHTML(goal.endDate)}</span></div></article>`).join("") : '<div class="dart-finance-empty dart-finance-empty-large">No goals overlap the selected period. Add the first goal when you have a real target.</div>'}</div>`;
  }

  function renderPnL(current, previous, range) {
    const lines = [
      ["Gross delivered revenue", current.grossRevenue, previous.grossRevenue],
      ["Less: period refunds", -current.refunds, -previous.refunds],
      ["Net revenue", current.netRevenue, previous.netRevenue, "subtotal"],
      ["Gross COGS", -current.grossCogs, -previous.grossCogs],
      ["Good-return COGS reversal", current.cogsReversal, previous.cogsReversal],
      ["Gross profit", current.grossProfit, previous.grossProfit, "subtotal"],
      ["Operating expenses", -current.operatingExpenses, -previous.operatingExpenses],
      ["COD fees", -current.codFees, -previous.codFees],
      ["Representative exchange fees", -current.returnCourierCosts, -previous.returnCourierCosts],
      ["Pre-sale damage write-offs", -current.damageLoss, -previous.damageLoss],
      ["Net profit", current.netProfit, previous.netProfit, "total"],
    ];
    return `${sectionToolbar("Profit & Loss", `${range.label} compared with ${range.previous.label}.`, '<button type="button" class="dart-finance-secondary" data-finance-export="pnl">Export CSV</button>')}
      <article class="dart-finance-panel dart-statement-panel"><div class="dart-statement-header"><span>Account</span><span>Current</span><span>Previous</span><span>Change</span></div>${lines.map(([label, value, prior, type]) => { const delta = comparison(value, prior); return `<div class="dart-statement-row ${type ? `is-${type}` : ""}"><span>${escapeHTML(label)}</span><strong>${money(value)}</strong><span>${money(prior)}</span><span class="dart-kpi-change is-${delta.direction}">${escapeHTML(delta.text)}</span></div>`; }).join("")}<div class="dart-statement-foot">Gross margin ${percent(current.grossMargin)} · Net margin ${percent(current.margin)}</div></article>`;
  }

  function renderCashFlow(current, previous, range) {
    return `${sectionToolbar("Cash Flow", "Cash basis: collected order cash less recorded paid expenses, completed refunds and Dart-paid representative fees. Inventory investment is shown separately until its payment is explicitly recorded.", '<button type="button" class="dart-finance-secondary" data-finance-export="cashflow">Export CSV</button>')}
      <div class="dart-finance-kpi-grid dart-finance-kpi-grid-three">
        ${kpiCard("Cash In", money(current.cashIn), "Recorded COD receipts", "fa-solid fa-arrow-down", "green", { current: current.cashIn, previous: previous.cashIn })}
        ${kpiCard("Cash Out", money(current.cashOut), "Recorded paid expenses + refunds + Dart-paid courier fees", "fa-solid fa-arrow-up", "burgundy", { current: current.cashOut, previous: previous.cashOut }, true)}
        ${kpiCard("Net Cash Change", money(current.netCashFlow), range.label, "fa-solid fa-scale-balanced", current.netCashFlow >= 0 ? "blue" : "red", { current: current.netCashFlow, previous: previous.netCashFlow })}
      </div>
      <article class="dart-finance-panel dart-statement-panel"><dl class="dart-statement-list"><div><dt>Order cash receipts</dt><dd>${money(current.cashIn)}</dd></div><div><dt>Paid operating expenses</dt><dd>(${money(current.paidExpenseCashOut)})</dd></div><div><dt>Courier allocation (included in item cost)</dt><dd>${money(current.deliveryCosts)}</dd></div><div><dt>Completed customer refunds</dt><dd>(${money(current.refundCashOut)})</dd></div><div><dt>Dart-paid representative fees</dt><dd>(${money(current.returnCourierCosts)})</dd></div><div><dt>Settlement fees</dt><dd>(${money(current.codFees)})</dd></div><div class="is-total"><dt>Net cash flow</dt><dd>${money(current.netCashFlow)}</dd></div></dl><p class="dart-report-caveat">Fees paid directly by the customer to the representative are deliberately excluded from Dart revenue and cash flow. Inventory Investment is not treated as cash paid unless a paid expense/payment record exists, preventing invented cash movements.</p></article>`;
  }

  function codRows(data, range) {
    return data.orders.filter(active).filter(isCOD).filter((order) => within(orderEventDate(order), range)).map((order) => {
      const { orderTotal, courierDue, dueToDart } = codDueForOrder(order);
      const received = settlementAmountForOrder(data, order);
      const remaining = roundMoney(Math.max(0, dueToDart - received));
      const status = remaining <= 0.009 && dueToDart > 0 ? "Settled" : received > 0 ? "Partial" : String(order.status).toLowerCase() === "delivered" ? "Awaiting Settlement" : "Expected";
      return { order, orderTotal, courierDue, due: dueToDart, received, remaining, status };
    });
  }

  function renderCOD(data, range) {
    const rows = codRows(data, range);
    return `${sectionToolbar("Cash on Delivery", "Courier fee is retained once per order. It is shown for reconciliation only because it is already included inside item cost and must not reduce profit twice.", '<button type="button" class="dart-finance-secondary" data-finance-export="cod">Export CSV</button>')}
      ${tableShell(["Order", "Delivery Date", "Order Status", "Order Total", "Courier Due", "Due to Dart", "Received", "Remaining", "Settlement", "Action"], rows.map(({ order, orderTotal, courierDue, due, received, remaining, status }) => `<tr><td><strong>${escapeHTML(order.orderId || order.id)}</strong></td><td>${escapeHTML(dateInputValue(orderEventDate(order)) || "-")}</td><td>${escapeHTML(order.status || "-")}</td><td>${money(orderTotal)}</td><td>${money(courierDue)}</td><td><strong>${money(due)}</strong></td><td>${money(received)}</td><td class="${remaining > 0 ? "is-negative" : ""}">${money(remaining)}</td><td><span class="dart-status-chip">${escapeHTML(status)}</span></td><td>${String(order.status).toLowerCase() === "delivered" && remaining > 0.009 ? `<button type="button" class="dart-table-primary" data-cod-settle="${escapeHTML(order.orderId || order.id)}">Record receipt</button>` : "—"}</td></tr>`).join(""), "No COD orders fall in the selected period.")}`;
  }

  function renderModels(data, range) {
    const rows = modelProfitability(data, range);
    return `${sectionToolbar("Model Profitability", "Gross contribution by model. Shared operating expenses are intentionally not allocated without a defined allocation rule.", '<button type="button" class="dart-finance-secondary" data-finance-export="models">Export CSV</button>')}
      ${tableShell(["Model", "Units", "Net Revenue", "COGS", "Gross Profit", "Gross Margin"], rows.map((row) => `<tr><td><strong>${escapeHTML(row.modelName)}</strong><small class="dart-table-sub">${escapeHTML(row.modelCode)}</small></td><td>${row.units}</td><td>${money(row.revenue)}</td><td>${money(row.cogs)}</td><td class="${row.profit < 0 ? "is-negative" : "is-positive"}">${money(row.profit)}</td><td>${percent(row.margin)}</td></tr>`).join(""), "No delivered model lines exist in the selected period.")}`;
  }

  function renderMarketing(data, range, summary) {
    const rows = summary.marketing.rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `${sectionToolbar("Marketing Analytics", "Manual or backend-imported campaign facts. Link spend to an expense to include it in P&L without duplication.", `<button type="button" class="dart-finance-secondary" data-finance-export="marketing">Export CSV</button><button type="button" class="dart-finance-primary" data-finance-add="marketing"><i class="fa-solid fa-plus"></i> Add Marketing Record</button>`)}
      <div class="dart-finance-kpi-grid">
        ${kpiCard("Tracked Spend", money(summary.marketing.spend), "Marketing analytics source", "fa-solid fa-wallet", "burgundy")}
        ${kpiCard("Attributed Revenue", money(summary.marketing.revenue), "Not additional accounting revenue", "fa-solid fa-sack-dollar", "green")}
        ${kpiCard("ROAS", `${decimal(summary.marketing.roas)}x`, "Attributed revenue ÷ spend", "fa-solid fa-arrow-trend-up", "blue")}
        ${kpiCard("CAC", money(summary.marketing.cac), "Spend ÷ attributed orders", "fa-solid fa-user-plus", "neutral")}
        ${kpiCard("CTR", percent(summary.marketing.ctr), "Clicks ÷ impressions", "fa-solid fa-computer-mouse", "neutral")}
        ${kpiCard("Conversion", percent(summary.marketing.conversion), "Attributed orders ÷ clicks", "fa-solid fa-bullseye", "neutral")}
      </div>
      ${tableShell(["Date", "Channel", "Campaign", "Spend", "Impressions", "Clicks", "Orders", "Revenue", "Expense Link", "Actions"], rows.map((row) => `<tr><td>${escapeHTML(row.date)}</td><td>${escapeHTML(row.channel)}</td><td>${escapeHTML(row.campaign || "-")}</td><td>${money(row.spend)}</td><td>${finiteNumber(row.impressions)}</td><td>${finiteNumber(row.clicks)}</td><td>${finiteNumber(row.orders)}</td><td>${money(row.attributedRevenue)}</td><td>${escapeHTML(row.linkedExpenseId || "Not linked")}</td><td>${actionButtons("marketing", row.id)}</td></tr>`).join(""), "No marketing records exist in the selected period.")}`;
  }

  function renderAlertRows(alerts) {
    if (!alerts.length) return '<div class="dart-finance-empty">No operational or financial alerts were triggered by the current records.</div>';
    return alerts.map((alert) => `<article class="dart-alert is-${escapeHTML(alert.severity)}"><i class="fa-solid ${alert.severity === "danger" ? "fa-circle-exclamation" : alert.severity === "warning" ? "fa-triangle-exclamation" : "fa-circle-info"}"></i><div><strong>${escapeHTML(alert.title)}</strong><p>${escapeHTML(alert.text)}</p></div></article>`).join("");
  }

  function renderAlerts(data, range, summary) {
    const alerts = operationalAlerts(data, range, summary);
    return `${sectionToolbar("Alerts", "Exceptions generated from current saved records and accounting integrity checks.")}<div class="dart-alert-list">${renderAlertRows(alerts)}</div>`;
  }

  function renderDrawLog() {
    const rows = readJSON(STORAGE_KEYS.drawAudit, []);
    return `${sectionToolbar("Dart Card Draw Eligibility Log", "Every inclusion or exclusion change is recorded with its previous value, new value, reason and timestamp.", '<button type="button" class="dart-finance-secondary" data-finance-export="drawlog">Export CSV</button>')}
      ${tableShell(["Timestamp", "Client", "Previous", "New", "Reason", "Actor"], rows.map((row) => `<tr><td>${escapeHTML(new Date(row.timestamp).toLocaleString("en-EG"))}</td><td><strong>${escapeHTML(row.clientName || "-")}</strong><small class="dart-table-sub">${escapeHTML(row.clientId || "-")}</small></td><td>${row.before ? "Eligible" : "Excluded"}</td><td>${row.after ? "Eligible" : "Excluded"}</td><td>${escapeHTML(row.reason || "-")}</td><td>${escapeHTML(row.actorRole || "Admin")}</td></tr>`).join(""), "No draw eligibility changes have been recorded.")}`;
  }

  function renderFinanceSection() {
    const content = document.getElementById("dart-finance-content");
    if (!content) return;
    const data = dashboardData();
    const range = currentRange();
    const current = authoritativeSummary(range);
    const previous = authoritativeSummary(range.previous);
    const summaryTabs = new Set(["overview", "pnl", "cashflow", "marketing", "alerts"]);

    if (summaryTabs.has(state.financeTab) && (!current || !previous)) {
      void hydrateAuthoritativeFinance(range);
      content.innerHTML = financeSummaryStatusMarkup(range);
      document.querySelectorAll("[data-finance-tab]").forEach((button) =>
        button.classList.toggle("active", button.dataset.financeTab === state.financeTab),
      );
      return;
    }

    const renderers = {
      overview: () => renderFinanceOverview(data, range, current, previous),
      expenses: () => renderExpenses(data, range),
      budgets: () => renderBudgets(data, range),
      invoices: () => renderInvoices(data, range),
      goals: () => renderGoals(data, range),
      pnl: () => renderPnL(current, previous, range),
      cashflow: () => renderCashFlow(current, previous, range),
      cod: () => renderCOD(data, range),
      models: () => renderModels(data, range),
      marketing: () => renderMarketing(data, range, current),
      alerts: () => renderAlerts(data, range, current),
      drawlog: () => renderDrawLog(),
    };
    content.innerHTML = (renderers[state.financeTab] || renderers.overview)();
    document.querySelectorAll("[data-finance-tab]").forEach((button) => button.classList.toggle("active", button.dataset.financeTab === state.financeTab));
  }

  function renderAllFinance() {
    renderBrandFinance();
    renderFinanceSection();
    enhanceCustomerDrawControls();
  }

  function resourceRecord(resource, id) {
    return FinanceRepository.list(resource).find((row) => String(row.id) === String(id)) || null;
  }

  function replaceSelectOptions(select, options) {
    if (!select) return;
    select.replaceChildren();
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  function openResourceModal(resource, id = null, preset = {}) {
    const form = document.getElementById("dart-finance-form");
    const modal = document.getElementById("dart-finance-modal");
    const section = document.querySelector(`[data-finance-form-resource="${resource}"]`);
    if (!form || !modal || !section) return;

    state.modalResource = resource;
    state.modalId = id;
    form.reset();
    document.querySelectorAll("[data-finance-form-resource]").forEach((item) => {
      item.hidden = item !== section;
      item.disabled = item !== section;
    });

    const record = { ...(id ? resourceRecord(resource, id) : {}), ...preset };
    const today = dateInputValue(new Date());
    const monthEnd = dateInputValue(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
    let title;
    let note = "";
    let defaults = {};
    if (resource === "expenses") {
      title = id ? "Edit Expense" : "Add Expense";
      defaults = { date: today, category: "Marketing", amount: "", status: "Unpaid", paidAt: "", paymentMethod: "", vendor: "", invoiceNumber: "", description: "", notes: "" };
      note = "Expense recognition uses Expense Date. Cash Flow uses Paid Date only when Status is Paid.";
    } else if (resource === "budgets") {
      title = id ? "Edit Budget" : "Add Budget";
      defaults = { name: "", category: "All", amount: "", warningPercent: 80, startDate: today, endDate: monthEnd };
    } else if (resource === "invoices") {
      title = id ? "Edit Invoice" : "Add Invoice";
      defaults = { number: "", type: "Supplier", issueDate: today, dueDate: monthEnd, total: "", amountPaid: 0, linkedId: "", notes: "" };
      note = "Invoices are control documents. Link them to the source order or expense; they never create a second revenue or expense entry.";
    } else if (resource === "goals") {
      title = id ? "Edit Goal" : "Add Goal";
      defaults = { name: "", metric: "revenue", target: "", startDate: today, endDate: monthEnd, status: "Active" };
    } else if (resource === "marketing") {
      const expenses = FinanceRepository.list("expenses").filter(active);
      title = id ? "Edit Marketing Record" : "Add Marketing Record";
      defaults = { date: today, channel: "Meta", campaign: "", spend: 0, impressions: 0, clicks: 0, orders: 0, attributedRevenue: 0, linkedExpenseId: "" };
      replaceSelectOptions(document.getElementById("finance-marketing-expense"), [["", "Not linked"], ...expenses.map((expense) => [expense.id, `${expense.date} · ${expense.category} · ${money(expense.amount)}`])]);
      note = "Attributed revenue is used only for ROAS and is not added to accounting revenue.";
    } else if (resource === "settlements") {
      const data = dashboardData();
      const orderId = record.orderId || "";
      const order = data.orders.find((entry) => String(entry.orderId || entry.id) === String(orderId));
      const due = order ? Math.max(0, codDueForOrder(order).dueToDart - settlementAmountForOrder(data, order)) : 0;
      title = "Record COD Receipt";
      defaults = { orderId, settlementDate: today, amountReceived: due, fee: 0, reference: "", notes: "" };
      replaceSelectOptions(document.getElementById("finance-settlement-order"), orderId ? [[orderId, orderId]] : [["", "No order selected"]]);
      const amountInput = document.getElementById("finance-settlement-amount");
      if (amountInput) amountInput.max = String(due);
      note = `Outstanding amount before this receipt: ${money(due)}.`;
    } else return;

    Object.entries({ ...defaults, ...record }).forEach(([name, value]) => {
      const control = section.querySelector(`[name="${name}"]`);
      if (control) control.value = value ?? "";
    });
    form.dataset.resource = resource;
    form.dataset.id = id || "";
    document.getElementById("finance-record-id").value = id || "";
    document.getElementById("dart-finance-modal-title").textContent = title;
    document.getElementById("dart-finance-modal-note").textContent = note;
    document.getElementById("dart-finance-form-submit").textContent = id ? "Save Changes" : "Save Record";
    const errorBox = document.getElementById("dart-finance-form-error");
    errorBox.textContent = "";
    errorBox.classList.remove("is-visible");
    modal.style.display = "block";
    modal.classList.add("active");
  }

  function closeFinanceModal() {
    const modal = document.getElementById("dart-finance-modal");
    if (!modal) return;
    modal.style.display = "none";
    modal.classList.remove("active");
    state.modalResource = null;
    state.modalId = null;
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function validateRecord(resource, payload, id) {
    const requiredDates = resource === "expenses" ? ["date"] : resource === "budgets" || resource === "goals" ? ["startDate", "endDate"] : resource === "invoices" ? ["issueDate", "dueDate"] : resource === "marketing" ? ["date"] : resource === "settlements" ? ["settlementDate"] : [];
    if (requiredDates.some((key) => !parseDate(payload[key]))) return "Enter every required date.";
    if ((resource === "budgets" || resource === "goals") && parseDate(payload.startDate) > parseDate(payload.endDate)) return "End Date must be on or after Start Date.";
    if (resource === "invoices" && parseDate(payload.issueDate) > parseDate(payload.dueDate)) return "Due Date must be on or after Issue Date.";
    if (resource === "expenses" && finiteNumber(payload.amount) <= 0) return "Expense Amount must be greater than zero.";
    if (resource === "expenses" && payload.status === "Paid" && !parseDate(payload.paidAt)) return "Paid Date is required when Status is Paid.";
    if (resource === "expenses" && payload.status === "Paid" && !parseDate(payload.paidAt)) return "Paid Date is required when Status is Paid.";
    if (resource === "budgets" && finiteNumber(payload.amount) <= 0) return "Budget Limit must be greater than zero.";
    if (resource === "goals" && finiteNumber(payload.target) <= 0) return "Goal Target must be greater than zero.";
    if (resource === "invoices") {
      if (finiteNumber(payload.total) <= 0) return "Invoice Total must be greater than zero.";
      if (finiteNumber(payload.amountPaid) < 0 || finiteNumber(payload.amountPaid) > finiteNumber(payload.total)) return "Amount Paid must be between zero and the invoice total.";
      if (FinanceRepository.list("invoices").some((row) => active(row) && String(row.id) !== String(id) && String(row.number).toLowerCase() === String(payload.number).toLowerCase())) return "Invoice Number must be unique.";
    }
    if (resource === "marketing") {
      const fields = ["spend", "impressions", "clicks", "orders", "attributedRevenue"];
      if (fields.some((key) => finiteNumber(payload[key]) < 0)) return "Marketing values cannot be negative.";
      if (finiteNumber(payload.clicks) > finiteNumber(payload.impressions) && finiteNumber(payload.impressions) > 0) return "Clicks cannot exceed impressions.";
    }
    if (resource === "settlements") {
      const data = dashboardData();
      const order = data.orders.find((entry) => String(entry.orderId || entry.id) === String(payload.orderId));
      if (!order || !isCOD(order) || String(order.status).toLowerCase() !== "delivered") return "Select a delivered COD order.";
      const remaining = Math.max(0, codDueForOrder(order).dueToDart - settlementAmountForOrder(data, order));
      if (finiteNumber(payload.amountReceived) <= 0 || finiteNumber(payload.amountReceived) - remaining > 0.009) return `Receipt cannot exceed the outstanding ${money(remaining)}.`;
      if (finiteNumber(payload.fee) < 0 || finiteNumber(payload.fee) > finiteNumber(payload.amountReceived)) return "COD Fee must be between zero and the received amount.";
    }
    return "";
  }

  function normalizeRecord(resource, payload, existing) {
    const numberFields = {
      expenses: ["amount"], budgets: ["amount", "warningPercent"], invoices: ["total", "amountPaid"], goals: ["target"],
      marketing: ["spend", "impressions", "clicks", "orders", "attributedRevenue"], settlements: ["amountReceived", "fee"],
    }[resource] || [];
    const normalized = { ...(existing || {}), ...payload };
    numberFields.forEach((key) => { normalized[key] = roundMoney(payload[key]); });
    if (["impressions", "clicks", "orders"].some((key) => numberFields.includes(key))) {
      ["impressions", "clicks", "orders"].forEach((key) => { normalized[key] = Math.trunc(Math.max(0, finiteNumber(payload[key]))); });
    }
    normalized.id = existing?.id || uid(resource.slice(0, 4).toUpperCase());
    normalized.createdAt = existing?.createdAt || new Date().toISOString();
    normalized.updatedAt = new Date().toISOString();
    normalized.archivedAt = null;
    if (resource === "invoices") normalized.status = invoiceStatus(normalized);
    if (resource === "settlements") normalized.status = "Received";
    return normalized;
  }

  function saveFinanceForm(form) {
    const resource = form.dataset.resource;
    const id = form.dataset.id;
    const payload = formValues(form);
    const error = validateRecord(resource, payload, id);
    const errorBox = form.querySelector(".dart-finance-form-error");
    if (error) {
      errorBox.textContent = error;
      errorBox.classList.add("is-visible");
      return;
    }
    const existing = id ? resourceRecord(resource, id) : null;
    const normalized = normalizeRecord(resource, payload, existing);
    FinanceRepository.upsert(resource, normalized);
    FinanceRepository.audit(existing ? "UPDATE" : "CREATE", resource, normalized.id, existing, normalized);
    try {
      if (typeof dartNotify === "function") dartNotify("payment", `${resource.slice(0, -1)} ${existing ? "updated" : "created"}`, normalized.name || normalized.number || normalized.description || normalized.id, `finance:${resource}`, normalized.id);
      if (typeof dartSaveAll === "function") dartSaveAll();
    } catch {
      // Standalone mode has no dashboard notification layer.
    }
    closeFinanceModal();
    renderAllFinance();
  }

  async function deleteFinanceRecord(resource, id) {
    const record = resourceRecord(resource, id);
    if (!record) return;
    if (!await root.DartDialog.confirm(`Archive this ${resource.slice(0, -1)} record? Its audit history will be kept.`)) return;
    const before = { ...record };
    const archived = FinanceRepository.archive(resource, id);
    FinanceRepository.audit("ARCHIVE", resource, id, before, archived);
    renderAllFinance();
  }

  function enhanceCustomerDrawControls() {
    if (!document.getElementById("customers-draw-entry-header")) return;
    const rows = document.querySelectorAll("#customers-container .model-row");
    rows.forEach((row) => {
      if (row.querySelector("[data-dart-draw-toggle]")) return;
      const id = row.dataset.id;
      const customer = typeof customersData !== "undefined" ? customersData.find((entry) => String(entry.id) === String(id)) : null;
      if (!customer) return;
      const eligible = customer.dartCardDrawEligible !== false;
      const template = document.getElementById("customer-draw-toggle-template");
      const control = template?.content.firstElementChild?.cloneNode(true);
      const button = control?.querySelector("[data-dart-draw-toggle]");
      if (!control || !button) return;
      button.classList.add(eligible ? "is-eligible" : "is-excluded");
      button.dataset.id = id;
      button.disabled = !active(customer);
      button.querySelector("[data-draw-label]").textContent = eligible ? "Eligible" : "Excluded";
      row.appendChild(control);
    });
  }

  async function changeDrawEligibility(id) {
    if (typeof customersData === "undefined") return;
    const customer = customersData.find((entry) => String(entry.id) === String(id));
    if (!customer || !active(customer)) return;

    const before = customer.dartCardDrawEligible !== false;
    const after = !before;
    const reason = await root.DartDialog.prompt(
      `${after ? "Include" : "Exclude"} ${customer.clientName} ${after ? "in" : "from"} the Dart Card draw. Optional reason:`,
      "",
    );
    if (reason === null) return;

    if (customer.serverAuthoritative) {
      if (!root.DartAdminApi?.request) {
        root.DartDialog.alert("Secure admin API is unavailable.");
        return;
      }
      try {
        await root.DartAdminApi.request(
          `/api/v1/admin/customers/${encodeURIComponent(customer.id)}/dart-card-draw-eligibility`,
          {
            method: "PATCH",
            body: { eligible: after, reason: reason.trim() },
          },
        );
      } catch (error) {
        root.DartDialog.alert(error.message || "Could not update Dart Card draw eligibility.");
        return;
      }
    }

    customer.dartCardDrawEligible = after;
    customer.dartCardDrawEligibilityUpdatedAt = new Date().toISOString();

    const log = readJSON(STORAGE_KEYS.drawAudit, []);
    log.unshift({
      id: uid("DRAW"),
      action: "DART_CARD_DRAW_ELIGIBILITY_CHANGED",
      clientRecordId: customer.id,
      clientId: customer.clientId,
      clientName: customer.clientName,
      before,
      after,
      reason: reason.trim(),
      actorRole: "Admin",
      actorId: null,
      timestamp: new Date().toISOString(),
    });
    writeJSON(STORAGE_KEYS.drawAudit, log);

    if (customer.serverAuthoritative && root.DartDomainState?.hydrateDomain) {
      await root.DartDomainState.hydrateDomain("customers", true).catch(() => {});
      await root.DartDomainState.hydrateAudit?.().catch(() => {});
    } else {
      if (typeof dartSaveAll === "function") dartSaveAll();
    }

    if (typeof dartRefreshAll === "function") dartRefreshAll();
    else renderAllFinance();
  }

  function activateFinance(tab = state.financeTab) {
    state.financeTab = tab;
    document.querySelectorAll(".dashboard-section").forEach((section) => section.classList.toggle("active-section", section.id === "finance"));
    document.querySelectorAll("[data-target]").forEach((link) => link.classList.toggle("active", link.dataset.target === "finance"));
    getStorage()?.setItem("dart_active_section", "finance");
    renderFinanceSection();
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCSV(filename, headers, rows) {
    const body = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportReport(report) {
    const data = dashboardData();
    const range = currentRange();
    const stamp = `${dateInputValue(range.start)}_${dateInputValue(range.end)}`;
    if (COLLECTIONS.includes(report)) {
      let rows = FinanceRepository.list(report).filter(active);
      if (report === "expenses") rows = rows.filter((row) => within(row.date, range));
      else if (report === "invoices") rows = rows.filter((row) => within(row.issueDate, range));
      else if (report === "marketing") rows = rows.filter((row) => within(row.date, range));
      else if (report === "settlements") rows = rows.filter((row) => within(row.settlementDate, range));
      else if (report === "budgets") rows = rows.filter((row) => startOfDay(row.startDate) <= range.end && endOfDay(row.endDate) >= range.start);
      else if (report === "goals") rows = rows.filter((row) => startOfDay(row.startDate) <= range.end && endOfDay(row.endDate) >= range.start);
      const headers = EXPORT_FIELDS[report];
      downloadCSV(`dart-${report}-${stamp}.csv`, headers, rows.map((row) => headers.map((key) => row[key] ?? "")));
      return;
    }
    const needsAuthoritativeSummary = report === "pnl" || report === "cashflow";
    const summary = needsAuthoritativeSummary ? authoritativeSummary(range) : null;
    if (needsAuthoritativeSummary && !summary) {
      void hydrateServerFinanceSummary(range)
        .then(() => exportReport(report))
        .catch(() => undefined);
      return;
    }
    if (report === "pnl") downloadCSV(`dart-pnl-${stamp}.csv`, ["Account", "Amount EGP"], [["Gross Revenue", summary.grossRevenue], ["Refunds", -summary.refunds], ["Total Selling", summary.netRevenue], ["Sold-piece Cost (includes courier allocation)", -summary.netCogs], ["Operating Expenses", -summary.operatingExpenses], ["Courier Allocation (informational)", summary.deliveryCosts], ["Settlement Fees", -summary.codFees], ["Representative Exchange Fees", -summary.returnCourierCosts], ["Damage Write-offs", -summary.damageLoss], ["Total Profit", summary.netProfit]]);
    else if (report === "cashflow") downloadCSV(`dart-cash-flow-${stamp}.csv`, ["Cash Flow", "Amount EGP"], [["Cash In to Dart", summary.cashIn], ["Paid Expenses", -summary.paidExpenseCashOut], ["Courier Allocation (retained before Dart receipt)", summary.deliveryCosts], ["Completed Refunds", -summary.refundCashOut], ["Dart-paid Representative Fees", -summary.returnCourierCosts], ["Settlement Fees", -summary.codFees], ["Net Cash Flow", summary.netCashFlow]]);
    else if (report === "cod") downloadCSV(`dart-cod-${stamp}.csv`, ["Order", "Order Total", "Courier Due", "Due to Dart", "Received", "Remaining", "Status"], codRows(data, range).map((row) => [row.order.orderId || row.order.id, row.orderTotal, row.courierDue, row.due, row.received, row.remaining, row.status]));
    else if (report === "models") downloadCSV(`dart-model-profitability-${stamp}.csv`, ["Model Code", "Model", "Units", "Net Revenue", "COGS", "Gross Profit", "Gross Margin %"], modelProfitability(data, range).map((row) => [row.modelCode, row.modelName, row.units, row.revenue, row.cogs, row.profit, decimal(row.margin)]));
    else if (report === "drawlog") {
      const rows = readJSON(STORAGE_KEYS.drawAudit, []);
      downloadCSV(`dart-draw-eligibility-log-${stamp}.csv`, ["Timestamp", "Client ID", "Client", "Previous", "New", "Reason", "Actor"], rows.map((row) => [row.timestamp, row.clientId, row.clientName, row.before ? "Eligible" : "Excluded", row.after ? "Eligible" : "Excluded", row.reason, row.actorRole]));
    }
  }

  function bindEvents() {
    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-period-preset]")) setPeriod({ preset: event.target.value });
      if (event.target.matches("[data-period-start]")) setPeriod({ start: event.target.value, preset: "custom" });
      if (event.target.matches("[data-period-end]")) setPeriod({ end: event.target.value, preset: "custom" });
    });
    document.addEventListener("submit", (event) => {
      if (!event.target.matches("#dart-finance-form")) return;
      event.preventDefault();
      saveFinanceForm(event.target);
    });
    document.addEventListener("click", async (event) => {
      const financeLink = event.target.closest('[data-target="finance"]');
      if (financeLink) { event.preventDefault(); activateFinance(); return; }
      const tab = event.target.closest("[data-finance-tab]");
      if (tab) { state.financeTab = tab.dataset.financeTab; renderFinanceSection(); return; }
      const openTab = event.target.closest("[data-open-finance-tab]");
      if (openTab) { activateFinance(openTab.dataset.openFinanceTab); return; }
      const add = event.target.closest("[data-finance-add]");
      if (add) { openResourceModal(add.dataset.financeAdd); return; }
      const edit = event.target.closest("[data-finance-edit]");
      if (edit) { openResourceModal(edit.dataset.financeEdit, edit.dataset.id); return; }
      const remove = event.target.closest("[data-finance-delete]");
      if (remove) { await deleteFinanceRecord(remove.dataset.financeDelete, remove.dataset.id); return; }
      const settle = event.target.closest("[data-cod-settle]");
      if (settle) { openResourceModal("settlements", null, { orderId: settle.dataset.codSettle }); return; }
      const exportButton = event.target.closest("[data-finance-export]");
      if (exportButton) { exportReport(exportButton.dataset.financeExport); return; }
      const draw = event.target.closest("[data-dart-draw-toggle]");
      if (draw) { await changeDrawEligibility(draw.dataset.id); return; }
      if (event.target.closest(".dart-finance-modal-close,.dart-finance-modal-cancel") || event.target.id === "dart-finance-modal") closeFinanceModal();
    });
    root.addEventListener("storage", (event) => {
      if (Object.values(STORAGE_KEYS).includes(event.key) || ["dart_orders", "dart_returns", "dart_items", "dart_models", "dart_customers", "dart_damage"].includes(event.key)) renderAllFinance();
    });
    root.addEventListener("dart:domain-hydrated", (event) => {
      if (
        ["finance_expenses","finance_budgets","finance_invoices","finance_goals","finance_marketing","finance_settlements","customers","returns","damage"].includes(event.detail?.domain)
      ) {
        invalidateAuthoritativeFinance();
        renderAllFinance();
      }
    });
    root.addEventListener("dart:orders-hydrated", () => {
      invalidateAuthoritativeFinance();
      renderAllFinance();
    });
    root.addEventListener("dart:catalog-hydrated", () => {
      invalidateAuthoritativeFinance();
      renderAllFinance();
    });
  }

  function wrapDashboardRefresh() {
    try {
      if (typeof dartRefreshAll === "function" && !dartRefreshAll.dartFinanceWrapped) {
        const previousRefresh = dartRefreshAll;
        const wrapped = function (...args) {
          const result = previousRefresh.apply(this, args);
          root.setTimeout(renderAllFinance, 0);
          return result;
        };
        wrapped.dartFinanceWrapped = true;
        dartRefreshAll = wrapped;
      }
    } catch {
      // The module can still render independently.
    }
  }

  function wrapCustomerRenderer() {
    try {
      if (typeof renderCustomers !== "function" || renderCustomers.dartFinanceWrapped) return;
      const previousRenderer = renderCustomers;
      const wrapped = function (...args) {
        const result = previousRenderer.apply(this, args);
        enhanceCustomerDrawControls();
        return result;
      };
      wrapped.dartFinanceWrapped = true;
      renderCustomers = wrapped;
      if (typeof sectionsMap !== "undefined" && sectionsMap.customers) sectionsMap.customers.render = wrapped;
    } catch {
      // The draw control is also restored by renderAllFinance as a safe fallback.
    }
  }

  loadPeriodState();
  renderPeriodControls();
  bindEvents();
  wrapDashboardRefresh();
  wrapCustomerRenderer();

  document.addEventListener("DOMContentLoaded", () => {
    renderPeriodControls();
    root.dispatchEvent(new CustomEvent("dart:finance-period-changed", {
      detail: currentRangeSelection(),
    }));
    renderAllFinance();
    const saved = getStorage()?.getItem("dart_active_section");
    if (requestedInitialSection === "finance" || saved === "finance") activateFinance();
  });
  root.addEventListener("dart:admin-authenticated", () => {
    adminAuthenticated = true;
    serverFinanceDenied = false;
    financeBackoffMs = 5_000;
    financeWarnedBackoffMs = 0;
    void refreshFinanceFromServer(true);
  });
  root.addEventListener("focus", () => {
    if (
      adminAuthenticated &&
      !serverFinanceDenied &&
      Date.now() - financeLastAttemptAt >= FINANCE_REFRESH_MS
    ) {
      void refreshFinanceFromServer(true);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(serverFinanceRefreshTimer);
      return;
    }
    if (adminAuthenticated && !serverFinanceDenied) scheduleFinanceRefresh(1_000);
  });
})(typeof window !== "undefined" ? window : globalThis);

// END MODULE
