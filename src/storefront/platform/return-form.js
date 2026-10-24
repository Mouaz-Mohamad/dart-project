  function returnRules() {
    return window.DartReturns || null;
  }

  function normalizeReturnLookupValue(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
  }

  function orderContainsReturnItem(order, itemCode) {
    const wanted = normalizeReturnLookupValue(itemCode);
    if (!wanted) return false;
    const directItems = Array.isArray(order?.items) ? order.items : [];
    const snapshotItems = Array.isArray(order?.priceSnapshot)
      ? order.priceSnapshot.map((line) => line?.itemCode ?? line?.item_code ?? "")
      : [];
    return [...directItems, ...snapshotItems].some(
      (code) => normalizeReturnLookupValue(code) === wanted,
    );
  }

  function deliveredOrderForItem(itemCode, orders = read(KEYS.orders, [])) {
    return orders
      .filter(
        (order) =>
          order.status === "Delivered" &&
          !order.isDeleted &&
          orderContainsReturnItem(order, itemCode),
      )
      .sort(
        (first, second) =>
          new Date(second.deliveredAt || second.updatedAt || second.createdAt || 0) -
          new Date(first.deliveredAt || first.updatedAt || first.createdAt || 0),
      )[0] || null;
  }

  function returnOrderLineForItem(order, itemCode) {
    const wanted = normalizeReturnLookupValue(itemCode);
    if (!wanted || !Array.isArray(order?.priceSnapshot)) return null;
    return order.priceSnapshot.find(
      (entry) =>
        normalizeReturnLookupValue(entry?.itemCode ?? entry?.item_code) === wanted,
    ) || null;
  }

  function returnModelIdFromLine(line) {
    return String(
      line?.modelCode ?? line?.modelId ?? line?.model_id ?? "",
    ).trim();
  }

  function resolveReturnCatalogModel(modelId) {
    const wanted = normalizeReturnLookupValue(modelId);
    if (!wanted) return null;
    const direct = window.DartCatalog?.model?.(modelId);
    if (direct) return direct;
    const models = window.DartCatalog?.models?.() || [];
    return models.find(
      (model) =>
        normalizeReturnLookupValue(model?.modelId ?? model?.code) === wanted,
    ) || null;
  }

  function activeReturnVariantValues(options, fallbackKey) {
    return (Array.isArray(options) ? options : [])
      .filter(
        (entry) =>
          typeof entry === "string" ||
          (entry && entry.active !== false && !entry.isArchived && !entry.isDeleted),
      )
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry?.name ?? entry?.[fallbackKey],
      )
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function uniqueReturnVariantValues(values) {
    const seen = new Set();
    return values
      .filter((value) => {
        const key = normalizeReturnLookupValue(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((first, second) =>
        String(first).localeCompare(String(second), undefined, { sensitivity: "base" }),
      );
  }

  function replaceReturnOptions(select, values, placeholder) {
    if (!select) return;
    const selected = normalizeReturnLookupValue(select.value);
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    const retained = values.find(
      (value) => normalizeReturnLookupValue(value) === selected,
    );
    if (retained) select.value = retained;
  }

  function initializeReturnRequestForm() {
    const form = document.getElementById("returnRequestForm");
    if (!form || form.dataset.dartReturnBound) return;
    form.dataset.dartReturnBound = "1";
    window.DartAddress?.initReturnRequest?.();

    const prefillCustomer = () => {
      const user = currentUser();
      const prefill = {
        "return-full-name": user?.name,
        "return-phone-1": user?.phone1 ? displayPhone(user.phone1) : "",
        "return-phone-2": user?.phone2 ? displayPhone(user.phone2) : "",
        "return-email": user?.email,
      };
      Object.entries(prefill).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input && value && !input.value) input.value = value;
      });
    };
    prefillCustomer();
    if (!form.dataset.dartCustomerPrefillBound) {
      form.dataset.dartCustomerPrefillBound = "1";
      window.addEventListener("dart:customer-session-changed", prefillCustomer);
    }

    const type = document.getElementById("return-request-type");
    const code = document.getElementById("return-item-code");
    const group = document.getElementById("return-exchange-options");
    const color = document.getElementById("return-exchange-color");
    const size = document.getElementById("return-exchange-size");
    const feeBox = document.getElementById("return-fee-summary");
    const feeText = document.getElementById("return-fee-summary-text");

    const availableForRequest = () => {
      const itemCode = String(code?.value || "").trim();
      const order = deliveredOrderForItem(itemCode);
      const line = returnOrderLineForItem(order, itemCode);
      const modelId = returnModelIdFromLine(line);
      const model = resolveReturnCatalogModel(modelId);
      if (!model || !modelId) return [];

      const sizes = activeReturnVariantValues(model.sizeOptions, "size");
      const colors = activeReturnVariantValues(model.colorOptions, "color");
      const available = [];
      for (const sizeValue of sizes) {
        for (const colorValue of colors) {
          const quantity = Number(
            window.DartCatalog?.available?.(model, sizeValue, colorValue) || 0,
          );
          if (quantity > 0) {
            available.push({
              modelId: model.modelId || modelId,
              color: colorValue,
              size: sizeValue,
              quantity,
              status: "In stock",
            });
          }
        }
      }
      return available;
    };

    const refreshSizes = () => {
      const selectedColor = normalizeReturnLookupValue(color?.value);
      const available = availableForRequest().filter(
        (item) =>
          !selectedColor ||
          normalizeReturnLookupValue(item.color) === selectedColor,
      );
      replaceReturnOptions(
        size,
        uniqueReturnVariantValues(available.map((item) => String(item.size))),
        available.length ? "Select new size" : "No available size",
      );
    };

    const refresh = () => {
      const rules = returnRules();
      const normalizedType = rules?.normalizeType(type?.value) || "";
      const isExchange = normalizedType === "Exchange";
      if (group) {
        group.hidden = !isExchange;
        group.disabled = !isExchange;
      }
      if (color) color.required = isExchange;
      if (size) size.required = isExchange;

      if (isExchange) {
        const available = availableForRequest();
        replaceReturnOptions(
          color,
          uniqueReturnVariantValues(available.map((item) => String(item.color))),
          available.length ? "Select new color" : "No replacement is currently available",
        );
        refreshSizes();
      }

      if (!normalizedType) {
        if (feeBox) feeBox.hidden = true;
        return;
      }
      const items = read(KEYS.items, []);
      const original = items.find(
        (item) =>
          normalizeReturnLookupValue(item.itemCode) ===
          normalizeReturnLookupValue(code?.value),
      );
      const chainId = rules?.chainIdForItem(original, code?.value.trim()) || code?.value.trim();
      const completed = rules?.completedExchangeCount(read(KEYS.returns, []), chainId) || 0;
      const policy = rules?.courierPolicy(normalizedType, completed);
      if (feeText) feeText.textContent = policy?.label || "";
      if (feeBox) feeBox.hidden = !policy;
    };

    const refreshFromReturnSource = (event) => {
      const key = event?.detail?.key;
      if (!key || [KEYS.orders, KEYS.items, KEYS.models].includes(key)) refresh();
    };

    type?.addEventListener("change", refresh);
    code?.addEventListener("change", refresh);
    code?.addEventListener("blur", refresh);
    color?.addEventListener("change", refreshSizes);
    window.addEventListener("dart:catalog-hydrated", refresh);
    window.addEventListener("dart:data-changed", refreshFromReturnSource);
    refresh();
  }


