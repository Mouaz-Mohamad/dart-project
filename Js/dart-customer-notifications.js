// DART CODE GUIDE | Js/dart-customer-notifications.js
// Profile-only, memory-only customer history and explicit browser push consent.
(function () {
  "use strict";
  const host = document.getElementById("customerNotifications");
  if (!host) return;
  const list = host.querySelector("[data-notification-list]");
  const status = host.querySelector("[data-notification-status]");
  const unread = host.querySelector("[data-notification-unread]");
  const more = host.querySelector("[data-notification-more]");
  const refresh = host.querySelector("[data-notification-refresh]");
  const markShown = host.querySelector("[data-notification-mark]");
  const pushButton = host.querySelector("[data-push-toggle]");
  const pushStatus = host.querySelector("[data-push-status]");
  let generation = 0, loading = false, pushBusy = false, items = [], cursor = null, unreadCount = 0;
  let pushConfig = null, device = null;
  const signedIn = () => Boolean(window.DartPlatform?.currentUser?.());
  const request = (path, options) => window.DartPlatform.apiRequest(path, options);
  const supported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function render() {
    list.replaceChildren();
    unread.textContent = `${unreadCount} unread`;
    items.forEach(item => {
      const row = document.createElement("li");
      row.dataset.unread = String(!item.readAt);
      const title = document.createElement("strong"); title.textContent = item.title;
      const message = document.createElement("p"); message.textContent = `${item.orderCode} — ${item.message}`;
      const date = document.createElement("time"); date.dateTime = item.createdAt;
      date.textContent = new Date(item.createdAt).toLocaleString();
      row.append(title, message, date);
      if (!item.readAt) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Mark as read";
        button.disabled = loading; button.addEventListener("click", () => void markRead([item.id])); row.append(button);
      }
      list.append(row);
    });
    more.hidden = !cursor; more.disabled = loading;
    refresh.disabled = loading || !signedIn();
    markShown.disabled = loading || !items.some(item => !item.readAt);
  }

  function renderPush() {
    pushButton.textContent = device?.enabled ? "Disable browser notifications" : "Enable browser notifications";
    pushButton.disabled = pushBusy || !signedIn() || !supported() || !pushConfig?.configured;
  }

  async function load(append = false) {
    if (loading || !signedIn()) return;
    const current = generation;
    loading = true; status.textContent = "Loading notifications…"; render();
    try {
      const result = await request(`/api/v1/me/notifications?limit=25${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (current !== generation) return;
      const merged = append ? [...items, ...result.notifications] : result.notifications;
      items = [...new Map(merged.map(item => [item.id, item])).values()];
      cursor = result.nextCursor; unreadCount = result.unreadCount;
      status.textContent = items.length ? "" : "No notifications yet. New order updates will appear here.";
    } catch {
      if (current === generation) status.textContent = "Notifications are unavailable. Select Refresh to retry.";
    } finally { if (current === generation) { loading = false; render(); } }
  }

  async function markRead(ids) {
    if (loading || !signedIn() || !ids.length) return;
    const current = generation; loading = true; render();
    try {
      const result = await request("/api/v1/me/notifications/read", { method: "POST", body: { ids } });
      if (current !== generation) return;
      const selected = new Set(ids);
      items = items.map(item => selected.has(item.id) ? { ...item, readAt: new Date().toISOString() } : item);
      unreadCount = Math.max(0, unreadCount - result.updated); status.textContent = "Marked as read.";
    } catch { if (current === generation) status.textContent = "Read status was not saved. Please retry."; }
    finally { if (current === generation) { loading = false; render(); } }
  }

  async function endpointHash(endpoint) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function applicationKey(value) {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
  async function readyRegistration() {
    // This narrow scope never controls storefront fetches. Do not use serviceWorker.ready.
    const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/push/", updateViaCache: "none" });
    if (registration.active) return registration;
    const worker = registration.installing || registration.waiting;
    if (!worker) throw new Error("Push worker unavailable");
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Push activation timed out")); }, 10000);
      const cleanup = () => { window.clearTimeout(timeout); worker.removeEventListener("statechange", changed); };
      const changed = () => {
        if (worker.state === "activated") { cleanup(); resolve(); }
        else if (worker.state === "redundant") { cleanup(); reject(new Error("Push activation failed")); }
      };
      worker.addEventListener("statechange", changed); changed();
    });
    return registration;
  }

  async function hydratePush() {
    if (pushBusy) return;
    const current = generation;
    pushBusy = true; renderPush();
    if (!supported()) {
      pushStatus.textContent = "This browser cannot enable notifications here. On iPhone or iPad, open Dart from a Home Screen installation. In-site updates remain available.";
      pushBusy = false; renderPush(); return;
    }
    try {
      const [config, subscriptions, registration] = await Promise.all([
        request("/api/v1/me/push/config"), request("/api/v1/me/push/subscriptions"), navigator.serviceWorker.getRegistration("/push/"),
      ]);
      const subscription = await registration?.pushManager?.getSubscription();
      const hash = subscription ? await endpointHash(subscription.endpoint) : null;
      if (current !== generation) return;
      pushConfig = config; device = subscriptions.subscriptions.find(value => value.endpointHash === hash) || null;
      if (device && !subscription) device = null;
      pushStatus.textContent = !config.configured ? "Browser notifications are not available yet. In-site updates remain available." :
        Notification.permission === "denied" ? "Notifications are blocked in browser settings. Allow them there, then select Refresh." :
        device?.enabled ? "Enabled for this sign-in. Signing out stops future delivery." : "Optional. Enable notifications on this browser for this sign-in.";
    } catch { if (current === generation) pushStatus.textContent = "Browser notification settings are unavailable. Select Refresh to retry."; }
    finally { if (current === generation) { pushBusy = false; renderPush(); } }
  }

  async function togglePush() {
    if (pushBusy || !signedIn() || !pushConfig?.configured) return;
    const current = generation; pushBusy = true; renderPush();
    try {
      if (device?.enabled) {
        await request(`/api/v1/me/push/subscriptions/${encodeURIComponent(device.id)}`, { method: "DELETE" });
        if (current !== generation) return;
        device.enabled = false;
        const registration = await navigator.serviceWorker.getRegistration("/push/");
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
        pushStatus.textContent = "Browser notifications disabled. In-site updates remain available.";
      } else {
        // Permission is requested only during this explicit button click.
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (current !== generation) return;
        if (permission !== "granted") { pushStatus.textContent = "Notifications were not enabled. You can change permission in browser settings."; return; }
        const registration = await readyRegistration();
        if (current !== generation) return;
        let subscription = await registration.pushManager.getSubscription();
        const key = applicationKey(pushConfig.publicKey);
        if (subscription) {
          const existing = subscription.options?.applicationServerKey;
          if (existing && (new Uint8Array(existing).length !== key.length || new Uint8Array(existing).some((byte, index) => byte !== key[index]))) {
            await subscription.unsubscribe(); subscription = null;
          }
        }
        subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        if (current !== generation) return;
        let result;
        try { result = await request("/api/v1/me/push/subscriptions", { method: "POST", body: { subscription: subscription.toJSON(), publicKey: pushConfig.publicKey } }); }
        catch (error) {
          if (error.code !== "PUSH_BROWSER_IN_USE" || current !== generation) throw error;
          await subscription.unsubscribe();
          subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          if (current !== generation) return;
          result = await request("/api/v1/me/push/subscriptions", { method: "POST", body: { subscription: subscription.toJSON(), publicKey: pushConfig.publicKey } });
        }
        if (current !== generation) return;
        device = result; pushStatus.textContent = "Enabled for this sign-in. Signing out stops future delivery.";
      }
    } catch { if (current === generation) pushStatus.textContent = "Browser notification settings were not saved. Select Refresh and try again."; }
    finally { if (current === generation) { pushBusy = false; renderPush(); } }
  }

  function initialize() {
    generation += 1; loading = false; pushBusy = false; items = []; cursor = null; unreadCount = 0; pushConfig = null; device = null;
    render(); renderPush();
    if (!signedIn()) { status.textContent = "Sign in to view your notifications."; pushStatus.textContent = ""; return; }
    void load(); void hydratePush();
  }
  more.addEventListener("click", () => void load(true));
  refresh.addEventListener("click", () => { void load(); void hydratePush(); });
  markShown.addEventListener("click", () => void markRead(items.filter(item => !item.readAt).slice(0, 100).map(item => item.id)));
  pushButton.addEventListener("click", () => void togglePush());
  window.addEventListener("dart:customer-session-changed", initialize);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
