/* DART | Homepage birthday welcome popup: guest-only, one impression per tab session. */
(function () {
  "use strict";
  const DISMISSED_KEY = "dart_birthday_welcome_dismissed_v1";
  const isDismissed = () => {
    try { return sessionStorage.getItem(DISMISSED_KEY) === "1"; }
    catch { return false; }
  };
  const rememberDismissal = () => {
    try { sessionStorage.setItem(DISMISSED_KEY, "1"); }
    catch { /* Browsers with disabled storage can still close the popup. */ }
  };

  async function initBirthdayWelcome() {
    const dialog = document.getElementById("dart-birthday-welcome-popup");
    const platform = window.DartPlatform;
    if (!dialog || typeof dialog.showModal !== "function" || !platform || isDismissed()) return;

    dialog.querySelector("[data-dart-birthday-welcome-close]")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-dart-birthday-welcome-cta]")?.addEventListener("click", rememberDismissal);
    dialog.addEventListener("close", rememberDismissal);
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    window.addEventListener("dart:customer-session-changed", event => {
      if (event.detail?.user && dialog.open) dialog.close();
    });

    try {
      // Check the server-backed account session before showing a guest-only offer.
      const user = await platform.hydrateApiSession();
      if (user || platform.currentUser?.() || isDismissed() || dialog.open) return;
      dialog.showModal();
      dialog.querySelector("[data-dart-birthday-welcome-close]")?.focus({ preventScroll: true });
    } catch {
      // If login state is uncertain, avoid displaying a guest offer to signed-in customers.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBirthdayWelcome, { once: true });
  } else {
    void initBirthdayWelcome();
  }
})();
