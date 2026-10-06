// DART CODE GUIDE | Js/dart-home-sets.js
// Homepage-only presentation. HTML lives in index.html and all prices come from the Sets API.
(function (root) {
  "use strict";
  const doc = root.document;
  const section = doc.getElementById("dartHomeSets");
  if (!section) return;
  const track = section.querySelector("[data-home-sets-track]");
  const carousel = section.querySelector("[data-home-sets-carousel]");
  const state = section.querySelector("[data-home-sets-state]");
  const status = section.querySelector("[data-home-sets-status]");
  const retry = section.querySelector("[data-home-sets-retry]");
  const controls = section.querySelector("[data-home-sets-controls]");
  const previous = section.querySelector("[data-home-sets-prev]");
  const next = section.querySelector("[data-home-sets-next]");
  const counter = section.querySelector("[data-home-sets-counter]");
  const cardTemplate = doc.getElementById("dartHomeSetCard");
  const pieceTemplate = doc.getElementById("dartHomeSetPiece");
  const fallback = "/Photos/logo-1to1.png";
  let rows = [];
  let index = 0;
  let scrollFrame = 0;
  let drag = null;
  let dragged = false;
  let retrying = false;

  function showState(message, failed = false) {
    section.hidden = false;
    state.hidden = false;
    carousel.hidden = true;
    status.textContent = message;
    retry.hidden = !failed;
    retry.disabled = false;
  }

  function imageSource(value) {
    return typeof value === "string" ? value : String(value?.url || value?.src || "");
  }

  function pieceImage(component) {
    const colors = Array.isArray(component.colors) ? component.colors : [];
    const color = colors.find(value => value && value.active !== false);
    const fromSet = (Array.isArray(color?.images) ? color.images : []).map(imageSource).find(Boolean);
    if (fromSet) return fromSet;
    const model = root.DartCatalog?.model?.(component.modelId);
    return root.DartCatalog?.cover?.(model, typeof color === "string" ? color : color?.name) || fallback;
  }

  function protectImage(image) {
    image.addEventListener("error", () => { image.src = fallback; }, { once: true });
  }

  function buildCard(set, position) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.setId = set.setId;
    card.setAttribute("aria-label", `${position + 1} of ${rows.length}: ${set.name}`);
    const cover = card.querySelector("[data-home-set-cover]");
    cover.src = root.DartSets.firstImage(set);
    cover.alt = set.name;
    protectImage(cover);
    card.querySelector("[data-home-set-title]").textContent = set.name;
    const description = card.querySelector("[data-home-set-description]");
    description.textContent = set.shortDescription || "";
    description.hidden = !description.textContent;
    card.querySelector("[data-home-set-old-price]").textContent = root.DartSets.moneyMinor(set.pricing?.componentsSellingTotalMinor);
    card.querySelector("[data-home-set-price]").textContent = root.DartSets.moneyMinor(set.pricing?.finalMinor);
    card.querySelector("[data-home-set-piece-count]").textContent = `${set.pieceCount || 0} PIECES`;
    const pieces = card.querySelector("[data-home-set-pieces]");
    (set.components || []).forEach(component => {
      const button = pieceTemplate.content.firstElementChild.cloneNode(true);
      const image = button.querySelector("img");
      image.src = pieceImage(component);
      image.alt = component.name || component.modelId;
      protectImage(image);
      button.setAttribute("aria-label", `Enlarge ${image.alt} image`);
      button.addEventListener("click", () => root.DartSetImagePreview?.open({ src: image.src, alt: image.alt }));
      pieces.appendChild(button);
    });
    const shop = card.querySelector("[data-home-set-shop]");
    shop.setAttribute("aria-label", `Shop ${set.name}`);
    shop.addEventListener("click", () => root.DartSetsStorefront?.open(set));
    return card;
  }

  function syncControls() {
    if (!rows.length) return;
    let nearest = 0;
    let distance = Infinity;
    [...track.children].forEach((card, position) => {
      const delta = Math.abs(card.offsetLeft - track.scrollLeft);
      if (delta < distance) { nearest = position; distance = delta; }
    });
    index = nearest;
    previous.disabled = index === 0;
    next.disabled = index === rows.length - 1;
    const label = `${index + 1} / ${rows.length}`;
    if (counter.textContent !== label) counter.textContent = label;
  }

  function goTo(position) {
    const card = track.children[Math.max(0, Math.min(rows.length - 1, position))];
    if (!card) return;
    const reducedMotion = root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: card.offsetLeft, behavior: reducedMotion ? "instant" : "smooth" });
  }

  function render(catalog) {
    const selected = track.children[index]?.dataset.setId;
    rows = (Array.isArray(catalog) ? catalog : []).filter(set =>
      set.showOnHomepage === true && set.active !== false && !set.isArchived && !set.isDeleted && Array.isArray(set.images) && set.images.length,
    ).sort((a, b) => Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0) || String(a.setId).localeCompare(String(b.setId)));
    retrying = false;
    section.hidden = !rows.length;
    state.hidden = true;
    carousel.hidden = !rows.length;
    if (!rows.length) { track.replaceChildren(); return; }
    track.replaceChildren(...rows.map(buildCard));
    controls.hidden = rows.length < 2;
    index = Math.max(0, rows.findIndex(set => set.setId === selected));
    root.requestAnimationFrame(() => {
      const card = track.children[index];
      track.scrollTo({ left: card.offsetLeft, behavior: "instant" });
      syncControls();
    });
  }

  previous.addEventListener("click", () => goTo(index - 1));
  next.addEventListener("click", () => goTo(index + 1));
  track.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    goTo(event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + (event.key === "ArrowRight" ? 1 : -1));
  });
  track.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = root.requestAnimationFrame(() => { scrollFrame = 0; syncControls(); });
  }, { passive: true });

  // Touch scroll stays native; mouse drag adds the same gesture on desktop.
  track.addEventListener("pointerdown", event => {
    dragged = false;
    if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest("button")) return;
    drag = { pointerId: event.pointerId, x: event.clientX, scroll: track.scrollLeft };
    dragged = false;
  });
  track.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) > 6) {
      dragged = true;
      track.setPointerCapture(event.pointerId);
      track.classList.add("is-dragging");
      track.scrollLeft = drag.scroll - delta;
    }
  });
  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    track.classList.remove("is-dragging");
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (dragged) { syncControls(); goTo(index); }
    if (event.type === "pointercancel") dragged = false;
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("click", event => {
    if (!dragged) return;
    event.preventDefault(); event.stopPropagation(); dragged = false;
  }, true);

  retry.addEventListener("click", async () => {
    if (retrying) return;
    retrying = true;
    showState("Loading Sets…");
    doc.dispatchEvent(new CustomEvent("dart:sets-load-request"));
    if (!root.DartSets) {
      return;
    }
    try { render(await root.DartSets.loadCatalog(true)); }
    catch { retrying = false; showState("Sets are temporarily unavailable.", true); }
  });
  root.addEventListener("dart:sets-catalog-changed", event => render(event.detail?.sets));
  root.addEventListener("dart:catalog-hydrated", () => { if (rows.length) render(root.DartSets.catalog()); });
  root.addEventListener("dart:sets-unavailable", () => { retrying = false; showState("Sets are temporarily unavailable.", true); });
  // Lazy assets can settle before this deferred script; keep their terminal state.
  if (root.__dartSetsUnavailable) showState("Sets are temporarily unavailable.", true);
  else if (root.__dartSetsCatalogReady) render(root.DartSets.catalog());
})(window);
