// DART CODE GUIDE | Js/dart-about-cache.js
// الغرض: تنظيف كاش سكاشن About القديمة مرة واحدة قبل حقنها، بدون أي repaint أو تعديل على مواضع الصور.
(function initDartAboutCacheReset() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v2';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];

  try {
    if (localStorage.getItem(ABOUT_FRAGMENT_CACHE_RESET_KEY) === '1') return;
    ABOUT_FRAGMENT_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(ABOUT_FRAGMENT_CACHE_RESET_KEY, '1');
  } catch {}
})();
