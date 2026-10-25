  function setCartReservationId(value) {
    const next = String(value || "").trim();
    if (!next) return CART_RESERVATION_ID;
    CART_RESERVATION_ID = next;
    sessionStorage.setItem("dart_cart_reservation_id", CART_RESERVATION_ID);
    if (window.DartPlatform) window.DartPlatform.cartReservationId = CART_RESERVATION_ID;
    return CART_RESERVATION_ID;
  }
  const ENTERED_FROM_INTERNAL_NAVIGATION =
    sessionStorage.getItem("dart_internal_navigation") === "1";
  const PAGE_NAVIGATION_TYPE =
    typeof performance !== "undefined" && performance.getEntriesByType
      ? performance.getEntriesByType("navigation")[0]?.type || ""
      : "";
  const PRESERVE_BIRTHDAY_CLOSE_STATE =
    ENTERED_FROM_INTERNAL_NAVIGATION || PAGE_NAVIGATION_TYPE === "reload";
  const preparedBirthdayCelebrationIds = new Set();
  sessionStorage.removeItem("dart_internal_navigation");
  const normalizeEmail = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const normalizePhone = (value) => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("0020")) digits = digits.slice(2);
    if (digits.startsWith("20")) return `+${digits}`;
    if (digits.startsWith("0")) return `+20${digits.slice(1)}`;
    return digits ? `+20${digits}` : "";
  };
  const displayPhone = (value) => normalizePhone(value).replace(/^\+20/, "0");
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const dateGB = (value) =>
    new Date(value || Date.now()).toLocaleDateString("en-GB");
  const money = (value) => `${(Number(value) || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
  const orderNet = (order) =>
    Number.isFinite(Number(order?.finalAmount))
      ? Math.max(0, Number(order.finalAmount))
      : Math.max(
          0,
          Number(order?.totalPrice || 0) -
            (Number(order?.orderLevelDiscountAmount) ||
              (Number(order?.totalPrice || 0) * Number(order?.discount || 0)) /
                100),
        );
  const getProducts = () => DartCatalog.products();

