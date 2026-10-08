// DART CODE GUIDE | Eye/dart-news-admin.js
// News management uses dedicated API writes, version checks and server-confirmed archiving.
(function (root) {
  "use strict";
  const doc = root.document, section = doc.getElementById("news");
  if (!section) return;
  const byId = id => doc.getElementById(id);
  const editor = byId("news-editor"), form = byId("news-form"), container = byId("news-rows");
  const selected = new Set();
  const can = permission => root.DartAdminAccess?.can?.(permission) === true;
  const readable = () => can("news.read") || can("news.manage");
  const api = (path, options) => root.DartAdminApi.request(path, options);
  let rows = [], record = null, newId = "", coverAssetId = "", previewUrl = "", pendingAssetId = "";
  let offset = 0, nextOffset = null, generation = 0, searchTimer = 0, busy = false, editorFocus = null;
  let editorOverflow = "", uploadVersion = 0, uploadedVersion = -1, editorGeneration = 0;
  const writable = () => can("news.manage") && !doc.body.classList.contains("dart-admin-locked");
  function inputError(text) { const error = new Error(text); error.newsInput = true; return error; }
  function message(text, error = false, node = byId("news-message")) {
    node.textContent = text; node.classList.toggle("is-error", error);
  }
  function errorMessage(error) {
    if (error?.status === 409) return "This News changed in another session. Reload the latest News before trying again.";
    if (error?.status === 403) return "Your Staff account does not have permission for this action.";
    if (error?.status === 401) return "Your session expired. Sign in again.";
    if (error?.status === 422) return "Check the title, text, display order and cover image before saving.";
    return "Unable to complete this News action. Please try again.";
  }
  const date = value => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "—";
  function syncSelection() {
    const eligible = rows.filter(row => !row.isArchived), count = eligible.filter(row => selected.has(row.newsId)).length;
    const all = byId("news-select-all"); all.checked = eligible.length > 0 && count === eligible.length;
    all.indeterminate = count > 0 && count < eligible.length; all.disabled = busy || !can("news.manage") || !eligible.length;
    byId("news-delete").disabled = busy || !can("news.manage") || count === 0;
  }
  function render() {
    const template = byId("news-row-template");
    container.replaceChildren(...rows.map(row => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.newsId = row.newsId;
      node.classList.toggle("is-archived", row.isArchived);
      const checkbox = node.querySelector("[data-news-select]");
      checkbox.checked = selected.has(row.newsId); checkbox.disabled = row.isArchived || !can("news.manage") || busy;
      const image = node.querySelector("[data-news-photo]"); image.src = root.DartNews.source(row.imageUrl); image.alt = row.title;
      node.querySelectorAll("[data-news-cell]").forEach(cell => {
        const field = cell.dataset.newsCell;
        cell.textContent = field === "status" ? row.isArchived ? `Archived / ${row.status}` : row.status :
          field.endsWith("At") ? date(row[field]) : row[field] ?? "Newest first";
      });
      node.querySelector('[data-news-action="edit"]').hidden = !can("news.manage") || row.isArchived;
      const state = node.querySelector('[data-news-action="state"]');
      state.hidden = !can("news.manage"); state.title = state.ariaLabel = row.isArchived ? "Restore News" : "Archive News";
      state.firstElementChild.className = row.isArchived ? "fa-solid fa-rotate-left" : "fa-solid fa-box-archive";
      node.querySelectorAll("button").forEach(button => { button.disabled = busy; });
      return node;
    }));
    syncSelection();
  }
  async function load(reset = false) {
    if (!readable() || busy) return;
    if (reset) { offset = 0; selected.clear(); }
    const current = ++generation;
    const query = new URLSearchParams({ q: byId("news-search").value.trim(), status: byId("news-status").value,
      archive: byId("news-archive").value, offset: String(offset), limit: "50" });
    message("Loading News…"); byId("news-retry").hidden = true;
    byId("news-page-prev").disabled = byId("news-page-next").disabled = true;
    try {
      const payload = await api(`/api/v1/admin/news?${query}`);
      if (current !== generation || !readable()) return;
      rows = payload.news; nextOffset = payload.nextOffset; render();
      message(rows.length ? "" : "No News matches these filters.");
      byId("news-page-count").textContent = `${rows.length ? offset + 1 : 0}–${offset + rows.length} / ${payload.total}`;
      byId("news-page-prev").disabled = offset === 0; byId("news-page-next").disabled = nextOffset === null;
    } catch (error) {
      if (current !== generation) return;
      rows = []; render(); message(errorMessage(error), true); byId("news-retry").hidden = false;
    }
  }
  function cleanPreview() { if (previewUrl) root.URL.revokeObjectURL(previewUrl); previewUrl = ""; }
  function openEditor(row = null) {
    if (!can("news.manage") || busy) return;
    cleanPreview(); ++editorGeneration; ++uploadVersion; uploadedVersion = -1; pendingAssetId = ""; form.reset();
    record = row; newId = row?.newsId || `NEWS-${root.crypto.randomUUID()}`; coverAssetId = row?.coverAssetId || "";
    byId("news-editor-title").textContent = row ? "Edit News" : "Add News";
    ["title", "excerpt", "body", "status", "sortOrder"].forEach(field => { form.elements[field].value = row?.[field] ?? (field === "status" ? "draft" : ""); });
    const preview = byId("news-cover-preview"); preview.hidden = !row; if (row) preview.src = root.DartNews.source(row.imageUrl);
    message("", false, byId("news-form-message")); byId("news-reload-record").hidden = true;
    if (!editor.open) {
      editorFocus = doc.activeElement; editorOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden";
      editor.showModal();
    }
    form.elements.title.focus();
  }
  async function compress(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) throw inputError("Choose a JPG, PNG or WebP image smaller than 20 MB.");
    const bitmap = await root.createImageBitmap(file);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = doc.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.84));
      if (!blob || blob.size > 4 * 1024 * 1024) throw inputError("The compressed image is too large. Choose a smaller image.");
      const data = await new Promise((resolve, reject) => { const reader = new root.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { base64: String(data).split(",")[1], contentType: blob.type };
    } finally { bitmap.close(); }
  }
  form.elements.cover.addEventListener("change", () => {
    cleanPreview(); ++uploadVersion; pendingAssetId = ""; coverAssetId = record?.coverAssetId || "";
    const file = form.elements.cover.files[0], preview = byId("news-cover-preview");
    if (file) { previewUrl = root.URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false; }
    else { preview.hidden = !record; if (record) preview.src = root.DartNews.source(record.imageUrl); }
  });
  function setBusy(value) {
    busy = value; form.querySelectorAll("input,textarea,select,button").forEach(node => { node.disabled = value; });
    editor.querySelector("[data-news-editor-close]").disabled = value;
    byId("news-add").disabled = value;
    section.querySelectorAll(".first input,.first select").forEach(node => { node.disabled = value; }); render();
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !can("news.manage") || !form.reportValidity()) return;
    const title = form.elements.title.value.trim(), body = form.elements.body.value.trim();
    if (!title || !body) { message("Title and Full News are required.", true, byId("news-form-message")); return; }
    const input = { title, body, excerpt: form.elements.excerpt.value.trim(), status: form.elements.status.value,
      sortOrder: form.elements.sortOrder.value === "" ? null : Number(form.elements.sortOrder.value) };
    const file = form.elements.cover.files[0], upload = uploadVersion, operation = editorGeneration;
    setBusy(true); ++generation; message("Saving News…", false, byId("news-form-message"));
    try {
      if (file && uploadedVersion !== uploadVersion) {
        const image = await compress(file);
        if (operation !== editorGeneration || !writable()) return;
        const assetId = pendingAssetId ||= `NEWSIMG-UPLOADED-${root.crypto.randomUUID()}`;
        const result = await api("/api/v1/admin/news/assets", { method: "PUT", body: { assetId, originalName: file.name, ...image } });
        if (operation !== editorGeneration || !writable()) return;
        if (upload !== uploadVersion) throw inputError("The image changed. Please try again.");
        coverAssetId = result.id; uploadedVersion = uploadVersion;
      }
      if (operation !== editorGeneration || !writable()) return;
      if (!coverAssetId) throw inputError("Choose a cover image before saving News.");
      const payload = await api(`/api/v1/admin/news${record ? `/${encodeURIComponent(record.newsId)}` : ""}`, {
        method: record ? "PUT" : "POST", body: { ...input, coverAssetId, ...(record ? { expectedVersion: record.version } : { newsId: newId }) },
      });
      if (operation !== editorGeneration || !writable()) return;
      // A confirmed write stays successful even when the follow-up list refresh fails.
      record = payload.news; editor.close(); message("News saved.");
    } catch (error) {
      if (operation !== editorGeneration || !writable()) return;
      const localMessage = error?.newsInput ? error.message : errorMessage(error);
      message(localMessage || "Unable to save News.", true, byId("news-form-message"));
      byId("news-reload-record").hidden = error?.status !== 409 || !record;
    } finally { setBusy(false); }
    if (!editor.open) void load(false);
  });
  editor.querySelectorAll("[data-news-editor-close]").forEach(button => button.addEventListener("click", () => { if (!busy) editor.close(); }));
  editor.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  editor.addEventListener("close", () => { cleanPreview(); doc.body.style.overflow = editorOverflow; editorFocus?.focus?.({ preventScroll: true }); });
  byId("news-reload-record").addEventListener("click", async () => {
    if (!record || busy) return;
    try { const result = await api(`/api/v1/admin/news/${encodeURIComponent(record.newsId)}`);
      if (result.news.isArchived) { message("This News was archived in another session. Restore it before editing.", true, byId("news-form-message")); return; }
      openEditor(result.news);
    } catch (error) { message(errorMessage(error), true, byId("news-form-message")); }
  });
  async function stateAction(targets, action) {
    if (busy || !can("news.manage") || !targets.length) return;
    // Lock before confirmation to prevent double-clicking from enqueueing multiple prompts.
    setBusy(true); ++generation;
    let completed = 0, failed = 0;
    try {
      if (!await root.DartDialog.confirm(action === "archive" ? `Archive ${targets.length} News? They will disappear from the website and remain in the dashboard.` : "Restore this News? Published News will appear on the website again.")) return;
      for (const row of targets) {
        if (!writable()) break;
        try {
          await api(`/api/v1/admin/news/${encodeURIComponent(row.newsId)}/state`, { method: "POST", body: { action, expectedVersion: row.version } });
          selected.delete(row.newsId); completed++;
        } catch { failed++; }
      }
      message(`${completed} ${action === "archive" ? "archived" : "restored"}.${failed ? ` ${failed} failed; reload and try again.` : ""}`, failed > 0);
    } finally { setBusy(false); if (completed || failed) void load(false); }
  }
  section.addEventListener("click", event => {
    const button = event.target.closest("[data-news-action]"); if (!button || busy) return;
    event.stopPropagation();
    const row = rows.find(item => item.newsId === button.closest("[data-news-id]")?.dataset.newsId); if (!row) return;
    if (button.dataset.newsAction === "preview") void root.DartNews.open(row.newsId, row);
    else if (button.dataset.newsAction === "edit") openEditor(row);
    else void stateAction([row], row.isArchived ? "restore" : "archive");
  });
  container.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-news-select]"); if (!checkbox) return;
    const id = checkbox.closest("[data-news-id]").dataset.newsId; checkbox.checked ? selected.add(id) : selected.delete(id); syncSelection();
  });
  byId("news-select-all").addEventListener("change", event => {
    rows.filter(row => !row.isArchived).forEach(row => event.target.checked ? selected.add(row.newsId) : selected.delete(row.newsId)); render();
  });
  byId("news-add").addEventListener("click", () => openEditor());
  byId("news-delete").addEventListener("click", () => void stateAction(rows.filter(row => !row.isArchived && selected.has(row.newsId)), "archive"));
  byId("news-retry").addEventListener("click", () => void load(false));
  byId("news-search").addEventListener("input", () => { ++generation; root.clearTimeout(searchTimer); searchTimer = root.setTimeout(() => void load(true), 250); });
  ["news-status", "news-archive"].forEach(id => byId(id).addEventListener("change", () => void load(true)));
  byId("news-page-prev").addEventListener("click", () => { if (!busy) { offset = Math.max(0, offset - 50); selected.clear(); void load(false); } });
  byId("news-page-next").addEventListener("click", () => { if (!busy && nextOffset !== null) { offset = nextOffset; selected.clear(); void load(false); } });
  function applyAccess() {
    const allowed = !doc.body.classList.contains("dart-admin-locked") && root.DartAdminHydration?.ready === true && readable();
    doc.querySelectorAll('[data-target="news"]').forEach(link => { link.closest("li").hidden = !allowed; });
    section.hidden = !allowed;
    byId("news-add").hidden = byId("news-delete").hidden = !allowed || !can("news.manage");
    if (!allowed) {
      ++generation; ++editorGeneration; rows = []; selected.clear(); render(); record = null; coverAssetId = newId = "";
      if (editor.open) editor.close(); form.reset(); root.DartNews.clear();
    }
    else if (section.classList.contains("active-section")) void load(true);
  }
  new root.MutationObserver(() => { if (section.classList.contains("active-section") && !section.hidden) void load(true); }).observe(section, { attributes: true, attributeFilter: ["class"] });
  root.addEventListener("dart:admin-authenticated", applyAccess);
  root.addEventListener("dart:admin-logged-out", applyAccess);
  new root.MutationObserver(() => { if (doc.body.classList.contains("dart-admin-locked")) applyAccess(); })
    .observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  applyAccess();
})(window);
