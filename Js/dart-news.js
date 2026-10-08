// DART CODE GUIDE | Js/dart-news.js
// Load News only near its carousel or when an authorized Staff member opens News.
(function (root) {
  "use strict";
  const doc = root.document, section = doc.getElementById("dart-news"), admin = doc.getElementById("news");
  let pending = null;
  function asset(src) {
    return new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = `${src}?v=20261008-news-v3`;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error("News unavailable")); };
      doc.head.appendChild(script);
    });
  }
  function boot() {
    if (pending) return pending;
    pending = (root.DartNewsLinks ? Promise.resolve() : asset("/Js/dart-news-links.js"))
      .then(() => root.DartNews ? undefined : asset("/Js/dart-news-runtime.js"))
      .then(() => admin ? asset("/Eye/dart-news-admin.js") : undefined)
      .catch(() => {
        pending = null;
        const message = admin ? doc.getElementById("news-message") : section?.querySelector("[data-news-status]");
        const retry = admin ? doc.getElementById("news-retry") : section?.querySelector("[data-news-retry]");
        if (message) { message.hidden = false; message.textContent = "Unable to load News. Please try again."; }
        if (retry) retry.hidden = false;
      });
    return pending;
  }
  if (admin) {
    function access() {
      const can = root.DartAdminAccess?.can;
      const allowed = !doc.body.classList.contains("dart-admin-locked") && root.DartAdminHydration?.ready === true &&
        (can?.("news.read") === true || can?.("news.manage") === true);
      doc.querySelectorAll('[data-target="news"]').forEach(link => { link.closest("li").hidden = !allowed; });
      admin.hidden = !allowed;
      if (allowed && admin.classList.contains("active-section")) void boot();
    }
    root.addEventListener("dart:admin-authenticated", access);
    root.addEventListener("dart:admin-logged-out", access);
    new root.MutationObserver(access).observe(admin, { attributes: true, attributeFilter: ["class"] });
    new root.MutationObserver(access).observe(doc.body, { attributes: true, attributeFilter: ["class"] });
    access();
    doc.getElementById("news-retry").addEventListener("click", () => { if (!pending) access(); });
  } else if (section) {
    section.querySelector("[data-news-retry]").addEventListener("click", () => { if (!pending) void boot(); });
    if (root.IntersectionObserver) {
      const observer = new root.IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { observer.disconnect(); void boot(); }
      }, { rootMargin: "300px 0px" });
      observer.observe(section);
    } else void boot();
  }
})(window);
