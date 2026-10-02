// DART CODE GUIDE | Js/dart-product-route-fix.js
// الغرض: ضمان تحديث رابط كل Model عند فتح الـModal بدون Reload من أي واجهة منتجات.
(function installDartProductRouteFix(root) {
  "use strict";
  if (root.DartProductRouteFix?.version) return;

  const PRODUCT_PREFIX = "/products/";
  let hookInstalled = false;
  let retryTimer = 0;

  function slugPart(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .toLocaleLowerCase("en")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 80);
  }

  function pathFor(product) {
    if (root.DartProductLinks?.pathFor) {
      try {
        return root.DartProductLinks.pathFor(product);
      } catch {}
    }
    const title = slugPart(product?.title) || "product";
    const code = slugPart(product?.code || product?.id) || "item";
    return `${PRODUCT_PREFIX}${title}--${code}`;
  }

  function routeProduct(product) {
    if (!product) return;
    const nextPath = pathFor(product);
    const nextState = {
      ...(history.state || {}),
      modalOpen: true,
      dartProduct: true,
      dartProductId: String(product.id ?? product.code ?? ""),
    };
    const alreadyOnProduct =
      root.location?.pathname === nextPath && history.state?.dartProduct;
    if (alreadyOnProduct) history.replaceState(nextState, "", nextPath);
    else history.pushState(nextState, "", nextPath);
    try {
      root.DartProductLinks?.applyProductSeo?.(product);
    } catch (error) {
      console.warn("Dart product SEO update skipped", error);
    }
  }

  function installOpenHook() {
    const storefront = root.DartStorefront;
    if (!storefront || typeof storefront.open !== "function") return false;
    if (storefront.open.__dartProductRouteFix) {
      hookInstalled = true;
      return true;
    }

    const originalOpen = storefront.open;
    function openWithProductRoute(product) {
      const result = originalOpen.call(this, product);
      routeProduct(product);
      return result;
    }
    Object.defineProperty(openWithProductRoute, "__dartProductRouteFix", {
      value: true,
      configurable: false,
      enumerable: false,
    });
    storefront.open = openWithProductRoute;
    hookInstalled = true;
    return true;
  }

  function retryInstall() {
    if (hookInstalled || installOpenHook()) return;
    clearTimeout(retryTimer);
    retryTimer = root.setTimeout(retryInstall, 50);
  }

  function init() {
    retryInstall();
    root.addEventListener("dart:catalog-hydrated", retryInstall);
    root.addEventListener("dart:data-changed", retryInstall);
  }

  root.DartProductRouteFix = Object.freeze({
    version: "1.0.0",
    slugPart,
    pathFor,
    routeProduct,
    installOpenHook,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);