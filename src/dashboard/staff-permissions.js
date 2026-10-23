// Shared dashboard presentation policy. The API remains the authorization boundary.
(function (root) {
  "use strict";
  const doc = root.document;
  const any = (...keys) => keys.some(key => root.DartAdminAccess?.can?.(key) === true);
  const catalogRead = () => any("catalog.manage", "catalog.read", "inventory.manage");
  const catalogWrite = key => any("catalog.manage", "catalog.edit", ...(key === "items" ? ["inventory.manage"] : []));
  function domainRead() {
    return (root.DartAdminAccess?.list?.() || []).some(key =>
      /^(?:dashboard_state\.read|finance\.(?:read|manage|view_\w+|manage_\w+)|(?:customers|returns|reviews|contacts|loyalty|messaging|notifications|promotions)\.read|(?:representatives|damage)\.manage)$/.test(key));
  }
  const catalog = ["catalog.manage", "catalog.edit"];
  const inventory = [...catalog, "inventory.manage"];
  const writes = {
    dart_models: catalog, dart_items: inventory, dart_customers: ["customers.manage"],
    dart_returns: ["returns.manage"], dart_reviews: ["reviews.manage"], dart_contact_messages: ["contacts.manage"],
    dart_cards: ["loyalty.manage"], dart_birthday_rewards: ["loyalty.manage"],
    dart_representatives: ["representatives.manage"], dart_damage: ["damage.manage"],
    dart_notifications: ["notifications.manage"], dart_birthday_messages: ["messaging.manage"],
    dart_message_queue: ["messaging.manage"], dart_promotions: ["promotions.manage"],
  };
  function canPersist(key) {
    const required = writes[key];
    return required ? any(...required) : null;
  }
  const workflow = ["orders.manage", "orders.bulk_manage"];
  const manage = {
    models: catalog, items: inventory, customers: ["customers.manage"],
    orders: ["orders.manage"], returns: ["returns.manage"], damage: ["damage.manage"],
    representative: ["representatives.manage"], card: ["loyalty.manage"],
  };
  const forms = {
    "model-form": catalog, "dashboard-size-chart-form": catalog, "item-add-form": inventory,
    customerForm: ["customers.manage"], "return-form": ["returns.manage", "returns.create_manual"],
    "damage-form": ["damage.manage"], "rep-form": ["representatives.manage"],
    "card-form": ["loyalty.manage"], "settings-promotion-form": ["promotions.manage"],
  };
  const actions = [
    ["[data-order-cod-decision]", ["orders.verify_cod"]],
    ["[data-bulk-order-status]", ["orders.bulk_manage"]],
    ["[data-order-target],.dart-pickup-cancel-btn,.dart-back-btn,#confirm-rep-assignment,#confirm-order-reason", workflow],
    [".return-accept-btn,.return-reject-btn,#confirm-return-approval,#confirm-return-rejection", ["returns.manage", "returns.review"]],
    [".return-assign-btn,#assign-selected-returns,#confirm-return-rep-assignment", ["returns.manage", "returns.assign"]],
    [".return-good-btn,.return-bad-btn", ["returns.manage", "returns.inspect"]],
    [".return-rollback-btn", ["returns.manage"]],
    [".dart-repair-btn,.dart-destroy-btn", ["damage.manage", "damage.resolve"]],
    [".dart-reset-password-btn,.dart-rep-reset,.dart-complete-reset,#openPasswordRequestsBtn,[data-password-reset-action]", ["staff.sessions_revoke"]],
    [".dart-approve-rep,.dart-reject-rep,.dart-rep-approve,.dart-rep-reject", ["representatives.approve"]],
    [".dart-rep-document,.dart-rep-docs", ["representatives.read_applications"]],
    ["[data-history-entity]", ["dashboard_state.read"]],
    ["#sendBdayBtn,[data-birthday-message-action]", ["messaging.manage"]],
    ["#open-reset-data-modal,#confirm-reset-data", ["platform.reset"]],
    ["#add-typing-word,#add-typing-scene,[data-typing-action],[data-announcement-action]", ["settings.manage"]],
  ];
  function formKeys(form) {
    if (!form) return null;
    if (form.id === "orderForm") return ["orders.manage", doc.getElementById("modal-order-edit-id")?.value ? "orders.edit" : "orders.create"];
    if (form.id === "customer-review-form") return [form.dataset.permissionDomain === "contacts" ? "contacts.manage" : "reviews.manage"];
    if (forms[form.id]) return forms[form.id];
    if (/^settings-/.test(form.id) && !["settings-display-form", "settings-staff-invite-form"].includes(form.id)) return ["settings.manage"];
    return null;
  }
  function required(node, submitting = false) {
    if (!node) return null;
    if (node.dartPermissionSource) return required(node.dartPermissionSource);
    if (submitting) return formKeys(node);
    for (const [selector, keys] of actions) if (node.matches?.(selector)) return keys;
    const form = node.closest?.("form");
    if (form && (node.type === "submit" || node.matches?.(".btn-done"))) return formKeys(form);
    const section = node.closest?.(".dashboard-section");
    if (!section) return null;
    const key = section.id;
    if (key === "models" && section.dataset.modelSetView === "sets" && node.matches?.(".add-btn,.delete-btn")) return ["sets.manage"];
    if (key === "orders") {
      if (node.matches?.(".btn-hard-delete")) return ["orders.manage", "orders.delete"];
      if (node.matches?.(".btn-delete,.delete-btn")) return ["orders.manage", "orders.archive"];
      if (node.matches?.(".btn-edit")) return ["orders.manage", "orders.edit"];
      if (node.matches?.(".add-btn")) return ["orders.manage", "orders.create"];
    }
    if (key === "returns" && node.matches?.(".btn-edit,.add-btn")) return ["returns.manage", "returns.create_manual"];
    if (key === "review" && node.matches?.(".btn-edit,.btn-delete,.btn-hard-delete,.delete-btn,.add-btn,.btn-toggle-review")) {
      if (node.matches?.(".delete-btn")) {
        const selected = Array.from(section.querySelectorAll?.(".model-checkbox:checked") || []);
        if (selected.some(control => !any(control.closest?.("[data-permission-domain]")?.dataset.permissionDomain === "contacts" ? "contacts.manage" : "reviews.manage"))) return [];
        return ["reviews.manage", "contacts.manage"];
      }
      const domain = node.closest?.("[data-permission-domain]")?.dataset.permissionDomain || "reviews";
      return [domain === "contacts" ? "contacts.manage" : "reviews.manage"];
    }
    if (node.matches?.(".btn-edit,.btn-delete,.btn-hard-delete,.delete-btn,.add-btn")) return manage[key] || null;
    return null;
  }
  function apply(node) {
    const keys = required(node);
    const denied = Boolean(keys && !any(...keys));
    if (keys || node.dataset?.dartAccessDenied) node.dataset.dartAccessDenied = String(denied);
  }
  function refresh(scope = doc) {
    if (!scope) return;
    if (scope.matches?.("button,input[type='submit']")) apply(scope);
    scope.querySelectorAll?.("button,input[type='submit']").forEach(apply);
  }
  root.DartAdminPermissions = Object.freeze({ any, catalogRead, catalogWrite, domainRead, canPersist, required, refresh });
  if (!doc) return;
  function guard(event) {
    const node = event.type === "submit" ? event.target : event.target.closest?.("button,input[type='submit']");
    const keys = required(node, event.type === "submit");
    if (!keys || any(...keys)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    root.DartDialog?.alert?.("Your Staff account does not have permission for this action.");
  }
  doc.addEventListener("click", guard, true);
  doc.addEventListener("submit", guard, true);
  doc.addEventListener("change", () => refresh(), true);
  root.addEventListener("dart:admin-authenticated", () => refresh());
  root.addEventListener("dart:admin-logged-out", () => refresh());
  function start() {
    refresh();
    if (typeof MutationObserver === "function") new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) refresh(node);
    }).observe(doc.body, { childList: true, subtree: true });
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})(window);
