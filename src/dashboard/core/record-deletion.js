function dartDeleteImpact(sectionKey, id) {
  const sid = String(id),
    impact = {
      models: new Set(),
      items: new Set(),
      customers: new Set(),
      orders: new Set(),
      returns: new Set(),
      review: new Set(),
      card: new Set(),
      representative: new Set(),
      damage: new Set(),
      clientCodes: new Set(),
      itemCodes: new Set(),
      orderCodes: new Set(),
      returnCodes: new Set(),
    };
  const target = sectionsMap[sectionKey]?.data.find(
    (row) => String(row.id) === sid,
  );
  if (!target) return null;
  impact[sectionKey]?.add(sid);

  if (sectionKey === "models") {
    const modelCode = target.modelId;
    itemsData
      .filter((row) => String(row.modelId) === String(modelCode))
      .forEach((row) => {
        impact.items.add(String(row.id));
        impact.itemCodes.add(String(row.itemCode));
      });
    ordersData
      .filter((row) =>
        (row.priceSnapshot || []).some(
          (line) => String(line.modelCode) === String(modelCode),
        ),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
  }
  if (sectionKey === "items") impact.itemCodes.add(String(target.itemCode));
  if (sectionKey === "customers") impact.clientCodes.add(String(target.clientId));
  if (sectionKey === "orders") impact.orderCodes.add(String(target.orderId));
  if (sectionKey === "returns") impact.returnCodes.add(String(target.returnId));

  if (sectionKey === "representative") {
    ordersData
      .filter(
        (row) =>
          [row.representativeId, row.representativeBusinessId].some(
            (value) =>
              String(value) === sid || String(value) === String(target.repId),
          ),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
  }

  if (impact.clientCodes.size) {
    ordersData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
    returnsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
    reviewsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => impact.review.add(String(row.id)));
    cardsData
      .filter((row) => impact.clientCodes.has(String(row.clientId)))
      .forEach((row) => impact.card.add(String(row.id)));
  }

  if (impact.itemCodes.size) {
    ordersData
      .filter((row) =>
        (row.items || []).some((code) => impact.itemCodes.has(String(code))),
      )
      .forEach((row) => {
        impact.orders.add(String(row.id));
        impact.orderCodes.add(String(row.orderId));
      });
    returnsData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
    damageData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  if (impact.orderCodes.size) {
    ordersData
      .filter((row) => impact.orderCodes.has(String(row.orderId)))
      .forEach((row) => {
        impact.orders.add(String(row.id));
        (row.items || []).forEach((code) => impact.itemCodes.add(String(code)));
      });
    itemsData
      .filter(
        (row) =>
          impact.orderCodes.has(String(row.orderId)) ||
          impact.itemCodes.has(String(row.itemCode)),
      )
      .forEach((row) => {
        impact.items.add(String(row.id));
        impact.itemCodes.add(String(row.itemCode));
      });
    returnsData
      .filter((row) => impact.orderCodes.has(String(row.orderId)))
      .forEach((row) => {
        impact.returns.add(String(row.id));
        impact.returnCodes.add(String(row.returnId));
      });
  }

  if (impact.itemCodes.size) {
    damageData
      .filter((row) => impact.itemCodes.has(String(row.itemCode)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  if (impact.returnCodes.size) {
    damageData
      .filter((row) => impact.returnCodes.has(String(row.returnId)))
      .forEach((row) => impact.damage.add(String(row.id)));
  }

  const labels = {
      models: "Models",
      items: "Items",
      customers: "Clients",
      orders: "Orders",
      returns: "Returns",
      review: "Reviews / Messages",
      card: "Dart Cards",
      representative: "Representatives",
      damage: "Damage records",
    },
    counts = Object.entries(labels)
      .map(([key, label]) => ({ key, label, count: impact[key].size }))
      .filter((row) => row.count > 0);
  return { sectionKey, id: sid, target, impact, counts };
}


let dartPendingHardDelete = null;
function dartHardDeleteRelations(preview) {
  return (preview?.counts || []).filter(
    (row) => row.key !== preview.sectionKey || row.count > 1,
  );
}

async function dartSyncHardDeleteSection(sectionKey) {
  if (["models", "items"].includes(sectionKey)) {
    await window.DartCatalog?.syncAdminState?.();
    await window.DartCatalog?.hydrate?.(true);
    return;
  }
  if (sectionKey === "orders") {
    await window.DartOrdersApi?.hydrate?.(true);
    return;
  }
  const domainBySection = {
    customers: "customers",
    returns: "returns",
    review: "reviews",
    card: "cards",
    representative: "representatives",
    damage: "damage",
  };
  const domain = domainBySection[sectionKey];
  if (domain) {
    await window.DartDomainState?.syncDomain?.(domain);
    await window.DartDomainState?.hydrateDomain?.(domain, true);
  }
  await window.DartDomainState?.hydrateAudit?.().catch(() => {});
}

async function dartRollbackHardDeleteSection(sectionKey) {
  try {
    if (["models", "items"].includes(sectionKey)) {
      await window.DartCatalog?.hydrate?.(true);
      return;
    }
    if (sectionKey === "orders") {
      await window.DartOrdersApi?.hydrate?.(true);
      return;
    }
    const domainBySection = {
      customers: "customers",
      returns: "returns",
      review: "reviews",
      card: "cards",
      representative: "representatives",
      damage: "damage",
    };
    const domain = domainBySection[sectionKey];
    if (domain) await window.DartDomainState?.hydrateDomain?.(domain, true);
  } finally {
    dartRefreshAll();
  }
}

async function dartCommitHardDelete(mode) {
  const preview = dartPendingHardDelete;
  if (!preview) return;

  const { sectionKey, id, target, impact } = preview;
  const sec = sectionsMap[sectionKey];
  const serverMode = Boolean(window.DartAdminApi?.request);
  const linked = dartHardDeleteRelations(preview);

  if (serverMode && (mode === "cascade" || linked.length)) {
    window.DartDialog.alert(
      "Permanent cascade delete is blocked in production for linked business records. Archive/soft-delete this record instead, or use Reset All Data when you intentionally need a full platform purge.",
    );
    return;
  }

  if (
    serverMode &&
    target?.serverAuthoritative &&
    ["customers", "representative"].includes(sectionKey)
  ) {
    window.DartDialog.alert("Secure customer and representative accounts must be deleted through the account API.");
    return;
  }

  if (mode === "only") {
    sec.data = sec.data.filter((row) => String(row.id) !== String(id));
  } else {
    // Legacy/local development fallback only. Production never enters this branch.
    modelsData = modelsData.filter((row) => !impact.models.has(String(row.id)));
    itemsData = itemsData.filter((row) => !impact.items.has(String(row.id)));
    customersData = customersData.filter(
      (row) => !impact.customers.has(String(row.id)),
    );
    ordersData = ordersData.filter((row) => !impact.orders.has(String(row.id)));
    returnsData = returnsData.filter((row) => !impact.returns.has(String(row.id)));
    reviewsData = reviewsData.filter((row) => !impact.review.has(String(row.id)));
    cardsData = cardsData.filter((row) => !impact.card.has(String(row.id)));
    representativeData = representativeData.filter(
      (row) => !impact.representative.has(String(row.id)),
    );
    damageData = damageData.filter((row) => !impact.damage.has(String(row.id)));

    if (!serverMode && impact.clientCodes.size) {
      let users;
      users = window.DartState?.read?.("dart_users", []) || [];
      users = users.filter(
        (row) => !impact.clientCodes.has(String(row.customerId)),
      );
      window.DartState?.write?.("dart_users", users, { source: "dashboard" });
    }
  }

  customersData.forEach((customer) => {
    customer.dartCard = cardsData.some(
      (card) =>
        card.clientId === customer.clientId &&
        dartCardIsCurrentlyActive(card),
    )
      ? "yes"
      : "no";
  });

  dartSyncUserCardFlags();
  dartAudit(
    mode === "cascade" ? "PERMANENT_DELETE_WITH_LINKS" : "PERMANENT_DELETE_ONLY",
    sectionKey,
    id,
    target || {},
    {},
  );
  dartSaveAll();

  if (serverMode) {
    try {
      await dartSyncHardDeleteSection(sectionKey);
    } catch (error) {
      await dartRollbackHardDeleteSection(sectionKey);
      window.DartDialog.alert(error.message || "Permanent delete was not committed to the database.");
      return;
    }
  }

  dartRefreshAll();
  closeModal(document.getElementById("hard-delete-modal"));
  dartPendingHardDelete = null;
}

function deletePermanently(id, sectionKey) {
  const preview = dartDeleteImpact(sectionKey, id);
  const modal = document.getElementById("hard-delete-modal");
  if (!preview || !modal) return;

  const linked = dartHardDeleteRelations(preview);
  if (window.DartAdminApi?.request && linked.length) {
    window.DartDialog.alert(
      `Permanent delete is blocked because this record has linked business history: ${linked
        .map((row) => `${row.label} (${row.count})`)
        .join(" · ")}. Use Archive/Soft Delete instead.`,
    );
    return;
  }

  dartPendingHardDelete = preview;
  document.getElementById("hard-delete-summary").textContent =
    window.DartAdminApi?.request
      ? "This record has no linked business history. Permanent deletion will be committed to the database."
      : "اختر طريقة الحذف لهذه المرة. الحذف النهائي لا يمكن استرجاعه.";

  const relations = document.getElementById("hard-delete-relations");
  relations.classList.toggle("is-empty", !linked.length);
  relations.innerHTML = linked.length
    ? `<strong>Linked data:</strong> ${linked
        .map((row) => `${dartEsc(row.label)} (${row.count})`)
        .join(" · ")}`
    : "No linked records were found.";

  const onlyButton = document.getElementById("hard-delete-only");
  const cascadeButton = document.getElementById("hard-delete-cascade");
  onlyButton.onclick = () => dartCommitHardDelete("only");

  if (window.DartAdminApi?.request) {
    cascadeButton.hidden = true;
    cascadeButton.onclick = null;
  } else {
    cascadeButton.hidden = false;
    cascadeButton.onclick = () => dartCommitHardDelete("cascade");
  }

  document.getElementById("hard-delete-cancel").onclick = () => {
    dartPendingHardDelete = null;
    closeModal(modal);
  };
  openModal(modal);
}

function dartCustomerStats(clientId) {
  const os = ordersData.filter((o) => o.clientId === clientId),
    delivered = os.filter((o) => o.status === "Delivered");
  const purchased = delivered.flatMap((o) => o.items || []);
  const returnedCodes = new Set(
    returnsData
      .filter(
        (r) =>
          r.clientId === clientId &&
          r.isPostDeliveryReturn &&
          !dartReturnIsExchange(r) &&
          (dartReturnRules()?.isCompleted(r) ||
            ["Completed", "Good", "Damaged", "Bad"].includes(r.status)),
      )
      .map((r) => r.itemCode),
  );
  const spent = delivered.reduce(
    (a, o) =>
      a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
    0,
  );
  return {
    orders: os.length,
    delivered: delivered.length,
    purchased: purchased.length,
    activePurchased: purchased.filter((x) => !returnedCodes.has(x)).length,
    spent,
    lastPurchase:
      delivered
        .map((o) => o.deliveredAt || o.date)
        .filter(Boolean)
        .sort()
        .at(-1) || "-",
  };
}

