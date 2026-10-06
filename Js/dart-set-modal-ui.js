// DART CODE GUIDE | Js/dart-set-modal-ui.js
// UI-only enhancement for the Sets storefront modal. Business state remains owned by dart-sets.js.
(function installDartSetModalUi(root) {
  "use strict";
  if (!root?.document || root.__dartSetModalUiInstalled) return;
  root.__dartSetModalUiInstalled = true;

  const doc = root.document;
  const BURGUNDY = "#ab012b";
  let queued = false;
  let carouselIndex = 0;
  let carouselSlides = [];

  function installScopedStyles() {
    if (doc.getElementById("dartSetModalUiStyles")) return;
    const style = doc.createElement("style");
    style.id = "dartSetModalUiStyles";
    style.textContent = `
#dartSetModal .dart-set-close{top:0;right:10px;z-index:10;margin-top:-10px;width:40px;height:40px;border-radius:0;background:transparent;color:${BURGUNDY};font-size:40px;line-height:1}
#dartSetModal .dart-set-gallery{position:relative}
#dartSetModal [data-set-cover],#dartSetModal [data-set-thumbs]{display:none!important}
#dartSetModal .dart-set-carousel{margin:0;width:100%;aspect-ratio:3/4;border-radius:14px;background:#eee}
#dartSetModal .dart-set-carousel .carousel-slide img{width:100%;height:100%;object-fit:cover;border-radius:0}
#dartSetModal .dart-set-component{grid-template-columns:minmax(72px,1fr) minmax(0,3fr);align-items:start;gap:12px}
#dartSetModal .dart-set-piece-media{min-width:0;display:grid;gap:5px}
#dartSetModal .dart-set-piece-image{width:100%;padding:0;border:0;border-radius:10px;background:#f3f4f6;overflow:hidden;cursor:pointer}
#dartSetModal .dart-set-piece-image img{display:block;width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:10px;background:#eee}
#dartSetModal .dart-set-piece-code{display:block;color:#6b7280;font-size:10px;line-height:1.25;text-align:center;overflow-wrap:anywhere}
#dartSetModal .dart-set-piece-body{min-width:0;display:grid;gap:8px}
#dartSetModal .dart-set-piece-body .dart-set-component-head{grid-column:auto;display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
#dartSetModal .dart-set-piece-body .dart-set-component-head strong{min-width:0;overflow-wrap:anywhere}
#dartSetModal .dart-set-option-row{display:grid;gap:4px}
#dartSetModal .dart-set-option-buttons{display:flex;flex-wrap:wrap;gap:6px}
#dartSetModal .dart-set-size-chart-trigger{justify-self:start}
#dartSetModal .dart-set-size-chart-panel{z-index:10060}
#dartSetModal .dart-set-size-chart-content{min-height:0;display:flex;flex-direction:column}
#dartSetModal .dart-set-option-buttons .size-btn,#dartSetModal .dart-set-option-buttons .color-btn{min-height:34px;padding:6px 10px}
#dartSetModal .dart-set-option-buttons .is-unavailable{text-decoration:line-through;opacity:.5;border-style:dashed}
#dartSetModal .dart-set-option-buttons .is-unavailable.active{opacity:.72}
#dartSetModal .dart-set-native-selects{display:none!important}
#dartSetModal .dart-set-piece-empty{margin:0;color:#991b1b;font-size:12px}
@media (max-width:760px){
  #dartSetModal .dart-set-carousel{width:min(100%,calc(58dvh * 3 / 4));max-height:58dvh;margin-inline:auto;aspect-ratio:3/4}
  #dartSetModal .dart-set-component{grid-template-columns:minmax(68px,1fr) minmax(0,3fr);padding:10px;gap:10px}
  #dartSetModal .dart-set-option-buttons .size-btn,#dartSetModal .dart-set-option-buttons .color-btn{padding:6px 9px;font-size:12px}
}
`;
    doc.head.appendChild(style);
  }

  function modal() {
    return doc.getElementById("dartSetModal");
  }

  function currentSet(modalNode = modal()) {
    const rawCode = modalNode?.querySelector("[data-set-code]")?.textContent || "";
    const setId = rawCode.replace(/^\s*Code\s*:\s*/i, "").trim();
    return setId ? root.DartSets?.setById?.(setId) || null : null;
  }

  function normalizeImage(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    try { return root.DartCatalog?.imageSrc?.(value) || ""; } catch { return ""; }
  }

  function imageFallback() {
    return root.DartCatalog?.placeholder || "Photos/logo-1to1.png";
  }

  function colorImages(modelId, color) {
    const model = root.DartCatalog?.model?.(modelId);
    if (!model) return [imageFallback()];
    const norm = root.DartCatalog?.norm || ((value) => String(value || "").trim().toLocaleLowerCase());
    const option = (root.DartCatalog?.colors?.(model) || []).find((row) => norm(row?.name) === norm(color));
    const images = (option?.images || []).map(normalizeImage).filter(Boolean);
    if (images.length) return images;
    try {
      const cover = root.DartCatalog?.cover?.(model, color);
      return cover ? [cover] : [imageFallback()];
    } catch {
      return [imageFallback()];
    }
  }

  function componentBlocks(modalNode = modal()) {
    return [...(modalNode?.querySelectorAll(".dart-set-component") || [])];
  }

  function pairAvailable(block, size, color, modalNode = modal()) {
    const modelId = String(block?.dataset.modelId || "");
    if (!modelId || !size || !color) return false;
    let required = 1;
    componentBlocks(modalNode).forEach((other) => {
      if (other === block || String(other.dataset.modelId || "") !== modelId) return;
      const otherSize = String(other.querySelector("[data-set-size]")?.value || "");
      const otherColor = String(other.querySelector("[data-set-color]")?.value || "");
      if (otherSize === String(size) && otherColor === String(color)) required += 1;
    });
    const model = root.DartCatalog?.model?.(modelId);
    if (!model) return false;
    try {
      return Number(root.DartCatalog?.available?.(
        model,
        size,
        color,
        root.DartPlatform?.cartReservationId || "",
      ) || 0) >= required;
    } catch {
      return false;
    }
  }

  function setButtonState(button, active, available) {
    button.classList.toggle("active", active);
    button.classList.toggle("is-unavailable", !available);
    button.setAttribute("aria-pressed", String(active));
    button.dataset.stockState = available ? "available" : "out-of-stock";
    button.title = available ? "" : "Out of stock — Waiting is available";
  }

  function syncPieceAvailability(block, modalNode = modal()) {
    const colorSelect = block.querySelector("[data-set-color]");
    const sizeSelect = block.querySelector("[data-set-size]");
    if (!colorSelect || !sizeSelect) return;
    const selectedColor = String(colorSelect.value || "");
    const selectedSize = String(sizeSelect.value || "");

    block.querySelectorAll("[data-set-ui-color]").forEach((button) => {
      const color = String(button.dataset.setUiColor || "");
      setButtonState(button, color === selectedColor, pairAvailable(block, selectedSize, color, modalNode));
    });
    block.querySelectorAll("[data-set-ui-size]").forEach((button) => {
      const size = String(button.dataset.setUiSize || "");
      setButtonState(button, size === selectedSize, pairAvailable(block, size, selectedColor, modalNode));
    });
  }

  function syncAllPieceAvailability(modalNode = modal()) {
    componentBlocks(modalNode).forEach((block) => syncPieceAvailability(block, modalNode));
  }

  function pieceImageButton(block, pieceIndex) {
    return block.querySelector("[data-set-piece-image]") || (() => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "dart-set-piece-image";
      button.dataset.setPieceImage = String(pieceIndex);
      button.setAttribute("aria-label", `Show Piece ${pieceIndex + 1} images`);
      const image = doc.createElement("img");
      image.alt = `Piece ${pieceIndex + 1}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        if (image.src !== imageFallback()) image.src = imageFallback();
      });
      button.appendChild(image);
      button.addEventListener("click", () => renderCarousel(pieceIndex));
      return button;
    })();
  }

  function updatePieceImage(block, pieceIndex) {
    const color = String(block.querySelector("[data-set-color]")?.value || "");
    const image = block.querySelector("[data-set-piece-image] img");
    if (!image) return;
    image.src = colorImages(block.dataset.modelId, color)[0] || imageFallback();
    const name = block.querySelector(".dart-set-component-head strong")?.textContent?.trim();
    image.alt = `${name || `Piece ${pieceIndex + 1}`} — ${color || "selected color"}`;
  }

  function optionGroup(kind, select, block, pieceIndex) {
    const row = doc.createElement("div");
    row.className = "dart-set-option-row";
    const buttons = doc.createElement("div");
    buttons.className = `dart-set-option-buttons ${kind === "size" ? "sizes-container" : "colors-container"}`;

    [...select.options].forEach((option) => {
      const value = String(option.value || "");
      const button = doc.createElement("button");
      button.type = "button";
      button.className = kind === "size" ? "size-btn" : "color-btn";
      if (kind === "size") button.dataset.setUiSize = value;
      else button.dataset.setUiColor = value;
      button.textContent = option.textContent || value;
      button.addEventListener("click", () => {
        const changed = select.value !== value;
        select.value = value;
        if (changed) {
          select.dispatchEvent(new root.Event("change", { bubbles: true }));
          return;
        }
        syncAllPieceAvailability(modal());
        if (kind === "color") {
          updatePieceImage(block, pieceIndex);
          renderCarousel(pieceIndex);
        }
      });
      buttons.appendChild(button);
    });
    row.appendChild(buttons);
    return row;
  }

  const chartColumns = [
    ["size", "Size"], ["chest", "Chest"], ["waist", "Waist"],
    ["hip", "Hip"], ["length", "Length"], ["shoulder", "Shoulder"],
    ["sleeve", "Sleeve"], ["inseam", "Inseam"], ["notes", "Notes"],
  ];

  function closeSizeChart(modalNode = modal()) {
    const panel = modalNode?.querySelector("[data-set-size-chart-panel]");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    const trigger = modalNode.querySelector("[data-set-size-chart-trigger][aria-expanded='true']");
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.focus();
  }

  function sizeChartPanel(modalNode) {
    let panel = modalNode.querySelector("[data-set-size-chart-panel]");
    if (panel) return panel;
    panel = doc.createElement("div");
    panel.id = "dartSetSizeChartPanel";
    panel.className = "product-size-chart-panel dart-set-size-chart-panel";
    panel.dataset.setSizeChartPanel = "1";
    panel.hidden = true;
    panel.innerHTML = `<div class="product-size-chart-dialog" role="dialog" aria-modal="true" aria-labelledby="dartSetSizeChartTitle">
      <button type="button" class="product-size-chart-close" data-set-size-chart-close aria-label="Close size chart">&times;</button>
      <h3 id="dartSetSizeChartTitle" data-set-size-chart-title></h3>
      <div class="dart-set-size-chart-content" data-set-size-chart-content></div>
    </div>`;
    panel.addEventListener("click", (event) => {
      if (event.target === panel || event.target.closest("[data-set-size-chart-close]")) closeSizeChart(modalNode);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSizeChart(modalNode);
      }
    });
    modalNode.appendChild(panel);
    return panel;
  }

  function showSizeChart(block, modalNode) {
    const panel = sizeChartPanel(modalNode);
    const content = panel.querySelector("[data-set-size-chart-content]");
    const model = root.DartCatalog?.model?.(String(block.dataset.modelId || ""));
    const source = model?.sizeChart;
    const rows = (Array.isArray(source) ? source : source?.rows);
    const validRows = Array.isArray(rows) ? rows.filter((row) => row && String(row.size || "").trim()) : [];
    const unit = Array.isArray(source) ? "cm" : String(source?.unit || "cm");
    panel.querySelector("[data-set-size-chart-title]").textContent =
      `Size Chart — ${model?.name || block.querySelector(".dart-set-component-head strong")?.textContent?.trim() || "Dart"}`;
    content.replaceChildren();
    if (!validRows.length) {
      const empty = doc.createElement("div");
      empty.className = "dart-ui-state dart-ui-state-empty";
      const title = doc.createElement("strong");
      title.textContent = "Size chart is being prepared";
      const message = doc.createElement("p");
      message.textContent = "Measurements for this model are not available yet. Contact Dart before ordering if you need help choosing a size.";
      empty.append(title, message);
      content.appendChild(empty);
    } else {
      const visible = chartColumns.filter(([key]) =>
        key === "size" || validRows.some((row) => String(row[key] || "").trim()));
      const wrap = doc.createElement("div");
      wrap.className = "product-size-chart-table-wrap";
      const table = doc.createElement("table");
      table.className = "product-size-chart-table";
      const head = doc.createElement("tr");
      visible.forEach(([key, label]) => {
        const th = doc.createElement("th");
        th.scope = "col";
        th.textContent = key === "size" || key === "notes" ? label : `${label} (${unit})`;
        head.appendChild(th);
      });
      const thead = doc.createElement("thead");
      thead.appendChild(head);
      const tbody = doc.createElement("tbody");
      validRows.forEach((row) => {
        const tr = doc.createElement("tr");
        visible.forEach(([key]) => {
          const td = doc.createElement("td");
          td.textContent = String(row[key] || "—");
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
      wrap.appendChild(table);
      const note = doc.createElement("p");
      note.className = "product-size-chart-note";
      note.textContent = `Measurements are in ${unit}. Measure a similar garment laid flat for the closest comparison.`;
      content.append(wrap, note);
    }
    modalNode.querySelectorAll("[data-set-size-chart-trigger]").forEach((button) =>
      button.setAttribute("aria-expanded", String(button === block.querySelector("[data-set-size-chart-trigger]"))));
    panel.hidden = false;
    panel.querySelector("[data-set-size-chart-close]").focus();
  }

  function enhancePiece(block, pieceIndex, modalNode) {
    if (block.dataset.dartSetUiReady === "1") {
      syncPieceAvailability(block, modalNode);
      updatePieceImage(block, pieceIndex);
      return;
    }
    const colorSelect = block.querySelector("[data-set-color]");
    const sizeSelect = block.querySelector("[data-set-size]");
    if (!colorSelect || !sizeSelect) return;

    const head = block.querySelector(".dart-set-component-head");
    const code = head?.querySelector("small");
    const colorLabel = colorSelect.closest("label");
    const sizeLabel = sizeSelect.closest("label");
    const native = doc.createElement("div");
    native.className = "dart-set-native-selects";
    if (colorLabel) native.appendChild(colorLabel);
    if (sizeLabel) native.appendChild(sizeLabel);

    const imageButton = pieceImageButton(block, pieceIndex);
    const media = doc.createElement("div");
    media.className = "dart-set-piece-media";
    media.appendChild(imageButton);
    if (code) {
      code.className = "dart-set-piece-code";
      media.appendChild(code);
    }
    const body = doc.createElement("div");
    body.className = "dart-set-piece-body";
    if (head) body.appendChild(head);
    if (sizeSelect.options.length) body.appendChild(optionGroup("size", sizeSelect, block, pieceIndex));
    if (colorSelect.options.length) body.appendChild(optionGroup("color", colorSelect, block, pieceIndex));
    const chartButton = doc.createElement("button");
    chartButton.type = "button";
    chartButton.className = "product-size-chart-trigger dart-set-size-chart-trigger";
    chartButton.dataset.setSizeChartTrigger = "1";
    chartButton.setAttribute("aria-controls", "dartSetSizeChartPanel");
    chartButton.setAttribute("aria-expanded", "false");
    chartButton.setAttribute("aria-label", `Size Chart for ${block.dataset.modelId || "model"}`);
    chartButton.textContent = "Size Chart";
    chartButton.addEventListener("click", () => showSizeChart(block, modalNode));
    body.appendChild(chartButton);
    if (!sizeSelect.options.length || !colorSelect.options.length) {
      const empty = doc.createElement("p");
      empty.className = "dart-set-piece-empty";
      empty.textContent = "This piece has no selectable size/color options.";
      body.appendChild(empty);
    }
    body.appendChild(native);
    block.replaceChildren(media, body);
    block.dataset.dartSetUiReady = "1";

    const onOptionChange = (event) => {
      syncAllPieceAvailability(modalNode);
      if (event.currentTarget === colorSelect) {
        updatePieceImage(block, pieceIndex);
        renderCarousel(pieceIndex);
      }
    };
    colorSelect.addEventListener("change", onOptionChange);
    sizeSelect.addEventListener("change", onOptionChange);
    updatePieceImage(block, pieceIndex);
    syncPieceAvailability(block, modalNode);
  }

  function collectSlides(modalNode = modal()) {
    const set = currentSet(modalNode);
    const slides = [];
    (Array.isArray(set?.images) ? set.images : []).forEach((image, index) => {
      const src = normalizeImage(image);
      if (src) slides.push({ src, pieceIndex: null, alt: `${set?.name || "Dart Set"} image ${index + 1}` });
    });
    componentBlocks(modalNode).forEach((block, pieceIndex) => {
      const color = String(block.querySelector("[data-set-color]")?.value || "");
      const name = block.querySelector(".dart-set-component-head strong")?.textContent?.trim() || `Piece ${pieceIndex + 1}`;
      colorImages(block.dataset.modelId, color).forEach((src, imageIndex) => {
        slides.push({ src, pieceIndex, alt: `${name} — ${color || "selected color"} — image ${imageIndex + 1}` });
      });
    });
    if (!slides.length) slides.push({ src: imageFallback(), pieceIndex: null, alt: set?.name || "Dart Set" });
    return slides;
  }

  function updateCarouselPosition(carousel) {
    const track = carousel?.querySelector("[data-set-carousel-track]");
    if (!track || !carouselSlides.length) return;
    carouselIndex = Math.max(0, Math.min(carouselIndex, carouselSlides.length - 1));
    track.style.transform = `translateX(-${carouselIndex * 100}%)`;
    carousel.querySelectorAll(".carousel-dot").forEach((dot, index) => {
      dot.classList.toggle("active", index === carouselIndex);
      dot.setAttribute("aria-current", index === carouselIndex ? "true" : "false");
    });
  }

  function ensureCarousel(modalNode = modal()) {
    const gallery = modalNode?.querySelector(".dart-set-gallery");
    if (!gallery) return null;
    let carousel = gallery.querySelector("[data-set-carousel]");
    if (carousel) return carousel;
    carousel = doc.createElement("div");
    carousel.className = "model-carousel dart-set-carousel";
    carousel.dataset.setCarousel = "1";
    carousel.setAttribute("aria-label", "Set images");
    carousel.innerHTML = `
      <div class="carousel-track" data-set-carousel-track></div>
      <button type="button" class="carousel-arrow carousel-prev" data-set-carousel-prev aria-label="Previous image"><span aria-hidden="true">&#8249;</span></button>
      <button type="button" class="carousel-arrow carousel-next" data-set-carousel-next aria-label="Next image"><span aria-hidden="true">&#8250;</span></button>
      <div class="carousel-dots" data-set-carousel-dots></div>`;
    gallery.appendChild(carousel);
    return carousel;
  }

  function renderCarousel(jumpToPiece = null, modalNode = modal()) {
    if (!modalNode || modalNode.hidden) return;
    const carousel = ensureCarousel(modalNode);
    if (!carousel) return;
    carouselSlides = collectSlides(modalNode);
    const track = carousel.querySelector("[data-set-carousel-track]");
    const dots = carousel.querySelector("[data-set-carousel-dots]");
    const prev = carousel.querySelector("[data-set-carousel-prev]");
    const next = carousel.querySelector("[data-set-carousel-next]");
    track.replaceChildren();
    dots.replaceChildren();

    carouselSlides.forEach((slideData, index) => {
      const slide = doc.createElement("div");
      slide.className = "carousel-slide";
      slide.dataset.setPieceIndex = slideData.pieceIndex == null ? "set" : String(slideData.pieceIndex);
      const image = doc.createElement("img");
      image.src = slideData.src || imageFallback();
      image.alt = slideData.alt;
      image.loading = index === 0 ? "eager" : "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        if (image.src !== imageFallback()) image.src = imageFallback();
      }, { once: true });
      slide.appendChild(image);
      track.appendChild(slide);

      const dot = doc.createElement("button");
      dot.type = "button";
      dot.className = "carousel-dot";
      dot.setAttribute("aria-label", `Image ${index + 1}`);
      dot.addEventListener("click", () => {
        carouselIndex = index;
        updateCarouselPosition(carousel);
      });
      dots.appendChild(dot);
    });

    if (Number.isInteger(jumpToPiece)) {
      const firstPieceSlide = carouselSlides.findIndex((slide) => slide.pieceIndex === jumpToPiece);
      carouselIndex = firstPieceSlide >= 0 ? firstPieceSlide : 0;
    } else if (carouselIndex >= carouselSlides.length) {
      carouselIndex = 0;
    }

    const multi = carouselSlides.length > 1;
    prev.classList.toggle("hidden", !multi);
    next.classList.toggle("hidden", !multi);
    dots.classList.toggle("hidden", !multi);
    prev.onclick = () => {
      carouselIndex = (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length;
      updateCarouselPosition(carousel);
    };
    next.onclick = () => {
      carouselIndex = (carouselIndex + 1) % carouselSlides.length;
      updateCarouselPosition(carousel);
    };

    let touchStartX = 0;
    track.ontouchstart = (event) => { touchStartX = event.touches?.[0]?.clientX || 0; };
    track.ontouchend = (event) => {
      const endX = event.changedTouches?.[0]?.clientX;
      if (typeof endX !== "number") return;
      const delta = endX - touchStartX;
      if (Math.abs(delta) < 40 || carouselSlides.length < 2) return;
      carouselIndex = delta < 0
        ? (carouselIndex + 1) % carouselSlides.length
        : (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length;
      updateCarouselPosition(carousel);
    };
    updateCarouselPosition(carousel);
  }

  function enhanceModal(modalNode = modal()) {
    if (!modalNode || modalNode.hidden) return;
    installScopedStyles();
    const cover = modalNode.querySelector("[data-set-cover]");
    const thumbs = modalNode.querySelector("[data-set-thumbs]");
    if (cover) {
      cover.hidden = true;
      cover.removeAttribute("src");
    }
    if (thumbs) {
      thumbs.hidden = true;
      thumbs.replaceChildren();
    }
    const close = modalNode.querySelector("[data-set-close]");
    if (close) close.setAttribute("aria-label", "Close Set details");
    closeSizeChart(modalNode);

    componentBlocks(modalNode).forEach((block, index) => enhancePiece(block, index, modalNode));
    syncAllPieceAvailability(modalNode);
    carouselIndex = 0;
    renderCarousel(null, modalNode);
  }

  function scheduleEnhance() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      enhanceModal();
    });
  }

  const observer = new root.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target?.id === "dartSetModal") {
        if (!mutation.target.hidden) scheduleEnhance();
        continue;
      }
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof root.Element)) continue;
        if (node.id === "dartSetModal" || node.matches?.(".dart-set-component") || node.querySelector?.("#dartSetModal,.dart-set-component")) {
          scheduleEnhance();
          return;
        }
      }
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", scheduleEnhance, { once: true });
  else scheduleEnhance();
})(typeof window !== "undefined" ? window : globalThis);
