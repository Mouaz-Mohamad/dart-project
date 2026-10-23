function renderCards(dataArray) {
  const container = document.getElementById("card-container");
  if (!container) return;
  container.innerHTML = "";

  getSortedData(dataArray).forEach((item) => {
    let boxesHTML = '<div class="card-items-grid">';
    (item.requestedProducts || []).forEach((code) => {
      boxesHTML += `<div class="card-item-chip">${dartEsc(code)}</div>`;
    });
    boxesHTML += "</div>";

    container.insertAdjacentHTML(
      "beforeend",
      `
            <div class="${getRowClass(item)}" data-id="${dartEsc(item.id)}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? "checked" : ""}>
                <div class="w100 button row-action-btns">
                    <button type="button" class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button type="button" class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button type="button" class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item overflow w150">${dartEsc(item.cardId)}</span>
                <span class="text-item overflow w150">${dartEsc(item.clientName)}</span>
                <span class="text-item overflow w150">${dartEsc(item.clientId)}</span>
                <span class="text-item overflow w150">${dartEsc(item.phone1)}</span>
                <span class="text-item overflow w150">${dartEsc(item.phone2 || "-")}</span>
                <span class="text-item overflow w200">${dartEsc(item.email || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.status || "-")}</span>
                <span class="text-item overflow w200">${dartEsc(item.issueDate || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.expDate || "-")}</span>
                <span class="text-item overflow w150">${dartEsc(item.purchasedItems ?? 0)}</span>
                <span class="text-item overflow w150">${dartEsc(item.purchasedLimit ?? item.itemLimit ?? 10)}</span>
                <div class="text-item overflow w1200">${boxesHTML}</div>
            </div>
        `,
    );
  });
}

// النافذة المنبثقة للكروت
function dartCardIsCurrentlyActive(card, reference = new Date()) {
  if (!card || card.status !== "Active" || dartIsArchived(card)) return false;
  const limit = Number(card.itemLimit || card.purchasedLimit || 10),
    used = Number(card.purchasedItems || 0),
    parsedExpiry = dartDateValue(card.expDate),
    expiry = parsedExpiry ? new Date(parsedExpiry) : null;
  if (expiry) expiry.setHours(23, 59, 59, 999);
  return used < limit && (!expiry || expiry >= reference);
}

function setupCardModal() {
  const modal = document.getElementById("card-modal");
  const form = document.getElementById("card-form");
  if (!modal || !form || form.dataset.dartBound) return;
  form.dataset.dartBound = "1";
  const clientSelect = document.getElementById("modal-card-client-id"),
    inputDate = (value) => {
      const date = dartDateValue(value);
      if (!date) return "";
      const year = date.getFullYear(),
        month = String(date.getMonth() + 1).padStart(2, "0"),
        day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },
    fillClient = (clientId) => {
      const client = customersData.find(
        (row) => String(row.clientId) === String(clientId),
      );
      document.getElementById("modal-card-client-name").value =
        client?.clientName || "";
      document.getElementById("modal-card-phone1").value = client?.phone1 || "";
      document.getElementById("modal-card-phone2").value = client?.phone2 || "-";
      document.getElementById("modal-card-email").value = client?.email || "";
    };

  window.dartOpenCardEditor = (card = null) => {
    form.reset();
    clientSelect.innerHTML =
      '<option value="">Select client</option>' +
      customersData
        .filter(dartIsActive)
        .map(
          (customer) =>
            `<option value="${dartEsc(customer.clientId)}">${dartEsc(customer.clientName)} — ${dartEsc(customer.clientId)}</option>`,
        )
        .join("");
    const today = new Date(),
      expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    document.getElementById("modal-card-edit-id").value = card?.id || "";
    document.getElementById("modal-card-code-id").value =
      card?.cardId || `DC-${Date.now().toString(36).toUpperCase()}`;
    clientSelect.value = card?.clientId || "";
    fillClient(clientSelect.value);
    document.getElementById("modal-card-purchased").value =
      Number(card?.purchasedItems || 0);
    document.getElementById("modal-card-limit").value = "10";
    document.getElementById("modal-card-discount").value = `${Number(card?.discountPercent ?? window.DartSiteSettings?.get?.().dartCardDiscountPercent ?? 40)}%`;
    document.getElementById("modal-card-issue").value =
      inputDate(card?.issueDate) || inputDate(today);
    document.getElementById("modal-card-exp").value =
      inputDate(card?.expDate) || inputDate(expiry);
    document.getElementById("modal-card-status").value = card?.status || "Active";
    document.getElementById("card-modal-title").textContent = card
      ? "Edit Dart Card Benefit"
      : "Additional Benefit — Dart Card";
    form.querySelector('[type="submit"]').textContent = card
      ? "Save Dart Card"
      : "Grant Dart Card";
    openModal(modal);
  };

  clientSelect.addEventListener("change", () => fillClient(clientSelect.value));
  document
    .getElementById("openCardBenefitBtn")
    ?.addEventListener("click", () => window.dartOpenCardEditor());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const editId = document.getElementById("modal-card-edit-id").value,
      client = customersData.find(
        (row) => String(row.clientId) === String(clientSelect.value),
      ),
      issueDate = document.getElementById("modal-card-issue").value,
      expDate = document.getElementById("modal-card-exp").value,
      purchasedItems = Number(
        document.getElementById("modal-card-purchased").value,
      );
    if (!client) return window.DartDialog.alert("اختر العميل أولًا.");
    if (!issueDate || !expDate || new Date(expDate) <= new Date(issueDate))
      return window.DartDialog.alert("تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار.");
    if (!Number.isInteger(purchasedItems) || purchasedItems < 0 || purchasedItems > 10)
      return window.DartDialog.alert("عدد القطع المستخدمة يجب أن يكون من 0 إلى 10.");
    if (
      document.getElementById("modal-card-status").value === "Active" &&
      cardsData.some(
        (row) =>
          String(row.id) !== String(editId) &&
          row.clientId === client.clientId &&
          dartCardIsCurrentlyActive(row),
      )
    )
      return window.DartDialog.alert("هذا العميل لديه Dart Card نشط بالفعل.");

    const cardPayload = {
      cardId: document.getElementById("modal-card-code-id").value,
      clientName: client.clientName,
      clientId: client.clientId,
      phone1: client.phone1 || "",
      phone2: client.phone2 || "-",
      email: client.email || "",
      status: document.getElementById("modal-card-status").value || "Active",
      issueDate,
      expDate,
      purchasedItems: String(purchasedItems),
      purchasedLimit: "10",
      itemLimit: 10,
      discountPercent: editId
        ? Number(cardsData.find((row) => String(row.id) === String(editId))?.discountPercent ?? 40)
        : Number(window.DartSiteSettings?.get?.().dartCardDiscountPercent ?? 40),
      requestedProducts: editId
        ? cardsData.find((row) => String(row.id) === String(editId))
            ?.requestedProducts || []
        : [],
      isArchived: false,
      isDeleted: false,
      isChecked: false,
      updatedAt: dartNowISO(),
    };
    if (editId) {
      const card = cardsData.find((row) => String(row.id) === String(editId)),
        old = { ...card };
      Object.assign(card, cardPayload);
      dartAudit("EDIT", "card", card.id, old, cardPayload);
    } else {
      const card = {
        id: dartUid("CARDDB"),
        createdAt: dartNowISO(),
        grantType: "Manual Additional Benefit",
        ...cardPayload,
      };
      cardsData.push(card);
      dartAudit("CREATE", "card", card.id, {}, card);
    }
    customersData.forEach((customer) => {
      customer.dartCard = cardsData.some(
        (row) =>
          row.clientId === customer.clientId &&
          dartCardIsCurrentlyActive(row),
      )
        ? "yes"
        : "no";
    });
    dartSyncUserCardFlags();
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
    form.reset();
  });
}

function dartSyncUserCardFlags() {
  if (window.DartDomainState) return;
  let users;
  users = window.DartState?.read?.("dart_users", []) || [];
  users.forEach((user) => {
    user.dartCard = cardsData.some(
      (card) =>
        card.clientId === user.customerId &&
        dartCardIsCurrentlyActive(card),
    )
      ? "yes"
      : "no";
  });
  window.DartState?.write?.("dart_users", users, { source: "dashboard" });
}

