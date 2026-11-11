/* Lazy customer history and Owner discount editor. */
(function (root) {
  "use strict";
  const doc = root.document;
  function button(text, className) { const node = doc.createElement("button"); node.type = "button"; node.textContent = text; node.className = className; return node; }
  const notify = (...args) => root.DartDashboardUI?.notify(...args);
  function confirmCancellation() {
    return new Promise(resolve => {
      const confirmation = doc.createElement("dialog"); confirmation.className = "dart-client-confirm";
      confirmation.setAttribute("aria-label", "Cancel customer discount");
      const title = doc.createElement("h2"); title.textContent = "Cancel this unused customer discount?";
      const keep = button("Keep discount", "dart-client-tool"); const cancel = button("Confirm cancellation", "dart-client-tool");
      keep.onclick = () => confirmation.close("keep"); cancel.onclick = () => confirmation.close("confirm");
      confirmation.append(title, keep, cancel); doc.body.append(confirmation);
      confirmation.addEventListener("close", () => { const confirmed = confirmation.returnValue === "confirm"; confirmation.remove(); resolve(confirmed); }, { once: true });
      confirmation.showModal(); keep.focus();
    });
  }
  // Customer sections load independently. No private data or financial state is persisted in the browser.
  let customerEpoch = 0;
  const clientDefinitions = {
    orders: ["Orders", "orders.read"], reviews: ["Ratings & Feedback", "reviews.read"],
    waiting: ["Waiting", "waiting.read"], returns: ["Returns & Exchanges", "returns.read"], discounts: ["Discounts", "promotions.read"],
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const clientMoney = minor => `${new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(minor || 0) / 100)} EGP`;
  const clientDate = value => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(date) : "—"; };
  function clientTable(headers, rows) {
    return `<div class="dart-client-table-wrap"><table class="dart-client-table"><thead><tr>${headers.map(label => `<th scope="col">${esc(label)}</th>`).join("")}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function clientRows(section, rows) {
    if (!rows.length) return '<p class="dart-empty-state">No records</p>';
    if (section === "orders") return clientTable(["Order / Items", "Amount after discounts", "Date", "Status"], rows.map(row => [
      `<button type="button" class="dart-client-order" data-client-order="${esc(row.orderId)}">${esc(row.orderId)}</button><small>${(row.items || []).map(item => esc([item.itemCode, item.name, item.color, item.size].filter(Boolean).join(" · ")) + ` — ${clientMoney(item.finalMinor)}`).join("<br>") || "—"}</small>`,
      `${clientMoney(row.finalMinor)}${Number(row.refundedMinor) ? `<small>Refunded: ${clientMoney(row.refundedMinor)}</small>` : ""}`, esc(clientDate(row.date)), esc(row.status) + (row.archived ? " · Archived" : ""),
    ]));
    if (section === "reviews") return clientTable(["Rating", "Feedback", "Date", "Status"], rows.map(row => [
      esc(row.rating ? `${row.rating}/5` : "—"), `<b>${esc(row.title)}</b><p>${esc(row.review || row.message)}</p>${row.orderId ? `<small>${esc(row.orderId)}</small>` : ""}`, esc(clientDate(row.createdAt || row.date)), esc(row.status),
    ]));
    if (section === "waiting") return clientTable(["Model / Set", "Color / Size", "Date", "Status"], rows.map(row => [
      `${esc(row.name)}<small>${esc(row.modelId)} · ${Number(row.pieceCount || 1)} pieces</small>`, esc([row.color, row.size].filter(Boolean).join(" · ") || (row.selections || []).map(line => [line.modelId, line.color, line.size].filter(Boolean).join(" · ")).join(" / ") || "Set"), esc(clientDate(row.date)), `${esc(row.status)}${row.reservedUntil ? `<small>Until ${esc(clientDate(row.reservedUntil))}</small>` : ""}`,
    ]));
    if (section === "returns") return clientTable(["Item / Order", "Type / Replacement", "Reason", "Status / Date"], rows.map(row => [
      `${esc(row.itemCode)}<small>${esc(row.orderId)}</small>`, `${esc(row.requestType)}<small>${esc([row.replacementItemCode || row.exchangeItemCode, row.requestedColor, row.requestedSize].filter(Boolean).join(" · "))}</small>`,
      esc(row.reason), `${esc(row.status)}<small>${esc(row.inspectionStatus || "")} · ${esc(clientDate(row.createdAt || row.date))}</small>`,
    ]));
    return clientTable(["Manual discount", "Value / Pieces", "Validity", "Status / Actions"], rows.map(row => [
      esc(row.name), `${row.kind === "percent" ? `${Number(row.value) / 100}%` : clientMoney(row.value)}<small>Up to ${Number(row.pieceLimit)} pieces · One order</small>`,
      `${esc(clientDate(row.startsOn))} — ${esc(clientDate(row.endsOn))}`,
      `${esc(row.status === "Active" && row.endsOn < new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) ? "Expired" : row.status)}${row.orderId ? `<small>${esc(row.orderId)}</small>` : ""}${row.status === "Active" ? `<span class="dart-client-manual-actions" data-manual-actions="${esc(row.id)}"></span>` : ""}`,
    ]));
  }
  function installCustomerDetails(dialog, general, ref, context) {
    const selection = context.selection;
    const customer = context.customer;
    if (customer) {
      const extra = doc.createElement("div"); extra.className = "dart-client-panel-body";
      const phones = [...new Set(customer.contactPhones || [])];
      const addresses = customer.addresses || [];
      extra.innerHTML = `${customer.identityConflict ? '<p role="alert">Identity conflict: review the primary phone and email before merging this customer.</p>' : ''}
        <h3>Contact numbers</h3><p>${phones.length ? phones.map(esc).join(" · ") : "No additional numbers"}</p>
        <h3>Address history</h3>${addresses.length ? clientTable(["Address", "Source", "Date"], addresses.map(record => [
          esc(record.address?.fullAddress || [record.address?.building,record.address?.street,record.address?.area,record.address?.governorate,record.address?.country].filter(Boolean).join(" · ")),
          esc(String(record.source || "").startsWith("order:") ? "Order" : "Saved address"), esc(clientDate(record.date)),
        ])) : '<p>No saved addresses</p>'}`;
      general.append(extra);
    }
    const epoch = customerEpoch;
    const container = doc.createElement("div"); container.className = "dart-client-panels";
    const first = doc.createElement("details"); first.dataset.clientPanel = "general"; first.open = true;
    const summary = doc.createElement("summary"); summary.textContent = "General Information"; first.append(summary, general); container.append(first);
    function remember(panel) {
      if (selection()?.key === ref) { if (panel.open) selection().panels.add(panel.dataset.clientPanel); else selection().panels.delete(panel.dataset.clientPanel); }
    }
    first.addEventListener("toggle", () => remember(first));
    Object.entries(clientDefinitions).forEach(([section, [title, permission]]) => {
      const panel = doc.createElement("details"); panel.dataset.clientPanel = section;
      const heading = doc.createElement("summary"); heading.textContent = title;
      const body = doc.createElement("div"); body.className = "dart-client-panel-body"; body.setAttribute("aria-live", "polite");
      const content = doc.createElement("div"); const tools = doc.createElement("div"); tools.className = "dart-client-section-tools";
      body.append(tools, content); panel.append(heading, body); container.append(panel);
      let loaded = false, busy = false, nextOffset = null, rows = [], lastData = null, generation = 0;
      const current = () => epoch === customerEpoch && dialog.isConnected && !doc.body.classList.contains("dart-admin-locked");
      const request = (path, options) => root.DartAdminApi.request(`/api/v1/admin/customers/${encodeURIComponent(ref)}${path}`, options);
      async function load(offset = 0) {
        if (busy || !current()) return;
        if (root.DartAdminAccess?.can?.(permission) !== true) { content.textContent = "You do not have access to this section."; return; }
        busy = true; body.setAttribute("aria-busy", "true");
        const turn = ++generation;
        if (!loaded) content.textContent = "Loading…";
        tools.replaceChildren();
        try {
          const data = await request(`/details/${section}?offset=${offset}`);
          if (!current() || turn !== generation) return;
          rows = offset ? [...rows, ...data.rows] : data.rows; nextOffset = data.nextOffset; lastData = data; loaded = true;
          render(data);
        } catch {
          if (!current() || turn !== generation) return;
          if (!loaded) content.textContent = "Unable to load this section. Try again.";
          const retry = button("Retry", "dart-client-tool"); retry.addEventListener("click", () => load(offset)); tools.append(retry);
        } finally { if (turn === generation) { busy = false; body.removeAttribute("aria-busy"); } }
      }
      function render(data) {
        tools.replaceChildren();
        const refresh = button("Refresh", "dart-client-tool"); refresh.addEventListener("click", () => load()); tools.append(refresh);
        heading.textContent = section === "waiting" ? `${title} · ${Number(data.pieces || 0)} pieces` : title;
        content.innerHTML = clientRows(section, rows);
        if (section === "discounts") {
          const benefits = [...(data.campaigns || []), ...(data.benefits || [])];
          const active = doc.createElement("div"); active.className = "dart-client-benefits";
          active.innerHTML = `<h3>Active benefits</h3>${benefits.length ? benefits.map(benefit => `<article><b>${esc(benefit.name)}</b> · ${Number(benefit.discountPercent)}%<small>${esc(benefit.type)}${benefit.code ? ` · ${esc(benefit.code)}` : ""}${benefit.remaining !== undefined ? ` · ${Number(benefit.remaining)} pieces remaining` : ""}${benefit.expiresAt ? ` · Until ${esc(clientDate(benefit.expiresAt))}` : ""}${benefit.minQuantity ? ` · Minimum ${Number(benefit.minQuantity)} pieces` : ""}${benefit.minOrderMinor ? ` · Minimum ${clientMoney(benefit.minOrderMinor)}` : ""}${benefit.productScope?.mode !== "all" && benefit.productScope ? ` · ${esc(benefit.productScope.mode)}: ${benefit.productScope.values.map(esc).join(", ")}` : ""}</small></article>`).join("") : "<p>No active benefits</p>"}<p>Priority: Item → Campaign → Manual → Birthday → Dart Card. One discount per piece.</p>`;
          content.prepend(active);
          if (data.canManageManual && root.DartAdminAccess?.can?.("promotions.manage") === true) {
            const add = button("Add manual discount", "dart-client-tool"); add.addEventListener("click", () => edit()); tools.append(add);
            rows.filter(row => row.status === "Active").forEach(row => {
              const slot = [...content.querySelectorAll("[data-manual-actions]")].find(node => node.dataset.manualActions === row.id);
              if (!slot) return;
              const change = button("Edit", "dart-client-tool"); change.addEventListener("click", () => edit(row));
              const cancel = button("Cancel discount", "dart-client-tool"); cancel.addEventListener("click", async () => {
                if (!await confirmCancellation()) return;
                if (!current()) return; cancel.disabled = true;
                try { await request(`/manual-discounts/${encodeURIComponent(row.id)}`, { method: "PUT", body: { expectedVersion: Number(row.version), discount: null } }); await load(); }
                catch { if (current()) { notify("Discount could not be cancelled. Refresh and retry.", "warning"); cancel.disabled = false; } }
              }); slot.append(change, cancel);
            });
          }
        }
        if (nextOffset !== null && nextOffset !== undefined) {
          const more = button("Load more", "dart-client-tool"); more.addEventListener("click", () => load(nextOffset)); tools.append(more);
        }
        content.querySelectorAll("[data-client-order]").forEach(order => order.addEventListener("click", async () => {
          order.disabled = true;
          try { await root.dartOpenCustomerOrder(order.dataset.clientOrder); }
          catch { if (current()) { notify("Order details could not be opened. Try again.", "warning"); order.disabled = false; } }
        }));
        content.querySelectorAll("[data-client-order]").forEach(order => order.closest("tr").addEventListener("click", event => {
          if (!event.target.closest("button,a,input,select")) order.click();
        }));
      }
      function edit(row) {
        if (!current() || !lastData?.canManageManual) return;
        content.querySelector(".dart-client-discount-form")?.remove();
        const form = doc.createElement("form"); form.className = "dart-client-discount-form";
        form.innerHTML = `<h3>${row ? "Edit" : "Add"} manual discount</h3><label>Discount name<input name="name" required minlength="2" maxlength="160"></label><label>Type<select name="kind"><option value="percent">Percentage</option><option value="amount">Amount (EGP)</option></select></label><label>Value<input name="value" type="number" min="0.01" step="0.01" required></label><label>Start date<input name="startsOn" type="date" required></label><label>End date<input name="endsOn" type="date" required></label><label>Maximum pieces in one order<input name="pieceLimit" type="number" min="1" max="100" step="1" required></label><p class="dart-client-form-status" role="status"></p><div><button type="submit">Save discount</button><button type="button" data-form-close>Close form</button></div>`;
        const values = row ? { ...row, value: Number(row.value) / 100 } : selection()?.draft || { kind: "percent", pieceLimit: 1 };
        Object.entries(values).forEach(([key, value]) => { if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value; });
        const id = row?.id || root.crypto.randomUUID();
        form.addEventListener("input", () => { if (!row && selection()?.key === ref) selection().draft = Object.fromEntries(new FormData(form)); });
        form.querySelector("[data-form-close]").addEventListener("click", () => { if (selection()?.key === ref) selection().draft = null; form.remove(); });
        form.addEventListener("submit", async event => {
          event.preventDefault(); if (form.dataset.saving || !current()) return;
          const fields = Object.fromEntries(new FormData(form));
          const discount = { name: fields.name.trim(), kind: fields.kind, value: Math.round(Number(fields.value) * 100), startsOn: fields.startsOn, endsOn: fields.endsOn, pieceLimit: Number(fields.pieceLimit) };
          const status = form.querySelector("[role=status]");
          if (discount.endsOn < discount.startsOn || discount.value < 1 || (discount.kind === "percent" && discount.value > 10000)) { status.textContent = "Check the value and validity dates."; return; }
          form.dataset.saving = "1"; form.querySelectorAll("button,input,select").forEach(node => { node.disabled = true; }); status.textContent = "Saving…";
          try {
            await request(`/manual-discounts${row ? `/${encodeURIComponent(id)}` : ""}`, { method: row ? "PUT" : "POST", body: row ? { expectedVersion: Number(row.version), discount } : { id, discount } });
            if (!current()) return;
            if (selection()?.key === ref) selection().draft = null;
            await load(); notify("Customer discount saved.");
          } catch (error) {
            if (!current()) return;
            status.textContent = error.code === "DISCOUNT_OVERLAP" ? "Another manual discount covers these dates. Edit it or choose different dates." : "Unable to save. Refresh if the discount changed, then retry.";
            delete form.dataset.saving; form.querySelectorAll("button,input,select").forEach(node => { node.disabled = false; });
          }
        });
        content.prepend(form); form.elements.namedItem("name").focus();
      }
      panel.addEventListener("toggle", () => { remember(panel); if (panel.open && !loaded && !busy) void load(); });
    });
    dialog.replaceChildren(dialog.firstElementChild, container);
    container.querySelectorAll("[data-client-panel]").forEach(panel => { panel.open = selection()?.panels?.has(panel.dataset.clientPanel) || false; });
  }
  root.addEventListener("dart:admin-logged-out", () => { customerEpoch++; doc.querySelectorAll(".dart-client-confirm[open]").forEach(node => node.close("keep")); doc.querySelectorAll(".dart-client-panel-body").forEach(node => node.replaceChildren()); });
  async function dartOpenCustomerOrder(ref) {
    if (window.DartAdminAccess?.can?.("orders.read") !== true) throw new Error("Order access is unavailable");
    if (!ordersData.some((order) => [String(order.id), String(order.orderId)].includes(String(ref)))) {
      await window.DartOrdersApi?.hydrate?.(true);
      loadAllDataFromStorage(false);
    }
    const order = ordersData.find((row) => [String(row.id), String(row.orderId)].includes(String(ref)));
    if (!order) throw new Error("Order is no longer available");
    dartOrdersView = "all";
    dartFilterState.orders = { search: String(order.orderId || ref).toLowerCase(), archive: "all" };
    const section = document.getElementById("orders");
    section?.querySelectorAll("select[data-filter-key]").forEach((node) => { node.value = "all"; });
    const search = section?.querySelector(".search-box input");
    if (search) search.value = order.orderId || ref;
    const view = section?.querySelector("[data-orders-view-toggle]");
    if (view) { view.setAttribute("aria-pressed", "false"); view.classList.remove("is-active"); const label = view.querySelector("span"); if (label) label.textContent = "Groups"; }
    document.querySelectorAll(".dart-record-dialog[open]").forEach((dialog) => dialog.close());
    window.dartNavigateSection?.("orders");
    dartRenderSection("orders");
    const trigger = [...document.querySelectorAll("#orders .model-row")].find(row => String(row.dataset.id) === String(order.id))?.querySelector(".dart-record-open");
    if (!trigger) throw new Error("Order details are unavailable");
    trigger.click();
  }

  root.dartOpenCustomerOrder = dartOpenCustomerOrder;
  root.DartCustomerDetails = Object.freeze({ install: installCustomerDetails });
})(window);
