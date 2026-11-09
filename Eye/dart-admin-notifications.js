// DART CODE GUIDE | Eye/dart-admin-notifications.js
// Staff inbox and device opt-in; all events/read state remain in PostgreSQL.
(() => {
  "use strict";
  const api = (...args) => window.DartAdminApi.request(...args);
  const bar = document.getElementById("dart-notification-bar"), panel = document.getElementById("dart-notification-panel");
  if (!bar || !panel) return;
  let rows = [], nextCursor = null, inFlight = null, queued = false, epoch = 0, hydrated = false, pendingDeepLink = true;
  let unread = 0, soundReady = false, audio = null, fallbackTimer = 0, subscriptionId = null;
  const sessionSeen = new Set();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enabled = () => window.DartAdminAccess?.can("notifications.read") === true;
  const status = message => { document.getElementById("dart-notification-status").textContent = message; };
  const notify = (message, type = "info") => window.DartDashboardUI?.notify?.(message, type);
  function renderRows(showEmpty = true, filter = "all") {
    return rows.filter(n => filter === "all" || ({ orders: "order", returns: "return", review: "review" })[n.section] === filter).map(n => `<button type="button" class="dart-inbox-row ${n.readAt ? "is-read" : "is-unread"}" data-admin-notification="${esc(n.id)}"><span class="dart-inbox-dot" aria-hidden="true"></span><span><strong>${esc(n.title)}${n.entityCode ? ` · ${esc(n.entityCode)}` : ""}</strong><small>${esc(new Date(n.createdAt).toLocaleString())}</small></span><span>${n.readAt ? "" : "New"}</span></button>`).join("") || (showEmpty ? '<p class="dart-empty-state">No notifications yet</p>' : "");
  }
  function render(counts) {
    document.getElementById("dart-notification-count").textContent = unread > 99 ? "99+" : String(unread);
    document.getElementById("dart-notification-count").hidden = !unread;
    document.getElementById("dart-notification-bell").setAttribute("aria-label", `Notifications · ${unread} unread`);
    document.getElementById("dart-notification-list").innerHTML = renderRows();
    document.getElementById("dart-notification-more").hidden = !nextCursor;
    if (counts) for (const section of ["orders", "returns", "review"]) {
      for (const link of document.querySelectorAll(`[data-target="${section}"]`)) {
        let badge = link.querySelector(".dart-nav-unread");
        if (!badge) { badge = document.createElement("span"); badge.className = "dart-nav-unread"; link.append(badge); }
        const count = counts[section] || 0;
        badge.textContent = count > 99 ? "99+" : String(count); badge.hidden = !count;
        badge.setAttribute("aria-label", `${count} unread notifications`);
      }
    }
    window.renderNotifications?.();
  }
  async function refresh({ more = false } = {}) {
    if (!enabled() || document.hidden || navigator.onLine === false) return;
    if (inFlight) { queued = true; return inFlight; }
    const generation = epoch;
    status("Loading notifications…");
    inFlight = (async () => {
      try {
        const page = await api("/api/v1/admin/notifications?limit=50" + (more && nextCursor ? "&cursor=" + encodeURIComponent(nextCursor) : ""));
        if (generation !== epoch) return;
        const fresh = page.notifications.filter(n => !sessionSeen.has(n.id) && !n.readAt);
        page.notifications.forEach(n => sessionSeen.add(n.id));
        rows = more ? [...new Map([...rows, ...page.notifications].map(n => [n.id, n])).values()] : page.notifications;
        nextCursor = page.nextCursor; unread = page.unreadCount;
        if (hydrated && !more && fresh.length) { notify(fresh.length === 1 ? fresh[0].title : `${fresh.length} new notifications`); playSound(); }
        hydrated = true; render(page.unread); status("");
        if (pendingDeepLink) {
          const id = new URL(location.href).searchParams.get("notification");
          if (id && /^[0-9a-f-]{36}$/i.test(id)) {
            let found = rows.find(n => n.id === id);
            if (!found) { const detail = await api("/api/v1/admin/notifications/" + encodeURIComponent(id)); found = detail.notification; rows.push(found); }
            if (found) { pendingDeepLink = false; await openNotification(found.id); }
            else { showPanel(true); status("Open older notifications to find this update."); }
          } else pendingDeepLink = false;
        }
      } catch (error) {
        if (generation !== epoch) return;
        status(error.status === 403 ? "Notifications are unavailable for this account." : "Notifications could not be loaded. Retry when connected.");
      }
    })().finally(() => { if (generation !== epoch) return; inFlight = null; if (queued) { queued = false; void refresh(); } });
    return inFlight;
  }
  async function mark(ids) {
    if (!ids.length) return;
    await api("/api/v1/admin/notifications/read", { method: "POST", body: { ids } });
    rows.forEach(n => { if (ids.includes(n.id)) n.readAt = new Date().toISOString(); });
    void refresh();
  }
  async function openNotification(id) {
    const n = rows.find(row => row.id === id); if (!n) return;
    try {
      if (!n.readAt) await mark([id]);
      showPanel(false);
      // Fetch authoritative records before opening details, including cross-device arrivals.
      if (n.section === "orders") await window.DartOrdersApi?.hydrate?.(true);
      document.querySelector(`.cont-menu [data-target="${n.section}"]`)?.click();
      const opened = await window.dartOpenAdminNotification?.(n);
      if (!opened) notify("The record may be outside the active filters. Clear the section filters to view it.");
      const url = new URL(location.href); url.searchParams.delete("notification"); history.replaceState(null, "", url);
    } catch { status("Could not open this notification. Please retry."); showPanel(true); }
  }
  function showPanel(show) {
    const wasHidden = panel.hidden;
    panel.hidden = !show;
    document.getElementById("dart-notification-bell").setAttribute("aria-expanded", String(show));
    if (show && wasHidden) void refresh();
  }
  function playSound() {
    if (!soundReady || localStorage.getItem("dart_admin_notification_sound") !== "on" || !audio) return;
    try {
      const tone = audio.createOscillator(), gain = audio.createGain(); tone.connect(gain); gain.connect(audio.destination);
      tone.frequency.value = 740; gain.gain.setValueAtTime(.12, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .25);
      tone.start(); tone.stop(audio.currentTime + .25);
    } catch { /* The inbox and native push remain available when audio is suspended. */ }
  }
  function keyBytes(key) { return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0)); }
  function pushStatus(message) { document.getElementById("dart-push-status").textContent = message; }
  async function registerWorker() {
    return navigator.serviceWorker.register("/Eye/admin-push-sw.js", { scope: "/Eye/push/" });
  }
  async function activeWorker(registration) {
    if (registration.active) return;
    await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      if (!worker) { reject(new Error("Push worker is not ready. Retry.")); return; }
      const timer = setTimeout(() => reject(new Error("Push worker is not ready. Retry.")), 10000);
      const check = () => { if (worker.state === "activated") { clearTimeout(timer); resolve(); } else if (worker.state === "redundant") { clearTimeout(timer); reject(new Error("Push worker could not start.")); } };
      worker.addEventListener("statechange", check); check();
    });
  }
  async function syncPush() {
    if (!enabled() || !window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      const registration = await registerWorker(); await activeWorker(registration);
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      const config = await api("/api/v1/admin/push/config"); if (!config.configured) return;
      const result = await api("/api/v1/admin/push/subscriptions", { method: "POST", body: { subscription: subscription.toJSON(), publicKey: config.publicKey } });
      subscriptionId = result.id; pushStatus("Phone notifications enabled on this device.");
      document.getElementById("dart-push-disable").hidden = false;
    } catch { pushStatus("Tap Enable phone notifications to renew this device."); }
  }
  async function enablePush() {
    const button = document.getElementById("dart-push-enable"); button.disabled = true;
    try {
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("This browser does not support push. On iPhone, add Dart Eye to the Home Screen and open it there.");
      // Permission is requested from the explicit click before asynchronous setup.
      if (await Notification.requestPermission() !== "granted") throw new Error("Allow notifications in your browser settings, then retry.");
      const config = await api("/api/v1/admin/push/config"); if (!config.configured) throw new Error("Phone notifications are not configured yet.");
      const registration = await registerWorker(); await activeWorker(registration);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && subscription.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(subscription.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== config.publicKey) { await subscription.unsubscribe(); subscription = null; }
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
      const result = await api("/api/v1/admin/push/subscriptions", { method: "POST", body: { subscription: subscription.toJSON(), publicKey: config.publicKey } });
      subscriptionId = result.id; pushStatus("Phone notifications enabled on this device."); document.getElementById("dart-push-disable").hidden = false;
    } catch (error) { pushStatus(error.status ? "This device could not be enabled. Retry or sign in again." : error.message); }
    finally { button.disabled = false; }
  }
  function start() {
    if (!enabled()) return;
    bar.hidden = false; void refresh(); void syncPush(); scheduleFallback();
  }
  function scheduleFallback() {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => { if (!window.DartChanges?.active) void refresh(); scheduleFallback(); }, 60000);
  }
  document.getElementById("dart-notification-bell").addEventListener("click", () => showPanel(panel.hidden));
  document.getElementById("dart-notification-close").addEventListener("click", () => showPanel(false));
  document.getElementById("dart-notification-retry").addEventListener("click", () => void refresh());
  document.getElementById("dart-notification-more").addEventListener("click", () => void refresh({ more: true }));
  document.getElementById("dart-notification-read").addEventListener("click", () => void mark(rows.filter(n => !n.readAt).map(n => n.id)).catch(() => status("Could not mark notifications as read. Retry.")));
  document.getElementById("dart-push-enable").addEventListener("click", () => void enablePush());
  document.getElementById("dart-push-disable").addEventListener("click", async () => {
    try {
      if (subscriptionId) await api("/api/v1/admin/push/subscriptions/" + encodeURIComponent(subscriptionId), { method: "DELETE" });
      const registration = await navigator.serviceWorker.getRegistration("/Eye/push/");
      const subscription = await registration?.pushManager.getSubscription(); if (subscription) await subscription.unsubscribe();
      subscriptionId = null; document.getElementById("dart-push-disable").hidden = true; pushStatus("Phone notifications disabled on this device.");
    } catch { pushStatus("Could not disable notifications. Retry."); }
  });
  const sound = document.getElementById("dart-notification-sound");
  sound.checked = localStorage.getItem("dart_admin_notification_sound") === "on";
  sound.addEventListener("change", () => { localStorage.setItem("dart_admin_notification_sound", sound.checked ? "on" : "off"); });
  document.addEventListener("pointerdown", () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try { audio ||= new Audio(); void audio.resume(); soundReady = true; } catch { /* Optional sound. */ }
  }, { once: true });
  document.addEventListener("click", event => {
    const row = event.target.closest("[data-admin-notification]"); if (row) void openNotification(row.dataset.adminNotification);
    else if (!panel.hidden && !bar.contains(event.target)) showPanel(false);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) { showPanel(false); document.getElementById("dart-notification-bell").focus(); } });
  window.addEventListener("dart:admin-authenticated", start);
  window.addEventListener("dart:server-change", event => { if (event.detail?.reconcile || event.detail?.name === "admin_notifications") void refresh(); });
  window.addEventListener("online", () => void refresh());
  window.addEventListener("focus", () => void refresh());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.addEventListener("dart:data-changed", event => {
    if (event.detail?.source !== "logout") return;
    epoch++; inFlight = null; queued = false; rows = []; sessionSeen.clear(); hydrated = false; unread = 0; subscriptionId = null;
    clearTimeout(fallbackTimer); bar.hidden = true; showPanel(false); render({});
  });
  window.DartAdminNotifications = Object.freeze({ refresh, renderRows, owns: legacy => ["order_created", "review_created", "return_created"].includes(legacy.type) && rows.some(row => [row.entityId, row.entityCode].includes(String(legacy.relatedEntityId || ""))) });
  start();
})();
