let currentMode = "months";
let currentYear = new Date().getFullYear();

var options = {
  series: [{ name: "Net Profit", data: [] }],
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
  if (window.DartFinance?.renderMonthlyProfit) return window.DartFinance.renderMonthlyProfit();
  const status = document.getElementById("monthly-profit-status");
  if (status) status.textContent = "Loading net profit…";
}

// تشغيل مبدئي
updateChart();

// البحث التلقائي وتعبئة بيانات العميل عبر برقم الهاتف
