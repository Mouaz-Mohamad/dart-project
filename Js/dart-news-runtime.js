// DART CODE GUIDE | Js/dart-news-runtime.js
// Shared News reader and horizontal carousel; durable state always comes from the API.
(function (root) {
  "use strict";
  if (root.DartNews) return;
  const doc = root.document;
  const base = String(root.DART_API_BASE_URL || root.location.origin).replace(/\/$/, "");
  const dialog = doc.getElementById("dart-news-dialog");
  const section = doc.getElementById("dart-news");
  const track = section?.querySelector("[data-news-track]");
  const links = root.DartNewsLinks;
  const historyOwner = root.crypto.randomUUID();
  let closingHistory = false, handledCloses = 0;
  const ownedStep = () => root.history.state?.dartNewsStep?.owner === historyOwner ? root.history.state.dartNewsStep : null;
  let modalRequest = 0, previousFocus = null, savedOverflow = "";
  let loading = false, started = false, listGeneration = 0, nextOffset = null;
  let lastRefresh = 0, timer = 0, hover = false, focused = false, inView = false, interacting = false;
  const reducedMotion = root.matchMedia("(prefers-reduced-motion: reduce)");
  const source = value => /^\/api\/v1\/catalog\/assets\//.test(value || "") ? `${base}${value}` : "/Photos/logo-1to1.png";
  async function request(path) {
    const response = await root.fetch(`${base}${path}`, { credentials: "omit", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error("News is temporarily unavailable."); error.status = response.status; throw error; }
    return payload;
  }
  function modalStatus(message, retry = false) {
    dialog.querySelector("[data-news-dialog-status]").textContent = message;
    dialog.querySelector("[data-news-dialog-retry]").hidden = !retry;
  }
  function fillArticle(record) {
    dialog.querySelector("[data-news-dialog-title]").textContent = record.title;
    const image = dialog.querySelector("[data-news-dialog-image]");
    image.src = source(record.imageUrl); image.alt = record.title; image.hidden = false;
    dialog.querySelector("[data-news-dialog-body]").textContent = record.body;
    const date = dialog.querySelector("[data-news-dialog-date]");
    date.dateTime = links.date(record.publishedAt); date.textContent = links.dateLabel(record.publishedAt); date.hidden = !date.dateTime;
    dialog.querySelector("[data-news-dialog-reading]").textContent = links.readingTime(record.body);
    if (ownedStep() && !ownedStep().preview) root.history.replaceState(root.history.state, "", links.path(record));
    modalStatus("");
  }
  function showDialog() {
    if (dialog.open) return;
    previousFocus = doc.activeElement;
    savedOverflow = doc.body.style.overflow;
    doc.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.scrollTop = 0;
    schedule();
  }
  async function open(id, preview = null, options = {}) {
    if (!dialog || !links.validId(id) || closingHistory) return;
    const privatePreview = !!preview || options.preview === true;
    if (privatePreview && (doc.body.classList.contains("dart-admin-locked") ||
      !(root.DartAdminAccess?.can("news.read") || root.DartAdminAccess?.can("news.manage")))) return;
    const generation = ++modalRequest;
    dialog.dataset.newsId = id;
    dialog.querySelector("[data-news-dialog-title]").textContent = preview?.title || "News";
    dialog.querySelector("[data-news-dialog-image]").hidden = true;
    dialog.querySelector("[data-news-dialog-body]").textContent = "";
    dialog.querySelector("[data-news-dialog-date]").hidden = true;
    dialog.querySelector("[data-news-dialog-reading]").textContent = "";
    if (options.history !== false) {
      const state = { ...(root.history.state || {}), dartNewsStep: { owner: historyOwner, id, preview: privatePreview } };
      const url = privatePreview ? root.location.href : links.path({ newsId: id, title: options.title });
      if (ownedStep()) root.history.replaceState(state, "", url);
      else root.history.pushState(state, "", url);
    }
    showDialog();
    if (preview) { fillArticle(preview); return; }
    modalStatus("Loading News…");
    try {
      const result = privatePreview ? await root.DartAdminApi.request(`/api/v1/admin/news/${encodeURIComponent(id)}`)
        : await request(`/api/v1/news/${encodeURIComponent(id)}`);
      if (generation === modalRequest && dialog.open) fillArticle(result.news);
    } catch (error) {
      if (generation !== modalRequest || !dialog.open) return;
      modalStatus(error.status === 404 ? "This News is no longer available." : "Unable to load News. Please try again.", error.status !== 404);
      if (error.status === 404 && section && track) void load(false);
    }
  }
  function finishClose() {
    ++modalRequest; doc.body.style.overflow = savedOverflow;
    previousFocus?.focus?.({ preventScroll: true }); schedule();
  }
  function consumeStep() {
    if (ownedStep() && !closingHistory) { closingHistory = true; root.history.back(); }
  }
  function close(fromHistory = false) {
    if (!dialog?.open) return;
    // The native close event is queued. Finish synchronously so it cannot close a later Forward entry.
    ++handledCloses; dialog.close(); finishClose();
    if (!fromHistory) consumeStep();
  }
  if (dialog) {
    dialog.querySelectorAll("[data-news-dialog-close]").forEach(button => button.addEventListener("click", () => close()));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.querySelector("[data-news-dialog-retry]").addEventListener("click", () => void open(dialog.dataset.newsId, null, { preview: ownedStep()?.preview }));
    dialog.addEventListener("click", event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
    });
    dialog.addEventListener("close", () => {
      if (handledCloses) { --handledCloses; return; }
      finishClose(); consumeStep();
    });
    root.addEventListener("popstate", () => {
      closingHistory = false;
      const step = ownedStep();
      if (step) void open(step.id, null, { history: false, preview: step.preview });
      else if (dialog.open) close(true);
    });
  }
  function clear() {
    ++modalRequest;
    if (!dialog) return;
    if (dialog.open) close();
    dialog.querySelector("[data-news-dialog-title]").textContent = "News";
    dialog.querySelector("[data-news-dialog-body]").textContent = "";
    dialog.querySelector("[data-news-dialog-image]").removeAttribute("src");
    dialog.querySelector("[data-news-dialog-date]").textContent = "";
    dialog.querySelector("[data-news-dialog-reading]").textContent = "";
  }
  root.DartNews = Object.freeze({ open, clear, source, request });
  if (!section || !track) return;
  const template = doc.getElementById("dart-news-card");
  const state = section.querySelector("[data-news-status]");
  const retry = section.querySelector("[data-news-retry]");
  const controls = section.querySelector("[data-news-controls]");
  const auto = section.querySelector("[data-news-auto]");
  let paused = false;
  function stateMessage(message, failed = false) {
    state.textContent = message; state.hidden = !message;
    retry.hidden = !failed; retry.disabled = false;
  }
  function card(record) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.newsId = record.newsId;
    const image = node.querySelector("img");
    image.src = source(record.imageUrl); image.alt = record.title;
    image.addEventListener("error", () => { image.src = "/Photos/logo-1to1.png"; }, { once: true });
    node.querySelector("[data-news-title]").textContent = record.title;
    node.querySelector("[data-news-excerpt]").textContent = record.excerpt;
    const date = node.querySelector("[data-news-date]");
    date.dateTime = links.date(record.publishedAt); date.textContent = links.dateLabel(record.publishedAt); date.hidden = !date.dateTime;
    const read = node.querySelector("[data-news-read]");
    read.href = links.path(record); read.setAttribute("aria-label", `Read ${record.title}`);
    read.addEventListener("click", event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); void open(record.newsId, null, { title: record.title });
    });
    return node;
  }
  async function load(append = false) {
    if (loading) return;
    if (append && nextOffset === null) return;
    const generation = ++listGeneration;
    loading = true; started = true;
    if (!track.children.length) { section.hidden = false; stateMessage("Loading News…"); }
    try {
      const result = await request(`/api/v1/news?limit=100&offset=${append ? nextOffset : 0}`);
      if (generation !== listGeneration) return;
      const nodes = result.news.map(card);
      if (append) {
        const ids = new Set([...track.children].map(node => node.dataset.newsId));
        nodes.filter(node => !ids.has(node.dataset.newsId)).forEach(node => track.appendChild(node));
      } else {
        const position = track.scrollLeft;
        track.replaceChildren(...nodes); track.scrollLeft = position;
      }
      nextOffset = result.nextOffset ?? null; lastRefresh = Date.now();
      section.hidden = track.children.length === 0;
      stateMessage(""); controls.hidden = track.children.length < 2 && nextOffset === null;
    } catch {
      section.hidden = false; stateMessage("Unable to load News. Please try again.", true);
    } finally { loading = false; schedule(); }
  }
  function step(direction, automatic = false) {
    const distance = (track.firstElementChild?.getBoundingClientRect().width || 187.5) + 16;
    const max = track.scrollWidth - track.clientWidth;
    const end = track.scrollLeft >= max - 2;
    if (direction > 0 && end && nextOffset !== null) { void load(true); return; }
    track.scrollTo({ left: direction > 0 && end ? 0 : direction < 0 && track.scrollLeft <= 2 ? max : track.scrollLeft + direction * distance,
      behavior: reducedMotion.matches ? "auto" : "smooth" });
    if (!automatic) schedule();
  }
  function schedule() {
    if (!section || !track) return;
    root.clearTimeout(timer);
    if (paused || reducedMotion.matches || doc.hidden || !inView || hover || focused || interacting || dialog?.open || section.hidden || track.children.length < 2) return;
    timer = root.setTimeout(() => { step(1, true); schedule(); }, 5000);
  }
  section.querySelector("[data-news-prev]").addEventListener("click", () => step(-1));
  section.querySelector("[data-news-next]").addEventListener("click", () => step(1));
  auto.addEventListener("click", () => {
    paused = !paused; auto.textContent = paused ? "Play" : "Pause";
    auto.setAttribute("aria-label", paused ? "Start automatic News scrolling" : "Pause automatic News scrolling"); schedule();
  });
  retry.addEventListener("click", () => void load(false));
  section.addEventListener("mouseenter", () => { hover = true; schedule(); });
  section.addEventListener("mouseleave", () => { hover = false; schedule(); });
  section.addEventListener("focusin", () => { focused = true; schedule(); });
  section.addEventListener("focusout", event => { focused = section.contains(event.relatedTarget); schedule(); });
  track.addEventListener("keydown", event => {
    if (event.target !== track || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); step(event.key === "ArrowRight" ? 1 : -1);
  });
  // Touch swiping uses native scrolling; mouse drag is additive and suppresses dragged clicks.
  let drag = null, moved = false;
  track.addEventListener("pointerdown", event => {
    interacting = true; moved = false; schedule();
    if (event.pointerType === "mouse" && event.button === 0 && !event.target.closest("button")) drag = { id: event.pointerId, x: event.clientX, left: track.scrollLeft };
  });
  track.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) < 5 && !moved) return;
    moved = true; track.setPointerCapture(event.pointerId); track.classList.add("is-dragging"); track.scrollLeft = drag.left - delta;
  });
  function release(event) {
    interacting = false; drag = null; track.classList.remove("is-dragging");
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    schedule();
  }
  root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
  track.addEventListener("click", event => { if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; } }, true);
  track.addEventListener("scroll", () => {
    if (nextOffset !== null && track.scrollLeft + track.clientWidth >= track.scrollWidth - 400) void load(true);
  }, { passive: true });
  reducedMotion.addEventListener("change", schedule);
  doc.addEventListener("visibilitychange", () => {
    if (!doc.hidden && started && Date.now() - lastRefresh > 60000) void load(false);
    schedule();
  });
  if (root.IntersectionObserver) {
    new root.IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (inView && (!started || Date.now() - lastRefresh > 60000)) void load(false);
      schedule();
    }, { rootMargin: "300px 0px" }).observe(section);
  } else { inView = true; void load(false); }
})(window);
