function autofillCustomerByPhone(phoneInput, fieldsMap) {
  if (!phoneInput) return;

  phoneInput.addEventListener("input", (e) => {
    const phoneVal = e.target.value.trim();
    if (phoneVal.length < 10) return;

    const customer = customersData.find(
      (c) => c.phone1 === phoneVal || c.phone2 === phoneVal,
    );
    if (customer) {
      if (fieldsMap.name && document.getElementById(fieldsMap.name))
        document.getElementById(fieldsMap.name).value =
          customer.clientName || "";
      if (fieldsMap.clientId && document.getElementById(fieldsMap.clientId))
        document.getElementById(fieldsMap.clientId).value =
          customer.clientId || "";
      if (fieldsMap.phone2 && document.getElementById(fieldsMap.phone2))
        document.getElementById(fieldsMap.phone2).value = customer.phone2 || "";
      if (fieldsMap.email && document.getElementById(fieldsMap.email))
        document.getElementById(fieldsMap.email).value = customer.email || "";
      if (
        fieldsMap.governorate &&
        document.getElementById(fieldsMap.governorate)
      )
        document.getElementById(fieldsMap.governorate).value =
          customer.governorate || "";
      if (fieldsMap.country && document.getElementById(fieldsMap.country))
        document.getElementById(fieldsMap.country).value =
          customer.country || "";
    }
  });
}

// تفعيل البحث التلقائي في جميع النوافذ المنبثقة (Modals)
function initGlobalCustomerAutofill() {
  // 1. نافذة الطلبات Order Modal
  autofillCustomerByPhone(document.getElementById("phone1"), {
    name: "clientName",
    clientId: "clientId",
    phone2: "phone2",
    email: "email",
    governorate: "governorate",
  });

  // 2. نافذة المرتجعات Returns Modal
  autofillCustomerByPhone(document.getElementById("modal-return-phone1"), {
    name: "modal-return-name",
    phone2: "modal-return-phone2",
    email: "modal-return-email",
  });

  // 3. نافذة التقييمات Reviews Modal
  autofillCustomerByPhone(document.getElementById("modal-cust-rev-phone1"), {
    name: "modal-cust-rev-name",
    phone2: "modal-cust-rev-phone2",
    email: "modal-cust-rev-email",
  });
}

// تشغيل التعبئة عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
  initGlobalCustomerAutofill();
});

function populateModelsDatalist() {
  const datalist = document.getElementById("models-list");
  if (!datalist) return;

  const options = modelsData
    .filter((model) => !model.isDeleted)
    .map((model) => {
      const option = document.createElement("option");
      option.value = String(model.modelId || "");
      option.textContent = `${String(model.name || "")} - ${String(model.category || "")}`;
      return option;
    });
  datalist.replaceChildren(...options);
}

// ============================================================================
// DART OPERATIONS V2 — integrated business layer (additive refactor)
