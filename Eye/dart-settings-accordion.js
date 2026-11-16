/* DART SETTINGS — accordion presentation only. Existing forms, IDs, validation, permissions and API calls remain untouched. */
(function () {
  "use strict";

  const root = document.getElementById("settings");
  const content = document.getElementById("settings-content");
  if (!root || !content) return;

  const cards = Array.from(content.children).filter((element) =>
    element.matches("article[data-settings-group]")
  );
  if (!cards.length) return;

  function setOpen(cardToOpen) {
    cards.forEach((card) => {
      const expanded = card === cardToOpen && !card.hidden;
      card.classList.toggle("is-open", expanded);
      const trigger = card.querySelector(":scope > .dart-settings-accordion-trigger");
      if (!trigger) return;
      trigger.setAttribute("aria-expanded", String(expanded));
      trigger.setAttribute(
        "aria-label",
        (expanded ? "Close " : "Open ") + trigger.dataset.settingsCardTitle + " settings"
      );
      const hint = trigger.querySelector(".dart-settings-accordion-hint");
      if (hint) hint.textContent = expanded ? "Close details" : "Open details";
    });
  }

  function openCard(card, activateCategory) {
    if (!card || !cards.includes(card) || card.hidden) return false;
    if (activateCategory) window.DartSettingsTabs?.activate?.(card.dataset.settingsGroup);
    setOpen(card);
    return true;
  }

  cards.forEach((card) => {
    const copy = card.querySelector(":scope > .dart-settings-card-copy");
    if (!copy || card.querySelector(":scope > .dart-settings-accordion-trigger")) return;

    const title = copy.querySelector("h2")?.textContent.trim() || "Settings";
    const eyebrow = copy.querySelector(":scope > span")?.textContent.trim() || "STORE SETTINGS";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dart-settings-accordion-trigger";
    trigger.dataset.settingsCardTitle = title;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Open " + title + " settings");

    const labels = document.createElement("span");
    labels.className = "dart-settings-accordion-labels";
    const category = document.createElement("span");
    category.className = "dart-settings-accordion-category";
    category.textContent = eyebrow;
    const name = document.createElement("strong");
    name.className = "dart-settings-accordion-title";
    name.textContent = title;
    const hint = document.createElement("small");
    hint.className = "dart-settings-accordion-hint";
    hint.textContent = "Open details";
    labels.append(category, name, hint);

    const chevron = document.createElement("i");
    chevron.className = "fa-solid fa-chevron-down dart-settings-accordion-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(labels, chevron);
    card.insertBefore(trigger, copy);
    card.classList.add("dart-settings-accordion-card");
    trigger.addEventListener("click", () => {
      setOpen(card.classList.contains("is-open") ? null : card);
    });
  });

  // Begin in a compact state every time; no business data is persisted in browser storage.
  setOpen(null);

  // Existing search and jump controls retain their own category activation and scrolling.
  // Expand the destination before those handlers scroll to it.
  root.querySelector("#settings-jump")?.addEventListener("change", (event) => {
    openCard(document.getElementById(event.target.value), false);
  });
  const results = root.querySelector("#settings-search-results");
  results?.addEventListener(
    "click",
    (event) => {
      const result = event.target.closest("[data-settings-result]");
      if (result && results.contains(result)) {
        openCard(document.getElementById(result.dataset.settingsResult), true);
      }
    },
    true
  );

  root.querySelector(".dart-settings-tabs")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-settings-tab]")) setOpen(null);
  });

  window.DartSettingsAccordion = Object.freeze({
    open: (cardId) => openCard(document.getElementById(cardId), true),
    close: () => setOpen(null),
  });
})();
