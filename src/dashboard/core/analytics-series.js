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
