// Dart storefront cache: network-first for code, cache-first fallback for media.
const CACHE = 'dart-static-v13-server-authoritative';
const PRIVATE_PATHS = ['/Eye/', '/profile.html', '/cart-checkout.html', '/track.html', '/rep.html', '/Sign%20Up%20modern.html'];

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

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    PRIVATE_PATHS.some(path => url.pathname.startsWith(path)) ||
    url.pathname.startsWith('/api/')
  ) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (/\.(?:js|css)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (/\.(?:png|jpe?g|jfif|svg|ico|webp)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
