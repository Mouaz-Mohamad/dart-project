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
    refreshPending = false;
  const $ = (id) => document.getElementById(id);
  function cards() {
    return C.products().flatMap((p) =>
      p.colorOptions
        .filter((c) => c.images?.length)
        .map((c) => ({
          ...p,
          cardColor: c.name,
          images: p.gallery.filter((i) => i.color === c.name).map((i) => i.src),
        })),
    );
  }
  // BEGIN Bidirectional color/gallery selection. Programmatic fallback does not select its color.
  function chooseColor(product, color, fromSlide = false) {
    selectedColor = color;
    if (selectedSize && getAvailableStock(product, selectedSize, color) <= 0)
      selectedSize = null;
    const modal = $("SectionModel");
    modal.querySelectorAll(".color-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.color === color);
      b.setAttribute("aria-pressed", String(b.dataset.color === color));
    });
    modal.querySelectorAll(".size-btn").forEach((b) => {
      const stock = getAvailableStock(product, b.dataset.size, color);
      b.disabled = stock <= 0;
      b.classList.toggle("disabled", b.disabled);
      b.classList.toggle("active", b.dataset.size === selectedSize);
      b.setAttribute("aria-pressed", String(b.dataset.size === selectedSize));
    });
    const index = product.gallery.findIndex((i) => i.color === color);
    let note = $("color-image-note");
    if (!note) {
      note = document.createElement("p");
      note.id = "color-image-note";
      note.setAttribute("role", "status");
      $("modelCarousel").after(note);
    }
    note.textContent =
      index < 0
        ? "صورة هذا اللون غير متاحة؛ الصورة المعروضة مرجعية للتصميم."
        : "";
    note.hidden = index >= 0;
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
        ? getAvailableStock(product, selectedSize, selectedColor)
        : 0;
    $("modalBuyBtn").disabled = qty <= 0;
    const colorStock = Object.keys(product.stock).reduce(
      (n, size) => n + getAvailableStock(product, size, selectedColor),
      0,
    );
    setProductOptionStatus(
      colorStock === 0
        ? "Sold Out — choose another color."
        : !selectedSize
          ? "Choose a size for " + selectedColor
          : qty <= product.lowStockLimit
            ? `Only ${qty} left in ${selectedColor} / ${selectedSize}`
            : `${selectedColor} / ${selectedSize} selected.`,
      qty > 0 ? "success" : "info",
    );
  }
  async function open(product) {
    await C.loadModelImages(product.id);
    const fresh = C.products().find((p) => p.id === product.id);
    if (!fresh) return;
    const color = product.cardColor || fresh.colorOptions[0]?.name;
    activeProduct = fresh;
    product = fresh;
    const modal = $("SectionModel");
    if (!modal) return;
    history.pushState({ modalOpen: true }, "");
    selectedSize = null;
    selectedColor = color;
    modalQuantity = 1;
    opened = false;
    modal
      .querySelector(".model-product-category")
      .before(modal.querySelector(".model-product-code"));
    modal
      .querySelector(".product-size-chart-actions")
      .before(modal.querySelector(".modal-qty-row"));
    modal.querySelector(".model-product-category").textContent =
      product.category;
    modal.querySelector(".model-product-code").textContent = product.code;
    modal.querySelector(".model-product-title").textContent = product.title;
    modal.querySelector(".price-number").textContent = Math.trunc(
      product.price,
    );
    modal.querySelector(".model-all-detelis").textContent = product.description;
    renderModalCarousel(product.images, product.title);
    renderProductSizeChart(product);
    const colorBox = modal.querySelector(".colors-container"),
      sizeBox = modal.querySelector(".sizes-container");
    sizeBox.before(colorBox);
    colorBox.replaceChildren();
    sizeBox.replaceChildren();
    for (const c of product.colorOptions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "color-btn";
      b.dataset.color = c.name;
      b.textContent = c.name;
      b.onclick = () => chooseColor(product, c.name);
      colorBox.append(b);
    }
    for (const s of product.sizeOptions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "size-btn";
      b.dataset.size = s.name;
      b.textContent = s.name;
      b.onclick = () => {
        selectedSize = s.name;
        sizeBox
          .querySelectorAll("button")
          .forEach((x) => x.classList.toggle("active", x === b));
        modalQuantity = 1;
        updatePurchase(product);
      };
      sizeBox.append(b);
    }
    initModalQtyControl(product);
    opened = true;
    chooseColor(product, color);
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    document.body.classList.add("modal-open");
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
        const p = productsData.find((p) => p.id === activeProduct.id);
        if (!p) {
          closeProductModal();
          return;
        }
        activeProduct.price = p.price;
        activeProduct.stock = p.stock;
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
})();
/* END STOREFRONT */
