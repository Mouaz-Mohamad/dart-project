/* ========================================================================== */
/* DART SETTINGS — guarded reset for dashboard-owned browser data             */
/* BACKEND: replace resetAllDartData with an authenticated admin endpoint.     */
/* The server must require recent re-authentication and keep a protected log.  */
/* ========================================================================== */
(function (root) {
  "use strict";

  const CONFIRMATION_PHRASE = "DELETE DART";
  const DART_KEY_PREFIX = "dart_";
  const LEGACY_DART_KEYS = new Set(["order_45_state", "user_last_address"]);
  const CATALOG_MEDIA_DATABASE = "dart-catalog-media-v7";

  function isDartStorageKey(key) {
    return typeof key === "string" && (key.startsWith(DART_KEY_PREFIX) || LEGACY_DART_KEYS.has(key));
  }

  function clearDartStorage(storage) {
    const removed = [];
    if (!storage) return removed;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
    keys.filter(isDartStorageKey).forEach((key) => {
      storage.removeItem(key);
      removed.push(key);
    });
    return removed;
  }

  function clearCatalogMedia(indexedDBApi = root.indexedDB) {
    if (!indexedDBApi) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(CATALOG_MEDIA_DATABASE);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
      };
      request.onerror = () => reject(request.error || new Error("Could not open saved image storage."));
      request.onsuccess = () => {
        const connection = request.result;
        if (!connection.objectStoreNames.contains("images")) {
          connection.close();
          resolve(true);
          return;
        }
        const transaction = connection.transaction("images", "readwrite");
        transaction.objectStore("images").clear();
        transaction.oncomplete = () => {
          connection.close();
          resolve(true);
        };
        transaction.onerror = () => {
          const error = transaction.error || new Error("Could not clear saved product images.");
          connection.close();
          reject(error);
        };
        transaction.onabort = () => {
          const error = transaction.error || new Error("Clearing saved product images was cancelled.");
          connection.close();
          reject(error);
        };
      };
    });
  }

  const api = {
    CONFIRMATION_PHRASE,
    CATALOG_MEDIA_DATABASE,
    isDartStorageKey,
    clearDartStorage,
    clearCatalogMedia,
  };
  root.DartSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document) return;

  const modal = document.getElementById("reset-data-modal");
  const openButton = document.getElementById("open-reset-data-modal");
  const closeButton = document.getElementById("close-reset-data-modal");
  const cancelButton = document.getElementById("cancel-reset-data");
  const confirmButton = document.getElementById("confirm-reset-data");
  const confirmationInput = document.getElementById("reset-confirmation-input");
  const understandCheckbox = document.getElementById("reset-understand-checkbox");
  const errorBox = document.getElementById("reset-data-error");
  const statusBox = document.getElementById("settings-reset-status");

  function confirmationIsValid() {
    return confirmationInput.value.trim().toUpperCase() === CONFIRMATION_PHRASE && understandCheckbox.checked;
  }

  function syncConfirmationState() {
    confirmButton.disabled = !confirmationIsValid();
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function resetConfirmationForm() {
    confirmationInput.value = "";
    understandCheckbox.checked = false;
    confirmButton.disabled = true;
    confirmButton.removeAttribute("aria-busy");
    document.getElementById("reset-delete-button-label").textContent = "Permanently Delete Everything";
    confirmationInput.disabled = false;
    understandCheckbox.disabled = false;
    cancelButton.disabled = false;
    closeButton.disabled = false;
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function openResetModal() {
    resetConfirmationForm();
    modal.classList.add("active");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    root.setTimeout(() => confirmationInput.focus(), 0);
  }

  function closeResetModal() {
    if (confirmButton.getAttribute("aria-busy") === "true") return;
    modal.classList.remove("active");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    resetConfirmationForm();
    openButton.focus();
  }

  function showResetError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  async function resetAllDartData() {
    if (!confirmationIsValid()) {
      showResetError(`اكتب ${CONFIRMATION_PHRASE} وفعّل مربع الإقرار أولًا.`);
      return;
    }

    const finalApproval = root.confirm("تحذير نهائي جدًا: سيتم الآن حذف كل بيانات Dart نهائيًا، ولا يمكن التراجع. هل أنت متأكد 100%؟");
    if (!finalApproval) return;

    confirmButton.disabled = true;
    confirmationInput.disabled = true;
    understandCheckbox.disabled = true;
    cancelButton.disabled = true;
    closeButton.disabled = true;
    confirmButton.setAttribute("aria-busy", "true");
    document.getElementById("reset-delete-button-label").textContent = "Deleting all data…";
    errorBox.hidden = true;

    try {
      await clearCatalogMedia();
      clearDartStorage(root.localStorage);
      clearDartStorage(root.sessionStorage);
      modal.classList.remove("active");
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      statusBox.textContent = "تم مسح جميع بيانات Dart بنجاح. سيتم الآن بدء النظام من الصفر.";
      statusBox.hidden = false;
      root.setTimeout(() => root.location.reload(), 900);
    } catch (error) {
      confirmButton.removeAttribute("aria-busy");
      confirmationInput.disabled = false;
      understandCheckbox.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      syncConfirmationState();
      showResetError("تعذر إكمال المسح بأمان. لم يتم حذف بيانات النظام المحلية. حاول مرة أخرى.");
    }
  }

  openButton.addEventListener("click", openResetModal);
  closeButton.addEventListener("click", closeResetModal);
  cancelButton.addEventListener("click", closeResetModal);
  confirmationInput.addEventListener("input", syncConfirmationState);
  understandCheckbox.addEventListener("change", syncConfirmationState);
  confirmButton.addEventListener("click", resetAllDartData);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeResetModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("active")) closeResetModal();
  });
})(typeof window !== "undefined" ? window : globalThis);
