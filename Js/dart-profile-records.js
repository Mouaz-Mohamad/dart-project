// DART CODE GUIDE | Js/dart-profile-records.js
// Profile Orders / Returns / Waiting compact rows + centered detail modal.
(function initDartProfileRecords(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) root.DartProfileRecords = api;
})(typeof window !== "undefined" ? window : globalThis, function buildDartProfileRecords(root) {
  "use strict";

  const detailCache = new Map();
  const detailMeta = new Map();
  const observedLists = new WeakSet();
  let scheduled = false;
  let lastOpener = null;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[char]);

  function quantityFromLines(lines) {
    if (!Array.isArray(lines)) return 0;
    return lines.reduce((sum, line) => {
      const quantity = Number(line?.quantity);
      return sum + (Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 1);
    }, 0);
  }

  function orderPieceCount(order) {
    const physicalItems = Array.isArray(order?.items)
      ? order.items.filter((item) => item != null && String(item).trim())
      : [];
    if (physicalItems.length) return physicalItems.length;
    return quantityFromLines(order?.priceSnapshot);
  }

  function returnPieceCount(record) {
    for (const lines of [record?.returnLines, record?.lines, record?.items]) {
      const count = quantityFromLines(lines);
      if (count) return count;
    }
    const quantity = Number(record?.quantity);
    if (Number.isFinite(quantity) && quantity > 0) return Math.trunc(quantity);
    return record?.itemCode ? 1 : 0;
  }

  function displayDate(primary, fallback) {
    const value = primary || fallback;
    if (!value) return "-";
    const text = String(value).trim();
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(text)) return text.replaceAll("-", "/");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleDateString("en-GB");
  }

  function statusTone(status) {
    const value = String(status || "").trim().toLowerCase();
    if (/delivered|completed|converted|ordered|added to cart|\bgood\b/.test(value)) return "success";
    if (/refused|rejected|cancelled|canceled|expired|damaged|\bbad\b|failed/.test(value)) return "danger";
    if (/notified|inspection|review|alternative/.test(value)) return "warning";
    if (/pending|waiting|reserved|accepted|preparing|representative|on the way|pickup|active|new/.test(value)) return "active";
    return "neutral";
  }

  function orderSummary(order = {}) {
    return {
      id: String(order.orderId || order.id || "-") || "-",
      status: String(order.status || "-") || "-",
      date: displayDate(order.date, order.createdAt),
      pieces: orderPieceCount(order),
    };
  }

  function returnSummary(record = {}) {
    return {
      id: String(record.returnId || record.id || "-") || "-",
      status: String(record.publicStatus || record.status || "-") || "-",
      date: displayDate(record.date, record.createdAt),
      pieces: returnPieceCount(record),
    };
  }

  function waitingSummary(entry = {}) {
    return {
      id: String(entry.id || "-") || "-",
      design: String(entry.modelName || entry.modelId || "-") || "-",
      size: String(entry.size || "-") || "-",
      color: String(entry.color || "-") || "-",
      date: displayDate(entry.requestedAt, entry.createdAt),
      status: String(entry.statusLabel || entry.status || "-") || "-",
    };
  }

  function toneStyle(element, status) {
    if (!element) return;
    const palette = {
      success: { background: "#e8f7ef", color: "#166534", border: "rgba(22,101,52,.18)" },
      danger: { background: "#fff0f3", color: "#991b1b", border: "rgba(153,27,27,.18)" },
      warning: { background: "#fff7ed", color: "#92400e", border: "rgba(146,64,14,.18)" },
      active: { background: "#f7e9ed", color: "#8c1d2c", border: "rgba(140,29,44,.18)" },
      neutral: { background: "#f1f5f9", color: "#475569", border: "rgba(71,85,105,.16)" },
    }[statusTone(status)];
    element.style.background = palette.background;
    element.style.color = palette.color;
    element.style.border = `1px solid ${palette.border}`;
  }

  function profileFieldValue(card, label) {
    if (!card) return "";
    const wanted = String(label || "").trim().toLowerCase();
    for (const field of card.querySelectorAll(".profile-record-field")) {
      const name = field.querySelector("small")?.textContent?.trim().toLowerCase();
      if (name === wanted) return field.querySelector("span")?.textContent?.trim() || "";
    }
    return "";
  }

  function cardIdentity(card) {
    return card?.querySelector(".profile-record-head strong")?.textContent?.trim() || "";
  }

  function cardStatus(card) {
    return card?.querySelector(".profile-status")?.textContent?.trim() || "-";
  }

  function platform() {
    return root.DartPlatform || null;
  }

  function currentCustomerId() {
    return platform()?.currentUser?.()?.customerId || "";
  }

  function customerOrders() {
    const customerId = currentCustomerId();
    return (platform()?.read?.("dart_orders", []) || [])
      .filter((record) => !customerId || String(record.clientId) === String(customerId))
      .filter((record) => !record.isDeleted);
  }

  function customerReturns() {
    const customerId = currentCustomerId();
    return (platform()?.read?.("dart_returns", []) || [])
      .filter((record) => !customerId || String(record.clientId) === String(customerId))
      .filter((record) => !record.isDeleted);
  }

  function waitingEntries() {
    const entries = platform()?.waitingEntries?.();
    return Array.isArray(entries)
      ? entries.slice().sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0))
      : [];
  }

  function waitingStatusText(entry, fallback) {
    const labels = {
      waiting: "Waiting",
      reserved: "Reserved for you",
      confirmed: "Added to cart",
      converted: "Ordered",
      expired: "Reservation expired",
      cancelled: "Cancelled",
    };
    return labels[entry?.status] || fallback || entry?.status || "-";
  }

  function resolveWaitingImage(entry) {
    const catalog = root.DartCatalog;
    try {
      const model = catalog?.model?.(entry?.modelId);
      return catalog?.cover?.(model, entry?.color) || model?.image || model?.images?.[0] || "Photos/logo-1to1.png";
    } catch {
      return "Photos/logo-1to1.png";
    }
  }

  function rowShell(key, label) {
    const button = root.document.createElement("button");
    button.type = "button";
    button.className = "profile-record-card";
    button.dataset.dartCompactRow = "1";
    button.dataset.dartProfileRecordOpen = key;
    button.setAttribute("aria-label", label);
    button.style.width = "100%";
    button.style.padding = "0";
    button.style.border = "1px solid rgba(30,30,30,.14)";
    button.style.background = "#fff";
    button.style.color = "inherit";
    button.style.font = "inherit";
    button.style.textAlign = "start";
    button.style.cursor = "pointer";
    button.style.appearance = "none";
    return button;
  }

  function twoLineRow(summary, key, label) {
    const row = rowShell(key, label);
    row.innerHTML = `
      <div class="profile-record-head" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px 12px;padding:11px 14px;">
        <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(summary.id)}</strong>
        <span class="profile-status">${escapeHtml(summary.status)}</span>
        <span style="color:#64748b;font-size:12px;">${escapeHtml(summary.date)}</span>
        <span style="color:#334155;font-size:12px;font-weight:700;white-space:nowrap;">${escapeHtml(`${summary.pieces} ${summary.pieces === 1 ? "Piece" : "Pieces"}`)}</span>
      </div>`;
    toneStyle(row.querySelector(".profile-status"), summary.status);
    return row;
  }

  function waitingRow(summary, image, key) {
    const row = rowShell(key, `Open Waiting details for ${summary.design}`);
    row.innerHTML = `
      <div class="profile-record-head" style="display:grid;grid-template-columns:52px minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:5px 11px;padding:9px 12px;">
        <img data-dart-waiting-row-image src="${escapeHtml(image)}" alt="${escapeHtml(summary.design)}" loading="lazy" decoding="async" style="grid-row:1/3;width:52px;height:64px;object-fit:cover;border-radius:9px;background:#f1f5f9;">
        <div style="min-width:0;">
          <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(summary.design)}</strong>
          <span style="display:block;margin-top:3px;color:#475569;font-size:11px;">Size: ${escapeHtml(summary.size)} · Color: ${escapeHtml(summary.color)}</span>
        </div>
        <span class="profile-status">${escapeHtml(summary.status)}</span>
        <span style="color:#64748b;font-size:11px;">${escapeHtml(summary.date)}</span>
        <span aria-hidden="true" style="color:#ab012b;font-size:18px;line-height:1;">›</span>
      </div>`;
    toneStyle(row.querySelector(".profile-status"), summary.status);
    const img = row.querySelector("[data-dart-waiting-row-image]");
    img?.addEventListener("error", () => {
      if (img.dataset.fallbackApplied === "1") {
        img.hidden = true;
        return;
      }
      img.dataset.fallbackApplied = "1";
      img.src = "Photos/logo-1to1.png";
    });
    return row;
  }

  function rememberDetail(type, id, card, meta) {
    const key = `${type}:${id}`;
    detailCache.set(key, card.cloneNode(true));
    detailMeta.set(key, { ...meta, type });
    return key;
  }

  function enhanceOrders(list) {
    const sourceCards = [...list.children].filter(
      (child) => child.matches?.(".profile-record-card:not([data-dart-compact-row])"),
    );
    if (!sourceCards.length) return;
    const byId = new Map(customerOrders().map((record) => [String(record.orderId), record]));
    sourceCards.forEach((card) => {
      const id = cardIdentity(card);
      const record = byId.get(id) || {};
      const summary = {
        ...orderSummary(record),
        id: id || orderSummary(record).id,
        status: cardStatus(card) || orderSummary(record).status,
        date: record.date || record.createdAt
          ? displayDate(record.date, record.createdAt)
          : profileFieldValue(card, "Order date") || "-",
        pieces: orderPieceCount(record) || card.querySelectorAll(".profile-record-item").length,
      };
      const key = rememberDetail("order", summary.id, card, {
        title: `Order ${summary.id}`,
      });
      card.replaceWith(twoLineRow(summary, key, `Open details for order ${summary.id}`));
    });
  }

  function enhanceReturns(list) {
    const sourceCards = [...list.children].filter(
      (child) => child.matches?.(".profile-record-card:not([data-dart-compact-row])"),
    );
    if (!sourceCards.length) return;
    const byId = new Map(customerReturns().map((record) => [String(record.returnId), record]));
    sourceCards.forEach((card) => {
      const id = cardIdentity(card);
      const record = byId.get(id) || {};
      const base = returnSummary(record);
      const summary = {
        ...base,
        id: id || base.id,
        status: cardStatus(card) || base.status,
        date: record.date || record.createdAt
          ? displayDate(record.date, record.createdAt)
          : profileFieldValue(card, "Request date") || "-",
        pieces: returnPieceCount(record) || (profileFieldValue(card, "Original Item") && profileFieldValue(card, "Original Item") !== "-" ? 1 : 0),
      };
      const key = rememberDetail("return", summary.id, card, {
        title: `Return ${summary.id}`,
      });
      card.replaceWith(twoLineRow(summary, key, `Open details for return ${summary.id}`));
    });
  }

  function enhanceWaiting(list) {
    const sourceCards = [...list.children].filter(
      (child) => child.matches?.(".profile-record-card:not([data-dart-compact-row])"),
    );
    if (!sourceCards.length) return;
    const entries = waitingEntries();
    sourceCards.forEach((card, index) => {
      const entry = entries[index] || {};
      const base = waitingSummary(entry);
      const summary = {
        ...base,
        id: entry.id || `${cardIdentity(card) || "waiting"}-${index}`,
        design: entry.modelName || cardIdentity(card) || base.design,
        size: entry.size || profileFieldValue(card, "Size") || "-",
        color: entry.color || profileFieldValue(card, "Requested color") || "-",
        date: entry.requestedAt
          ? displayDate(entry.requestedAt)
          : profileFieldValue(card, "Requested") || "-",
        status: waitingStatusText(entry, cardStatus(card)),
      };
      const image = resolveWaitingImage(entry);
      const key = rememberDetail("waiting", summary.id, card, {
        title: summary.design,
        image,
        imageAlt: summary.design,
      });
      card.replaceWith(waitingRow(summary, image, key));
    });
  }

  function ensureModal() {
    let modal = root.document.getElementById("dartProfileRecordDetailModal");
    if (modal) return modal;
    modal = root.document.createElement("section");
    modal.id = "dartProfileRecordDetailModal";
    modal.className = "serial-result";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "dartProfileRecordDetailTitle");
    modal.style.zIndex = "400000";
    modal.innerHTML = `
      <div class="serial-result-card" style="width:min(92vw,620px);max-height:82dvh;overflow:auto;text-align:start;padding:20px;">
        <button type="button" class="serial-result-close" data-dart-profile-detail-close aria-label="Close details">×</button>
        <h2 id="dartProfileRecordDetailTitle" style="margin:0 38px 14px 0;color:#ab012b;"></h2>
        <div data-dart-profile-detail-body></div>
      </div>`;
    root.document.body.appendChild(modal);
    return modal;
  }

  function openDetail(key, opener) {
    const cached = detailCache.get(key);
    if (!cached) return;
    const modal = ensureModal();
    const meta = detailMeta.get(key) || {};
    const body = modal.querySelector("[data-dart-profile-detail-body]");
    const title = modal.querySelector("#dartProfileRecordDetailTitle");
    body.replaceChildren();
    title.textContent = meta.title || "Details";
    if (meta.type === "waiting" && meta.image) {
      const preview = root.document.createElement("div");
      preview.style.display = "flex";
      preview.style.alignItems = "center";
      preview.style.gap = "12px";
      preview.style.marginBottom = "12px";
      preview.innerHTML = `<img src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.imageAlt || meta.title || "Waiting design")}" style="width:62px;height:78px;object-fit:cover;border-radius:10px;background:#f1f5f9;"><strong style="color:#334155;">${escapeHtml(meta.title || "Waiting")}</strong>`;
      body.appendChild(preview);
    }
    const detail = cached.cloneNode(true);
    detail.style.width = "100%";
    detail.style.boxShadow = "none";
    body.appendChild(detail);
    lastOpener = opener || root.document.activeElement;
    modal.hidden = false;
    root.document.body.dataset.dartProfilePreviousOverflow = root.document.body.style.overflow || "";
    root.document.body.style.overflow = "hidden";
    requestAnimationFrame(() => modal.querySelector("[data-dart-profile-detail-close]")?.focus());
  }

  function closeDetail() {
    const modal = root.document.getElementById("dartProfileRecordDetailModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    root.document.body.style.overflow = root.document.body.dataset.dartProfilePreviousOverflow || "";
    delete root.document.body.dataset.dartProfilePreviousOverflow;
    lastOpener?.focus?.();
    lastOpener = null;
  }

  function enhanceAll() {
    if (!root.document) return;
    const orders = root.document.getElementById("profileOrdersList");
    const returns = root.document.getElementById("profileReturnsList");
    const waiting = root.document.getElementById("profileWaitingList");
    if (orders) enhanceOrders(orders);
    if (returns) enhanceReturns(returns);
    if (waiting) enhanceWaiting(waiting);
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceAll();
    });
  }

  function observeLists() {
    if (!root.MutationObserver) return;
    ["profileOrdersList", "profileReturnsList", "profileWaitingList"].forEach((id) => {
      const list = root.document.getElementById(id);
      if (!list || observedLists.has(list)) return;
      observedLists.add(list);
      const observer = new root.MutationObserver(scheduleEnhance);
      observer.observe(list, { childList: true });
    });
  }

  function bindDom() {
    observeLists();
    scheduleEnhance();
    root.document.addEventListener("dart:data-changed", scheduleEnhance);
    root.document.addEventListener("dart:sections-loaded", () => {
      observeLists();
      scheduleEnhance();
    });
    root.document.addEventListener("click", (event) => {
      const opener = event.target.closest?.("[data-dart-profile-record-open]");
      if (opener) {
        openDetail(opener.dataset.dartProfileRecordOpen, opener);
        return;
      }
      const modal = root.document.getElementById("dartProfileRecordDetailModal");
      if (!modal) return;
      if (event.target.closest?.("[data-dart-profile-detail-close]") || event.target === modal) {
        closeDetail();
        return;
      }
      if (event.target.closest?.("[data-waiting-action]") && modal.contains(event.target)) {
        root.setTimeout(closeDetail, 0);
      }
    });
    root.document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDetail();
    });
  }

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", bindDom);
    else bindDom();
  }

  return Object.freeze({
    orderPieceCount,
    returnPieceCount,
    statusTone,
    orderSummary,
    returnSummary,
    waitingSummary,
    displayDate,
  });
});
