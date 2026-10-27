// DART CODE GUIDE | push-sw.js
// Push-only worker under /push/; no fetch handler, offline cache or business storage.
"use strict";
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("push", event => {
  let notificationId = "update";
  try {
    const value = event.data?.json()?.notificationId;
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) notificationId = value;
  } catch { /* A visible generic notification is still required for malformed payloads. */ }
  event.waitUntil(self.registration.showNotification("Dart order update", {
    body: "Your order has an update. Open Dart to view it.",
    icon: "/Photos/192px.png", badge: "/Photos/192px.png",
    tag: `dart-order-${notificationId}`, renotify: false,
    data: { url: "/profile.html#customerNotifications" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  // Never navigate to a URL supplied by a push payload or notification data.
  const target = new URL("/profile.html#customerNotifications", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname === "/profile.html") {
        if (client.navigate) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
