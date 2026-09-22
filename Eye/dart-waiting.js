// DART CODE GUIDE | Eye/dart-waiting.js
// الغرض: إدارة Waiting Queue وDemand من الداشبورد مع صلاحيات Actions وAudit.
(function (root) {
  "use strict";
  if (!root.document) return;

  const $ = (id) => document.getElementById(id);
  const state = { version: 0, entries: [], demand: [], view: "queue", loading: false };
  let searchTimer = 0;

  const can = (permission) => root.DartAdminAccess?.can?.(permission) === true;
  const escapeHtml = (value) => String(value ?? "").replace(
    /[&<>'"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char],
  );

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
    }).format(date);
  }

  function request(path, options = {}) {
    if (!root.DartAdminApi?.request) throw new Error("Dashboard API is not ready");
    return root.DartAdminApi.request(path, options);
  }

  function filtersQuery() {
    const params = new URLSearchParams();
    const pairs = [
      ["search", $("waiting-search")?.value],
      ["modelId", $("waiting-model-filter")?.value],
      ["color", $("waiting-color-filter")?.value],
      ["size", $("waiting-size-filter")?.value],
      ["status", $("waiting-status-filter")?.value],
      ["from", $("waiting-from-filter")?.value],
      ["to", $("waiting-to-filter")?.value],
    ];
    pairs.forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    params.set("limit", "200");
    return params.toString();
  }

  function setFilterOptions(id, values, label) {
    const select = $(id);
    if (!select) return;
    const previous = select.value;
    const unique = [...new Set(values.filter(Boolean).map(String))].sort((a,b) => a.localeCompare(b));
    select.replaceChildren(new Option(label, ""));
    unique.forEach((value) => select.append(new Option(value, value)));
    if (unique.includes(previous)) select.value = previous;
  }

  function syncFilterOptions() {
    const all = [...state.entries, ...state.demand];
    setFilterOptions("waiting-model-filter", all.map((row) => row.modelId), "All models");
    setFilterOptions("waiting-color-filter", all.map((row) => row.color), "All colors");
    setFilterOptions("waiting-size-filter", all.map((row) => row.size), "All sizes");
  }

  function renderKpis() {
    const totals = state.demand.reduce((acc,row) => {
      acc.waiting += Number(row.waiting || 0);
      acc.reserved += Number(row.reserved || 0);
      acc.converted += Number(row.converted || 0);
      acc.expired += Number(row.expired || 0);
      acc.cancelled += Number(row.cancelled || 0);
      return acc;
    }, { waiting:0, reserved:0, converted:0, expired:0, cancelled:0 });
    const settled = totals.converted + totals.expired + totals.cancelled;
    const conversion = settled ? Math.round((totals.converted / settled) * 1000) / 10 : 0;
    $("waiting-kpi-waiting").textContent = totals.waiting;
    $("waiting-kpi-reserved").textContent = totals.reserved;
    $("waiting-kpi-converted").textContent = totals.converted;
    $("waiting-kpi-conversion").textContent = `${conversion}%`;
  }

  function actionButton(action,label,permission,danger=false) {
    if (permission && !can(permission)) return "";
    return `<button type="button" ${danger ? 'class="dart-waiting-action-danger"' : ""} data-waiting-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
  }

  function rowActions(entry) {
    const actions = [
      actionButton("view","View details"),
      actionButton("customer","Open customer"),
      actionButton("model","Open model"),
    ];
    if (entry.status === "waiting") {
      actions.push(
        actionButton("move_top","Move to top","waiting.priority_override"),
        entry.priorityOverride ? actionButton("reset_priority","Reset FIFO priority","waiting.priority_override") : "",
        actionButton("edit_request","Change color / size","waiting.edit"),
        actionButton("offer_alternative","Offer alternative color","waiting.offer_alternative"),
        actionButton("cancel","Cancel Waiting","waiting.cancel",true),
      );
    }
    if (entry.status === "reserved") {
      actions.push(
        actionButton("extend","Extend reservation","waiting.extend"),
        actionButton("resend","Notify again","waiting.resend"),
        actionButton("reassign","Assign to another customer","waiting.reassign"),
        actionButton("release","Release reservation","waiting.release",true),
        actionButton("cancel","Cancel Waiting","waiting.cancel",true),
      );
    }
    actions.push(actionButton("audit","View audit","waiting.audit_read"));
    return `<details class="dart-waiting-actions-menu"><summary aria-label="Waiting actions">⋮</summary><div class="dart-waiting-actions-pop">${actions.filter(Boolean).join("")}</div></details>`;
  }

  function renderQueue() {
    const target = $("waiting-table");
    if (!target) return;
    if (!state.entries.length) {
      target.innerHTML = '<div class="dart-waiting-empty">No Waiting records match these filters.</div>';
      return;
    }
    target.innerHTML = `<table class="dart-waiting-table"><thead><tr>
      <th>Actions</th><th>Customer</th><th>Client Code</th><th>Model</th><th>Color</th><th>Size</th>
      <th>Requested</th><th>Queue</th><th>Status</th><th>Notified</th><th>Reservation expiry</th>
      <th>Reserved item</th><th>Match</th><th>Order</th>
    </tr></thead><tbody>${state.entries.map((entry) => {
      const allocation = entry.allocation || {};
      return `<tr data-waiting-id="${escapeHtml(entry.id)}">
        <td>${rowActions(entry)}</td>
        <td>${escapeHtml(entry.customerName)}</td>
        <td>${escapeHtml(entry.clientCode)}</td>
        <td><strong>${escapeHtml(entry.modelId)}</strong><br><small>${escapeHtml(entry.modelName || "")}</small></td>
        <td>${escapeHtml(entry.color)}</td><td>${escapeHtml(entry.size)}</td>
        <td>${escapeHtml(formatDate(entry.requestedAt))}</td>
        <td class="${entry.priorityOverride ? "dart-waiting-priority" : ""}">${entry.queuePosition ? `#${entry.queuePosition}` : "-"}${entry.priorityOverride ? " · override" : ""}</td>
        <td><span class="dart-waiting-status">${escapeHtml(entry.status)}</span></td>
        <td>${escapeHtml(formatDate(entry.notifiedAt))}</td>
        <td>${escapeHtml(formatDate(entry.reservationExpiry))}</td>
        <td>${escapeHtml(allocation.itemCode || "-")}<br><small>${escapeHtml(allocation.offeredColor || "")}</small></td>
        <td>${escapeHtml(allocation.matchType || "-")}</td>
        <td>${escapeHtml(entry.orderCode || "-")}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  }

  function renderDemand() {
    const target = $("waiting-demand-table");
    if (!target) return;
    if (!state.demand.length) {
      target.innerHTML = '<div class="dart-waiting-empty">No demand data yet.</div>';
      return;
    }
    target.innerHTML = `<table class="dart-waiting-table"><thead><tr>
      <th>Model</th><th>Color</th><th>Size</th><th>Waiting</th><th>Reserved</th><th>Confirmed</th>
      <th>Converted</th><th>Expired</th><th>Cancelled</th><th>Conversion</th>
    </tr></thead><tbody>${state.demand.map((row) => `<tr>
      <td><strong>${escapeHtml(row.modelId)}</strong><br><small>${escapeHtml(row.modelName || "")}</small></td>
      <td>${escapeHtml(row.color)}</td><td>${escapeHtml(row.size)}</td>
      <td>${Number(row.waiting || 0)}</td><td>${Number(row.reserved || 0)}</td><td>${Number(row.confirmed || 0)}</td>
      <td>${Number(row.converted || 0)}</td><td>${Number(row.expired || 0)}</td><td>${Number(row.cancelled || 0)}</td>
      <td>${Number(row.conversionRate || 0)}%</td>
    </tr>`).join("")}</tbody></table>`;
  }

  function render() {
    syncFilterOptions();
    renderKpis();
    renderQueue();
    renderDemand();
  }

  async function hydrate(force=false) {
    if (!can("waiting.view") || state.loading) return state.entries;
    state.loading = true;
    try {
      if (!force && state.version) {
        const versionPayload = await request("/api/v1/admin/waiting/version");
        if (Number(versionPayload.version || 0) === state.version) return state.entries;
      }
      const query = filtersQuery();
      const payload = await request(`/api/v1/admin/waiting${query ? `?${query}` : ""}`);
      state.version = Number(payload.version || 0);
      state.entries = Array.isArray(payload.entries) ? payload.entries : [];
      state.demand = Array.isArray(payload.demand) ? payload.demand : [];
      render();
      return state.entries;
    } finally {
      state.loading = false;
    }
  }

  function ensureDialog() {
    let dialog = $("dart-waiting-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "dart-waiting-dialog";
    dialog.className = "dart-waiting-dialog";
    dialog.innerHTML = '<div class="dart-waiting-dialog-head"><h3 id="dart-waiting-dialog-title">Waiting</h3><button type="button" class="dart-waiting-dialog-close" aria-label="Close">×</button></div><div id="dart-waiting-dialog-body" class="dart-waiting-dialog-body"></div>';
    dialog.querySelector(".dart-waiting-dialog-close").addEventListener("click", () => dialog.close());
    document.body.appendChild(dialog);
    return dialog;
  }

  function showDetails(entry) {
    const dialog = ensureDialog();
    $("dart-waiting-dialog-title").textContent = `Waiting · ${entry.clientCode || entry.id}`;
    const fields = {
      Customer: entry.customerName,
      "Client code": entry.clientCode,
      Model: `${entry.modelId} · ${entry.modelName || ""}`,
      "Requested color": entry.color,
      Size: entry.size,
      Status: entry.status,
      "Queue position": entry.queuePosition ? `#${entry.queuePosition}` : "-",
      "Priority override": entry.priorityOverride || 0,
      "Requested at": formatDate(entry.requestedAt),
      "Notified at": formatDate(entry.notifiedAt),
      "Reservation expiry": formatDate(entry.reservationExpiry),
      "Reserved item": entry.allocation?.itemCode || "-",
      "Reserved color": entry.allocation?.offeredColor || "-",
      Match: entry.allocation?.matchType || "-",
      Order: entry.orderCode || "-",
    };
    $("dart-waiting-dialog-body").innerHTML = `<div class="dart-waiting-detail-grid">${Object.entries(fields).map(([label,value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
    dialog.showModal();
  }

  async function showAudit(entry) {
    const payload = await request(`/api/v1/admin/waiting/${encodeURIComponent(entry.id)}/audit`);
    const dialog = ensureDialog();
    $("dart-waiting-dialog-title").textContent = `Audit · ${entry.clientCode || entry.id}`;
    const rows = Array.isArray(payload.audit) ? payload.audit : [];
    $("dart-waiting-dialog-body").innerHTML = rows.length
      ? rows.map((row) => `<div class="dart-waiting-audit-row"><strong>${escapeHtml(row.action)}</strong><div>${escapeHtml(formatDate(row.occurredAt))} · ${escapeHtml(row.actorType || "-")}</div><small>${escapeHtml(JSON.stringify(row.metadata || {}))}</small></div>`).join("")
      : '<div class="dart-waiting-empty">No audit events.</div>';
    dialog.showModal();
  }

  function openSection(target, searchValue) {
    document.querySelector(`[data-target="${target}"]`)?.click();
    const input = document.querySelector(`#${target} .search-box input`);
    if (input && searchValue) {
      input.value = searchValue;
      input.dispatchEvent(new Event("input", { bubbles:true }));
    }
  }

  async function mutate(entry, action, extra={}) {
    const payload = await request(`/api/v1/admin/waiting/${encodeURIComponent(entry.id)}/action`, {
      method:"POST", body:{ action, ...extra },
    });
    await hydrate(true);
    return payload.entry;
  }

  function reason(label) {
    const value = root.prompt(`${label}\nReason is required:`);
    return value === null ? null : String(value).trim();
  }

  async function handleAction(entry, action) {
    if (action === "view") return showDetails(entry);
    if (action === "audit") return showAudit(entry);
    if (action === "customer") return openSection("customers",entry.clientCode);
    if (action === "model") return openSection("models",entry.modelId);
    if (action === "resend") return mutate(entry,action);

    if (action === "extend") {
      const value = root.prompt("Extend by how many hours? (1–72)","4");
      if (value === null) return;
      const extensionHours = Math.min(72,Math.max(1,Number(value)||4));
      const why = reason("Extend reservation");
      if (!why) return;
      return mutate(entry,action,{ hours:extensionHours, reason:why });
    }

    if (action === "edit_request") {
      const size = root.prompt("New size:",entry.size||"");
      if (size === null) return;
      const color = root.prompt("New requested color:",entry.color||"");
      if (color === null) return;
      const why = reason("Change Waiting request");
      if (!why) return;
      return mutate(entry,action,{ size:size.trim(), color:color.trim(), reason:why });
    }

    if (action === "offer_alternative") {
      const color = root.prompt("Alternative color to reserve:");
      if (!color) return;
      const why = reason("Offer alternative color");
      if (!why) return;
      return mutate(entry,action,{ color:color.trim(), reason:why });
    }

    if (action === "reassign") {
      const eligible = state.entries.filter((row) =>
        row.id !== entry.id &&
        row.status === "waiting" &&
        row.modelId === entry.modelId &&
        row.size === entry.size
      );
      if (!eligible.length) return root.alert("No eligible Waiting customer with the same design and size.");
      const choices = eligible.map((row,index) => `${index+1}) ${row.customerName} · ${row.clientCode} · ${row.color} · ${row.id}`).join("\n");
      const selected = root.prompt(`Choose target by number or paste Waiting ID:\n${choices}`);
      if (!selected) return;
      const index = Number(selected);
      const target = Number.isInteger(index) && index>=1 && index<=eligible.length
        ? eligible[index-1]
        : eligible.find((row) => row.id === selected.trim());
      if (!target) return root.alert("Target Waiting entry not found.");
      const why = reason("Reassign physical reservation");
      if (!why) return;
      const cancelPrevious = root.confirm("OK = cancel previous Waiting request.\nCancel = keep previous customer in Waiting.");
      return mutate(entry,action,{ targetWaitlistId:target.id, cancelPrevious, reason:why });
    }

    const labels = { cancel:"Cancel Waiting", release:"Release reservation", move_top:"Move customer to top", reset_priority:"Reset FIFO priority" };
    const why = reason(labels[action] || action);
    if (!why) return;
    if ((action === "cancel" || action === "release") && !root.confirm(`${labels[action]}?`)) return;
    return mutate(entry,action,{ reason:why });
  }

  function applyAccess() {
    const allowed = can("waiting.view");
    document.querySelectorAll('[data-target="waiting"]').forEach((link) => link.closest("li")?.toggleAttribute("hidden",!allowed));
    $("waiting")?.toggleAttribute("hidden",!allowed);
    if ($("waiting-reconcile-btn")) $("waiting-reconcile-btn").hidden = !can("waiting.reassign");
    if (allowed) void hydrate(true);
  }

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-waiting-action]");
    if (actionButton) {
      const row = actionButton.closest("[data-waiting-id]");
      const entry = state.entries.find((item) => item.id === row?.dataset.waitingId);
      if (!entry) return;
      actionButton.disabled = true;
      try {
        await handleAction(entry,actionButton.dataset.waitingAction);
      } catch (error) {
        root.alert(error?.message || "Waiting action failed.");
      } finally {
        actionButton.disabled = false;
      }
      return;
    }

    const viewButton = event.target.closest("[data-waiting-view]");
    if (viewButton) {
      state.view = viewButton.dataset.waitingView === "demand" ? "demand" : "queue";
      document.querySelectorAll("[data-waiting-view]").forEach((button) => button.classList.toggle("is-active",button===viewButton));
      $("waiting-queue-view").hidden = state.view !== "queue";
      $("waiting-demand-view").hidden = state.view !== "demand";
    }

    if (event.target.closest('[data-target="waiting"]') && can("waiting.view")) void hydrate(true);
  });

  $("waiting-refresh-btn")?.addEventListener("click",() => void hydrate(true));
  $("waiting-reconcile-btn")?.addEventListener("click",async () => {
    if (!can("waiting.reassign")) return;
    try {
      const payload = await request("/api/v1/admin/waiting/reconcile",{ method:"POST", body:{} });
      root.alert(`Matched ${Number(payload.allocated||0)} available piece(s).`);
      await hydrate(true);
    } catch (error) {
      root.alert(error?.message || "Waiting reconciliation failed.");
    }
  });

  ["waiting-model-filter","waiting-color-filter","waiting-size-filter","waiting-status-filter","waiting-from-filter","waiting-to-filter"].forEach((id) => {
    $(id)?.addEventListener("change",() => void hydrate(true));
  });
  $("waiting-search")?.addEventListener("input",() => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void hydrate(true),250);
  });

  root.addEventListener("dart:admin-authenticated",applyAccess);
  document.addEventListener("DOMContentLoaded",applyAccess);

  setInterval(() => {
    if (!document.hidden && can("waiting.view") && $("waiting")?.classList.contains("active-section")) void hydrate(false);
  },15000);

  root.DartWaitingAdmin = Object.freeze({ hydrate, state });
})(typeof window !== "undefined" ? window : globalThis);