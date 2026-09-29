// DART CODE GUIDE | Js/dart-about-reflow.js
// الغرض: إصلاح صور صفحة About بعد حقن السكاشن، مع تنظيف كاش السكاشن القديمة مرة واحدة دون تغيير تخطيط main.css.
(function initDartAboutReflow() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v1';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];

  function resetLegacyAboutFragmentCacheOnce() {
    try {
      if (localStorage.getItem(ABOUT_FRAGMENT_CACHE_RESET_KEY) === '1') return;
      ABOUT_FRAGMENT_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(ABOUT_FRAGMENT_CACHE_RESET_KEY, '1');
    } catch {}
  }

  // about.html loads this deferred script before dart-ui.js, so stale fragments are
  // removed before dart-ui.js can read and inject them into the three About sections.
  resetLegacyAboutFragmentCacheOnce();

  const TARGET_IDS = [
    'dart-founder-image',
    'dart-card-about-image',
    'dart-birthday-about-image'
  ];
  const ABOUT_CONTAINERS = new Set(['story', 'card-details', 'birthday-details']);

  function forcePositionReflow(image) {
    if (!image || !image.isConnected) return;

    const computed = window.getComputedStyle(image);
    const property = computed.right !== 'auto'
      ? 'right'
      : computed.left !== 'auto'
        ? 'left'
        : null;

    if (!property) {
      void image.offsetWidth;
      return;
    }

    const inlineValue = image.style.getPropertyValue(property);
    const inlinePriority = image.style.getPropertyPriority(property);

    // يحاكي إيقاف/إعادة تفعيل right أو left من DevTools لإجبار repaint حقيقي.
    image.style.setProperty(property, 'auto');
    void image.offsetWidth;

    if (inlineValue) {
      image.style.setProperty(property, inlineValue, inlinePriority);
    } else {
      image.style.removeProperty(property);
    }

    void image.offsetWidth;
  }

  function scheduleReflow(image) {
    if (!image) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => forcePositionReflow(image));
    });
  }

  function bindImage(image) {
    if (!image || image.dataset.dartAboutReflowBound === '1') return;
    image.dataset.dartAboutReflowBound = '1';

    if (image.complete && image.naturalWidth > 0) {
      scheduleReflow(image);
    } else {
      image.addEventListener('load', () => scheduleReflow(image), { once: true });
    }
  }

  function hydrateAboutImages() {
    TARGET_IDS.forEach(id => bindImage(document.getElementById(id)));
  }

  document.addEventListener('dart:section-loaded', event => {
    if (ABOUT_CONTAINERS.has(String(event.detail?.containerId || ''))) {
      hydrateAboutImages();
    }
  });

  window.addEventListener('pageshow', hydrateAboutImages);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAboutImages, { once: true });
  } else {
    hydrateAboutImages();
  }
})();
