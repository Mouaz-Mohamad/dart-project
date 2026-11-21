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

  let node, link, heading, detail, progress, fill, offerCopy, count, price, feedback, live;
  let title = "", incentives = [], quote = null, version = 0, loading = false;
  let confirmationUntil = 0, timer = 0, refreshTimer = 0, dismissed = false, paused = false;
  const cart = () => { const lines = root.DartState?.read?.("dart_cart", []); return Array.isArray(lines) ? lines : []; };
  const options = () => root.DartSiteSettings?.get?.().shoppingBar || {};
  const duration = () => Math.min(30, Math.max(4, Number(options().durationSeconds) || 6)) * 1000;
  const checkoutPage = () => /^\/cart-checkout(?:\.html)?\/?$/i.test(root.location?.pathname || "") ||
    Boolean(doc.getElementById("cartView") || doc.getElementById("checkoutView"));
  function reserveSpace() {
    const height = node && !node.hidden ? Math.ceil(node.getBoundingClientRect?.().height || 0) + 14 : 0;
    doc.documentElement?.style?.setProperty("--dart-shopping-bar-space", `${height}px`);
  }
  function ensure() {
    if (node) return;
    node = doc.createElement("aside"); node.id = "cartBanner"; node.className = "cart-banner glass-effect";
    node.dir = "rtl"; node.hidden = true; node.setAttribute("aria-label", "السلة والعروض المتاحة");
    link = doc.createElement("a"); link.className = "cart-banner-link"; link.href = "/cart-checkout.html";
    const summary = doc.createElement("span"); summary.className = "cart-banner-summary";
    count = doc.createElement("span"); count.className = "cart-banner-count";
    const action = doc.createElement("span"); action.className = "cart-banner-action";
    const label = doc.createElement("strong"); label.textContent = "عرض السلة";
    feedback = doc.createElement("span"); feedback.className = "cart-banner-feedback"; feedback.textContent = "✓"; feedback.setAttribute("aria-hidden", "true");
    action.append(label, feedback);
    const amount = doc.createElement("span"); amount.className = "cart-banner-amount";
    price = doc.createElement("bdi"); price.dir = "ltr"; price.className = "cart-banner-price";
    amount.append(price); summary.append(count, action, amount);
    offerCopy = doc.createElement("span"); offerCopy.className = "cart-banner-offer";
    heading = doc.createElement("strong"); heading.className = "cart-banner-offer-title";
    detail = doc.createElement("span"); detail.className = "cart-banner-detail";
    progress = doc.createElement("span"); progress.className = "cart-banner-progress";
    progress.setAttribute("role", "progressbar"); progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-label", "التقدم نحو العرض");
    fill = doc.createElement("span"); fill.className = "cart-banner-progress-fill"; progress.append(fill);
    live = doc.createElement("span"); live.className = "sr-only";
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true");
    offerCopy.append(heading, detail, progress); link.append(summary, offerCopy, live);
    const close = doc.createElement("button"); close.type = "button"; close.className = "cart-banner-close";
    close.textContent = "×"; close.setAttribute("aria-label", "إغلاق إشعار السلة");
    close.addEventListener("click", () => { dismissed = true; hide(); });
    node.append(link, close); doc.body.append(node);
    if (root.ResizeObserver) new root.ResizeObserver(reserveSpace).observe(node);
    root.addEventListener("resize", reserveSpace);
    node.addEventListener("pointerenter", () => { paused = true; root.clearTimeout(timer); });
    node.addEventListener("pointerleave", resume);
    node.addEventListener("focusin", () => { paused = true; root.clearTimeout(timer); });
    node.addEventListener("focusout", () => { if (!node.contains(doc.activeElement)) resume(); });
    node.addEventListener("keydown", event => { if (event.key === "Escape") { dismissed = true; hide(); } });
  }
  function hide() {
    root.clearTimeout(timer); paused = false;
    if (node) { node.hidden = true; node.classList.remove("show"); }
    doc.body?.classList.remove("dart-cart-bar-visible"); reserveSpace();
  }
  function resume() { paused = false; if (title) confirmationUntil = Date.now() + duration(); render(); }
  function itemTotal(payload) {
    if (payload?.currency !== "EGP" || !Number.isSafeInteger(payload.totalMinor) ||
        !Number.isSafeInteger(payload.shippingMinor) || payload.shippingMinor < 0 || payload.totalMinor < payload.shippingMinor) return null;
    return payload.totalMinor - payload.shippingMinor;
  }
  function offerTitle(offer) {
    if (offer.title && offer.title !== "كمّل اختياراتك واستفيد") return offer.title;
    return ({ freeShipping: "توصيل مجاني", gift: "هدية على طلبك", percent: "خصم على طلبك", fixed: "خصم على طلبك", card: "Dart Card" })[offer.type] || "عرض خاص ليك";
  }
  function render() {
    root.clearTimeout(timer);
    if (dismissed || !doc.body || doc.hidden || checkoutPage()) return hide();
    const offer = options().enabled === false ? null : incentives[0];
    const added = title && Date.now() < confirmationUntil;
    const quantity = cart().reduce((sum, line) => sum + (Number.isSafeInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0), 0);
    if (!quantity && !added && !offer) return hide();
    ensure();
    count.textContent = String(quantity); count.setAttribute("aria-label", `${quantity} قطعة في السلة`);
    const minor = quantity ? itemTotal(quote) : 0;
    price.textContent = minor === null ? (loading ? "…" : "—") : `${(minor / 100).toLocaleString("en-EG", { maximumFractionDigits: 0 })} ج.م`;
    price.setAttribute("aria-busy", String(loading));
    price.setAttribute("aria-label", minor === null ? (loading ? "جارٍ حساب السعر" : "السعر غير متاح، راجع السلة") : `${minor / 100} جنيه مصري`);
    feedback.hidden = !added;
    offerCopy.hidden = !offer;
    let progressTransform;
    if (offer) {
      heading.textContent = offerTitle(offer); detail.textContent = offer.message;
      const target = Number.isFinite(Number(offer.target)) ? Math.max(1, Number(offer.target)) : 1;
      const current = Number.isFinite(Number(offer.current)) ? Math.min(target, Math.max(0, Number(offer.current))) : 0;
      progress.setAttribute("aria-valuemax", String(target)); progress.setAttribute("aria-valuenow", String(current));
      progress.setAttribute("aria-valuetext", offer.message); progressTransform = `scaleX(${current / target})`;
    }
    const announcement = added ? `تمت إضافة «${title}» إلى السلة` : (offer?.message || "");
    if (live.textContent !== announcement) live.textContent = announcement;
    if (offer) node.classList.add("cart-banner-expanded"); else node.classList.remove("cart-banner-expanded");
    node.hidden = false; node.classList.add("show");
    doc.body.classList.add("dart-cart-bar-visible"); reserveSpace();
    if (offer) fill.style.transform = progressTransform;
    if (added && !paused) timer = root.setTimeout(() => { title = ""; render(); }, Math.max(0, confirmationUntil - Date.now()));
  }
  async function refresh() {
    const sequence = ++version;
    if (checkoutPage()) { hide(); return; }
    incentives = []; quote = null; loading = Boolean(cart().length); render();
    try {
      let payload;
      if (cart().length) payload = await root.DartPlatform?.quoteCart?.({ force: true });
      else if (root.DartPlatform?.currentUser?.()) payload = await root.DartPlatform.apiRequest("/api/v1/me/promotions/card-progress");
      if (sequence !== version) return;
      quote = payload; loading = false;
      incentives = Array.isArray(payload?.incentives) ? payload.incentives : [];
      render();
    } catch { if (sequence === version) { incentives = []; quote = null; loading = false; render(); } }
  }
  function changed() {
    ++version; incentives = []; quote = null; loading = Boolean(cart().length); dismissed = false;
    root.clearTimeout(refreshTimer);
    if (checkoutPage()) { hide(); return; }
    if (!cart().length) { title = ""; hide(); } else render();
    refreshTimer = root.setTimeout(() => void refresh(), 180);
  }
  function added(productTitle) {
    if (checkoutPage()) { hide(); return; }
    title = String(productTitle || "المنتج").slice(0, 200); dismissed = false;
    confirmationUntil = Date.now() + duration(); render();
    root.clearTimeout(refreshTimer); void refresh();
  }
  function updateQuote(payload) {
    if (checkoutPage()) { hide(); return; }
    if (!payload || root.DartPlatform?.currentCartQuote?.() !== payload) return;
    ++version; quote = payload; loading = false;
    incentives = Array.isArray(payload.incentives) ? payload.incentives : []; render();
  }
  root.addEventListener("dart:data-changed", event => { if (event.detail?.key === "dart_cart") changed(); });
  root.addEventListener("dart:customer-session-changed", () => { title = ""; changed(); });
  root.addEventListener("dart:site-settings-changed", changed);
  root.addEventListener("dart:cart-reservation-expired", changed);
  root.addEventListener("pageshow", changed);
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) hide(); else changed(); });
  doc.addEventListener("dart:critical-ready", changed);
  root.DartShoppingBar = Object.freeze({ added, refresh, updateQuote });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", changed, { once: true });
  else changed();
})(window);
