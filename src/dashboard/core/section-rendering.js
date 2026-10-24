function dartGetSectionData(key) {
  return sectionsMap[key]?.data || [];
}
function dartSectionSearchText(x) {
  const modelName = x.modelId ? DartCatalog.model(x.modelId)?.name || "" : "";
  return (
    modelName.toLowerCase() +
    " " +
    Object.entries(x)
      .filter(([k]) => !["activityLog", "priceSnapshot"].includes(k))
      .map(([, v]) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")))
      .join(" ")
      .toLowerCase()
  );
}

function dartRenderSection(key) {
  const sec = sectionsMap[key];
  if (!sec) return;
  const filtered = dartApplyFilters(key, sec.data);
  sec.render(filtered);
  dartUpdateMasterCheckbox(key, filtered);
  window.DartDashboardUI?.refresh?.();
  if (typeof dartUpdateFilterSummary === 'function') dartUpdateFilterSummary(key, filtered.length, sec.data.length);
}
// BEGIN Scoped dashboard refresh: one frame per burst, no hidden table construction.
let dartDashboardRenderQueued = false;
let dartDashboardReloadQueued = false;
function dartRefreshAll() {
  if (dartDashboardRenderQueued || document.hidden) return;
  dartDashboardRenderQueued = true;
  const render = () => {
    dartDashboardRenderQueued = false;
    if (document.hidden) return;
    if (dartDashboardReloadQueued) {
      dartDashboardReloadQueued = false;
      try { loadAllDataFromStorage(false); }
      catch { console.warn("Dashboard data could not be refreshed."); return; }
    }
    const active = document.querySelector(".dashboard-section.active-section")?.id;
    if (active && sectionsMap[active]) dartRenderSection(active);
    if (active === "brand") updateBrandAnalytics();
    if (active === "orders" || active === "brand") updateOrderCards();
    if (document.getElementById("notificationFeed")?.closest(".dashboard-section.active-section")) renderNotifications();
    window.DartFinance?.render?.();
  };
  if (window.requestAnimationFrame) window.requestAnimationFrame(render);
  else setTimeout(render, 0);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) dartRefreshAll(); });
// END Scoped dashboard refresh.
function renderAllSections() {
  dartRefreshAll();
}

// Extend the existing sectionsMap rather than replacing it.
sectionsMap.representative = {
  get data() {
    return representativeData;
  },
  set data(v) {
    representativeData = v;
  },
  render: renderRepresentative,
  storageKey: "dart_representatives",
};
sectionsMap.damage = {
  get data() {
    return damageData;
  },
  set data(v) {
    damageData = v;
  },
  render: renderDamage,
  storageKey: "dart_damage",
};

function dartArchiveRecord(key, id) {
  const sec = sectionsMap[key],
    x = sec?.data.find((v) => String(v.id) === String(id));
  if (!x) return;
  const old = dartIsArchived(x),
    snapshot = { ...x };
  dartSetArchived(x, !old);
  x.isChecked = false;
  if (key === "items" && !old && x.status === "Processing/Held" && x.orderId)
    dartRevalidateAllocatedItem(x, snapshot);
  dartAudit(
    old ? "RESTORE" : "ARCHIVE",
    key,
    id,
    { isArchived: old },
    { isArchived: !old },
  );
  dartSaveAll();
  dartRefreshAll();
}
function dartUpdateMasterCheckbox(key, viewData) {
  if (key === "items") return DartInventory.updateMaster();
  const sec = document.getElementById(key),
    master = sec?.querySelector(
      '.cont-titel .title-name input[type="checkbox"]',
    );
  if (!master) return;
  const visible = (
      viewData || dartApplyFilters(key, dartGetSectionData(key))
    ).filter(dartIsActive),
    selected = visible.filter((x) => x.isChecked);
  master.checked = visible.length > 0 && selected.length === visible.length;
  master.indeterminate =
    selected.length > 0 && selected.length < visible.length;
  if (key === "orders") {
    const n = document.getElementById("bulk-selected-count");
    if (n) n.textContent = `${selected.length} selected`;
  }
}
async function dartSyncBulkSection(key) {
  if (["models", "items"].includes(key)) {
    await window.DartCatalog?.syncAdminState?.();
    await window.DartCatalog?.hydrate?.(true);
    return;
  }
  if (key === "review") {
    for (const [domain, permission] of [["reviews", "reviews.manage"], ["contacts", "contacts.manage"]]) {
      if (!window.DartAdminAccess?.can?.(permission)) continue;
      await window.DartDomainState?.syncDomain?.(domain);
      await window.DartDomainState?.hydrateDomain?.(domain, true);
    }
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
  const domain = domainBySection[key];
  if (domain) {
    await window.DartDomainState?.syncDomain?.(domain);
    await window.DartDomainState?.hydrateDomain?.(domain, true);
  }
}

async function dartRollbackBulkSection(key) {
  if (["models", "items"].includes(key)) {
    await window.DartCatalog?.hydrate?.(true).catch(() => {});
    return;
  }
  if (key === "review") {
    for (const [domain, permission] of [["reviews", "reviews.read"], ["contacts", "contacts.read"]]) {
      if (window.DartAdminAccess?.can?.(permission)) await window.DartDomainState?.hydrateDomain?.(domain, true).catch(() => {});
    }
    return;
  }
  if (key === "orders") {
    await window.DartOrdersApi?.hydrate?.(true).catch(() => {});
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
  const domain = domainBySection[key];
  if (domain) {
    await window.DartDomainState?.hydrateDomain?.(domain, true).catch(() => {});
  }
}

async function dartBulkArchive(key, records) {
  if (!records.length) return { archived: 0, failed: [] };

  const serverMode = Boolean(window.DartAdminApi?.request);
  const failed = [];
  let archived = 0;

  if (serverMode && key === "orders" && window.DartOrdersApi?.stateAction) {
    for (const record of records) {
      try {
        await window.DartOrdersApi.stateAction(
          record.orderId || record.id,
          "archive",
        );
        archived += 1;
      } catch (error) {
        failed.push({
          id: record.orderId || record.id,
          message: error.message || "Order archive failed",
        });
      }
    }
    await window.DartOrdersApi.hydrate?.(true).catch(() => {});
    return { archived, failed };
  }

  if (
    serverMode &&
    ["customers", "representative"].includes(key)
  ) {
    const resource = key === "customers" ? "customers" : "representatives";
    const secure = records.filter((record) => record.serverAuthoritative);
    const legacy = records.filter((record) => !record.serverAuthoritative);

    for (const record of secure) {
      try {
        await window.DartAdminApi.request(
          `/api/v1/admin/${resource}/${encodeURIComponent(record.id)}/state`,
          { method: "POST", body: { action: "suspend" } },
        );
        archived += 1;
      } catch (error) {
        failed.push({
          id: record.clientId || record.repId || record.id,
          message: error.message || "Account suspension failed",
        });
      }
    }

    if (legacy.length) {
      const snapshots = legacy.map((record) => ({
        record,
        isArchived: record.isArchived,
        isDeleted: record.isDeleted,
        archivedAt: record.archivedAt,
      }));
      legacy.forEach((record) => {
        dartSetArchived(record, true);
        record.isChecked = false;
      });
      try {
        saveDataToStorage(sectionsMap[key].storageKey, sectionsMap[key].data);
        await dartSyncBulkSection(key);
        archived += legacy.length;
      } catch (error) {
        snapshots.forEach(({ record, isArchived, isDeleted, archivedAt }) => {
          record.isArchived = isArchived;
          record.isDeleted = isDeleted;
          record.archivedAt = archivedAt;
        });
        failed.push({
          id: "legacy-records",
          message: error.message || "Legacy CRM archive failed",
        });
      }
    }

    await window.DartDomainState?.hydrateDomain?.(
      key === "customers" ? "customers" : "representatives",
      true,
    ).catch(() => {});
    return { archived, failed };
  }

  const snapshots = records.map((record) => ({
    record,
    isArchived: record.isArchived,
    isDeleted: record.isDeleted,
    archivedAt: record.archivedAt,
  }));

  records.forEach((record) => {
    dartSetArchived(record, true);
    record.isChecked = false;
    dartAudit(
      "BULK_ARCHIVE",
      key,
      record.id,
      { isArchived: false },
      { isArchived: true },
    );
  });

  if (!serverMode) {
    dartSaveAll();
    return { archived: records.length, failed };
  }

  try {
    saveDataToStorage(sectionsMap[key].storageKey, sectionsMap[key].data);
    await dartSyncBulkSection(key);
    archived = records.length;
  } catch (error) {
    snapshots.forEach(({ record, isArchived, isDeleted, archivedAt }) => {
      record.isArchived = isArchived;
      record.isDeleted = isDeleted;
      record.archivedAt = archivedAt;
    });
    await dartRollbackBulkSection(key);
    failed.push({
      id: "bulk",
      message: error.message || "Bulk archive was not committed",
    });
  }

  return { archived, failed };
}

function setupHeaderBatchActions() {
  if (document.documentElement.dataset.dartBatchReady) return;
  document.documentElement.dataset.dartBatchReady = "1";

  document.addEventListener("change", (e) => {
    if (!e.target.matches('.cont-titel .title-name input[type="checkbox"]'))
      return;
    const sec = e.target.closest(".dashboard-section"),
      key = sec?.id,
      info = sectionsMap[key];
    if (!info) return;
    const visible = (
      key === "items"
        ? DartInventory.visibleItems()
        : dartApplyFilters(key, info.data)
    ).filter(dartIsActive);
    visible.forEach((x) => (x.isChecked = e.target.checked));
    dartRenderSection(key);
  });

  document.addEventListener("click", async (e) => {
    const viewButton = e.target.closest("[data-orders-view-toggle]");
    if (viewButton) {
      dartOrdersView = dartOrdersView === "groups" ? "all" : "groups";
      viewButton.setAttribute("aria-pressed", String(dartOrdersView === "groups"));
      viewButton.classList.toggle("is-active", dartOrdersView === "groups");
      viewButton.querySelector("span").textContent =
        dartOrdersView === "groups" ? "All Orders" : "Groups";
      renderOrders(dartApplyFilters("orders", ordersData));
      return;
    }
    const btn = e.target.closest(".dashboard-section .second .delete-btn");
    if (!btn) return;

    const key = btn.closest(".dashboard-section")?.id,
      info = sectionsMap[key];
    if (!info) return;

    const visibleIds = new Set(
      (key === "items"
        ? DartInventory.visibleItems()
        : dartApplyFilters(key, info.data)
      )
        .filter(dartIsActive)
        .map((x) => String(x.id)),
    );
    const selected = info.data.filter(
      (record) =>
        record.isChecked && visibleIds.has(String(record.id)),
    );
    if (!selected.length) return;

    btn.disabled = true;
    try {
      const result = await dartBulkArchive(key, selected);
      selected.forEach((record) => {
        record.isChecked = false;
      });
      dartRefreshAll();

      if (result.failed.length) {
        window.DartDialog.alert(
          `${result.archived} archived successfully. ${result.failed.length} failed:\n` +
            result.failed
              .map((row) => `${row.id}: ${row.message}`)
              .join("\n"),
        );
      }
    } finally {
      btn.disabled = false;
    }
  });
}


