// DART CODE GUIDE | Js/dart-cache-recovery.js
// الغرض: إزالة كاش أجزاء الواجهة القديمة التي قد تخفي Navbar/Icons بعد النشر.
(function recoverDartShellFragments() {
  "use strict";
  try {
    const staleKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key &&
        key.startsWith("dart_fragment_") &&
        (key.includes("Nav-Bar.html") || key.includes("footer.html"))
      ) {
        staleKeys.push(key);
      }
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
  } catch {}
})();
