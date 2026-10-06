// DART CODE GUIDE | Js/dart-set-image-preview.js
// Enlarges an image in the HTML-owned dialog. No product or cart flow is started.
(function (root) {
  "use strict";
  const dialog = root.document?.getElementById("dartSetImagePreview");
  if (!dialog || root.DartSetImagePreview) return;
  const image = dialog.querySelector("[data-set-image-preview]");
  const caption = dialog.querySelector("[data-set-image-caption]");
  let current = null;

  function open(details, options = {}) {
    if (!details?.src) return false;
    let url;
    try { url = new URL(details.src, root.location.href); } catch { return false; }
    if (!["http:", "https:"].includes(url.protocol)) return false;
    current = { src: url.href, alt: String(details.alt || "Set image") };
    image.src = current.src;
    image.alt = current.alt;
    caption.textContent = current.alt;
    if (!dialog.open) dialog.showModal();
    root.document.body.classList.add("dart-set-image-open");
    if (options.history !== false) root.DartSetNavigation?.openedImage(current);
    return true;
  }

  function close(options = {}) {
    if (!dialog.open) return false;
    if (options.history !== false && root.DartSetNavigation?.closeImage()) return true;
    dialog.close();
    current = null;
    root.document.body.classList.remove("dart-set-image-open");
    return true;
  }

  dialog.querySelector("[data-set-image-close]").addEventListener("click", () => close());
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    current = null;
    root.document.body.classList.remove("dart-set-image-open");
  });
  image.addEventListener("error", () => {
    if (!image.src.endsWith("/Photos/logo-1to1.png")) image.src = "/Photos/logo-1to1.png";
  });
  root.DartSetImagePreview = Object.freeze({ open, close, isOpen: () => dialog.open, current: () => current && { ...current } });
})(window);
