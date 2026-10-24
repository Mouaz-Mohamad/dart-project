let dartPasswordResetRequests = [];

async function dartLoadPasswordResetRequests(openAfterLoad = false) {
  if (!window.DartAdminApi?.request) return [];
  const payload = await window.DartAdminApi.request(
    "/api/v1/admin/password-reset-requests",
  );
  dartPasswordResetRequests = Array.isArray(payload.requests)
    ? payload.requests
    : [];

  const count = document.getElementById("passwordRequestsCount");
  if (count) count.textContent = String(dartPasswordResetRequests.length);

  const list = document.getElementById("password-requests-list");
  if (list) {
    list.replaceChildren();
    if (!dartPasswordResetRequests.length) {
      const empty = document.createElement("p");
      empty.className = "dart-empty-state";
      empty.textContent = "No pending password reset requests.";
      list.appendChild(empty);
    } else {
      dartPasswordResetRequests.forEach((request) => {
        const row = document.createElement("div");
        row.className = "dart-password-request-row";
        row.dataset.requestId = String(request.id);

        const info = document.createElement("div");
        info.className = "dart-password-request-info";
        const title = document.createElement("strong");
        title.textContent = [request.name, request.code].filter(Boolean).join(" · ");
        const meta = document.createElement("small");
        meta.textContent = [
          request.accountType,
          request.email,
          request.phone,
          request.requestedAt
            ? new Date(request.requestedAt).toLocaleString()
            : "",
        ].filter(Boolean).join(" · ");
        info.append(title, meta);

        if (!request.matchedAccount) {
          const unmatched = document.createElement("span");
          unmatched.className = "dart-sensitive-note";
          unmatched.textContent = "No matching account — can only cancel this request.";
          info.appendChild(unmatched);
        }

        const actions = document.createElement("div");
        actions.className = "dart-password-request-actions";

        if (request.matchedAccount) {
          const passwordInput = document.createElement("input");
          passwordInput.type = "password";
          passwordInput.minLength = 12;
          passwordInput.maxLength = 200;
          passwordInput.autocomplete = "new-password";
          passwordInput.placeholder = "Temporary password (12+ characters)";
          passwordInput.dataset.temporaryPassword = "1";

          const setButton = document.createElement("button");
          setButton.type = "button";
          setButton.className = "action-btn dart-set-temporary-password";
          setButton.textContent = "Set temporary password";
          actions.append(passwordInput, setButton);
        }

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "action-btn dart-cancel-reset-request";
        cancelButton.textContent = "Cancel request";
        actions.appendChild(cancelButton);

        row.append(info, actions);
        list.appendChild(row);
      });
    }
  }

  if (openAfterLoad) {
    openModal(document.getElementById("password-requests-modal"));
  }
  return dartPasswordResetRequests;
}

async function dartRequestCustomerPasswordReset(customer) {
  if (!customer?.serverAuthoritative || !window.DartAdminApi?.request) {
    return {
      ok: false,
      message: "This CRM-only customer does not have a secure login account.",
    };
  }
  try {
    await window.DartAdminApi.request("/api/v1/auth/forgot-password", {
      method: "POST",
      body: {
        identifier: customer.email || customer.phone1,
        accountType: "customer",
      },
    });
    await dartLoadPasswordResetRequests(false);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "Password reset request failed." };
  }
}

async function dartAdminAccountState(sectionKey, record, action) {
  if (!window.DartAdminApi?.request || !record?.serverAuthoritative) {
    return { ok: false, message: "Secure account API is unavailable." };
  }
  const resource =
    sectionKey === "customers"
      ? "customers"
      : sectionKey === "representative"
        ? "representatives"
        : "";
  if (!resource) return { ok: false, message: "Unsupported account type." };

  try {
    await window.DartAdminApi.request(
      `/api/v1/admin/${resource}/${encodeURIComponent(record.id)}/state`,
      { method: "POST", body: { action } },
    );
    if (window.DartDomainState?.hydrateDomain) {
      await window.DartDomainState.hydrateDomain(
        sectionKey === "customers" ? "customers" : "representatives",
        true,
      );
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "Account action failed." };
  }
}

function setupSectionEvents(containerId, dataArray, renderFn, sectionKey) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.dartDelegated) return;
  container.dataset.dartDelegated = "1";
  container.addEventListener("change", (e) => {
    if (!e.target.classList.contains("model-checkbox")) return;
    const id = e.target.closest(".model-row")?.dataset.id,
      x = sectionsMap[sectionKey]?.data.find(
        (v) => String(v.id) === String(id),
      );
    if (x) {
      x.isChecked = e.target.checked;
      dartUpdateMasterCheckbox(sectionKey);
    }
  });
  container.addEventListener("click", async (e) => {
    const row = e.target.closest(".model-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".btn-delete")) {
      const record = sectionsMap[sectionKey]?.data.find(
        (value) => String(value.id) === String(id),
      );
      if (sectionKey === "orders" && record && window.DartOrdersApi?.stateAction) {
        const action = dartIsArchived(record) ? "restore" : "archive";
        try {
          await window.DartOrdersApi.stateAction(record.orderId || record.id, action);
        } catch (error) {
          window.DartDialog.alert(error.message || "Order state update failed.");
        }
        return;
      }
      if (
        record?.serverAuthoritative &&
        ["customers", "representative"].includes(sectionKey)
      ) {
        const suspended =
          sectionKey === "customers"
            ? record.accountStatus === "suspended"
            : record.status === "Suspended" || record.accountStatus === "suspended";
        const result = await dartAdminAccountState(
          sectionKey,
          record,
          suspended ? "activate" : "suspend",
        );
        if (!result.ok) window.DartDialog.alert(result.message || "Account action failed.");
        return;
      }
      dartArchiveRecord(sectionKey, id);
      return;
    }
    if (e.target.closest(".btn-hard-delete")) {
      const record = sectionsMap[sectionKey]?.data.find(
        (value) => String(value.id) === String(id),
      );
      if (sectionKey === "orders" && record && window.DartOrdersApi?.stateAction) {
        if (
          !await window.DartDialog.confirm(
            "Soft-delete this order from operational views? Financial snapshots, item history and audit records will be preserved.",
          )
        ) return;
        try {
          await window.DartOrdersApi.stateAction(record.orderId || record.id, "delete");
        } catch (error) {
          window.DartDialog.alert(error.message || "Order deletion failed.");
        }
        return;
      }
      if (
        record?.serverAuthoritative &&
        ["customers", "representative"].includes(sectionKey)
      ) {
        if (
          !await window.DartDialog.confirm(
            "Delete this account? Login access will be permanently disabled, while orders and audit history stay preserved.",
          )
        ) return;
        const result = await dartAdminAccountState(sectionKey, record, "delete");
        if (!result.ok) window.DartDialog.alert(result.message || "Account deletion failed.");
        return;
      }
      deletePermanently(id, sectionKey);
      return;
    }
    if (e.target.closest(".btn-edit")) {
      openEditModal(id, sectionKey);
      return;
    }
    if (sectionKey === "orders") {
      const o = ordersData.find((x) => String(x.id) === String(id));
      if (!o) return;
      const codDecision = e.target.closest("[data-order-cod-decision]")?.dataset
        .orderCodDecision;
      if (codDecision) {
        if (!window.DartOrdersApi?.codVerification) {
          window.DartDialog.alert("COD verification requires the secure server API.");
          return;
        }
        const defaultReason =
          codDecision === "verify"
            ? "Customer/order COD details verified"
            : "COD verification failed";
        const reason = await window.DartDialog.prompt("ملاحظة التحقق من COD:", defaultReason);
        if (reason === null) return;
        try {
          await window.DartOrdersApi.codVerification(o.orderId || o.id, {
            expectedVersion: Math.max(1, Number(o.version || 1)),
            decision: codDecision,
            reason: String(reason).trim() || defaultReason,
          });
        } catch (error) {
          if (error?.code === "ORDER_VERSION_CONFLICT") {
            await window.DartOrdersApi.hydrate(true).catch(() => {});
          }
          window.DartDialog.alert(error?.message || "COD verification update failed.");
        }
        return;
      }
      const target = e.target.closest("[data-order-target]")?.dataset
        .orderTarget;
      if (target) {
        await dartRequestOrderTransition([o], target);
        return;
      }
      if (e.target.closest(".dart-pickup-cancel-btn")) {
        const result = await dartApplyTransition(o, "Preparing", {
          type: "REPRESENTATIVE_CANCELLED_PICKUP",
          actorRole: "Representative",
          reason: "Representative cancelled pickup",
        });
        if (!result.ok) window.DartDialog.alert(result.message || "Order status update failed.");
        return;
      }
      if (e.target.closest("[data-order-history]")) {
        dartShowOrderHistory(o);
        return;
      }
    }
    if (sectionKey === "returns") {
      const r = returnsData.find((x) => String(x.id) === String(id));
      if (e.target.closest(".return-rollback-btn")) {
        await dartRollbackReturn(r);
        return;
      }
      if (e.target.closest(".return-accept-btn")) dartDecideReturn(r, "accept");
      if (e.target.closest(".return-reject-btn")) dartDecideReturn(r, "reject");
      if (e.target.closest(".return-assign-btn")) {
        dartPendingReturnAction = { record: r, decision: "assign" };
        const select = document.getElementById("return-rep-assignment-select");
        select?.replaceChildren();
        dartActiveReps().forEach((representative) => {
          const option = document.createElement("option");
          option.value = representative.id;
          option.textContent = `${representative.name} — ${representative.repId}`;
          select?.appendChild(option);
        });
        if (!select?.options.length) {
          dartPendingReturnAction = null;
          window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
          return;
        }
        const summary = document.getElementById("return-rep-assignment-summary");
        if (summary) summary.textContent = `${r.returnId} · ${r.clientName || r.clientId || "Customer"}`;
        openModal(document.getElementById("return-rep-assignment-modal"));
      }
      if (e.target.closest(".return-good-btn")) {
        const result = await dartInspectReturn(r, "Good");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Inspection failed");
      }
      if (e.target.closest(".return-bad-btn")) {
        const result = await dartInspectReturn(r, "Damaged");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Inspection failed");
      }
    }
    if (sectionKey === "damage") {
      const d = damageData.find((x) => String(x.id) === String(id));
      if (e.target.closest(".dart-repair-btn")) {
        const result = await dartSetDamageStatus(d, "Repaired");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Repair failed");
      }
      if (
        e.target.closest(".dart-destroy-btn") &&
        await window.DartDialog.confirm("Mark this physical item as permanently Destroyed?")
      ) {
        const result = await dartSetDamageStatus(d, "Destroyed");
        if (result?.ok === false) window.DartDialog.alert(result.message || "Destroy failed");
      }
    }
    if (sectionKey === "customers") {
      const x = customersData.find((v) => String(v.id) === String(id));
      if (e.target.closest("[data-client-profile]")) dartShowClientProfile(x);
      if (e.target.closest(".dart-reset-password-btn")) {
        const result = await dartRequestCustomerPasswordReset(x);
        if (!result.ok) {
          window.DartDialog.alert(result.message || "Password reset request failed.");
        } else {
          window.DartDialog.alert("تم تسجيل طلب Reset Password في قاعدة البيانات.");
        }
      }
    }
    if (e.target.closest("[data-history-entity]"))
      dartShowAuditFor(sectionKey, id);
  });
}

