// Server-backed shopping feedback. No prices, eligibility or customer progress are persisted here.
(function (root) {
  "use strict";
  const doc = root.document;
  // Keep the shared header available on the first upward movement, even mid-page.
  function installScrollHeader() {
    const header = doc.getElementById("header-container");
    if (!header?.querySelector(".hedar-nav") || header.dataset.dartScrollHeader === "1") return;
    header.dataset.dartScrollHeader = "1";
    doc.body.classList.add("dart-scroll-header");
    const position = () => Math.max(0, Math.min(root.scrollY || 0,
      Math.max(0, doc.documentElement.scrollHeight - root.innerHeight)));
    let previous = position(), downward = 0, frame = 0;
    function reveal() { header.classList.remove("dart-nav-hidden"); downward = 0; }
    function update() {
      frame = 0;
      const current = position(), delta = current - previous;
      previous = current;
      if (current <= header.offsetHeight || doc.body.classList.contains("menu-open") ||
          header.contains(doc.activeElement)) { reveal(); return; }
      if (delta < 0) { reveal(); return; }
      downward += delta;
      if (downward >= 8) header.classList.add("dart-nav-hidden");
    }
    root.addEventListener("scroll", () => { if (!frame) frame = root.requestAnimationFrame(update); }, { passive: true });
    header.addEventListener("focusin", reveal);
    header.addEventListener("click", reveal);
    root.addEventListener("pageshow", () => { previous = position(); reveal(); });
    root.addEventListener("resize", () => { previous = position(); reveal(); });
  }
  doc.addEventListener("dart:section-loaded", installScrollHeader);
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", installScrollHeader, { once: true });
  else installScrollHeader();

  let node, link, heading, detail, progress, action, title = "", incentives = [], version = 0;
  let confirmationUntil = 0, timer = 0, refreshTimer = 0, dismissed = false, paused = false;
  const cart = () => root.DartState?.read?.("dart_cart", []) || [];
  const options = () => root.DartSiteSettings?.get?.().shoppingBar || {};
  const duration = () => Math.min(30, Math.max(4, Number(options().durationSeconds) || 6)) * 1000;
  function ensure() {
    if (node) return;
    node = doc.createElement("aside"); node.id = "cartBanner"; node.className = "cart-banner";
    node.dir = "rtl"; node.hidden = true; node.setAttribute("aria-label", "السلة والعروض المتاحة");
    link = doc.createElement("a"); link.className = "cart-banner-link"; link.href = "/cart-checkout.html";
    link.addEventListener("click", event => {
      const checkout = doc.getElementById?.("toCheckoutBtn");
      if (!checkout || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); checkout.click();
    });
    const copy = doc.createElement("span"); copy.className = "cart-banner-copy";
    const live = doc.createElement("span"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true");
    heading = doc.createElement("strong"); detail = doc.createElement("span");
    detail.className = "cart-banner-detail"; live.append(heading, detail);
    progress = doc.createElement("progress"); progress.className = "cart-banner-progress";
    progress.setAttribute("aria-label", "التقدم نحو العرض");
    action = doc.createElement("span"); action.className = "cart-banner-action";
    copy.append(live, progress); link.append(copy, action);
    const close = doc.createElement("button"); close.type = "button"; close.className = "cart-banner-close";
    close.textContent = "×"; close.setAttribute("aria-label", "إغلاق إشعار السلة");
    close.addEventListener("click", () => { dismissed = true; hide(); });
    node.append(link, close); doc.body.append(node);
    node.addEventListener("pointerenter", () => { paused = true; root.clearTimeout(timer); });
    node.addEventListener("pointerleave", resume);
    node.addEventListener("focusin", () => { paused = true; root.clearTimeout(timer); });
    node.addEventListener("focusout", () => { if (!node.contains(doc.activeElement)) resume(); });
    node.addEventListener("keydown", event => { if (event.key === "Escape") { dismissed = true; hide(); } });
  }
  function hide() { root.clearTimeout(timer); if (node) { node.hidden = true; node.classList.remove("show"); } }
  function resume() { paused = false; if (title) confirmationUntil = Date.now() + duration(); render(); }
  function render() {
    root.clearTimeout(timer);
    if (dismissed || !doc.body || doc.hidden) return hide();
    const offer = options().enabled === false ? null : incentives[0];
    const added = title && Date.now() < confirmationUntil;
    if (!added && !offer) return hide();
    ensure();
    heading.textContent = added ? `تمت إضافة «${title}» إلى السلة` : offer.title;
    detail.textContent = offer ? offer.message : "اختياراتك جاهزة — افتح السلة وكمّل طلبك";
    progress.hidden = !offer;
    if (offer) { progress.max = Math.max(1, Number(offer.target)); progress.value = Math.min(progress.max, Math.max(0, Number(offer.current))); }
    action.textContent = "إتمام الشراء ←";
    node.hidden = false; node.classList.add("show");
    if (added && !paused) timer = root.setTimeout(() => { title = ""; render(); }, Math.max(0, confirmationUntil - Date.now()));
  }
  async function refresh() {
    const sequence = ++version;
    incentives = []; render();
    try {
      let payload;
      if (cart().length) payload = await root.DartPlatform?.quoteCart?.({ force: true });
      else if (root.DartPlatform?.currentUser?.()) payload = await root.DartPlatform.apiRequest("/api/v1/me/promotions/card-progress");
      if (sequence !== version) return;
      incentives = Array.isArray(payload?.incentives) ? payload.incentives : [];
      render();
    } catch { if (sequence === version) { incentives = []; render(); } }
  }
  function changed() {
    ++version; incentives = []; dismissed = false;
    if (!cart().length) { title = ""; hide(); } else render();
    root.clearTimeout(refreshTimer); refreshTimer = root.setTimeout(() => void refresh(), 180);
  }
  function added(productTitle) {
    title = String(productTitle || "المنتج").slice(0, 200); dismissed = false;
    confirmationUntil = Date.now() + duration(); render();
    root.clearTimeout(refreshTimer); void refresh();
  }
  root.addEventListener("dart:data-changed", event => { if (event.detail?.key === "dart_cart") changed(); });
  root.addEventListener("dart:customer-session-changed", () => { title = ""; changed(); });
  root.addEventListener("dart:site-settings-changed", changed);
  root.addEventListener("dart:cart-reservation-expired", changed);
  root.addEventListener("pageshow", changed);
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) hide(); else changed(); });
  doc.addEventListener("dart:critical-ready", changed);
  root.DartShoppingBar = Object.freeze({ added, refresh });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", changed, { once: true });
  else changed();
})(window);
