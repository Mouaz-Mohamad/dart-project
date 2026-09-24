// DART CODE GUIDE | Js/dart-storefront.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-storefront.js
// Storefront product cards, product modal, option availability, and carousel behavior.
// BEGIN MODULE

/* BEGIN STOREFRONT — كارت لكل لون، ونافذة واحدة لكل تصميم.
 * No quantities are stored here. The selected model/color/size is revalidated
 * by the reservation and checkout layer. Public colors need images for cards,
 * but image-less colors remain purchasable inside another color's modal.
 */
(function () {
  "use strict";
  const C = DartCatalog;
  let suppressSlide = false,
    opened = false,
    refreshPending = false,
    modalCarouselIndex = 0;

  const $ = (id) => document.getElementById(id);

  function availableStock(product, size, color) {
    const model = C.model(product?.code || product?.id);
    return C.available(
      model,
      size,
      color,
      window.DartPlatform?.cartReservationId || "",
    );
  }

  function cards() {
    return C.products().flatMap((p) =>
      (window.DartSiteSettings?.visibleColors?.(p.id, p.colorOptions) || p.colorOptions)
        .filter((c) => c.images?.length)
        .map((c) => ({
          ...p,
          cardColor: c.name,
          images: p.gallery.filter((i) => i.color === c.name).map((i) => i.src),
        })),
    );
  }

  // BEGIN Product modal helpers — owned here so storefront opening never depends
  // on helpers that can be removed during UI cleanup/refactors.
  function productSizeChart(product) {
    const model = C.model(product?.code || product?.id);
    const source = model?.sizeChart;
    const rows = Array.isArray(source)
      ? source
      : Array.isArray(source?.rows)
        ? source.rows
        : [];
    return {
      model,
      unit: Array.isArray(source) ? "cm" : String(source?.unit || "cm"),
      rows: rows.filter((row) => row && String(row.size || "").trim()),
    };
  }

  function renderProductSizeChart(product) {
    const content = $("productSizeChartContent");
    const title = $("productSizeChartTitle");
    const button = $("productSizeChartBtn");
    const panel = $("productSizeChartPanel");
    if (!content || !button || !panel) return;

    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    const chart = productSizeChart(product);
    if (title)
      title.textContent = `Size Chart — ${chart.model?.name || product.title || "Dart"}`;
    content.replaceChildren();

    if (!chart.rows.length) {
      const empty = document.createElement("div");
      empty.className = "dart-ui-state dart-ui-state-empty";
      const strong = document.createElement("strong");
      strong.textContent = "Size chart is being prepared";
      const message = document.createElement("p");
      message.textContent =
        "Measurements for this model are not available yet. Contact Dart before ordering if you need help choosing a size.";
      empty.append(strong, message);
      content.appendChild(empty);
      button.dataset.chartAvailable = "false";
      return;
    }

    button.dataset.chartAvailable = "true";
    const definitions = [
      ["size", "Size"],
      ["chest", "Chest"],
      ["waist", "Waist"],
      ["hip", "Hip"],
      ["length", "Length"],
      ["shoulder", "Shoulder"],
      ["sleeve", "Sleeve"],
      ["inseam", "Inseam"],
      ["notes", "Notes"],
    ];
    const visibleColumns = definitions.filter(
      ([key]) =>
        key === "size" ||
        chart.rows.some((row) => String(row[key] || "").trim()),
    );

    const tableWrap = document.createElement("div");
    tableWrap.className = "product-size-chart-table-wrap";
    const table = document.createElement("table");
    table.className = "product-size-chart-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    visibleColumns.forEach(([key, label]) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent =
        key === "size" || key === "notes" ? label : `${label} (${chart.unit})`;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    chart.rows.forEach((row) => {
      const tr = document.createElement("tr");
      visibleColumns.forEach(([key]) => {
        const td = document.createElement("td");
        td.textContent = String(row[key] || "—");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    tableWrap.appendChild(table);

    const note = document.createElement("p");
    note.className = "product-size-chart-note";
    note.textContent = `Measurements are in ${chart.unit}. Measure a similar garment laid flat for the closest comparison.`;
    content.append(tableWrap, note);
  }

  function updateCarouselPosition(track) {
    if (!track) return;
    track.style.transform = `translateX(-${modalCarouselIndex * 100}%)`;
    const modal = $("SectionModel");
    modal?.querySelectorAll(".carousel-dot").forEach((dot, index) => {
      dot.classList.toggle("active", index === modalCarouselIndex);
    });
    onSlide();
  }

  function renderModalCarousel(images, altText) {
    const modal = $("SectionModel");
    if (!modal) return;
    const track = modal.querySelector("#carouselTrack");
    const dotsContainer = modal.querySelector("#carouselDots");
    const prevBtn = modal.querySelector("#carouselPrev");
    const nextBtn = modal.querySelector("#carouselNext");
    if (!track || !dotsContainer) return;

    const slides = Array.isArray(images) && images.length ? images : [C.placeholder];
    track.replaceChildren();
    dotsContainer.replaceChildren();

    slides.forEach((src, index) => {
      const slide = document.createElement("div");
      slide.className = "carousel-slide";
      const image = document.createElement("img");
      image.src = src || C.placeholder;
      image.alt = altText || "Dart product";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener(
        "error",
        () => {
          if (image.src !== C.placeholder) image.src = C.placeholder;
        },
        { once: true },
      );
      slide.appendChild(image);
      track.appendChild(slide);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `carousel-dot${index === 0 ? " active" : ""}`;
      dot.dataset.index = String(index);
      dot.setAttribute("aria-label", `Image ${index + 1}`);
      dot.onclick = () => {
        modalCarouselIndex = index;
        updateCarouselPosition(track);
      };
      dotsContainer.appendChild(dot);
    });

    const showArrows = slides.length > 1;
    prevBtn?.classList.toggle("hidden", !showArrows);
    nextBtn?.classList.toggle("hidden", !showArrows);
    dotsContainer.classList.toggle("hidden", !showArrows);

    modalCarouselIndex = 0;
    if (prevBtn) {
      prevBtn.onclick = () => {
        modalCarouselIndex =
          (modalCarouselIndex - 1 + slides.length) % slides.length;
        updateCarouselPosition(track);
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        modalCarouselIndex = (modalCarouselIndex + 1) % slides.length;
        updateCarouselPosition(track);
      };
    }

    let touchStartX = 0;
    track.ontouchstart = (event) => {
      touchStartX = event.touches?.[0]?.clientX || 0;
    };
    track.ontouchend = (event) => {
      const endX = event.changedTouches?.[0]?.clientX;
      if (typeof endX !== "number") return;
      const diff = endX - touchStartX;
      if (Math.abs(diff) < 40) return;
      modalCarouselIndex =
        diff < 0
          ? (modalCarouselIndex + 1) % slides.length
          : (modalCarouselIndex - 1 + slides.length) % slides.length;
      updateCarouselPosition(track);
    };

    updateCarouselPosition(track);
  }

  function updateModalQtyMax(product) {
    const modal = $("SectionModel");
    if (!modal) return;
    const decreaseBtn = modal.querySelector("#modalQtyDecrease");
    const increaseBtn = modal.querySelector("#modalQtyIncrease");
    const valueEl = modal.querySelector("#modalQtyValue");
    if (!decreaseBtn || !increaseBtn || !valueEl) return;

    const maxQty =
      selectedSize && selectedColor
        ? availableStock(product, selectedSize, selectedColor)
        : 0;
    if (maxQty > 0 && modalQuantity > maxQty) modalQuantity = maxQty;
    if (maxQty === 0) modalQuantity = 1;

    valueEl.textContent = String(modalQuantity);
    decreaseBtn.classList.toggle("disabled-btn", modalQuantity <= 1);
    increaseBtn.classList.toggle("disabled-btn", maxQty <= 0 || modalQuantity >= maxQty);
    decreaseBtn.disabled = modalQuantity <= 1;
    increaseBtn.disabled = maxQty <= 0 || modalQuantity >= maxQty;
  }

  function initModalQtyControl(product) {
    const modal = $("SectionModel");
    if (!modal) return;
    const decreaseBtn = modal.querySelector("#modalQtyDecrease");
    const increaseBtn = modal.querySelector("#modalQtyIncrease");
    const valueEl = modal.querySelector("#modalQtyValue");
    if (!decreaseBtn || !increaseBtn || !valueEl) return;

    valueEl.textContent = String(modalQuantity);
    decreaseBtn.onclick = () => {
      if (modalQuantity <= 1) return;
      modalQuantity -= 1;
      updateModalQtyMax(activeProduct || product);
    };
    increaseBtn.onclick = () => {
      if (!selectedSize || !selectedColor) {
        setProductOptionStatus(
          "Choose an available size and color before changing quantity.",
          "error",
        );
        if (typeof showToast === "function") showToast("Choose a size and color first.");
        return;
      }
      const currentProduct = activeProduct || product;
      const maxQty = availableStock(currentProduct, selectedSize, selectedColor);
      if (modalQuantity >= maxQty) {
        setProductOptionStatus(
          `Only ${maxQty} item${maxQty === 1 ? "" : "s"} available for this option.`,
          "error",
        );
        if (typeof showToast === "function")
          showToast(`Only ${maxQty} item${maxQty === 1 ? "" : "s"} available.`);
        return;
      }
      modalQuantity += 1;
      updateModalQtyMax(currentProduct);
    };
    updateModalQtyMax(activeProduct || product);
  }
  // END Product modal helpers.

  // BEGIN Bidirectional color/gallery selection. Programmatic fallback does not select its color.
  function chooseColor(product, color, fromSlide = false) {
    selectedColor = color || null;
    // Preserve the customer's selected size even when this exact color/size is
    // unavailable. Waiting needs the exact requested variant; stock must not erase intent.
    const modal = $("SectionModel");
    if (!modal) return;
    modal.querySelectorAll(".color-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.color === selectedColor);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.color === selectedColor),
      );
    });
    modal.querySelectorAll(".size-btn").forEach((button) => {
      const stock = selectedColor
        ? availableStock(product, button.dataset.size, selectedColor)
        : 0;
      button.disabled = false;
      button.classList.toggle("disabled", false);
      button.classList.toggle("is-unavailable", stock <= 0);
      button.title = stock <= 0 ? "Out of stock — Waiting is available" : "";
      button.classList.toggle("active", button.dataset.size === selectedSize);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.size === selectedSize),
      );
    });

    const index = selectedColor
      ? product.gallery.findIndex((image) => image.color === selectedColor)
      : -1;
    let note = $("color-image-note");
    if (!note) {
      note = document.createElement("p");
      note.id = "color-image-note";
      note.setAttribute("role", "status");
      $("modelCarousel")?.after(note);
    }
    if (note) {
      note.textContent =
        selectedColor && index < 0
          ? "صورة هذا اللون غير متاحة؛ الصورة المعروضة مرجعية للتصميم."
          : "";
      note.hidden = !selectedColor || index >= 0;
    }

    if (!fromSlide) {
      modalCarouselIndex = index < 0 ? 0 : index;
      suppressSlide = true;
      updateCarouselPosition($("carouselTrack"));
      suppressSlide = false;
    }
    updatePurchase(product);
  }

  function onSlide() {
    if (!opened || suppressSlide || !activeProduct) return;
    const image = activeProduct.gallery?.[modalCarouselIndex];
    if (image && image.color !== selectedColor)
      chooseColor(activeProduct, image.color, true);
  }

  function updatePurchase(product) {
    updateModalQtyMax(product);
    const qty =
      selectedColor && selectedSize
        ? availableStock(product, selectedSize, selectedColor)
        : 0;
    const hasVariant = Boolean(selectedColor && selectedSize);
    const waitingEnabled =
      window.DartSiteSettings?.get?.().waiting?.enabled !== false;
    const showWaiting = Boolean(waitingEnabled && hasVariant && qty <= 0);
    const actionController = window.DartProductButtonState;
    const buyButton = $("modalBuyBtn");
    const waitingButton = $("modalWaitBtn");

    if (actionController?.sync) {
      // Once loaded, the action controller is the single owner of Buy/Waiting state.
      actionController.sync();
    } else {
      // Safe startup fallback: Waiting still replaces Buy if the controller is late
      // or fails to load. Only the two modal action buttons are touched here.
      if (buyButton) {
        buyButton.hidden = showWaiting;
        buyButton.disabled = !hasVariant || qty <= 0;
      }
      if (waitingButton) {
        waitingButton.hidden = !showWaiting;
        waitingButton.disabled = false;
        waitingButton.dataset.modelId = product.id;
        waitingButton.dataset.color = selectedColor || "";
        waitingButton.dataset.size = selectedSize || "";
        waitingButton.textContent = "Notify me when available";
        waitingButton.style.background = "#2563eb";
        waitingButton.style.borderColor = "#2563eb";
        waitingButton.style.color = "#fff";
      }
    }

    const qtyRow = $("modalQtyControl")?.closest(".modal-qty-row");
    if (qtyRow) qtyRow.hidden = hasVariant && qty <= 0;
    const colorStock = selectedColor
      ? Object.keys(product.stock || {}).reduce(
          (total, size) => total + availableStock(product, size, selectedColor),
          0,
        )
      : 0;

    setProductOptionStatus(
      !selectedColor
        ? "Choose a color."
        : colorStock === 0 && !selectedSize
          ? `${selectedColor} is currently out of stock — choose a size to join Waiting.`
          : !selectedSize
            ? "Choose a size for " + selectedColor
            : qty <= 0
              ? `${selectedColor} / ${selectedSize} is out of stock — join Waiting and we will reserve it for you when it returns.`
              : qty <= product.lowStockLimit
                ? `Only ${qty} left in ${selectedColor} / ${selectedSize}`
                : `${selectedColor} / ${selectedSize} selected.`,
      qty > 0 ? "success" : "info",
    );
  }

  function open(product) {
    const requestedId = product.id;
    const fresh = C.products().find((row) => row.id === requestedId) || product;
    const color = product.cardColor || fresh.colorOptions?.[0]?.name || null;
    activeProduct = fresh;
    product = fresh;
    const modal = $("SectionModel");
    if (!modal) return;

    history.pushState({ modalOpen: true }, "");
    selectedSize = null;
    selectedColor = color;
    modalQuantity = 1;
    opened = false;

    const categoryNode = modal.querySelector(".model-product-category");
    const codeNode = modal.querySelector(".model-product-code");
    const sizeActions = modal.querySelector(".product-size-chart-actions");
    const qtyRow = modal.querySelector(".modal-qty-row");
    if (categoryNode && codeNode) categoryNode.before(codeNode);
    if (sizeActions && qtyRow) sizeActions.before(qtyRow);

    if (categoryNode) categoryNode.textContent = product.category || "";
    if (codeNode) codeNode.textContent = product.code || "";
    const titleNode = modal.querySelector(".model-product-title");
    if (titleNode) titleNode.textContent = product.title || "";
    const priceNode = modal.querySelector(".price-number");
    if (priceNode) priceNode.textContent = String(Math.trunc(Number(product.price) || 0));
    const detailsNode = modal.querySelector(".model-all-detelis");
    if (detailsNode) detailsNode.textContent = product.description || "";

    renderModalCarousel(product.images, product.title);
    renderProductSizeChart(product);

    const colorBox = modal.querySelector(".colors-container");
    const sizeBox = modal.querySelector(".sizes-container");
    if (!colorBox || !sizeBox) return;
    sizeBox.before(colorBox);
    colorBox.replaceChildren();
    sizeBox.replaceChildren();

    for (const option of product.colorOptions || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-btn";
      button.dataset.color = option.name;
      button.textContent = option.name;
      button.onclick = () => chooseColor(activeProduct || product, option.name);
      colorBox.appendChild(button);
    }

    for (const option of product.sizeOptions || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "size-btn";
      button.dataset.size = option.name;
      button.textContent = option.name;
      button.onclick = () => {
        selectedSize = option.name;
        sizeBox
          .querySelectorAll("button")
          .forEach((node) => node.classList.toggle("active", node === button));
        modalQuantity = 1;
        updatePurchase(activeProduct || product);
      };
      sizeBox.appendChild(button);
    }

    initModalQtyControl(product);
    opened = true;
    chooseColor(product, color);
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    document.body.classList.add("modal-open");

    // Product details must never wait for image I/O. The modal opens from the
    // catalog snapshot immediately; image hydration continues in the background.
    void Promise.resolve(C.loadModelImages(requestedId))
      .then(() => {
        if (!opened || activeProduct?.id !== requestedId) return;
        const hydrated = C.products().find((row) => row.id === requestedId);
        if (!hydrated) return;
        activeProduct = hydrated;
        renderModalCarousel(hydrated.images, hydrated.title);
        renderProductSizeChart(hydrated);
        if (selectedColor) chooseColor(hydrated, selectedColor);
      })
      .catch((error) => {
        console.warn(
          "Dart product images are still loading; product details remain available.",
          error,
        );
      });
  }
  // END Bidirectional selection.

  // BEGIN Data refresh: preserve active color/size; rerender cards from current models.
  function refresh() {
    if (refreshPending) return;
    refreshPending = true;
    setTimeout(() => {
      refreshPending = false;
      productsData = C.products();
      renderProductsLogic();
      if (activeProduct && $("SectionModel")?.style.display === "flex") {
        const product = productsData.find((row) => row.id === activeProduct.id);
        if (!product) {
          closeProductModal();
          return;
        }
        activeProduct.price = product.price;
        activeProduct.stock = product.stock;
        updatePurchase(activeProduct);
      }
      if (typeof cartData !== "undefined") {
        cartData.forEach((line) => {
          line.image = C.cover(C.model(line.id), line.color);
        });
        if ($("cartView")) renderCart();
      }
    }, 0);
  }

  window.DartStorefront = { cards, open, onSlide, refresh };
  window.addEventListener("dart:images-ready", refresh);
  window.addEventListener("dart:data-changed", refresh);
  window.addEventListener("dart:catalog-hydrated", refresh);
  window.addEventListener("dart:site-settings-changed", refresh);
})();
/* END STOREFRONT */


// END MODULE