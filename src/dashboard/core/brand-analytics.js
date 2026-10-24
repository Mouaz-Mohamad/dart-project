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
      '<option value="all">All dates</option><option value="current">This Month</option><option value="none">None</option>' +
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
      '<option value="all">All years</option><option value="none">None</option>' +
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
        if (selectedYear === 'all' || selectedMonth === 'all') return true;
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

