// Dashboard-only physical item batching. The catalog API owns validation and the transaction.
(function () {
  "use strict";
  window.DartItemBatch = {
    setup(form, $) {
      const extraCodes = $("dart-item-extra-codes"), addCode = $("dart-item-code-add");
      addCode.addEventListener("click", () => {
        if (form.dataset.saving === "true" || $("modal-item-add-edit-id").value || extraCodes.children.length >= 999) return;
        const row = document.createElement("div");
        row.className = "dart-item-code-row";
        const input = document.createElement("input");
        input.type = "text";
        input.required = true;
        input.setAttribute("aria-label", "Item Code");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "−";
        remove.setAttribute("aria-label", "Remove item code");
        remove.addEventListener("click", () => { if (form.dataset.saving !== "true") row.remove(); });
        row.append(input, remove);
        extraCodes.append(row);
        input.focus();
      });
    },
    async save(api, batch, state) {
      if (!state.ready()) {
        throw Object.assign(new Error("Inventory is not connected to the server."), { code: "CATALOG_NOT_READY" });
      }
      if (!Array.isArray(batch) || !batch.length || batch.length > 1000 || batch.some(item =>
        !item || !item.id || !item.modelId || !item.itemCode || !item.size || !item.color) ||
        new Set(batch.map(item => String(item.itemCode).trim().toLocaleLowerCase())).size !== batch.length ||
        new Set(batch.map(item => item.id)).size !== batch.length) {
        throw Object.assign(new Error("Complete the physical items with unique codes."), { code: "ITEM_FIELDS_REQUIRED" });
      }
      if (state.dirty()) {
        await state.sync();
        if (state.dirty()) throw Object.assign(new Error("Save pending catalogue changes first."), { code: "CATALOG_PENDING_CHANGES" });
      }
      const current = state.items();
      const rows = batch.map(item => ({ ...current.find(row => row.id === item.id), ...item }));
      const result = await api("/api/v1/admin/catalog-state", {
        method: "PATCH",
        body: {
          expectedVersion: state.version(),
          models: [],
          items: rows,
          recordVersions: { models: {}, items: Object.fromEntries(rows.map(item =>
            [item.id, Number(current.find(row => row.id === item.id)?.version || 0)])) },
        },
      });
      const confirmed = rows.map(item => result.items?.find(record =>
        record.id === item.id && record.modelId === item.modelId &&
        record.itemCode === item.itemCode && record.color === item.color && record.size === item.size));
      if (confirmed.some(item => !item)) throw Object.assign(new Error("Inventory save was not confirmed by the server."), { code: "ITEM_SAVE_UNCONFIRMED" });
      await state.hydrate(true);
      return confirmed;
    },
  };
})();
