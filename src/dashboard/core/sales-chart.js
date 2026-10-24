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
