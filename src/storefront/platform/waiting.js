  function waitingEntries() {
    return waitingEntriesCache.map((entry) => ({ ...entry }));
  }

  function waitingToast(message) {
    if (typeof window.showToast === "function") {
      window.showToast(message);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("dart:waiting-notice", {
        detail: { message },
      }),
    );
  }

  function announceNewWaitingReservations(entries) {
    let seen = new Set();
    try {
      seen = new Set(
        JSON.parse(
          sessionStorage.getItem("dart_waiting_seen_reservations") || "[]",
        ),
      );
    } catch {}
    let changed = false;
    for (const entry of entries) {
      if (entry.status !== "reserved" || seen.has(entry.id)) continue;
      seen.add(entry.id);
      changed = true;
      const alternative =
        entry.allocation?.matchType === "alternative_color";
      notify(
        alternative ? "waiting_alternative" : "waiting_available",
        alternative ? "Alternative color available" : "Your item is ready",
        alternative
          ? `${entry.modelName || entry.modelId} — ${entry.allocation?.offeredColor || "-"} / ${entry.size}`
          : `${entry.modelName || entry.modelId} — ${entry.color} / ${entry.size}`,
        "waiting",
        entry.id,
      );
      waitingToast(
        alternative
          ? "في لون بديل متاح ومحجوز لك مؤقتًا. افتح My Waiting."
          : "قطعتك أصبحت متاحة وتم حجزها لك مؤقتًا. افتح My Waiting.",
      );
    }
    if (changed) {
      try {
        sessionStorage.setItem(
          "dart_waiting_seen_reservations",
          JSON.stringify([...seen].slice(-100)),
        );
      } catch {}
    }
  }

  async function hydrateWaiting(force = false) {
    if (!API_BASE || !currentUser()) {
      waitingEntriesCache = [];
      renderProfileWaiting();
      return [];
    }
    if (waitingPromise && !force) return waitingPromise;
    const task = (async () => {
      const payload = await apiRequest("/api/v1/me/waiting");
      waitingEntriesCache = Array.isArray(payload?.entries)
        ? payload.entries
        : [];
      announceNewWaitingReservations(waitingEntriesCache);
      renderProfileWaiting();
      window.dispatchEvent(
        new CustomEvent("dart:waiting-hydrated", {
          detail: { entries: waitingEntries() },
        }),
      );
      return waitingEntries();
    })();
    waitingPromise = task;
    try {
      return await task;
    } finally {
      if (waitingPromise === task) waitingPromise = null;
    }
  }

  async function joinWaiting(modelId, size, color) {
    const payload = await apiRequest("/api/v1/me/waiting", {
      method: "POST",
      body: { modelId, size, color },
    });
    await hydrateWaiting(true);
    return payload.entry;
  }

  async function cancelWaiting(entryId) {
    const payload = await apiRequest(
      `/api/v1/me/waiting/${encodeURIComponent(entryId)}`,
      { method: "DELETE" },
    );
    await hydrateWaiting(true);
    return payload.entry;
  }

  async function confirmWaiting(entryId) {
    const payload = await apiRequest(
      `/api/v1/me/waiting/${encodeURIComponent(entryId)}/confirm`,
      { method: "POST", body: {} },
    );
    await hydrateCustomerCart();
    await hydrateWaiting(true);
    return payload.entry;
  }

  async function declineWaitingAlternative(entryId) {
    const payload = await apiRequest(
      `/api/v1/me/waiting/${encodeURIComponent(entryId)}/decline-alternative`,
      { method: "POST", body: {} },
    );
    await hydrateWaiting(true);
    return payload.entry;
  }

  function waitingStatusLabel(entry) {
    const labels = {
      waiting: "Waiting",
      reserved: "Reserved for you",
      confirmed: "Added to cart",
      converted: "Ordered",
      expired: "Reservation expired",
      cancelled: "Cancelled",
    };
    return labels[entry?.status] || entry?.status || "-";
  }

  function renderProfileWaiting() {
    const list = document.getElementById("profileWaitingList");
    if (!list) return;
    const entries = waitingEntriesCache
      .slice()
      .sort(
        (a, b) =>
          new Date(b.requestedAt || 0) -
          new Date(a.requestedAt || 0),
      );
    if (!entries.length) {
      list.innerHTML =
        '<div class="empty-state">No Waiting requests yet</div>';
      return;
    }
    list.innerHTML = entries
      .map((entry) => {
        const allocation = entry.allocation || null;
        const alternative =
          allocation?.matchType === "alternative_color";
        const actionButtons = [];
        if (entry.status === "waiting") {
          actionButtons.push(
            `<button type="button" class="dart-waiting-action is-danger" data-waiting-action="cancel" data-waiting-id="${escapeHtml(entry.id)}">Cancel Waiting</button>`,
          );
        } else if (entry.status === "reserved") {
          actionButtons.push(
            `<button type="button" class="dart-waiting-action is-primary" data-waiting-action="confirm" data-waiting-id="${escapeHtml(entry.id)}">${alternative ? "Accept alternative" : "Add reserved item to cart"}</button>`,
          );
          if (alternative) {
            actionButtons.push(
              `<button type="button" class="dart-waiting-action" data-waiting-action="decline" data-waiting-id="${escapeHtml(entry.id)}">Keep waiting for my color</button>`,
            );
          }
          actionButtons.push(
            `<button type="button" class="dart-waiting-action is-danger" data-waiting-action="cancel" data-waiting-id="${escapeHtml(entry.id)}">Cancel Waiting</button>`,
          );
        }
        return `<article class="profile-record-card dart-waiting-card" data-waiting-record-id="${escapeHtml(entry.id)}">
          <div class="profile-record-head">
            <strong>${escapeHtml(entry.modelName || entry.modelId)}</strong>
            <span class="profile-status">${escapeHtml(waitingStatusLabel(entry))}</span>
          </div>
          <div class="profile-record-grid">
            ${profileField("Model code", entry.modelId || "-")}
            ${profileField("Requested color", entry.color || "-")}
            ${profileField("Size", entry.size || "-")}
            ${profileField("Queue position", entry.queuePosition ? `#${entry.queuePosition}` : "-")}
            ${profileField("Requested", formatDateTime(entry.requestedAt))}
            ${profileField("Notified", formatDateTime(entry.notifiedAt))}
            ${profileField("Reservation expires", formatDateTime(entry.reservationExpiry))}
            ${profileField("Reserved color", allocation?.offeredColor || "-")}
            ${profileField("Match", alternative ? "Alternative color" : allocation ? "Exact" : "-")}
            ${profileField("Order", entry.orderCode || "-")}
          </div>
          ${actionButtons.length ? `<div class="dart-waiting-actions">${actionButtons.join("")}</div>` : ""}
        </article>`;
      })
      .join("");
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-waiting-action]");
    if (!button) return;
    const entryId = String(button.dataset.waitingId || "");
    const action = String(button.dataset.waitingAction || "");
    if (!entryId || !action) return;
    button.disabled = true;
    try {
      if (action === "cancel") {
        await cancelWaiting(entryId);
        waitingToast("تم إلغاء الانتظار.");
      } else if (action === "confirm") {
        await confirmWaiting(entryId);
        waitingToast("تمت إضافة القطعة المحجوزة إلى السلة.");
      } else if (action === "decline") {
        await declineWaitingAlternative(entryId);
        waitingToast("تم رفض اللون البديل، وستظل منتظرًا للون المطلوب.");
      }
    } catch (error) {
      waitingToast(error?.message || "تعذر تحديث Waiting.");
    } finally {
      button.disabled = false;
      renderProfileWaiting();
    }
  });

