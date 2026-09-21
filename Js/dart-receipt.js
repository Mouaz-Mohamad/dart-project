(function () {
  "use strict";

  const items = Object.freeze([
    Object.freeze({ name: "Jeans 9 oz", qty: 2, price: 450 }),
    Object.freeze({ name: "Dart Brand T-Shirt", qty: 3, price: 250 }),
    Object.freeze({ name: "Black Winter Hoodie", qty: 1, price: 600 }),
  ]);

  function loadReceipt() {
    const date = document.getElementById("current-date");
    const body = document.getElementById("receipt-items");
    const grandTotal = document.getElementById("grand-total");
    if (!date || !body || !grandTotal) return;

    date.textContent = new Date().toLocaleDateString("en-GB");
    body.replaceChildren();

    let totalAmount = 0;
    for (const item of items) {
      const lineTotal = item.qty * item.price;
      totalAmount += lineTotal;

      const row = document.createElement("tr");
      for (const value of [item.name, item.qty, `${lineTotal} EGP`]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    grandTotal.textContent = String(totalAmount);
  }

  document.addEventListener("DOMContentLoaded", loadReceipt);
  document
    .getElementById("printReceiptBtn")
    ?.addEventListener("click", () => window.print());
})();
