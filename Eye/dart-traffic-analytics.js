// DART CODE GUIDE | Eye/dart-traffic-analytics.js
// الغرض: Brand-only traffic/funnel analytics; lazy-loaded to keep dashboard core light.
(function installDartTrafficAnalytics(root) {
  "use strict";
  if (root.DartTrafficAnalyticsLoaded) return;
  root.DartTrafficAnalyticsLoaded = true;

const ctxTow = document.getElementById("analyticsChartTow")?.getContext("2d") || null;
let trafficAggregationTow = "daily";
let trafficHourlyWindowTow = 7;
let trafficRequestGenerationTow = 0;
let trafficReportTow = null;

const AnalyticsChartTow =
  typeof Chart === "function"
    ? Chart
    : class {
        constructor(_ctx, config) { this.data = config.data; }
        update() {}
        toBase64Image() { return ""; }
      };

const analyticsChartTow = ctxTow
  ? new AnalyticsChartTow(ctxTow, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            type: "line",
            label: "Unique Visitors",
            data: [],
            borderColor: "#ab012b",
            backgroundColor: "rgba(171, 1, 43, 0.12)",
            fill: true,
            tension: 0.32,
            pointRadius: 3,
            yAxisID: "yTrafficTow",
          },
          {
            type: "line",
            label: "Cart Visitors",
            data: [],
            borderColor: "#bf506d",
            backgroundColor: "rgba(191, 80, 109, 0.08)",
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            borderDash: [5, 4],
            yAxisID: "yTrafficTow",
          },
          {
            type: "bar",
            label: "Ordered Pieces",
            data: [],
            backgroundColor: "#1abc9c",
            borderRadius: 5,
            yAxisID: "yTrafficTow",
            barPercentage: 0.6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end" },
          tooltip: { cornerRadius: 8, padding: 10 },
        },
        scales: {
          x: { grid: { display: false } },
          yTrafficTow: {
            type: "linear",
            position: "left",
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: "Count" },
            grid: { color: "#f0f0f0" },
          },
        },
      },
    })
  : null;

function trafficRangeTow() {
  return window.DartFinance?.currentRangeSelection?.() || null;
}

function trafficNumberTow(value) {
  return new Intl.NumberFormat("en-EG").format(Math.max(0, Number(value) || 0));
}

function trafficCairoTodayTow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function trafficShiftDateTow(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function trafficHourlyRangeTow() {
  const end = trafficCairoTodayTow();
  const days = [1, 7, 30].includes(Number(trafficHourlyWindowTow)) ? Number(trafficHourlyWindowTow) : 7;
  return { start: trafficShiftDateTow(end, -(days - 1)), end };
}

function effectiveTrafficRangeTow(range = trafficRangeTow()) {
  return trafficAggregationTow === "hourly" ? trafficHourlyRangeTow() : range;
}

function syncTrafficHourlyControlsTow() {
  const wrapper = document.getElementById("trafficHourWindowWrapTow");
  if (wrapper) wrapper.hidden = trafficAggregationTow !== "hourly";
}

function setTrafficKpiTow(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = trafficNumberTow(value);
}

function trafficDateTimeTow(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-EG", {
    timeZone: "Africa/Cairo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderTrafficVisitorsTow(visitors = [], detailsLimit = 250) {
  const body = document.getElementById("trafficVisitorDetailsTow");
  const status = document.getElementById("trafficDetailStatusTow");
  if (!body) return;
  body.replaceChildren();
  if (!visitors.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No visitors were recorded in this period.";
    row.appendChild(cell);
    body.appendChild(row);
    if (status) status.textContent = "0 visitors";
    return;
  }
  visitors.forEach((visitor) => {
    const row = document.createElement("tr");
    const values = [
      visitor.clientCode ? `${visitor.name} · ${visitor.clientCode}` : visitor.name,
      visitor.type,
      trafficNumberTow(visitor.visits),
      trafficNumberTow(visitor.addToCartEvents),
      trafficNumberTow(visitor.itemsAdded),
      trafficNumberTow(visitor.completedOrders),
      trafficDateTimeTow(visitor.firstVisit),
      trafficDateTimeTow(visitor.lastVisit),
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "—");
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  if (status) {
    status.textContent = visitors.length >= detailsLimit
      ? `Top ${detailsLimit} visitors by activity`
      : `${visitors.length} visitor${visitors.length === 1 ? "" : "s"}`;
  }
}

function renderTrafficReportTow(report) {
  trafficReportTow = report;
  const summary = report?.summary || {};
  setTrafficKpiTow("trafficUniqueVisitorsTow", summary.uniqueVisitors);
  setTrafficKpiTow("trafficVisitsTow", summary.visits);
  setTrafficKpiTow("trafficCartVisitorsTow", summary.addToCartVisitors);
  setTrafficKpiTow("trafficAddEventsTow", summary.addToCartEvents);
  setTrafficKpiTow("trafficItemsAddedTow", summary.itemsAdded);
  setTrafficKpiTow("trafficOrdersTow", summary.ordersPlaced ?? summary.completedOrders);
  setTrafficKpiTow("trafficOrderedPiecesTow", summary.orderedPieces);

  const period = document.getElementById("trafficPeriodLabelTow");
  if (period) {
    period.textContent = report.group === "hourly"
      ? `${report.start} → ${report.end} · hourly audience pattern · Cairo time`
      : `${report.start} → ${report.end} · grouped ${report.group}`;
  }

  const series = Array.isArray(report?.series) ? report.series : [];
  const note = document.getElementById("chartNoteTextTow");
  if (note) {
    if (report.group === "hourly" && series.length) {
      const peak = [...series].sort((a, b) => Number(b.uniqueVisitors || 0) - Number(a.uniqueVisitors || 0))[0];
      const hasHourlyActivity = series.some((row) =>
        Number(row.uniqueVisitors || 0) > 0 ||
        Number(row.addToCartVisitors || 0) > 0 ||
        Number(row.orderedPieces || 0) > 0
      );
      note.textContent = hasHourlyActivity
        ? `Peak audience: ${peak?.label || "—"} · ${trafficNumberTow(peak?.uniqueVisitors)} unique visitors · ${trafficNumberTow(peak?.addToCartVisitors)} added to cart · ${trafficNumberTow(peak?.orderedPieces)} ordered pieces`
        : "No hourly audience activity was recorded in this window.";
    } else {
      note.textContent = `${trafficNumberTow(summary.uniqueVisitors)} unique visitors · ${trafficNumberTow(summary.visits)} visits · Add-to-cart rate ${Number(summary.addToCartRate || 0).toFixed(1)}% · Conversion rate ${Number(summary.conversionRate || 0).toFixed(1)}%`;
    }
  }

  if (analyticsChartTow) {
    analyticsChartTow.data.labels = series.map((row) => row.label);
    analyticsChartTow.data.datasets[0].label = "Unique Visitors";
    analyticsChartTow.data.datasets[1].label = "Cart Visitors";
    analyticsChartTow.data.datasets[2].label = "Ordered Pieces";
    analyticsChartTow.data.datasets[0].data = series.map((row) => Number(row.uniqueVisitors) || 0);
    analyticsChartTow.data.datasets[1].data = series.map((row) => Number(row.addToCartVisitors) || 0);
    analyticsChartTow.data.datasets[2].data = series.map((row) => Number(row.orderedPieces) || 0);
    analyticsChartTow.update();
  }
  renderTrafficVisitorsTow(report?.visitors || [], Number(report?.detailsLimit) || 250);
}

function renderTrafficLoadingTow(message = "Loading website analytics…") {
  const note = document.getElementById("chartNoteTextTow");
  if (note) note.textContent = message;
}

async function refreshTrafficAnalyticsTow(range = trafficRangeTow()) {
  const selectedRange = effectiveTrafficRangeTow(range);
  if (!selectedRange?.start || !selectedRange?.end || !window.DartAdminApi?.request) return;
  const generation = ++trafficRequestGenerationTow;
  renderTrafficLoadingTow();
  try {
    const report = await window.DartAdminApi.request(
      `/api/v1/admin/analytics/traffic?start=${encodeURIComponent(selectedRange.start)}&end=${encodeURIComponent(selectedRange.end)}&group=${encodeURIComponent(trafficAggregationTow)}`,
    );
    if (generation !== trafficRequestGenerationTow) return;
    renderTrafficReportTow(report);
  } catch (error) {
    if (generation !== trafficRequestGenerationTow) return;
    renderTrafficLoadingTow(error?.message || "Website analytics are temporarily unavailable.");
    renderTrafficVisitorsTow([]);
  }
}

function updateChartTow(period, btn) {
  if (!["hourly", "daily", "weekly", "monthly", "yearly"].includes(period)) return;
  trafficAggregationTow = period;
  document.querySelectorAll(".filter-btn-tow").forEach((button) => {
    button.classList.toggle("active-tow", button === btn);
  });
  syncTrafficHourlyControlsTow();
  void refreshTrafficAnalyticsTow();
}

function exportChartPNGTow() {
  if (!analyticsChartTow?.toBase64Image) return;
  const imageURI = analyticsChartTow.toBase64Image();
  if (!imageURI) return;
  const link = document.createElement("a");
  link.download = "dart-traffic-conversion-report.png";
  link.href = imageURI;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.querySelectorAll("[data-chart-period-tow]").forEach((button) => {
  button.addEventListener("click", () => {
    updateChartTow(String(button.dataset.chartPeriodTow || "daily"), button);
  });
});
document.getElementById("trafficHourWindowTow")?.addEventListener("change", (event) => {
  const days = Number(event.target?.value || 7);
  trafficHourlyWindowTow = [1, 7, 30].includes(days) ? days : 7;
  if (trafficAggregationTow === "hourly") void refreshTrafficAnalyticsTow();
});
syncTrafficHourlyControlsTow();
document.getElementById("exportChartTowBtn")?.addEventListener("click", exportChartPNGTow);
window.addEventListener("dart:finance-period-changed", (event) => {
  void refreshTrafficAnalyticsTow(event.detail || trafficRangeTow());
});
window.addEventListener("dart:admin-authenticated", () => {
  window.setTimeout(() => void refreshTrafficAnalyticsTow(), 0);
});
document.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(() => void refreshTrafficAnalyticsTow(), 0);
});
})(window);
