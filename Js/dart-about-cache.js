// DART CODE GUIDE | Js/dart-about-cache.js
// الغرض: تنظيف كاش سكاشن About القديمة وتثبيت صورة المؤسس العامة على PNG الأصلية.
(function initDartAboutMediaGuard() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v4';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];
  const STORY_FRAGMENT_CACHE_KEY = 'dart_fragment_v2:sections/story.html';
  const FOUNDER_SRC = '/Photos/me.png';

  function enforceFounderPng() {
    const founder = document.getElementById('dart-founder-image');
    if (!founder) return;

    if (founder.getAttribute('src') !== FOUNDER_SRC) {
      founder.setAttribute('src', FOUNDER_SRC);
    }

    if (founder.dataset.dartFounderPngLocked === '1') return;
    founder.dataset.dartFounderPngLocked = '1';

    // Site settings can resolve an uploaded founder asset asynchronously after
    // the story fragment is injected. Keep the public About image pinned to the
    // repository PNG without changing image handling elsewhere in Dart.
    const observer = new MutationObserver(() => {
      if (founder.getAttribute('src') !== FOUNDER_SRC) {
        founder.setAttribute('src', FOUNDER_SRC);
      }
    });
    observer.observe(founder, { attributes: true, attributeFilter: ['src'] });
  }

  try {
    const cachedStory = localStorage.getItem(STORY_FRAGMENT_CACHE_KEY) || '';
    if (/\/Photos\/me\.webp(?:[?#][^"']*)?/i.test(cachedStory)) {
      localStorage.removeItem(STORY_FRAGMENT_CACHE_KEY);
    }

    if (localStorage.getItem(ABOUT_FRAGMENT_CACHE_RESET_KEY) !== '1') {
      ABOUT_FRAGMENT_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(ABOUT_FRAGMENT_CACHE_RESET_KEY, '1');
    }
  } catch {}

  document.addEventListener('dart:section-loaded', event => {
    if (event.detail?.containerId === 'story') enforceFounderPng();
  });
  document.addEventListener('dart:sections-loaded', enforceFounderPng);
  window.addEventListener('dart:site-settings-changed', enforceFounderPng);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforceFounderPng, { once: true });
  } else {
    enforceFounderPng();
  }
})();
