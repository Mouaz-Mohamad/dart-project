// DART CODE GUIDE | Eye/admin-push-sw.js
// Push-only staff worker; no fetch handler or offline business data.
"use strict";
const labels = { ORDER_CREATED: "New order", RETURN_CREATED: "New return request", EXCHANGE_CREATED: "New exchange request", REVIEW_CREATED: "New review", ADMIN_PUSH_TEST: "Test Notification" };
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("push", event => {
  let id = "update", type = "";
  try {
    const data = event.data?.json();
    if (/^[0-9a-f-]{36}$/i.test(data?.notificationId)) id = data.notificationId;
    else if (/^[0-9a-f-]{36}$/i.test(data?.testId)) id = data.testId;
    if (Object.hasOwn(labels, data?.eventType)) type = data.eventType;
  } catch { /* Show a generic visible alert for malformed messages. */ }
  const isTest=type==="ADMIN_PUSH_TEST";
  event.waitUntil(self.registration.showNotification(isTest ? "Dart | for you 🔔" : `Dart · ${labels[type] || "Dashboard update"}`, {
    body: isTest ? "Test Notification — إشعارات Dart شغالة بنجاح! ✅" : "Open Dart Eye to view the details.", icon: "/Photos/192px.png", badge: "/Photos/192px.png",
    tag: `dart-admin-${id}`, renotify: false, data: isTest ? {} : { notificationId: id },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const id = event.notification.data?.notificationId;
  const target = new URL("/Eye/Dart%20Eye.html", self.location.origin);
  if (/^[0-9a-f-]{36}$/i.test(id)) target.searchParams.set("notification", id);
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      const url = new URL(client.url);
      if (url.origin === target.origin && url.pathname === target.pathname) {
        if (client.navigate) await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
