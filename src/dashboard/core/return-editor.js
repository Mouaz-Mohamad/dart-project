function dartNextBusinessCode(prefix, data, field) {
  const safePrefix = String(prefix || "").replace(/[^A-Za-z0-9_-]/g, "");
  const re = new RegExp("^" + safePrefix + "-(\\d+)$", "i");
  const existing = (data || []).reduce((max, row) => {
    const match = String(row?.[field] || "").match(re);
    return Math.max(max, match ? Number(match[1]) || 0 : 0);
  }, 0);
  return safePrefix + "-" + (existing + 1);
}

function dartCreateInspectionReturns(order, reason = "Refused delivery") {
  (order.items || []).forEach((code) => {
    const it = dartFindItemByCode(code);
    if (!it) return;
    it.status = "Return Inspection";
    const exists = returnsData.some(
      (r) =>
        r.orderId === order.orderId &&
        r.itemCode === code &&
        !r.isPostDeliveryReturn,
    );
    if (!exists)
      returnsData.push({
        id: dartUid("RETDB"),
        returnId: dartNextBusinessCode("R", returnsData, "returnId"),
        modelId: it.modelId,
        itemCode: code,
        status: "Pending Inspection",
        date: new Date().toLocaleDateString("en-GB"),
        createdAt: dartNowISO(),
        clientName: order.clientName,
        clientId: order.clientId,
        phone1: order.phone1,
        phone2: order.phone2,
        email: order.email,
        reason,
        orderId: order.orderId,
        isPostDeliveryReturn: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      });
  });
}

function setupReturnModal() {
  const modal = document.getElementById("return-modal"),
    form = document.getElementById("return-form");
  if (!form || form.dataset.dartV3Final) return;
  form.dataset.dartV3Final = "1";
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";

  document.getElementById("add-return-btn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-return-edit-id").value = "";
    form.dataset.returnUpdatedAt = "";
    openModal(modal);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("modal-return-edit-id").value,
      code = document.getElementById("modal-return-item-code").value.trim(),
      it = dartFindItemByCode(code);

    if (!it) {
      window.DartDialog.alert("Item Code غير موجود.");
      return;
    }

    const existing = id ? returnsData.find((row) => String(row.id || row.returnId) === String(id)) : null;
    if (existing && String(existing.itemCode).toLowerCase() !== code.toLowerCase()) {
      window.DartDialog.alert("The original item of a saved return cannot be changed.");
      return;
    }
    const order = ordersData.filter(
      (o) => (o.items || []).includes(code) && o.status === "Delivered" &&
        (!existing || String(o.orderId) === String(existing.orderId)),
    ).sort((a, b) => new Date(b.deliveredAt || b.createdAt || 0) - new Date(a.deliveredAt || a.createdAt || 0))[0];
    if (!order) {
      window.DartDialog.alert("Manual return requires a delivered order containing this item.");
      return;
    }

    const refundAmount =
      Number(document.getElementById("modal-return-refund")?.value) || 0;
    const originalLine = (order.priceSnapshot || []).find((line) => String(line.itemCode) === code);
    const lineNet = Number(originalLine?.finalUnitPrice ?? existing?.originalNetAmount ?? dartOrderNet(order));
    const remainingRefund = Math.min(lineNet, Math.max(
      0,
      dartOrderNet(order) - Math.max(0, (Number(order.amountRefunded) || 0) - (Number(existing?.refundAmount) || 0)),
    ));
    const duplicateReturn = returnsData.some(
      (row) =>
        String(row.id) !== String(id || "") &&
        row.itemCode === code &&
        String(row.orderId) === String(order.orderId) &&
        !["Rejected", "Closed"].includes(row.status),
    );
    if (duplicateReturn) {
      window.DartDialog.alert("There is already an active return for this item.");
      return;
    }
    if (refundAmount < 0 || refundAmount > remainingRefund) {
      window.DartDialog.alert(`Maximum remaining refund is ${Math.trunc(remainingRefund)} EGP.`);
      return;
    }

    const condition =
      document.getElementById("modal-item-condition").value || "Good";
    const payload = {
      ...(id ? { existingReturnId: id, expectedUpdatedAt: form.dataset.returnUpdatedAt || "" } : {}),
      itemCode: code,
      reason: document.getElementById("modal-item-reason").value || "Other",
      condition: condition === "Bad" ? "Bad" : "Good",
      refundAmount,
      clientName:
        document.getElementById("modal-return-name").value ||
        order.clientName ||
        "",
      phone1:
        document.getElementById("modal-return-phone1").value ||
        order.phone1 ||
        "",
      phone2:
        document.getElementById("modal-return-phone2").value ||
        order.phone2 ||
        "-",
      email:
        document.getElementById("modal-return-email").value ||
        order.email ||
        "",
    };

    if (window.DartAdminApi?.request) {
      try {
        await window.DartAdminApi.request("/api/v1/admin/returns/manual", {
          method: "POST",
          body: payload,
        });

        await Promise.allSettled([
          window.DartDomainState?.hydrateDomain?.("returns", true),
          window.DartDomainState?.hydrateDomain?.("damage", true),
          window.DartCatalog?.hydrate?.(true),
          window.DartOrdersApi?.hydrate?.(true),
          window.DartDomainState?.hydrateAudit?.(),
        ]);

        dartRefreshAll();
        closeModal(modal);
        form.reset();
      } catch (error) {
        window.DartDialog.alert(error.message || "Manual return could not be saved.");
      }
      return;
    }

    const p = {
      clientName: payload.clientName,
      clientId: order.clientId || "",
      itemCode: code,
      modelId:
        document.getElementById("modal-return-model-id").value || it.modelId,
      phone1: payload.phone1,
      phone2: payload.phone2,
      email: payload.email,
      reason: payload.reason,
      status: payload.condition,
      date: new Date().toLocaleDateString("en-GB"),
      orderId: order.orderId || "",
      isPostDeliveryReturn: true,
      refundAmount: payload.refundAmount,
      createdAt: dartNowISO(),
    };

    let r;
    if (id) {
      r = returnsData.find((x) => String(x.id) === String(id));
      const previous = { ...r };
      Object.assign(r, p);
      dartAudit("EDIT", "returns", r.id, previous, p);
    } else {
      r = {
        id: dartUid("RETDB"),
        returnId: dartNextBusinessCode("R", returnsData, "returnId"),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      returnsData.push(r);
      dartAudit("CREATE", "returns", r.id, {}, r);
    }

    if (payload.condition === "Good") {
      it.status = "In stock";
      it.orderId = "";
      it.clientId = "";
      it.clientName = "";
      it.purchaseDate = "";
    } else {
      it.status = "Damaged";
    }

    if (payload.refundAmount > 0) {
      order.amountRefunded =
        (Number(order.amountRefunded) || 0) + payload.refundAmount;
      order.refundedAt = dartNowISO();
      order.paymentStatus =
        order.amountRefunded >= dartOrderNet(order)
          ? "Refunded"
          : "Partially Refunded";
    }

    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
  });
}

// Friendly mapping for the existing Return reason filter values to Arabic stored reasons.
