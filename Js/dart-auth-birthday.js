// DART | FOR YOU — shared signup/checkout DOB selector; submits one ISO birthday field.
(() => {
  "use strict";

  function initialize() {
    const form = document.getElementById("registerForm") || document.getElementById("checkoutForm");
    const day = document.getElementById("dartBirthDay");
    const month = document.getElementById("dartBirthMonth");
    const year = document.getElementById("dartBirthYear");
    const value = form?.elements.namedItem("birthday");
    if (!form || !day || !month || !year || !value) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    for (let y = currentYear; y >= 1900; y--) {
      year.add(new Option(String(y), String(y)));
    }

    function synchronize() {
      const previous = day.value;
      const selectedYear = Number(year.value) || 2000;
      const selectedMonth = Number(month.value);
      const available = selectedMonth
        ? new Date(selectedYear, selectedMonth, 0).getDate()
        : 31;

      if (day.options.length !== available + 1) {
        day.replaceChildren(new Option("Day", ""));
        for (let d = 1; d <= available; d++) day.add(new Option(String(d), String(d)));
        if (previous && Number(previous) <= available) day.value = previous;
      }

      value.value = "";
      year.setCustomValidity("");
      if (!day.value && !month.value && !year.value) return;
      if (!day.value || !month.value || !year.value) {
        year.setCustomValidity("Complete your birthday or leave every date field blank.");
        return;
      }

      const y = Number(year.value);
      const m = Number(month.value);
      const d = Number(day.value);
      const inFuture = y > currentYear ||
        (y === currentYear && (m > today.getMonth() + 1 ||
          (m === today.getMonth() + 1 && d > today.getDate())));
      if (inFuture) {
        year.setCustomValidity("Choose a birth date that is not in the future.");
        return;
      }
      value.value = [y, String(m).padStart(2, "0"), String(d).padStart(2, "0")].join("-");
    }

    function restore() {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.value);
      year.value = parts ? String(Number(parts[1])) : "";
      month.value = parts ? String(Number(parts[2])) : "";
      day.value = "";
      synchronize();
      if (parts) day.value = String(Number(parts[3]));
      synchronize();
    }

    [day, month, year].forEach(select => select.addEventListener("change", synchronize));
    value.addEventListener("change", restore);
    form.addEventListener("reset", () => window.setTimeout(restore, 0));
    restore();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
