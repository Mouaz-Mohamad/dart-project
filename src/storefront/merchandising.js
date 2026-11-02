// Product-modal suggestions and server-backed quantity-offer presentation; loaded on demand.
(function () {
  "use strict";
  const C = window.DartCatalog;
  const $ = (id) => document.getElementById(id);
  // Related models and quantity campaigns share the current catalogue/cart projection.
  // Display is advisory; checkout and refund eligibility remain server-authoritative.
  let quantityOffers = [], offersAt = 0, offersIdentity = "", offersFlight = null;
  function offerMatches(offer, model, itemCode = "") {
    if (!model || Number(model.discount || 0) > 0) return false;
    const scope = offer.productScope || { mode: "all", values: [] };
    if (scope.mode === "all") return true;
    const value = scope.mode === "categories" ? model.category : scope.mode === "models" ? model.modelId : itemCode;
    return (scope.values || []).some((candidate) => String(candidate).toLowerCase() === String(value || "").toLowerCase());
  }
  function offerCartFacts(offer) {
    const quote = window.DartPlatform?.currentCartQuote?.();
    if (quote?.lines) return quote.lines.filter((line) => !line.isSet && offerMatches(offer, C.model(line.modelId), line.itemCode));
    const cart = typeof cartData !== "undefined" ? cartData : window.DartState?.read?.("dart_cart", []) || [];
    return cart.filter((line) => !line.dartSetKey && !line.setGroupId && offerMatches(offer, C.model(line.id)))
      .map((line) => ({ modelId: line.id, baseMinor: Math.round(Number(C.model(line.id)?.selling || 0) * 100) * Number(line.quantity || 1) }));
  }
  function offerMessage(offer) {
    const lines = offerCartFacts(offer);
    const missing = Math.max(0, Number(offer.minQuantity) - new Set(lines.map((line) => line.modelId)).size);
    const missingMinor = Math.max(0, Number(offer.minOrderMinor || 0) - lines.reduce((sum, line) => sum + Number(line.baseMinor || 0), 0));
    const saving = offer.discountKind === "fixed" ? `${Number(offer.discountAmountMinor) / 100} جنيه` : `${offer.discountPercent}٪`;
    const quote = window.DartPlatform?.currentCartQuote?.();
    const applied = (quote?.lines || []).filter((line) => line.discountSource === "Campaign" && line.discountReference === offer.code);
    const saved = applied.reduce((sum, line) => sum + Number(line.baseMinor) - Number(line.finalMinor), 0);
    let message = `اشتري من ${offer.minQuantity} موديلات مختلفة وخد خصم ${saving}.`;
    if (saved > 0) message = `استفدت بالعرض! وفّرت ${saved / 100} جنيه.`;
    else if (lines.length && missing) message += ` فاضلك ${missing} موديل مختلف.`;
    else if (lines.length && !missing && !missingMinor) message += " اكتمل العدد؛ يتأكد الخصم عند مراجعة الطلب.";
    if (missingMinor) message += ` الحد الأدنى لقيمة القطع المشمولة ${Number(offer.minOrderMinor) / 100} جنيه.`;
    return message;
  }
  function populateOffer(node, offer) {
    node.replaceChildren();
    node.hidden = !offer;
    if (!offer) return;
    const title = document.createElement("strong");
    title.textContent = offer.marketingText || "كمّل اختياراتك واستفيد بعرض العدد";
    const message = document.createElement("p");
    message.textContent = offerMessage(offer);
    const terms = document.createElement("small");
    terms.textContent = "داخل أوردر واحد • كل موديل يُحسب مرة واحدة • القطع المخفّضة والطقمات خارج العرض. عند الإرجاع وكسر شروط العرض، يُعاد حساب خصم القطع المحتفظ بها ويُخصم الفرق من الاسترداد.";
    node.append(title, message, terms);
  }
  function renderOffers() {
    const productNode = $("productQuantityOffer");
    if (productNode) populateOffer(productNode, $("SectionModel")?.style.display === "flex" && typeof activeProduct !== "undefined" && activeProduct
      ? quantityOffers.find((offer) => offerMatches(offer, C.model(activeProduct.code || activeProduct.id))) : null);
    const cartItems = $("cartItemsContainer");
    if (!cartItems) return;
    let node = $("cartQuantityOffer");
    if (!node) {
      node = document.createElement("div"); node.id = "cartQuantityOffer"; node.className = "dart-quantity-offer";
      node.dir = "rtl"; node.setAttribute("role", "status"); node.setAttribute("aria-live", "polite");
      cartItems.before(node);
    }
    const cart = typeof cartData !== "undefined" ? cartData : window.DartState?.read?.("dart_cart", []) || [];
    const quote = window.DartPlatform?.currentCartQuote?.();
    const appliedCodes = new Set((quote?.lines || []).filter((line) => line.discountSource === "Campaign").map((line) => line.discountReference));
    const offer = quantityOffers.find((offer) => appliedCodes.has(offer.code))
      || quantityOffers.find((offer) => offerCartFacts(offer).length) || quantityOffers[0];
    populateOffer(node, cart.length ? offer : null);
  }
  function refreshOffers() {
    const identity = String(window.DartPlatform?.currentUser?.()?.id || "public");
    if (offersIdentity === identity && Date.now() - offersAt < 20_000) { renderOffers(); return Promise.resolve(); }
    if (offersFlight?.identity === identity) { renderOffers(); return offersFlight.task; }
    offersIdentity = identity; quantityOffers = []; renderOffers();
    const path = `/api/v1/${identity === "public" ? "" : "me/"}promotions/quantity-offers`;
    const task = (async () => {
      try {
        const api = window.DartPlatform?.apiRequest;
        const payload = api ? await api(path) : await (async () => {
          const base = String(window.DART_API_BASE_URL || window.DartApi?.baseUrl || location.origin).replace(/\/$/, "");
          const response = await fetch(`${base}${path}`, { credentials: "include", cache: "no-store" });
          if (!response.ok) throw new Error("Offers unavailable");
          return response.json();
        })();
        if (offersIdentity !== identity) return;
        quantityOffers = Array.isArray(payload.offers) ? payload.offers : [];
      } catch {
        if (offersIdentity !== identity) return;
        quantityOffers = [];
      }
      offersAt = Date.now(); renderOffers();
    })();
    offersFlight = { identity, task };
    void task.finally(() => { if (offersFlight?.task === task) offersFlight = null; });
    return task;
  }
  function renderRelatedModels(product) {
    const section = $("productRelatedModels"), list = $("productRelatedList");
    if (!section || !list) return;
    list.replaceChildren();
    const ids = [...new Set(C.model(product.code || product.id)?.relatedModelIds || [])].filter((id) => id !== product.id).slice(0, 12);
    for (const id of ids) {
      const model = C.model(id);
      const candidate = C.products().find((row) => row.id === id);
      if (!model || !C.active(model) || !candidate) continue;
      const color = (candidate.colorOptions || []).find((color) => (candidate.sizeOptions || []).some((size) => C.available(model, size.name, color.name) > 0));
      if (!color) continue;
      const button = document.createElement("button"); button.type = "button"; button.className = "dart-related-card";
      button.dataset.relatedModel = id;
      const image = document.createElement("img"); image.src = C.cover(model, color.name) || "/Photos/logo-1to1.png";
      image.alt = candidate.title; image.loading = "lazy"; image.decoding = "async";
      image.addEventListener("error", () => { image.hidden = true; }, { once: true });
      const name = document.createElement("span"); name.textContent = candidate.title;
      const price = document.createElement("strong"); price.textContent = `${Number(candidate.price).toLocaleString("en-EG")} EGP`;
      button.append(image, name, price);
      button.addEventListener("click", () => {
        void window.DartStorefront.open({ ...candidate, cardColor: color.name }, { history: false });
      });
      list.appendChild(button);
    }
    section.hidden = !list.childElementCount;
  }

  window.addEventListener("dart:customer-session-changed", () => {
    offersAt = 0; quantityOffers = []; renderOffers();
    if ($("SectionModel")?.style.display === "flex" || $("cartItemsContainer")) void refreshOffers();
  });
  window.DartMerchandising = { refreshOffers, renderOffers, renderRelatedModels };
})();
