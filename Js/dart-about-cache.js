// DART CODE GUIDE | Js/dart-about-cache.js
// الغرض: تنظيف كاش سكاشن About القديمة وتثبيت صورة المؤسس العامة على PNG الأصلية.
(function initDartAboutMediaGuard() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v9';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];
  const STORY_FRAGMENT_CACHE_KEY = 'dart_fragment_v2:sections/story.html';
  // Versioned URL bypasses every historical HTTP/media cache entry for this image.
  const FOUNDER_SRC = '/Photos/me.png?v=founder-png-v9';

  function enforceFounderPng() {
    const founder = document.getElementById('dart-founder-image');
    if (!founder) return;

    // Historical cached markup used <picture><source srcset="/Photos/me.webp">.
    // Browsers prefer that source over the <img src>, so remove every alternative
    // source/srcset before locking the public founder image to the PNG file.
    const picture = founder.closest('picture');
    if (picture) picture.querySelectorAll('source').forEach(source => source.remove());

    founder.removeAttribute('srcset');
    founder.removeAttribute('sizes');
    if (founder.getAttribute('src') !== FOUNDER_SRC) founder.setAttribute('src', FOUNDER_SRC);

    if (founder.dataset.dartFounderPngLocked === '1') return;
    founder.dataset.dartFounderPngLocked = '1';

    // Site settings or stale runtime code must never replace the public About
    // founder image with a WebP variant after the section is painted.
    const observer = new MutationObserver(() => {
      const activePicture = founder.closest('picture');
      if (activePicture) activePicture.querySelectorAll('source').forEach(source => source.remove());
      founder.removeAttribute('srcset');
      founder.removeAttribute('sizes');
      if (founder.getAttribute('src') !== FOUNDER_SRC) founder.setAttribute('src', FOUNDER_SRC);
    });
    observer.observe(founder, {
      attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes']
    });
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
    // About requests an update immediately so the PNG-only worker takes control.
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
  document.addEventListener('dart:section-loaded', enforceFounderPng);
  document.addEventListener('dart:sections-loaded', enforceFounderPng);
  window.addEventListener('dart:site-settings-changed', enforceFounderPng);
  window.addEventListener('pageshow', enforceFounderPng);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforceFounderPng, { once: true });
  } else {
    enforceFounderPng();
  }
})();
