// DART CODE GUIDE | Js/dart-set-navigation.js
// Set URLs and nested image history. History contains navigation identifiers, never prices/cart data.
(function (root) {
  "use strict";
  if (root.DartSetNavigation) return;
  const doc = root.document;
  const routeState = doc.getElementById("dartSetRouteState");
  const message = routeState?.querySelector("[data-set-route-message]");
  const retry = routeState?.querySelector("[data-set-route-retry]");
  let requestVersion = 0;
  let traversalPending = false;

  function currentUrl() { return root.location.pathname + root.location.search + root.location.hash; }
  function isSetRoute() { return root.location.pathname.startsWith("/sets/"); }
  function routeId() {
    const match = root.location.pathname.match(/^\/sets\/([A-Za-z0-9_-]{1,120})\/?$/);
    return match?.[1] || "";
  }
  function pathFor(set) { return `/sets/${encodeURIComponent(String(set.setId))}`; }
  function withoutSetState(state = root.history.state) {
    const clean = { ...(state || {}) };
    for (const key of ["dartSetRoute", "dartSetId", "dartSetReturnUrl", "dartSetImage"]) delete clean[key];
    return clean;
  }
  function showState(text, failed = false) {
    if (!routeState) return;
    routeState.hidden = false;
    message.textContent = text;
    retry.hidden = !failed;
  }
  function hideState() { if (routeState) routeState.hidden = true; }

  // Fresh/shared links get a local list entry underneath them, including while the API is loading.
  if (isSetRoute() && !root.history.state?.dartSetRoute) {
    const requestedUrl = currentUrl();
    const base = withoutSetState();
    root.history.replaceState(base, "", "/products");
    root.history.pushState({ ...base, dartSetRoute: true, dartSetId: routeIdFrom(requestedUrl), dartSetReturnUrl: "/products" }, "", requestedUrl);
  }
  function routeIdFrom(url) { return url.match(/^\/sets\/([A-Za-z0-9_-]{1,120})(?:[/?#]|$)/)?.[1] || ""; }

  function openedSet(set) {
    hideState();
    const path = pathFor(set);
    const previous = root.history.state || {};
    if (previous.dartSetId === set.setId && root.location.pathname === path) return;
    const returnUrl = previous.dartSetRoute ? previous.dartSetReturnUrl : currentUrl();
    root.history.pushState({ ...withoutSetState(), dartSetRoute: true, dartSetId: set.setId, dartSetReturnUrl: returnUrl || "/products" }, "", path);
  }

  function openedImage(details) {
    const state = { ...(root.history.state || {}), dartSetImage: { src: details.src, alt: details.alt } };
    // Replacing the image inside an already-open preview must not add another Back step.
    if (root.history.state?.dartSetImage) root.history.replaceState(state, "", currentUrl());
    else root.history.pushState(state, "", currentUrl());
  }

  function closeImage() {
    if (!root.history.state?.dartSetImage) return false;
    if (!traversalPending) { traversalPending = true; root.history.back(); }
    return true;
  }

  function closeSet() {
    if (!root.history.state?.dartSetRoute || root.history.state.dartSetId !== routeId()) return false;
    if (!traversalPending) {
      traversalPending = true;
      root.history.go(root.history.state.dartSetImage ? -2 : -1);
    }
    return true;
  }

  async function sync() {
    const version = ++requestVersion;
    const id = routeId();
    const image = root.history.state?.dartSetImage;
    if (!image) root.DartSetImagePreview?.close({ history: false });
    if (!id) {
      root.DartSetsStorefront?.close(true, { history: false });
      if (isSetRoute()) showState("This Set is unavailable.", true);
      else hideState();
    } else {
      if (!root.DartSets || !root.DartSetsStorefront || !root.__dartSetsCatalogReady) {
        showState(root.__dartSetsUnavailable ? "Sets are temporarily unavailable." : "Loading Set…", Boolean(root.__dartSetsUnavailable));
        return;
      }
      const active = root.DartSetsStorefront.active();
      if (!active || active.setId !== id || doc.getElementById("dartSetModal")?.hidden) {
        showState("Loading Set…");
        try {
          const set = root.DartSets.setById(id) || await root.DartSets.detail(id);
          if (version !== requestVersion) return;
          if (!set || set.active === false || set.isArchived || set.isDeleted) throw new Error("Unavailable Set");
          if (!root.DartSetsStorefront.open(set, { history: false })) {
            showState("Please wait for the current Set to finish adding.");
            return;
          }
          hideState();
        } catch {
          if (version !== requestVersion) return;
          root.DartSetsStorefront.close(true, { history: false });
          showState("This Set is unavailable. Please try again or browse products.", true);
          return;
        }
      } else hideState();
    }
    if (image && version === requestVersion) root.DartSetImagePreview?.open(image, { history: false });
  }

  retry?.addEventListener("click", async () => {
    showState("Loading Set…");
    doc.dispatchEvent(new CustomEvent("dart:sets-load-request"));
    if (!root.DartSets) return;
    try { await root.DartSets.loadCatalog(true); await sync(); }
    catch { showState("Sets are temporarily unavailable.", true); }
  });
  root.addEventListener("popstate", () => { traversalPending = false; void sync(); });
  root.addEventListener("dart:sets-catalog-changed", () => void sync());
  root.addEventListener("dart:sets-extension-ready", () => void sync());
  root.addEventListener("dart:set-purchase-finished", () => void sync());
  root.addEventListener("dart:sets-unavailable", () => {
    if (isSetRoute()) showState("Sets are temporarily unavailable.", true);
  });
  root.DartSetNavigation = Object.freeze({ pathFor, openedSet, openedImage, closeSet, closeImage, sync });
  void sync();
})(window);
