function dartNotificationCategory(n) {
  const t = String(n.type || "").toLowerCase();
  if (t.includes("damage") || t.includes("destroy") || t.includes("repair"))
    return "damage";
  if (t.includes("return") || t.includes("refus")) return "return";
  if (t.includes("payment") || t.includes("refund")) return "payment";
  if (t.includes("stock") || t.includes("item") || t.includes("inventory"))
    return "inventory";
  if (t.includes("client") || t.includes("password")) return "customer";
  if (
    t.includes("order") ||
    t.includes("representative") ||
    t.includes("pickup") ||
    t.includes("attention")
  )
    return "order";
  return "system";
}
function dartNotificationIcon(cat) {
  return (
    {
      order: "fa-solid fa-box",
      inventory: "fa-solid fa-shirt",
      return: "fa-solid fa-rotate-left",
      damage: "fa-solid fa-triangle-exclamation",
      payment: "fa-solid fa-wallet",
      customer: "fa-solid fa-user",
      system: "fa-solid fa-circle-info",
    }[cat] || "fa-solid fa-bell"
  );
}
function renderNotifications() {
  const feed = document.getElementById("updates-feed");
  if (!feed) return;
  const filter = document.getElementById("notificationFilter")?.value || "all",
    list = notificationData
      .filter((n) => filter === "all" || dartNotificationCategory(n) === filter)
      .slice(0, 80);
  feed.innerHTML =
    list
      .map((n) => {
        const cat = dartNotificationCategory(n);
        return `<div class="dart-notification notif-${cat} ${n.read ? "read" : "unread"}" data-notification-id="${dartEsc(n.id)}"><span class="notif-icon"><i class="${dartNotificationIcon(cat)}"></i></span><div class="notif-main"><div class="notif-title">${dartEsc(n.title)}</div><small>${dartEsc(n.message)}</small></div><time>${dartEsc(new Date(n.timestamp).toLocaleString())}</time></div>`;
      })
      .join("") || '<div class="dart-empty-state">No updates yet</div>';
  if (!feed.dataset.dartBound) {
    feed.dataset.dartBound = "1";
    feed.addEventListener("click", (e) => {
      const el = e.target.closest("[data-notification-id]");
      if (!el) return;
      const n = notificationData.find(
        (x) => x.id === el.dataset.notificationId,
      );
      if (!n) return;
      n.read = true;
      dartSaveAll();
      renderNotifications();
      if (n.relatedEntityType && document.getElementById(n.relatedEntityType)) {
        document
          .querySelector(`[data-target="${n.relatedEntityType}"]`)
          ?.click();
        setTimeout(
          () =>
            document
              .querySelector(
                `#${n.relatedEntityType} .model-row[data-id="${CSS.escape(n.relatedEntityId)}"]`,
              )
              ?.scrollIntoView({ behavior: "smooth", block: "center" }),
          50,
        );
      }
    });
  }
  const f = document.getElementById("notificationFilter");
  if (f && !f.dataset.dartBound) {
    f.dataset.dartBound = "1";
    f.addEventListener("change", renderNotifications);
  }
}

