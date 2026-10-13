// DART CODE GUIDE | Js/dart-navigation.js
// Public document preloading and native history restoration. Each page keeps its own JS realm.
(function (root) {
  "use strict";
  const doc = root.document;
  const PUBLIC_PAGES = ["/", "/products.html", "/about.html", "/policies.html", "/Contact%20us.html", "/search-serial.html"];
  const queue = [], seen = new Set(), controllers = new Set();
  let active = 0, started = false, paused = false, restoring = false;

  function publicUrl(href) {
    try {
      const url = new URL(href, root.location.href);
      if (url.origin !== root.location.origin || url.search) return null;
      if (url.pathname === "/index.html") url.pathname = "/";
      if (url.pathname === "/products") url.pathname = "/products.html";
      return PUBLIC_PAGES.includes(url.pathname) ? url : null;
    } catch { return null; }
  }

  function preloadAllowed() {
    const connection = root.navigator.connection;
    return !doc.prerendering && !doc.hidden && root.navigator.onLine !== false &&
      !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType || "");
  }

  function enqueue(href, html = false) {
    const url = new URL(href, root.location.href);
    if (url.origin !== root.location.origin || seen.has(url.href)) return;
    if (!html && !/^\/(?:Js|CSS)\/[^?#]+\.(?:js|css)$/.test(url.pathname)) return;
    seen.add(url.href);
    queue.push({ url, html });
    pump();
  }

  async function load(entry) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = root.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await root.fetch(entry.url.href, { signal: controller.signal, credentials: "same-origin",
        cache: entry.html ? "no-cache" : "default", priority: "low" });
      if (!response.ok) return;
      if (entry.html) {
        const html = new DOMParser().parseFromString(await response.text(), "text/html");
        const base = html.querySelector("base[href]");
        const baseUrl = base ? new URL(base.getAttribute("href"), entry.url.href) : entry.url;
        html.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((node) => {
          enqueue(new URL(node.getAttribute("src") || node.getAttribute("href"), baseUrl).href);
        });
      } else await response.arrayBuffer();
    } catch { /* Preloading is optional; real navigation still shows its normal error/retry states. */ }
    finally { root.clearTimeout(timer); controllers.delete(controller); }
  }

  function pump() {
    if (paused || !preloadAllowed()) return;
    while (active < 2 && queue.length) {
      active += 1;
      void load(queue.shift()).finally(() => { active -= 1; pump(); });
    }
  }

  function installPrerender() {
    if (!root.HTMLScriptElement?.supports?.("speculationrules")) return;
    const rules = doc.createElement("script");
    rules.type = "speculationrules";
    const markLinks = () => doc.querySelectorAll("a[href]").forEach((link) => {
      const url = publicUrl(link.href);
      if (url && !url.hash && (!link.target || link.target === "_self") && !link.hasAttribute("download"))
        link.setAttribute("data-dart-prerender", "");
    });
    markLinks();
    doc.addEventListener("dart:section-loaded", markLinks);
    const prerender = [{ source: "document", eagerness: "moderate", where: { selector_matches: "a[data-dart-prerender]" } }];
    if (publicUrl(root.location.href)?.pathname === "/") prerender.unshift({ urls: ["/products.html"], eagerness: "immediate" });
    rules.textContent = JSON.stringify({ prerender });
    doc.head.appendChild(rules);
  }

  function start() {
    if (started || !preloadAllowed()) return;
    started = true;
    installPrerender();
    const current = publicUrl(root.location.href);
    PUBLIC_PAGES.filter((path) => path !== current?.pathname).forEach((path) => enqueue(path, true));
  }

  function go(href) {
    const destination = publicUrl(href);
    const current = publicUrl(root.location.href);
    const nav = root.navigation;
    // Exact hashes matter: a product/modal history entry must not replace the plain page entry.
    if (!restoring && destination && current && destination.href !== current.href && nav?.entries && nav.traverseTo) {
      const match = nav.entries().filter((entry) => entry.key !== nav.currentEntry?.key &&
        publicUrl(entry.url)?.href === destination.href).sort((a, b) =>
        Math.abs(a.index - nav.currentEntry.index) - Math.abs(b.index - nav.currentEntry.index))[0];
      if (match) {
        restoring = true;
        try {
          const originKey = nav.currentEntry.key;
          const result = nav.traverseTo(match.key);
          // Both promises can reject when a newer navigation supersedes this one.
          void result.committed.catch(() => {});
          void result.finished.catch((error) => {
            restoring = false;
            if (error?.name === "AbortError" || doc.hidden || nav.currentEntry?.key !== originKey) return;
            root.location.assign(href);
          });
          return;
        } catch { restoring = false; }
      }
    }
    root.location.assign(href);
  }

  doc.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const shop = event.target.closest?.("[data-go-products]");
    const link = event.target.closest?.("a[href]");
    if (!shop && (!link || link.hasAttribute("download") || link.target && link.target !== "_self")) return;
    const href = shop ? "/products.html" : link.href;
    const url = publicUrl(href), current = publicUrl(root.location.href);
    if (!url || url.hash || url.pathname === current?.pathname) return;
    event.preventDefault();
    if (shop) event.stopImmediatePropagation();
    go(href);
  }, true);

  doc.addEventListener("dart:critical-ready", () => {
    if (root.requestIdleCallback) root.requestIdleCallback(start, { timeout: 1500 });
    else root.setTimeout(start, 100);
  });
  root.addEventListener("pagehide", () => {
    paused = true;
    controllers.forEach((controller) => controller.abort());
  });
  root.addEventListener("pageshow", () => { paused = false; restoring = false; pump(); });
  doc.addEventListener("visibilitychange", () => { if (!doc.hidden) { start(); pump(); } });
  root.addEventListener("online", () => { start(); pump(); });
  root.DartNavigation = Object.freeze({ go, publicUrl, start });
})(window);
