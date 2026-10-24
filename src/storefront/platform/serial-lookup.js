  async function renderSerialResult(form) {
    const result = document.getElementById("serialSearchResult");
    if (!result) return;
    const content = result.querySelector(".serial-result-content");
    const title = document.getElementById("serialResultTitle");
    const message = document.getElementById("serialResultMessage");
    const icon = document.getElementById("serialResultIcon");
    const iconGlyph = document.getElementById("serialResultIconGlyph");
    const product = document.getElementById("serialProduct");
    const skeletonImage = document.getElementById("serialSkeletonImage");
    const skeletonCopy = document.getElementById("serialSkeletonCopy");
    if (!content || !title || !message || !icon || !iconGlyph || !product) return;
    const code = String(form.elements.serial_number?.value || "")
      .trim()
      .toLowerCase();
    let item = null;
    if (API_BASE) {
      try {
        const payload = await apiRequest(
          `/api/v1/serial/${encodeURIComponent(code)}`,
        );
        if (payload.found && payload.item) {
          item = {
            ...payload.item,
            clientName: payload.item.ownerName || "Dart Customer",
          };
        }
      } catch (error) {
        result.hidden = false;
        result.classList.remove("is-idle");
        content.classList.remove("serial-result-skeleton");
        if (skeletonImage) skeletonImage.hidden = true;
        if (skeletonCopy) skeletonCopy.hidden = true;
        icon.hidden = false;
        iconGlyph.className = "fa-solid fa-triangle-exclamation";
        title.textContent = "Registry Unavailable";
        message.textContent = "تعذر التحقق من قاعدة بيانات Dart الآن. حاول مرة أخرى.";
        product.hidden = true;
        return;
      }
    } else {
      const items = read(KEYS.items, []);
      item = items.find(
        (row) =>
          String(row.itemCode || "")
            .trim()
            .toLowerCase() === code &&
          !row.isDeleted &&
          String(row.status || "").toLowerCase() === "sold" &&
          (row.clientId || row.clientName),
      ) || null;
    }
    result.hidden = false;
    result.classList.remove("is-idle");
    content.classList.remove("serial-result-skeleton");
    if (skeletonImage) skeletonImage.hidden = true;
    if (skeletonCopy) skeletonCopy.hidden = true;
    icon.hidden = false;
    result.classList.toggle("is-authentic", Boolean(item));
    result.classList.toggle("is-missing", !item);
    if (!item) {
      iconGlyph.className = "fa-solid fa-xmark";
      title.textContent = "Item Not Found";
      message.textContent = "This code does not match a sold item in the official Dart registry.";
      product.hidden = true;
      return;
    }
    const owner =
      item.clientName ||
      read(KEYS.customers, []).find(
        (row) => String(row.clientId) === String(item.clientId),
      )?.clientName;
    const model = DartCatalog.model(item.modelId),
      productName = model?.name || item.modelName || "Dart item",
      image = DartCatalog.cover(model, item.color);
    iconGlyph.className = "fa-solid fa-check";
    title.textContent = "Original piece";
    message.textContent = "This sold item is verified in the official Dart registry.";
    const imageElement = document.getElementById("serialProductImage");
    imageElement.src = image;
    imageElement.alt = `${productName} in ${item.color || "its registered color"}`;
    document.getElementById("serialProductName").textContent = productName;
    document.getElementById("serialProductCode").textContent = item.itemCode;
    document.getElementById("serialProductSize").textContent = item.size || "-";
    document.getElementById("serialProductColor").textContent = item.color || "-";
    document.getElementById("serialProductOwner").textContent = customerNameParts(owner, 2);
    product.hidden = false;
  }

