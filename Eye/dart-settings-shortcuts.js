/* DART EYE | Simple Settings shortcuts.
   Navigation only: never submits a form, writes data, changes Staff access,
   or reveals a hidden/unauthorized settings card. */
(function () {
  "use strict";
  function init() {
    const root = document.getElementById("settings");
    const nav = document.getElementById("settings-quick-nav");
    const content = document.getElementById("settings-content");
    if (!root || !nav || !content || nav.dataset.bound === "true") return;
    nav.dataset.bound = "true";

    nav.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-settings-go]");
      if (!button || !nav.contains(button)) return;
      if (content.dataset.activeSettingsTab !== "general") return;
      const targetId = button.dataset.settingsGo;
      const card = document.getElementById(targetId);
      if (!card || !content.contains(card) || card.dataset.settingsGroup !== "general") return;

      // The existing search filters card visibility. Reset only the search
      // field when navigating; do not clear any unsaved settings form values.
      const search = document.getElementById("settings-search");
      if (search && search.value) {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (card.hidden || card.classList.contains("dart-settings-search-hidden")) return;
      if (typeof card.getClientRects === "function" && !card.getClientRects().length) return;
      card.tabIndex = -1;
      card.focus({ preventScroll: true });
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      card.classList.add("is-jump-highlighted");
      window.setTimeout(() => card.classList.remove("is-jump-highlighted"), 1300);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
