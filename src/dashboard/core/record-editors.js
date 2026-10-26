function setupModelModal() {
  return DartInventory.setupModelModal();
}

/* BEGIN Clients — identity normalization and duplicate guard */
function dartNormalizeCustomerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function dartNormalizeCustomerPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("20") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("01") && digits.length === 11) return `+2${digits}`;
  return digits ? `+${digits}` : "";
}

function dartCustomerConflict(payload, editId = "") {
  const wantedEmail = dartNormalizeCustomerEmail(payload?.email);
  const wantedPhones = [payload?.phone1, payload?.phone2]
    .map(dartNormalizeCustomerPhone)
    .filter(Boolean);

  return customersData.find((customer) => {
    if (String(customer.id) === String(editId || "")) return false;
    const sameEmail =
      wantedEmail &&
      dartNormalizeCustomerEmail(customer.email) === wantedEmail;
    const currentPhones = [customer.phone1, customer.phone2]
      .map(dartNormalizeCustomerPhone)
      .filter(Boolean);
    return sameEmail || wantedPhones.some((phone) => currentPhones.includes(phone));
  }) || null;
}
/* END Clients — identity normalization and duplicate guard */

function setupCustomerModal() {
  const modal = document.getElementById("customerModal"),
    form = document.getElementById("customerForm");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";
  document
    .getElementById("openCustomerModalBtn")
    ?.addEventListener("click", () => {
      form.reset();
      document.getElementById("modal-customer-edit-id").value = "";
      document.getElementById("custCountry").value = "Egypt";
      openModal(modal);
    });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("modal-customer-edit-id").value,
      p = {
        clientName: document.getElementById("custName").value.trim(),
        birthday: document.getElementById("custBirthday").value || "-",
        phone1: document.getElementById("custPhone1").value.trim(),
        phone2: document.getElementById("custPhone2").value.trim() || "-",
        email: document.getElementById("custEmail").value.trim(),
        country: document.getElementById("custCountry").value || "Egypt",
        governorate: document.getElementById("custGovernorate").value || "",
      };

    if (dartCustomerConflict(p, id)) {
      window.DartDialog.alert("Email or phone is already registered.");
      return;
    }

    if (id) {
      const x = customersData.find((customer) => String(customer.id) === String(id));
      if (!x) return;
      const oldValues = { ...x };

      if (x.serverAuthoritative) {
        if (!window.DartAdminApi?.request) {
          window.DartDialog.alert("Secure admin API is unavailable.");
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/customers/${encodeURIComponent(x.id)}`,
            {
              method: "PATCH",
              body: {
                name: p.clientName,
                email: p.email,
                phone1: p.phone1,
                ...(p.phone2 && p.phone2 !== "-" ? { phone2: p.phone2 } : {}),
                birthday: p.birthday && p.birthday !== "-" ? p.birthday : null,
                dartCardDrawEligible: x.dartCardDrawEligible !== false,
              },
            },
          );
        } catch (error) {
          window.DartDialog.alert(error.message || "Customer update failed.");
          return;
        }
      }

      Object.assign(x, p);
      dartAudit("EDIT", "customers", x.id, oldValues, p);

      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_customers", customersData);
        if (window.DartDomainState.syncDomain) {
          try {
            await window.DartDomainState.syncDomain("customers");
          } catch (error) {
            console.warn("Customer CRM state sync failed", error);
          }
        }
        if (x.serverAuthoritative && window.DartDomainState.hydrateDomain) {
          await window.DartDomainState.hydrateDomain("customers", true);
        }
      } else {
        dartSaveAll();
      }
    } else {
      const x = {
        id: dartUid("CDB"),
        clientId: dartNextBusinessCode("DA", customersData, "clientId"),
        dartCard: "no",
        serverAuthoritative: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        registeredAt: dartNowISO(),
        ...p,
      };
      customersData.push(x);
      dartAudit("CREATE", "customers", x.id, {}, x);
      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_customers", customersData);
      } else {
        dartSaveAll();
      }
    }

    dartRefreshAll();
    closeModal(modal);
  });
}
async function dartHashSensitiveValue(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function setupRepresentativeModal() {
  if (window.DartOperations?.active) return;
  const modal = document.getElementById("representative-modal"),
    form = document.getElementById("rep-form");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  form.dataset.dartV2 = "1";

  document.getElementById("openRepModalBtn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("modal-rep-id").value = "";
    const field = document.getElementById("modal-representative-id");
    if (field) {
      field.value = dartNextBusinessCode("Rep", representativeData, "repId");
      field.readOnly = false;
    }
    const nationalIdInput = document.getElementById("modal-representative-national-id");
    if (nationalIdInput) {
      nationalIdInput.value = "";
      nationalIdInput.readOnly = false;
      nationalIdInput.placeholder = "14-digit national ID";
    }
    openModal(modal);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("modal-rep-id").value;
    const existing = id
      ? representativeData.find((r) => String(r.id) === String(id))
      : null;
    const serverAuthoritative = Boolean(existing?.serverAuthoritative);
    const rawNationalId = document
      .getElementById("modal-representative-national-id")
      .value.trim();

    if (serverAuthoritative && rawNationalId) {
      window.DartDialog.alert("لا يمكن تغيير الرقم القومي للحساب المسجل من هذا المحرر.");
      return;
    }
    if (!serverAuthoritative && rawNationalId && !/^\d{14}$/.test(rawNationalId)) {
      window.DartDialog.alert("الرقم القومي يجب أن يكون 14 رقمًا.");
      return;
    }

    const requestedRepId =
      document.getElementById("modal-representative-id").value.trim();
    if (
      serverAuthoritative &&
      requestedRepId &&
      requestedRepId !== String(existing.repId || "")
    ) {
      window.DartDialog.alert("Rep ID للحساب المسجل ثابت ولا يمكن تغييره.");
      return;
    }

    const nationalIdHash = rawNationalId
      ? await dartHashSensitiveValue(rawNationalId)
      : existing?.nationalIdHash || "";
    const nationalIdLast4 = rawNationalId
      ? rawNationalId.slice(-4)
      : existing?.nationalIdLast4 || "";

    const p = {
      name: document.getElementById("modal-representative-name").value.trim(),
      repId: serverAuthoritative
        ? existing.repId
        : id
          ? requestedRepId
          : dartNextBusinessCode("Rep", representativeData, "repId"),
      nationalIdHash,
      nationalIdLast4,
      address: document.getElementById("modal-representative-address").value.trim(),
      phone1: document.getElementById("modal-rep-phone1").value.trim(),
      phone2: document.getElementById("modal-rep-phone2").value.trim() || "-",
      status: existing?.status || "Active",
    };

    if (
      representativeData.some(
        (r) => r.repId === p.repId && String(r.id) !== String(id),
      )
    ) {
      window.DartDialog.alert("Rep ID مستخدم بالفعل.");
      return;
    }

    if (existing) {
      const old = { ...existing };

      if (serverAuthoritative) {
        if (!window.DartAdminApi?.request) {
          window.DartDialog.alert("Secure admin API is unavailable.");
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/representatives/${encodeURIComponent(existing.id)}`,
            {
              method: "PATCH",
              body: {
                name: p.name,
                email: existing.email,
                phone1: p.phone1,
                ...(p.phone2 && p.phone2 !== "-" ? { phone2: p.phone2 } : {}),
                address: p.address,
              },
            },
          );
        } catch (error) {
          window.DartDialog.alert(error.message || "Representative update failed.");
          return;
        }
      }

      Object.assign(existing, p);
      dartAudit("EDIT", "representative", existing.id, old, p);

      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_representatives", representativeData);
        if (window.DartDomainState.syncDomain) {
          try {
            await window.DartDomainState.syncDomain("representatives");
          } catch (error) {
            console.warn("Representative CRM state sync failed", error);
          }
        }
        if (serverAuthoritative && window.DartDomainState.hydrateDomain) {
          await window.DartDomainState.hydrateDomain("representatives", true);
        }
      } else {
        dartSaveAll();
      }
    } else {
      const x = {
        id: dartUid("RDB"),
        date: new Date().toLocaleDateString("en-GB"),
        serverAuthoritative: false,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      representativeData.push(x);
      dartAudit("CREATE", "representative", x.id, {}, x);
      if (window.DartDomainState?.write) {
        window.DartDomainState.write("dart_representatives", representativeData);
      } else {
        dartSaveAll();
      }
    }

    dartRefreshAll();
    closeModal(modal);
  });
}
function setupReviewModal() {
  const modal = document.getElementById("customer-review-modal"),
    form = document.getElementById("customer-review-form");
  if (!form || form.dataset.dartV3) return;
  form.dataset.dartV3 = "1";
  document
    .getElementById("openReviewModalBtn")
    ?.addEventListener("click", () => {
      form.reset();
      form.dataset.permissionDomain = "reviews";
      document.getElementById("modal-review-edit-id").value = "";
      openModal(modal);
    });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("modal-review-edit-id").value,
      name = document.getElementById("modal-cust-rev-name").value,
      client = customersData.find((c) => c.clientName === name) || null,
      p = {
        clientName: name,
        clientId: client?.clientId || "",
        rating: document.getElementById("modal-cust-rating").value || "5",
        phone1:
          document.getElementById("modal-cust-rev-phone1").value ||
          client?.phone1 ||
          "",
        review: document.getElementById("modal-cust-review").value || "",
        phone2:
          document.getElementById("modal-cust-rev-phone2").value ||
          client?.phone2 ||
          "-",
        title: document.getElementById("modal-cust-title").value || "",
        email:
          document.getElementById("modal-cust-rev-email").value ||
          client?.email ||
          "",
        status: document.getElementById("modal-cust-status").value || "Active",
      };
    if (id) {
      const r = reviewsData.find((x) => String(x.id) === String(id)),
        old = { ...r };
      Object.assign(r, p);
      dartAudit("EDIT", "review", r.id, old, p);
    } else {
      const r = {
        id: dartUid("REVDB"),
        createdAt: dartNowISO(),
        date: new Date().toLocaleString(),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      reviewsData.push(r);
      dartAudit("CREATE", "review", r.id, {}, r);
    }
    dartSaveAll();
    dartRefreshAll();
    closeModal(modal);
  });
}

function openEditModal(id, sectionKey) {
  if (sectionKey === "models" || sectionKey === "items")
    return DartInventory.openEditor(id, sectionKey);
  const info = sectionsMap[sectionKey],
    x = info?.data.find((v) => String(v.id) === String(id));
  if (!x) return;
  if (sectionKey === "review") {
    document.getElementById("customer-review-form").dataset.permissionDomain = x.recordType === "contact" || x.source === "Contact Us" ? "contacts" : "reviews";
    document.getElementById("modal-review-edit-id").value = x.id;
    document.getElementById("modal-cust-rev-name").value = x.clientName || "";
    document.getElementById("modal-cust-rating").value = x.rating || "5";
    document.getElementById("modal-cust-rev-phone1").value = x.phone1 || "";
    document.getElementById("modal-cust-review").value = x.review || "";
    document.getElementById("modal-cust-rev-phone2").value = x.phone2 || "";
    document.getElementById("modal-cust-title").value = x.title || "";
    document.getElementById("modal-cust-rev-email").value = x.email || "";
    document.getElementById("modal-cust-status").value = x.status || "Active";
    openModal(document.getElementById("customer-review-modal"));
    return;
  }
  if (sectionKey === "models") {
    document.getElementById("modal-edit-id").value = x.id;
    document.getElementById("modal-id").value = x.modelId || "";
    document.getElementById("modal-name").value = x.name || "";
    document.getElementById("modal-category").value = x.category || "";
    document.getElementById("modal-description").value = x.description || "";
    document.getElementById("modal-cost").value = x.cost || 0;
    document.getElementById("modal-selling").value = x.selling || 0;
    document.getElementById("modal-discount").value = x.discount || 0;
    document.getElementById("modal-final-price").textContent = dartMoney(
      x.discountedPrice ?? x.selling,
    );
    openModal(document.getElementById("model-modal"));
    return;
  }
  if (sectionKey === "items") {
    document.getElementById("modal-item-add-edit-id").value = x.id;
    document.getElementById("modal-item-model-id").value = x.modelId || "";
    document.getElementById("modal-item-code-pic").value = x.itemCode || "";
    document.getElementById("modal-item-color").value = x.color || "";
    document.getElementById("modal-item-size").value = x.size || "";
    openModal(document.getElementById("item-add-modal"));
    return;
  }
  if (sectionKey === "customers") {
    document.getElementById("modal-customer-edit-id").value = x.id;
    document.getElementById("custName").value = x.clientName || "";
    document.getElementById("custBirthday").value = x.birthday || "";
    document.getElementById("custPhone1").value = x.phone1 || "";
    document.getElementById("custPhone2").value = x.phone2 || "";
    document.getElementById("custEmail").value = x.email || "";
    document.getElementById("custCountry").value = x.country || "Egypt";
    document.getElementById("custGovernorate").value = x.governorate || "Cairo";
    openModal(document.getElementById("customerModal"));
    return;
  }
  if (sectionKey === "returns") {
    document.getElementById("return-form").dataset.returnUpdatedAt = String(x.updatedAt || x.completedAt || x.createdAt || "");
    document.getElementById("modal-return-edit-id").value = x.id;
    document.getElementById("modal-return-name").value = x.clientName || "";
    document.getElementById("modal-return-item-code").value = x.itemCode || "";
    document.getElementById("modal-return-phone1").value = x.phone1 || "";
    document.getElementById("modal-return-model-id").value = x.modelId || "";
    document.getElementById("modal-return-phone2").value = x.phone2 || "";
    document.getElementById("modal-return-email").value = x.email || "";
    document.getElementById("modal-item-condition").value =
      ["Bad", "Damaged"].includes(x.condition || x.inspectionStatus || x.status) ? "Bad" : "Good";
    document.getElementById("modal-item-reason").value = x.reason || "سبب آخر";
    if (document.getElementById("modal-return-refund"))
      document.getElementById("modal-return-refund").value =
        x.refundAmount || 0;
    openModal(document.getElementById("return-modal"));
    return;
  }
  if (sectionKey === "card") {
    window.dartOpenCardEditor?.(x);
    return;
  }
  if (sectionKey === "representative") {
    document.getElementById("modal-rep-id").value = x.id;
    document.getElementById("modal-representative-name").value = x.name || "";
    const repIdInput = document.getElementById("modal-representative-id");
    repIdInput.value = x.repId || "";
    repIdInput.readOnly = Boolean(x.serverAuthoritative);
    const nationalIdInput = document.getElementById("modal-representative-national-id");
    nationalIdInput.value = "";
    nationalIdInput.readOnly = Boolean(x.serverAuthoritative);
    nationalIdInput.placeholder = x.nationalIdLast4
      ? `••••••••••${x.nationalIdLast4}`
      : "14-digit national ID";
    document.getElementById("modal-representative-address").value =
      x.address || "";
    document.getElementById("modal-rep-phone1").value = x.phone1 || "";
    document.getElementById("modal-rep-phone2").value = x.phone2 || "";
    openModal(document.getElementById("representative-modal"));
    return;
  }
  if (sectionKey === "orders") {
    document.getElementById("orderForm").dataset.orderVersion = String(x.version || 0);
    document.getElementById("modal-order-edit-id").value = x.id;
    document.getElementById("clientName").value = x.clientName || "";
    document.getElementById("clientId").value = x.clientId || "";
    document.getElementById("phone1").value = x.phone1 || "";
    document.getElementById("phone2").value = x.phone2 || "";
    document.getElementById("email").value = x.email || "";
    document.getElementById("paymentMethod").value = x.paymentMethod || "";
    document.getElementById("paymentStatus").value =
      x.paymentStatus || "Unpaid";
    document.getElementById("amountPaid").value = x.amountPaid || 0;
    document.getElementById("amountRefunded").value = x.amountRefunded || 0;
    document.getElementById("orderSource").value = x.orderSource || "Manual";
    document.getElementById("deliveryNotes").value = x.deliveryNotes || "";
    document.getElementById("orderCountry").value = x.country || "";
    document.getElementById("governorate").value = x.governorate || "";
    document.getElementById("orderArea").value = x.area || "";
    document.getElementById("orderStreetName").value = x.street || "";
    document.getElementById("orderBuildingNumber").value = x.building || "";
    document.getElementById("orderFloor").value = x.floor || "";
    document.getElementById("deductions").value = x.discount || 0;
    window.loadOrderItemsForEdit?.(x.items || []);
    openModal(document.getElementById("orderModal"));
    return;
  }
  if (sectionKey === "damage") {
    document.getElementById("damage-edit-id").value = x.id;
    document.getElementById("damage-item-code").value = x.itemCode || "";
    document.getElementById("damage-reason").value = x.reason || "";
    document.getElementById("damage-notes").value = x.notes || "";
    document.getElementById("damage-status").value = x.status || "Damaged";
    openModal(document.getElementById("damage-modal"));
  }
}

function setupPasswordResetRequests() {
  const openButton = document.getElementById("openPasswordRequestsBtn");
  if (openButton && !openButton.dataset.dartBound) {
    openButton.dataset.dartBound = "1";
    openButton.addEventListener("click", async () => {
      try {
        await dartLoadPasswordResetRequests(true);
      } catch (error) {
        window.DartDialog.alert(error.message || "Could not load password reset requests.");
      }
    });
  }

  const list = document.getElementById("password-requests-list");
  if (list && !list.dataset.dartBound) {
    list.dataset.dartBound = "1";
    list.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-request-id]");
      if (!row) return;
      const requestId = row.dataset.requestId;

      if (event.target.closest(".dart-cancel-reset-request")) {
        if (!await window.DartDialog.confirm("Cancel this password reset request?")) return;
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/password-reset-requests/${encodeURIComponent(requestId)}/cancel`,
            { method: "POST" },
          );
          await dartLoadPasswordResetRequests(false);
        } catch (error) {
          window.DartDialog.alert(error.message || "Could not cancel the request.");
        }
        return;
      }

      if (event.target.closest(".dart-set-temporary-password")) {
        const input = row.querySelector("[data-temporary-password]");
        const temporaryPassword = String(input?.value || "");
        if (temporaryPassword.length < 12) {
          window.DartDialog.alert("Temporary password must be at least 12 characters.");
          input?.focus();
          return;
        }
        try {
          await window.DartAdminApi.request(
            `/api/v1/admin/password-reset-requests/${encodeURIComponent(requestId)}/temporary-password`,
            {
              method: "POST",
              body: { temporaryPassword },
            },
          );
          if (input) input.value = "";
          await dartLoadPasswordResetRequests(false);
        } catch (error) {
          if (input) input.value = "";
          window.DartDialog.alert(error.message || "Could not set the temporary password.");
        }
      }
    });
  }

  // Password-reset requests are fetched on demand after authentication.
  // Do not call protected endpoints while the login/activation gate is visible.
}

function setupAllDelegatedEvents() {
  const map = {
    models: "models-container",
    items: "items-container",
    customers: "customers-container",
    orders: "orders-container",
    returns: "returns-container",
    review: "review-container",
    representative: "representative-container",
    card: "card-container",
    damage: "damage-container",
  };
  Object.entries(map).forEach(([k, id]) =>
    setupSectionEvents(id, sectionsMap[k]?.data, sectionsMap[k]?.render, k),
  );
  const orders = document.getElementById("orders-container");
  if (orders && !orders.dataset.dartV3Back) {
    orders.dataset.dartV3Back = "1";
    orders.addEventListener("click", async (e) => {
      const b = e.target.closest(".dart-back-btn");
      if (!b) return;
      const id = b.closest(".model-row")?.dataset.id,
        o = ordersData.find((x) => String(x.id) === String(id));
      if (!o) return;
      b.disabled = true;
      try {
        const result = await dartRollbackOrderOneStep(o);
        if (!result.ok && result.message !== "cancelled") {
          window.DartDialog.alert(result.message || "Order rollback failed.");
        }
      } finally {
        b.disabled = false;
      }
    });
  }
  const items = document.getElementById("items-container");
  if (items && !items.dataset.dartV3Img) {
    items.dataset.dartV3Img = "1";
    items.addEventListener("click", (e) => {
      const img = e.target.closest(".dart-item-thumb");
      if (!img) return;
      document.getElementById("full-item-image").src = img.dataset.fullImage;
      openModal(document.getElementById("image-preview-modal"));
    });
  }
  const reviews = document.getElementById("review-container");
  if (reviews && !reviews.dataset.dartV3Toggle) {
    reviews.dataset.dartV3Toggle = "1";
    reviews.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-toggle-review");
      if (!btn) return;
      const id = btn.closest(".model-row")?.dataset.id,
        r = reviewsData.find((x) => String(x.id) === String(id));
      if (!r) return;
      const old = r.status;
      r.status = old === "Active" ? "Hidden" : "Active";
      dartAudit(
        "REVIEW_VISIBILITY",
        "review",
        r.id,
        { status: old },
        { status: r.status },
      );
      dartSaveAll();
      dartRenderSection("review");
    });
  }
}

