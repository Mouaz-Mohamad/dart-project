// DART CODE GUIDE | Js/dart-product-links.js
// الغرض: روابط SEO مستقلة لكل Model مع إبقاء تجربة المنتج Modal سريعة وبدون Reload.
(function installDartProductLinks(root) {
  "use strict";
  if (root.DartProductLinks?.version) return;

  const BRAND_NAME = "Dart | for you";
  const BRAND_ALT_NAME = "Dart Wear";
  const LIST_PATH = "/products";
  const PRODUCT_PREFIX = "/products/";
  const PRODUCT_JSONLD_ID = "dart-product-jsonld";
  const PRODUCT_LINK_CLASS = "dart-product-deep-link";
  let initialHead = null;
  let linkObserver = null;
  let cardSyncTimer = 0;
  let directSeeded = false;

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

  function slugFor(product) {
    const title = slugPart(product?.title) || "product";
    const code = slugPart(product?.code || product?.id) || "item";
    return `${title}--${code}`;
  }

  function pathFor(product) {
    return `${PRODUCT_PREFIX}${slugFor(product)}`;
  }

  function slugFromPath(pathname = root.location?.pathname || "") {
    let decoded = String(pathname || "");
    try { decoded = decodeURIComponent(decoded); } catch {}
    const match = decoded.match(/^\/products\/([^/]+)\/?$/i);
    return match ? match[1] : "";
  }

  function catalogProducts() {
    return root.DartCatalog?.products?.() || [];
  }

  function normalizeRouteSlug(value) {
    return String(value ?? "")
      .split("--")
      .map((part) => slugPart(part))
      .filter(Boolean)
      .join("--");
  }

  function resolveSlug(slug, source = catalogProducts()) {
    const target = normalizeRouteSlug(slug);
    if (!target) return null;
    const exact = source.find((product) => slugFor(product) === target);
    if (exact) return exact;

    const codeSuffix = target.includes("--") ? target.split("--").pop() : target;
    return source.find((product) => {
      const code = slugPart(product?.code || product?.id);
      return Boolean(code && code === codeSuffix);
    }) || source.find((product) => slugPart(product?.title) === target) || null;
  }

  function absolute(value) {
    const raw = String(value || "").trim();
    if (!raw || /^(?:data|blob):/i.test(raw)) return "";
    try { return new URL(raw, root.location.origin).href; } catch { return ""; }
  }

  function hasStock(product) {
    return Object.values(product?.stock || {}).some((colors) =>
      Object.values(colors || {}).some((qty) => Number(qty) > 0),
    );
  }

  function generatedDescription(product) {
    const source = String(product?.description || "").replace(/\s+/g, " ").trim();
    if (source) return source.slice(0, 158);
    const category = String(product?.category || "ملابس رجالية").trim();
    return `${product?.title || "منتج Dart"} من ${BRAND_NAME}. ${category} متاح بالألوان والمقاسات الموضحة داخل المتجر.`.slice(0, 158);
  }

  function getOrCreateMeta(attribute, key) {
    let node = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!node) {
      node = document.createElement("meta");
      node.setAttribute(attribute, key);
      node.dataset.dartProductCreated = "1";
      document.head.appendChild(node);
    }
    return node;
  }

  function setMeta(attribute, key, value) {
    const node = getOrCreateMeta(attribute, key);
    node.setAttribute("content", String(value || ""));
  }

  function snapshotHead() {
    if (initialHead) return;
    const canonical = document.head.querySelector('link[rel="canonical"]');
    const selectors = [
      ['name', 'description'],
      ['name', 'robots'],
      ['property', 'og:type'],
      ['property', 'og:title'],
      ['property', 'og:description'],
      ['property', 'og:url'],
      ['property', 'og:image'],
      ['name', 'twitter:title'],
      ['name', 'twitter:description'],
      ['name', 'twitter:image'],
    ];
    initialHead = {
      title: document.title,
      canonical: canonical?.getAttribute("href") || "",
      metas: selectors.map(([attribute, key]) => {
        const node = document.head.querySelector(`meta[${attribute}="${key}"]`);
        return { attribute, key, existed: Boolean(node), content: node?.getAttribute("content") || "" };
      }),
    };
  }

  function applyProductSeo(product) {
    if (!product) return;
    snapshotHead();
    const initialRobots = initialHead.metas.find((meta) => meta.attribute === "name" && meta.key === "robots");
    const robotsNode = document.head.querySelector('meta[name="robots"]');
    if (initialRobots?.existed && robotsNode) robotsNode.setAttribute("content", initialRobots.content);
    else if (robotsNode?.dataset.dartProductCreated === "1") robotsNode.remove();
    const canonicalUrl = `${root.location.origin}${pathFor(product)}`;
    const title = `${product.title} | ${BRAND_NAME}`;
    const description = generatedDescription(product);
    const image = absolute(product.images?.[0] || product.gallery?.[0]?.src || "");

    document.title = title;
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      canonical.dataset.dartProductCreated = "1";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    setMeta("name", "description", description);
    setMeta("property", "og:type", "product");
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", canonicalUrl);
    if (image) setMeta("property", "og:image", image);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    if (image) setMeta("name", "twitter:image", image);

    document.getElementById(PRODUCT_JSONLD_ID)?.remove();
    const jsonLd = document.createElement("script");
    jsonLd.id = PRODUCT_JSONLD_ID;
    jsonLd.type = "application/ld+json";
    jsonLd.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${canonicalUrl}#product`,
      name: product.title,
      description,
      ...(image ? { image: [image] } : {}),
      sku: String(product.code || product.id || ""),
      url: canonicalUrl,
      brand: { "@type": "Brand", name: BRAND_NAME, alternateName: BRAND_ALT_NAME },
      offers: {
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "EGP",
        price: Math.max(0, Number(product.price) || 0).toFixed(2),
        availability: hasStock(product)
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    });
    document.head.appendChild(jsonLd);
  }

  function restoreCollectionSeo() {
    if (!initialHead) return;
    document.title = initialHead.title;
    const canonical = document.head.querySelector('link[rel="canonical"]');
    if (canonical) {
      if (initialHead.canonical) canonical.setAttribute("href", initialHead.canonical);
      else if (canonical.dataset.dartProductCreated === "1") canonical.remove();
    }
    for (const meta of initialHead.metas) {
      const node = document.head.querySelector(`meta[${meta.attribute}="${meta.key}"]`);
      if (meta.existed) {
        if (node) node.setAttribute("content", meta.content);
      } else if (node?.dataset.dartProductCreated === "1") {
        node.remove();
      }
    }
    document.getElementById(PRODUCT_JSONLD_ID)?.remove();
  }

  function routeState(product) {
    return {
      ...(history.state || {}),
      modalOpen: true,
      dartProduct: true,
      dartProductId: String(product.id),
    };
  }

  function routeOpenedProduct(product) {
    if (!product) return;
    history.replaceState(routeState(product), "", pathFor(product));
    applyProductSeo(product);
  }

  function openWithoutAddingHistory(product) {
    if (!product || !root.DartStorefront?.open) return false;
    const originalPushState = history.pushState;
    history.pushState = function interceptedPushState(state, title, url) {
      history.replaceState({ ...(history.state || {}), ...(state || {}) }, title, url || root.location.href);
    };
    try {
      root.DartStorefront.open(product);
      return true;
    } finally {
      history.pushState = originalPushState;
    }
  }

  function seedDirectEntry(product) {
    if (directSeeded) return;
    directSeeded = true;
    const targetPath = pathFor(product);
    history.replaceState({ dartProductsList: true }, "", LIST_PATH);
    history.pushState(routeState(product), "", targetPath);
  }

  function syncRouteFromLocation({ direct = false } = {}) {
    const slug = slugFromPath();
    if (!slug) {
      restoreCollectionSeo();
      return false;
    }
    const product = resolveSlug(slug);
    if (!product) return false;

    if (direct && !history.state?.dartProduct) seedDirectEntry(product);
    openWithoutAddingHistory(product);
    routeOpenedProduct(product);
    return true;
  }

  function ensureLinkStyle() {
    if (document.getElementById("dart-product-link-style")) return;
    const style = document.createElement("style");
    style.id = "dart-product-link-style";
    style.textContent = `.${PRODUCT_LINK_CLASS}{color:inherit;text-decoration:none}.` +
      `${PRODUCT_LINK_CLASS}:focus-visible{outline:2px solid #AB012B;outline-offset:3px;border-radius:3px}`;
    document.head.appendChild(style);
  }

  function syncCardLinks() {
    const products = catalogProducts();
    if (!products.length) return;
    const map = new Map(products.map((product) => [String(product.id), product]));
    document.querySelectorAll(".product-card[data-id]").forEach((card) => {
      const product = map.get(String(card.getAttribute("data-id") || ""));
      if (!product) return;
      card.dataset.productPath = pathFor(product);
      const titleNode = card.querySelector(".product-title");
      if (!titleNode) return;
      let link = titleNode.querySelector(`a.${PRODUCT_LINK_CLASS}`);
      if (!link) {
        const text = titleNode.textContent || product.title;
        titleNode.replaceChildren();
        link = document.createElement("a");
        link.className = PRODUCT_LINK_CLASS;
        link.dataset.dartProductLink = "1";
        link.textContent = text;
        titleNode.appendChild(link);
      }
      link.href = pathFor(product);
      link.setAttribute("aria-label", `Open ${product.title}`);
    });
  }

  function scheduleCardLinks() {
    clearTimeout(cardSyncTimer);
    cardSyncTimer = root.setTimeout(syncCardLinks, 0);
  }

  function observeCardContainers() {
    if (linkObserver || typeof MutationObserver !== "function") return;
    const containers = ["productsPart1", "productsPart2", "bestProductsContainer"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!containers.length) return;
    linkObserver = new MutationObserver(scheduleCardLinks);
    containers.forEach((container) => linkObserver.observe(container, { childList: true, subtree: true }));
  }

  function onProductClick(event) {
    const card = event.target.closest?.(".product-card[data-id]");
    if (!card) return;
    const link = event.target.closest?.(`a.${PRODUCT_LINK_CLASS}`);
    if (link && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      event.stopPropagation();
      return;
    }
    if (link) event.preventDefault();
    const product = catalogProducts().find((row) => String(row.id) === String(card.getAttribute("data-id")));
    if (!product) return;
    queueMicrotask(() => {
      const modal = document.getElementById("SectionModel");
      if (modal?.style.display === "flex") routeOpenedProduct(product);
    });
  }

  function onPopState() {
    root.setTimeout(() => {
      const slug = slugFromPath();
      if (!slug) {
        restoreCollectionSeo();
        return;
      }
      const product = resolveSlug(slug);
      if (!product) return;
      openWithoutAddingHistory(product);
      routeOpenedProduct(product);
    }, 0);
  }

  function markUnresolvedDeepLinkNoIndex() {
    if (!slugFromPath()) return;
    const products = catalogProducts();
    if (products.length && !resolveSlug(slugFromPath(), products)) {
      setMeta("name", "robots", "noindex, follow");
    }
  }

  function init() {
    snapshotHead();
    ensureLinkStyle();
    observeCardContainers();
    scheduleCardLinks();
    document.addEventListener("click", onProductClick, true);
    root.addEventListener("popstate", onPopState);
    root.addEventListener("dart:catalog-hydrated", () => {
      scheduleCardLinks();
      if (!syncRouteFromLocation({ direct: true })) markUnresolvedDeepLinkNoIndex();
    });
    root.addEventListener("dart:data-changed", scheduleCardLinks);
    root.addEventListener("dart:site-settings-changed", scheduleCardLinks);

    // Catalog may already be hydrated by the time this dynamically loaded helper starts.
    root.setTimeout(() => {
      scheduleCardLinks();
      if (!syncRouteFromLocation({ direct: true })) markUnresolvedDeepLinkNoIndex();
    }, 0);
  }

  root.DartProductLinks = Object.freeze({
    version: "1.0.0",
    slugPart,
    slugFor,
    pathFor,
    slugFromPath,
    resolveSlug,
    normalizeRouteSlug,
    syncCardLinks,
    applyProductSeo,
    restoreCollectionSeo,
    syncRouteFromLocation,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
