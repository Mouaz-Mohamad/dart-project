// DART CODE GUIDE | Eye/dart-order-group-ui.js
// الغرض: Orders UI فقط — مجموعات قابلة للفتح، وحالة New تعرض Accept + Reject فقط.
(function (root) {
  "use strict";

  const GROUP = "[data-operation-group-heading]";

  function normalizeNewOrderActions() {
    document.querySelectorAll('[data-order-target="Accepted"]').forEach((accept) => {
      const controls = accept.parentElement;
      if (!controls) return;
      accept.textContent = "Accept";
      controls.querySelectorAll('[data-order-cod-decision],[data-order-target="Cancelled"]').forEach((button) => button.remove());
      if (controls.querySelector('[data-dart-initial-reject="1"]')) return;
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "dart-cancel-btn";
      reject.dataset.orderTarget = "Cancelled";
      reject.dataset.dartInitialReject = "1";
      reject.textContent = "Reject";
      accept.insertAdjacentElement("afterend", reject);
    });
  }

  function groupCount(heading) {
    const title = heading.querySelector('[data-operation-group-field="title"]')?.textContent || "";
    const match = title.match(/group\s*[·:-]?\s*(\d+)/i) || title.match(/(\d+)\s+orders?/i);
    return Math.max(0, Number(match?.[1] || 0));
  }

  function groupRows(heading) {
    const count = groupCount(heading);
    const rows = [];
    let node = heading.nextElementSibling;
    while (node && rows.length < count) {
      if (node.matches?.(GROUP)) break;
      rows.push(node);
      node = node.nextElementSibling;
    }
    return rows;
  }

  function applyState(heading, expanded) {
    heading.dataset.dartGroupExpanded = expanded ? "1" : "0";
    heading.setAttribute("aria-expanded", String(expanded));
    groupRows(heading).forEach((row) => {
      row.hidden = !expanded;
      row.dataset.dartGroupedOrderChild = "1";
    });
    const note = heading.querySelector('[data-operation-group-field="note"]');
    if (!note) return;
    const base = note.dataset.dartBaseNote || note.textContent || "";
    note.dataset.dartBaseNote = base;
    note.textContent = `${base}${base ? " · " : ""}${expanded ? "Tap to close" : "Tap to open orders"}`;
  }

  function enhanceHeading(heading) {
    if (!heading || heading.dataset.dartGroupToggleBound === "1" || !groupCount(heading)) return;
    heading.dataset.dartGroupToggleBound = "1";
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.style.cursor = "pointer";
    heading.style.userSelect = "none";
    const toggle = () => applyState(heading, heading.dataset.dartGroupExpanded !== "1");
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    applyState(heading, false);
  }

  function enhanceAll() {
    normalizeNewOrderActions();
    document.querySelectorAll(GROUP).forEach(enhanceHeading);
  }

  function init() {
    const container = document.getElementById("orders-container");
    if (!container || container.dataset.dartGroupObserver === "1") return;
    container.dataset.dartGroupObserver = "1";
    enhanceAll();
    new MutationObserver(enhanceAll).observe(container, { childList: true, subtree: false });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  root.addEventListener("dart:orders-hydrated", () => root.requestAnimationFrame?.(enhanceAll));
  root.addEventListener("dart:orders-synced", () => root.requestAnimationFrame?.(enhanceAll));
})(window);
