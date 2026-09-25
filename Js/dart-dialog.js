// DART CODE GUIDE | Js/dart-dialog.js
// الغرض: رسائل Dart الموحّدة بدل alert/confirm/prompt الأصلية للمتصفح، بدون تغيير رسائل الـToast/Checkout الحالية.
(function installDartDialog(root) {
  "use strict";
  if (root.DartDialog?.version) return;

  const queue = [];
  let active = null;
  let styleInstalled = false;

  const COLORS = Object.freeze({ burgundy: "#AB012B", ink: "#151515", muted: "#667085", offWhite: "#FBF8F4" });

  function installStyle() {
    if (styleInstalled || document.getElementById("dart-dialog-style")) return;
    styleInstalled = true;
    const style = document.createElement("style");
    style.id = "dart-dialog-style";
    style.textContent = `
      .dart-dialog-layer{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:18px;background:rgba(8,18,18,.62);backdrop-filter:blur(4px);font-family:"Readex Pro",Arial,sans-serif}
      .dart-dialog-card{width:min(430px,100%);max-height:min(78vh,680px);overflow:auto;background:${COLORS.offWhite};border:1px solid rgba(171,1,43,.18);border-radius:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:22px;color:${COLORS.ink};animation:dartDialogIn .16s ease-out}
      .dart-dialog-card[dir="rtl"]{text-align:right}.dart-dialog-card[dir="ltr"]{text-align:left}
      .dart-dialog-brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
      .dart-dialog-brand strong{font-size:20px;line-height:1;color:${COLORS.burgundy};letter-spacing:.01em}
      .dart-dialog-mark{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(171,1,43,.1);color:${COLORS.burgundy};font-weight:900}
      .dart-dialog-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.75;color:#2f3337;margin:0}
      .dart-dialog-input{width:100%;box-sizing:border-box;margin-top:16px;border:1px solid #d7d1ca;border-radius:12px;background:#fff;color:${COLORS.ink};padding:12px 13px;font:inherit;outline:none}
      .dart-dialog-input:focus{border-color:${COLORS.burgundy};box-shadow:0 0 0 3px rgba(171,1,43,.1)}
      .dart-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;flex-wrap:wrap}
      .dart-dialog-card[dir="rtl"] .dart-dialog-actions{justify-content:flex-start}
      .dart-dialog-button{min-width:96px;min-height:42px;border-radius:11px;border:1px solid #d7d1ca;background:#fff;color:#222;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer}
      .dart-dialog-button:hover{border-color:${COLORS.burgundy};color:${COLORS.burgundy}}
      .dart-dialog-button.is-primary{background:${COLORS.burgundy};border-color:${COLORS.burgundy};color:#fff}
      .dart-dialog-button.is-primary:hover{filter:brightness(.94);color:#fff}
      @keyframes dartDialogIn{from{transform:translateY(8px) scale(.985);opacity:.3}to{transform:none;opacity:1}}
      @media(max-width:520px){.dart-dialog-layer{padding:12px;align-items:end}.dart-dialog-card{border-radius:24px 24px 18px 18px;padding:20px 18px 18px}.dart-dialog-actions{display:grid;grid-template-columns:1fr 1fr}.dart-dialog-actions .dart-dialog-button:only-child{grid-column:1/-1}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function containsArabic(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function waitForBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  function labels(mode, rtl) {
    if (rtl) return { ok: mode === "alert" ? "حسنًا" : "تأكيد", cancel: "إلغاء" };
    return { ok: mode === "alert" ? "OK" : "Confirm", cancel: "Cancel" };
  }

  async function pump() {
    if (active || !queue.length) return;
    await waitForBody();
    if (active || !queue.length) return;
    active = queue.shift();
    installStyle();

    const { mode, message, defaultValue, options } = active.request;
    const rtl = containsArabic(message) || containsArabic(options?.title);
    const copy = labels(mode, rtl);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const layer = document.createElement("div");
    layer.className = "dart-dialog-layer";
    layer.setAttribute("role", "presentation");

    const card = document.createElement("section");
    card.className = "dart-dialog-card";
    card.dir = rtl ? "rtl" : "ltr";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "dart-dialog-title");
    card.setAttribute("aria-describedby", "dart-dialog-message");

    const brand = document.createElement("div");
    brand.className = "dart-dialog-brand";
    const title = document.createElement("strong");
    title.id = "dart-dialog-title";
    title.textContent = String(options?.title || "Dart");
    const mark = document.createElement("span");
    mark.className = "dart-dialog-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = mode === "alert" ? "!" : "✓";
    brand.append(title, mark);

    const body = document.createElement("p");
    body.id = "dart-dialog-message";
    body.className = "dart-dialog-message";
    body.textContent = String(message ?? "");

    let input = null;
    if (mode === "prompt") {
      input = document.createElement("input");
      input.className = "dart-dialog-input";
      input.type = options?.inputType === "password" ? "password" : "text";
      input.value = String(defaultValue ?? "");
      input.autocomplete = options?.autocomplete || "off";
      input.maxLength = Number.isFinite(Number(options?.maxLength)) ? Number(options.maxLength) : 500;
    }

    const actions = document.createElement("div");
    actions.className = "dart-dialog-actions";
    let cancel = null;
    if (mode !== "alert") {
      cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "dart-dialog-button";
      cancel.textContent = String(options?.cancelText || copy.cancel);
      actions.appendChild(cancel);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "dart-dialog-button is-primary";
    ok.textContent = String(options?.confirmText || copy.ok);
    actions.appendChild(ok);

    card.append(brand, body);
    if (input) card.appendChild(input);
    card.appendChild(actions);
    layer.appendChild(card);
    document.body.appendChild(layer);

    function finish(value) {
      document.removeEventListener("keydown", onKeyDown, true);
      layer.remove();
      const resolve = active?.resolve;
      active = null;
      try { previousFocus?.focus?.({ preventScroll: true }); } catch {}
      resolve?.(value);
      void pump();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(mode === "confirm" ? false : mode === "prompt" ? null : true);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finish(mode === "prompt" ? input.value : true);
      }
    }

    ok.addEventListener("click", () => finish(mode === "prompt" ? input.value : true));
    cancel?.addEventListener("click", () => finish(mode === "confirm" ? false : null));
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => (input || ok).focus());
  }

  function enqueue(mode, message, defaultValue, options) {
    return new Promise((resolve) => {
      queue.push({ request: { mode, message, defaultValue, options: options || {} }, resolve });
      void pump();
    });
  }

  function showAlert(message, options) {
    void enqueue("alert", message, "", options);
    return undefined;
  }

  function showConfirm(message, options) {
    return enqueue("confirm", message, "", options);
  }

  function showPrompt(message, defaultValue = "", options) {
    return enqueue("prompt", message, defaultValue, options);
  }

  root.DartDialog = Object.freeze({
    version: "1.0.0",
    alert: showAlert,
    confirm: showConfirm,
    prompt: showPrompt,
  });
})(window);
