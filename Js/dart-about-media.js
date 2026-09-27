// DART CODE GUIDE | Js/dart-about-media.js
// الغرض: تثبيت عرض صور صفحة About وتحديث كاش السكاشن بدون تغيير تخطيط النص الأصلي.
(function initDartAboutMedia() {
  'use strict';

  const VERSION_KEY = 'dart_about_media_cache_version';
  const VERSION = 'v1';
  const FRAGMENT_CACHE_PREFIX = 'dart_fragment_v2:';
  const FRAGMENTS = [
    'sections/story.html',
    'sections/card.html',
    'sections/birthday-details.html'
  ];

  try {
    if (localStorage.getItem(VERSION_KEY) !== VERSION) {
      FRAGMENTS.forEach(path => localStorage.removeItem(FRAGMENT_CACHE_PREFIX + path));
      localStorage.setItem(VERSION_KEY, VERSION);
    }
  } catch {}

  const imageConfigs = [
    { id: 'dart-founder-image', webp: '/Photos/me.webp', fallback: '/Photos/me.png', priority: 'high' },
    { id: 'dart-card-about-image', webp: '/Photos/card.webp', fallback: '/Photos/card.png', priority: 'auto' },
    { id: 'dart-birthday-about-image', webp: '/Photos/gift.webp', fallback: '/Photos/gift.png', priority: 'auto' }
  ];

  function revealAboutSections() {
    ['story', 'card-details', 'birthday-details'].forEach(id => {
      const host = document.getElementById(id);
      if (!host) return;
      host.style.contentVisibility = 'visible';
      host.style.containIntrinsicSize = 'auto';
    });
  }

  function configureImage(config) {
    const image = document.getElementById(config.id);
    if (!image) return;

    image.loading = 'eager';
    image.decoding = 'async';
    image.setAttribute('fetchpriority', config.priority);
    if (!image.getAttribute('src')) image.src = config.webp;

    if (image.dataset.dartAboutFallbackBound !== '1') {
      image.dataset.dartAboutFallbackBound = '1';
      image.addEventListener('error', () => {
        let pathname = '';
        try {
          pathname = new URL(image.currentSrc || image.src, window.location.href).pathname;
        } catch {}
        if (pathname !== config.fallback) image.src = config.fallback;
      });
    }

    if (image.complete && image.naturalWidth === 0) {
      let pathname = '';
      try {
        pathname = new URL(image.currentSrc || image.src, window.location.href).pathname;
      } catch {}
      if (pathname !== config.fallback) image.src = config.fallback;
    }
  }

  function hydrateAboutMedia() {
    revealAboutSections();
    imageConfigs.forEach(configureImage);
  }

  document.addEventListener('dart:section-loaded', event => {
    if (FRAGMENTS.includes(String(event.detail?.filePath || ''))) hydrateAboutMedia();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAboutMedia, { once: true });
  } else {
    hydrateAboutMedia();
  }
})();
