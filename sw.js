// BEGIN V9 cache refresh — birthday rewards and requested UI additions.
const CACHE = 'dart-static-v9';
// END V9 cache refresh.
const PRIVATE_PATHS = ['/Eye/', '/profile.html', '/cart-checkout.html', '/track.html', '/rep.html', '/Sign%20Up%20modern.html'];

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dart-static-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || PRIVATE_PATHS.some(path => url.pathname.startsWith(path))) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }
  if (!/\.(?:css|js|png|jpe?g|jfif|svg|ico|webp)$/i.test(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => {
    const fresh = fetch(request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone())); return response; });
    return cached || fresh;
  }));
});
