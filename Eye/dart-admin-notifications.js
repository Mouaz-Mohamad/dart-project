// DART CODE GUIDE | Eye/dart-admin-notifications.js
// Staff inbox and device opt-in; all events/read state remain in PostgreSQL.
(() => {
  "use strict";
  const api = (...args) => window.DartAdminApi.request(...args);
  const bar = document.getElementById("dart-notification-bar"), panel = document.getElementById("dart-notification-panel");
  if (!bar || !panel) return;
  let rows = [], nextCursor = null, inFlight = null, queued = false, epoch = 0, hydrated = false, pendingDeepLink = true;
  let unread = 0, soundReady = false, audio = null, fallbackTimer = 0, subscriptionId = null;
  let pushSync = null, pushConnecting = false, lastPushCheck = 0;
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
    if (counts) for (const section of ["orders", "returns", "review", "settings"]) {
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
      // Account-claim alerts link to the Owner's protected review panel.
      // No customer PII is included in the notification or lock-screen payload.
      if (n.eventType === "CUSTOMER_EMAIL_LINK_REQUESTED") {
        document.querySelector('.cont-menu [data-target="settings"]')?.click();
        window.DartSettingsTabs?.activate?.("staff");
        const review = document.getElementById("settings-customer-email-links-card");
        if (review && !review.hidden) {
          review.scrollIntoView({ behavior: "smooth", block: "center" });
          window.DartCustomerEmailLinks?.refresh?.(true);
        } else {
          notify("افتح Settings ثم Staff & Permissions لمراجعة طلب ربط الإيميل.");
        }
      } else {
        // Fetch authoritative records before opening details, including cross-device arrivals.
        if (n.section === "orders") await window.DartOrdersApi?.hydrate?.(true);
        document.querySelector(`.cont-menu [data-target="${n.section}"]`)?.click();
        const opened = await window.dartOpenAdminNotification?.(n);
        if (!opened) notify("The record may be outside the active filters. Clear the section filters to view it.");
      }
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
  async function pushRecord(subscription) {
    // Compare the browser endpoint to the server's SHA-256 fingerprint; no endpoint is exposed.
    if (!window.crypto?.subtle) throw new Error("Secure browser cryptography is required for push.");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint));
    const endpointHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const result = await api("/api/v1/admin/push/subscriptions");
    return (result.subscriptions || []).find(record => record.endpointHash === endpointHash) || null;
  }
  async function syncPush() {
    if (!enabled() || document.hidden || navigator.onLine === false || !window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (pushSync || pushConnecting || Date.now() - lastPushCheck < 600000) return;
    lastPushCheck = Date.now();
    const generation = epoch;
    pushSync = (async () => {
    try {
      if (localStorage.getItem("dart_admin_push_autorenew") === "off") { pushStatus("Phone notifications disabled on this device."); return; }
      const config = await api("/api/v1/admin/push/config");
      if (!config.configured) { pushStatus("Phone notifications are not configured yet."); return; }
      const registration = await registerWorker(); await activeWorker(registration);
      const subscription = await registration.pushManager.getSubscription();
      const record = subscription ? await pushRecord(subscription) : null;
      if (generation !== epoch || !enabled()) return;
      if (record?.enabled) {
        subscriptionId = record.id;
        localStorage.setItem("dart_admin_push_autorenew", "on");
        pushStatus("Phone notifications enabled on this device.");
        document.getElementById("dart-push-disable").hidden = false;
      } else {
        subscriptionId = null;
        document.getElementById("dart-push-disable").hidden = true;
        // Retain granted consent across provider expiry/session renewal. An
        // explicit opt-out always wins, including after browser unsubscribing.
        if (record?.disabledReason === "customer_opt_out") {
          localStorage.setItem("dart_admin_push_autorenew", "off");
          pushStatus("Phone notifications disabled on this device.");
        } else if ((record && ["provider_expired", "expired", "key_changed", "session_ended"].includes(record.disabledReason)) ||
                   localStorage.getItem("dart_admin_push_autorenew") === "on" || (record && !record.enabled && !record.disabledReason)) {
          await enablePush(true, config);
        } else pushStatus("Tap Enable phone notifications to connect this device.");
      }
    } catch { pushStatus("Tap Enable phone notifications to renew this device."); }
    })().finally(() => { if (generation === epoch) pushSync = null; });
    return pushSync;
  }
  async function enablePush(automatic = false, knownConfig = null) {
    if (pushConnecting || !enabled()) return;
    pushConnecting = true;
    const generation = epoch;
    const button = document.getElementById("dart-push-enable"); button.disabled = true;
    try {
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("This browser does not support push. On iPhone, add Dart Eye to the Home Screen and open it there.");
      // Permission is requested from the explicit click before asynchronous setup.
      const permission = automatic ? Notification.permission : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser settings, then retry.");
      const config = knownConfig || await api("/api/v1/admin/push/config"); if (!config.configured) throw new Error("Phone notifications are not configured yet.");
      const registration = await registerWorker(); await activeWorker(registration);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const record = await pushRecord(subscription);
        const key = subscription.options.applicationServerKey;
        const keyMismatch = key && btoa(String.fromCharCode(...new Uint8Array(key)))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== config.publicKey;
        // A 404/410 endpoint cannot be used again; obtain fresh browser keys.
        if (!record || ["provider_expired", "expired", "key_changed"].includes(record.disabledReason) || keyMismatch ||
            (subscription.expirationTime && subscription.expirationTime <= Date.now())) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (generation !== epoch || !enabled() || (automatic && localStorage.getItem("dart_admin_push_autorenew") === "off")) return;
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
      if (generation !== epoch || !enabled() || (automatic && localStorage.getItem("dart_admin_push_autorenew") === "off")) return;
      const result = await api("/api/v1/admin/push/subscriptions", { method: "POST", body: { subscription: subscription.toJSON(), publicKey: config.publicKey } });
      if (generation !== epoch) return;
      localStorage.setItem("dart_admin_push_autorenew", "on");
      subscriptionId = result.id; pushStatus("Phone notifications enabled on this device."); document.getElementById("dart-push-disable").hidden = false;
    } catch (error) { pushStatus(error.status ? "This device could not be enabled. Retry or sign in again." : error.message); }
    finally { pushConnecting = false; button.disabled = false; }
  }
  function start() {
    if (!enabled()) return;
    bar.hidden = false; void refresh(); void syncPush(); scheduleFallback();
  }
  function scheduleFallback() {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => { if (!window.DartChanges?.active) void refresh(); void syncPush(); scheduleFallback(); }, 60000);
  }
  document.getElementById("dart-notification-bell").addEventListener("click", () => showPanel(panel.hidden));
  document.getElementById("dart-notification-close").addEventListener("click", () => showPanel(false));
  document.getElementById("dart-notification-retry").addEventListener("click", () => void refresh());
  document.getElementById("dart-notification-more").addEventListener("click", () => void refresh({ more: true }));
  document.getElementById("dart-notification-read").addEventListener("click", () => void mark(rows.filter(n => !n.readAt).map(n => n.id)).catch(() => status("Could not mark notifications as read. Retry.")));
  document.getElementById("dart-push-enable").addEventListener("click", () => void enablePush());
  document.getElementById("dart-push-disable").addEventListener("click", async () => {
    try {
      localStorage.setItem("dart_admin_push_autorenew", "off");
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
  window.addEventListener("online", () => { void refresh(); void syncPush(); });
  window.addEventListener("focus", () => { void refresh(); void syncPush(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { void refresh(); void syncPush(); } });
  window.addEventListener("dart:data-changed", event => {
    if (event.detail?.source !== "logout") return;
    epoch++; inFlight = null; queued = false; rows = []; sessionSeen.clear(); hydrated = false; unread = 0; subscriptionId = null;
    pushSync = null; lastPushCheck = 0;
    clearTimeout(fallbackTimer); bar.hidden = true; showPanel(false); render({});
  });
  // Settings action broadcasts only to eligible subscribed staff devices.
  // Results distinguish queued, provider acceptance and local display.
  const testButton=document.getElementById("settings-push-test-send");
  const testStatus=document.getElementById("settings-push-test-status");
  if(testButton && testStatus) {
    testButton.addEventListener("click",async()=>{
      testButton.disabled=true;
      testStatus.textContent="Preparing a real phone notification test…";
      const generation=epoch;
      try {
        const batch=await api("/api/v1/admin/push/test",{method:"POST",body:{}});
        if(generation!==epoch)return;
        testStatus.textContent=`Queued for ${batch.queued} connected device(s). Checking provider acceptance…`;
        for(let i=0;i<12 && generation===epoch;i++){
          if(i)await new Promise(resolve=>setTimeout(resolve,2000));
          const result=await api("/api/v1/admin/push/test/"+encodeURIComponent(batch.testId));
          if(generation!==epoch)return;
          testStatus.textContent=`Devices: ${result.total} · Provider accepted: ${result.accepted} · Pending: ${result.pending} · Skipped: ${result.suppressed} · Failed: ${result.failed} · Unknown: ${result.unknown}. Provider acceptance does not guarantee phone display.`;
          if(!result.pending)break;
        }
      }catch(error){
        if(generation===epoch)testStatus.textContent=error.status===429?"Test already sent recently. Retry after one minute.":error.status===403?"Only the Dart owner can run a notification test.":error.status===409?"No active connected notification devices. Enable phone notifications on a device first.":"Could not run the phone notification test. Check your connection and retry.";
      }finally{testButton.disabled=false;}
    });
  }

  window.DartAdminNotifications = Object.freeze({ refresh, renderRows, owns: legacy => ["order_created", "review_created", "return_created"].includes(legacy.type) && rows.some(row => [row.entityId, row.entityCode].includes(String(legacy.relatedEntityId || ""))) });
  start();
})();
