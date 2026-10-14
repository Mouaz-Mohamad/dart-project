// DART CODE GUIDE | Js/dart-about-cache.js
// الغرض: تنظيف كاش About القديم مع ترك صورة المؤسس المحفوظة للإعدادات الخادمية.
(function initDartAboutMediaGuard() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v11';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];
  const STORY_FRAGMENT_CACHE_KEY = 'dart_fragment_v2:sections/story.html';
  // Versioned URL bypasses every historical HTTP/media cache entry for this image.
  const FOUNDER_SRC = '/Photos/me.png?v=founder-png-v10';

  function prepareFounderImage() {
    const founder = document.getElementById('dart-founder-image');
    if (!founder) return;

    // Historical cached markup used <picture><source srcset="/Photos/me.webp">.
    // Those alternatives can shadow a saved Settings image, so clear them once
    // when preparing the section. Site Settings owns the selected image.
    const picture = founder.closest('picture');
    if (picture) picture.querySelectorAll('source').forEach(source => source.remove());

    founder.removeAttribute('srcset');
    founder.removeAttribute('sizes');
    const source = founder.getAttribute('src');
    let isLegacyWebp = false;
    try { isLegacyWebp = new URL(source || '', window.location.href).pathname === '/Photos/me.webp'; } catch {}
    if (!source || isLegacyWebp) founder.setAttribute('src', FOUNDER_SRC);
  }

  async function refreshFounderRuntimeCaches() {
    // Remove any old founder media response even if it lives in a cache created
    // by a historical service worker with a different cache version.
    try {
      if ('caches' in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map(async cacheName => {
          const cache = await window.caches.open(cacheName);
          const requests = await cache.keys();
          await Promise.all(requests
            .filter(request => {
              try {
                const pathname = new URL(request.url).pathname;
                return pathname === '/Photos/me.webp' || pathname === '/Photos/me.png';
              } catch {
                return false;
              }
            })
            .map(request => cache.delete(request)));
        }));
      }
    } catch {}

    // Do not wait for the browser's normal service-worker update interval.
    // About requests an update immediately so the current worker takes control.
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) await registration.update();
      }
    } catch {}
  }

  try {
    const cachedStory = localStorage.getItem(STORY_FRAGMENT_CACHE_KEY) || '';
    if (/\/Photos\/me\.webp(?:[?#][^"']*)?/i.test(cachedStory) || /<picture[\s>]/i.test(cachedStory)) {
      localStorage.removeItem(STORY_FRAGMENT_CACHE_KEY);
    }

    if (localStorage.getItem(ABOUT_FRAGMENT_CACHE_RESET_KEY) !== '1') {
      ABOUT_FRAGMENT_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(ABOUT_FRAGMENT_CACHE_RESET_KEY, '1');
    }
  } catch {}

  void refreshFounderRuntimeCaches();

  // Run for every injected section so this does not depend on a particular
  // event detail shape used by the fragment loader.
  document.addEventListener('dart:section-loaded', prepareFounderImage);
  document.addEventListener('dart:sections-loaded', prepareFounderImage);
  window.addEventListener('pageshow', prepareFounderImage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepareFounderImage, { once: true });
  } else {
    prepareFounderImage();
  }
})();
