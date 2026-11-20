/* Dart internal UI Arabic labels. Business values and API identifiers are never changed. */
(function () {
  "use strict";
  const translations = new Map([["Total Inflow","إجمالي الوارد"],["Total Outflow","إجمالي الصادر"],["Net Profit","صافي الربح"],["Code PIC","كود القطعة"],["Code Pic","كود القطعة"],["Code Model","كود الموديل"],["Model Code","كود الموديل"],["Confirm Dispatch","تأكيد خروج الأوردر للتوصيل"],["Full address written on the ID","العنوان كامل زي البطاقة"]]);
  const attributes = ["placeholder", "title", "aria-label", "data-info-title", "data-info-text"];
  const excluded = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "OPTIONGROUP"]);
  const patterns = [
    [/^(\d+) selected$/i, (_, count) => count + " محدد"],
    [/^(\d+) active$/i, (_, count) => count + " نشط"],
    [/^(\d+) shipments$/i, (_, count) => count + " شحنة"],
    [/^(\d+) sold item\(s\)$/i, (_, count) => count + " قطعة مباعة"],
    [/^(\d+) matching setting\(s\) across all categories$/i, (_, count) => count + " إعداد مطابق في كل الأقسام"],
    [/^(\d+) \/ (\d+) selected$/i, (_, count, max) => count + " من " + max + " محدد"]
  ];
  function translated(value) {
    if (!value || value.length > 360) return null;
    const trimmed = value.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
    const fixed = translations.get(trimmed) || translations.get(trimmed.replace(/\s+/g, " "));
    if (fixed) return fixed;
    for (const [pattern, replace] of patterns) {
      if (pattern.test(trimmed)) return trimmed.replace(pattern, replace);
    }
    return null;
  }
  function isExcluded(node) {
    const parent = node.nodeType === 3 ? node.parentElement : node;
    if (!parent || !parent.closest) return false;
    // Hero typing previews display merchant-authored copy, not interface labels.
    return Boolean(parent.closest('[contenteditable="true"], [data-ar-ignore], .dart-typing-preview, script, style, noscript, pre, code, svg, textarea'));
  }
  function translateElement(element) {
    // Textarea content is user input, but its placeholder is a UI label.
    if (!element || (isExcluded(element) && element.tagName !== "TEXTAREA")) return;
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const next = translated(value);
      if (next && next !== value) element.setAttribute(attribute, next);
    }
    // Do not touch value, name, id, data-status, aria-controls or API payloads.
  }
  function translateText(node) {
    if (isExcluded(node)) return;
    const original = node.nodeValue;
    const next = translated(original);
    if (!next) return;
    const before = original.match(/^\s*/)[0];
    const after = original.match(/\s*$/)[0];
    const replacement = before + next + after;
    if (replacement !== original) node.nodeValue = replacement;
  }
  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 3) translateText(node);
      else translateElement(node);
    }
  }
  function start() {
    document.documentElement.lang = "ar";
    translateTree(document.body);
    const pending = new Set();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const items = [...pending];
      pending.clear();
      // Avoid reprocessing a subtree when its parent is already queued.
      for (const node of items) {
        if (items.some(parent => parent !== node && parent.nodeType === 1 && parent.contains(node))) continue;
        translateTree(node);
      }
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") pending.add(record.target);
        else if (record.type === "attributes") pending.add(record.target);
        else for (const child of record.addedNodes) pending.add(child);
      }
      if (!scheduled && pending.size) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: attributes
    });
    // Keep presentation text in a separate static data file so it does not
    // count against the shared JavaScript runtime or slow down other pages.
    if (typeof fetch === "function") {
      fetch("/Js/dart-admin-ar.json?v=20261120-ar-v2", { cache: "force-cache" })
        .then(response => {
          if (!response.ok) throw new Error("Arabic dictionary unavailable");
          return response.json();
        })
        .then(entries => {
          if (!Array.isArray(entries)) throw new Error("Invalid Arabic dictionary");
          for (const entry of entries) {
            if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
              translations.set(entry[0], entry[1]);
            }
          }
          translateTree(document.body);
          document.documentElement.dataset.dartArabicReady = "true";
        })
        .catch(() => { document.documentElement.dataset.dartArabicReady = "error"; });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();