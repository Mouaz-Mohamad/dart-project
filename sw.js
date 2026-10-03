// DART CODE GUIDE | sw.js
// Cache Lifecycle V2 retirement worker.
// Dart no longer uses a Service Worker for storefront delivery. This file exists
// only so browsers with an older Dart worker can update to this version, purge
// legacy CacheStorage entries, and unregister the worker permanently.
const DART_CACHE_PREFIX = 'dart-static-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(DART_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
    await self.registration.unregister();
  })());
});
