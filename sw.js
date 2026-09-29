// DART CODE GUIDE | sw.js
// الغرض: Service Worker للموقع؛ يدير التخزين المؤقت وسلوك الشبكة دون أن يصبح مصدر بيانات تجاري.
// Dart storefront cache: network-first for documents/code, cache-first fallback for media.
const CACHE = 'dart-static-v24-founder-png-v8';
const PRIVATE_PATHS = ['/Eye/', '/profile.html', '/cart-checkout.html', '/track.html', '/rep.html', '/Sign%20Up%20modern.html'];

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('dart-static-') && key !== CACHE)
        .map(key => caches.delete(key))
    ))
    .then(async () => {
      // Defensive cleanup in case a legacy founder WebP was stored in a
      // non-versioned cache by an older worker.
      const keys = await caches.keys();
      await Promise.all(keys.map(async key => {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter(request => {
              try { return new URL(request.url).pathname === '/Photos/me.webp'; }
              catch { return false; }
            })
            .map(request => cache.delete(request))
        );
      }));
      return self.clients.claim();
    })
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

  // The legacy founder WebP no longer exists in the repository. Older
  // dashboard code may still request it as a preview fallback; preserve that
  // preview by redirecting only Eye-originated requests to the PNG. Public
  // requests deliberately fail so stale <picture><source> markup cannot win.
  if (url.pathname === '/Photos/me.webp') {
    let referrerPath = '';
    try {
      referrerPath = request.referrer ? new URL(request.referrer).pathname : '';
    } catch {}

    if (referrerPath.startsWith('/Eye/')) {
      event.respondWith(Promise.resolve(Response.redirect('/Photos/me.png?v=founder-png-v8', 302)));
    } else {
      event.respondWith(Promise.resolve(new Response('', {
        status: 404,
        statusText: 'Founder PNG only',
        headers: { 'Cache-Control': 'no-store' }
      })));
    }
    return;
  }

  // Always revalidate the founder PNG instead of serving a historical media
  // cache entry. A fresh successful PNG is still saved for offline fallback.
  if (url.pathname === '/Photos/me.png') {
    event.respondWith(
      fetch(request, { cache: 'reload' })
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

  if (request.mode === 'navigate' || /\.html$/i.test(url.pathname) || url.pathname.startsWith('/sections/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(async error => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw error;
        })
    );
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
