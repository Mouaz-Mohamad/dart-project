// DART CODE GUIDE | Js/dart-about-cache.js
// الغرض: تنظيف كاش سكاشن About القديمة قبل حقنها، ومنع بقاء نسخة WebP القديمة لصورة المؤسس.
(function initDartAboutCacheReset() {
  'use strict';

  const ABOUT_FRAGMENT_CACHE_RESET_KEY = 'dart_about_fragment_cache_reset_v3';
  const ABOUT_FRAGMENT_CACHE_KEYS = [
    'dart_fragment_v2:sections/story.html',
    'dart_fragment_v2:sections/card.html',
    'dart_fragment_v2:sections/birthday-details.html'
  ];
  const STORY_FRAGMENT_CACHE_KEY = 'dart_fragment_v2:sections/story.html';

  try {
    // حتى لو تم تنفيذ reset سابق، أي fragment قديم ما زال يشير إلى me.webp
    // يجب حذفه فورًا حتى تصبح me.png هي الصورة الوحيدة المستخدمة في صفحة About.
    const cachedStory = localStorage.getItem(STORY_FRAGMENT_CACHE_KEY) || '';
    if (/\/Photos\/me\.webp(?:[?#][^"']*)?/i.test(cachedStory)) {
      localStorage.removeItem(STORY_FRAGMENT_CACHE_KEY);
    }

    if (localStorage.getItem(ABOUT_FRAGMENT_CACHE_RESET_KEY) === '1') return;
    ABOUT_FRAGMENT_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(ABOUT_FRAGMENT_CACHE_RESET_KEY, '1');
  } catch {}
})();
