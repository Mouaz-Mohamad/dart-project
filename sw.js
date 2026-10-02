// DART CODE GUIDE | sw.js
// الغرض: Service Worker للموقع؛ يدير التخزين المؤقت وسلوك الشبكة دون أن يصبح مصدر بيانات تجاري.
// Dart storefront cache policy: always revalidate online; use CacheStorage only as an offline fallback.
const CACHE = 'dart-static-v27-revalidate-all';
const PRIVATE_PATHS = ['/Eye/', '/profile.html', '/cart-checkout.html', '/track.html', '/rep.html', '/Sign%20Up%20modern.html'];
const FOUNDER_PNG_URL = '/Photos/me.png?v=founder-png-v10';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('dart-static-') && key !== CACHE)
        .map(key => caches.delete(key))
    ))
    .then(() => self.clients.claim())
));

async function networkFirst(request) {
  const refreshRequest = new Request(request, { cache: 'no-cache' });
  try {
    const response = await fetch(refreshRequest);
    if (response.ok) {
      const clone = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, clone));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    PRIVATE_PATHS.some(path => url.pathname.startsWith(path)) ||
    url.pathname.startsWith('/api/')
  ) return;

  // Keep the founder image fully uncached because this asset historically had
  // multiple filenames and formats. This guarantees the canonical PNG wins.
  if (url.pathname === '/Photos/me.webp' || url.pathname === '/Photos/me.png') {
    event.respondWith(
      fetch(new Request(FOUNDER_PNG_URL, {
        method: 'GET',
        headers: request.headers,
        mode: 'same-origin',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'follow'
      }))
    );
    return;
  }

  // Every same-origin public GET request is revalidated while online.
  // CacheStorage is only used when the network request fails.
  event.respondWith(networkFirst(request));
});
