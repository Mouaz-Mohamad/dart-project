// DART CODE GUIDE | Js/dart-cache-recovery.js
// Cache Lifecycle V2: retire legacy Service Workers/caches without touching customer/business data.
(function recoverDartBrowserCaches() {
  "use strict";

  function purgeLegacyFragmentStorage() {
    try {
      const staleKeys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (
          key &&
          key.startsWith("dart_fragment_") &&
          (key.includes("Nav-Bar.html") || key.includes("footer.html"))
        ) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach((key) => localStorage.removeItem(key));
    } catch {}
  }

  async function unregisterLegacyServiceWorkers() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            try {
              return new URL(registration.scope).origin === location.origin;
            } catch {
              return false;
            }
          })
          .map((registration) => registration.unregister()),
      );
    } catch {}
  }

  async function purgeLegacyCacheStorage() {
    if (!("caches" in window)) return;
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("dart-static-"))
          .map((key) => caches.delete(key)),
      );
    } catch {}
  }

  async function retireLegacyCaching() {
    await Promise.all([
      unregisterLegacyServiceWorkers(),
      purgeLegacyCacheStorage(),
    ]);
  }

  purgeLegacyFragmentStorage();
  void retireLegacyCaching();

  // Older UI bundles may try to register /sw.js later in the same page load.
  // Re-run cleanup after those deferred/idle registrations have had a chance to fire.
  window.addEventListener("load", () => {
    window.setTimeout(() => void retireLegacyCaching(), 0);
    window.setTimeout(() => void retireLegacyCaching(), 6500);
  }, { once: true });
})();
