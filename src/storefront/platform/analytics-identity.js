  // BEGIN Website analytics identity — first-party anonymous ID + browser-session ID.
  // PostgreSQL remains authoritative; these IDs only let the server distinguish people/sessions.
  const ANALYTICS_VISITOR_COOKIE = "dart_vid";
  const ANALYTICS_VISITOR_SESSION_KEY = "dart_analytics_visitor_id";
  const ANALYTICS_SESSION_KEY = "dart_analytics_session_id";
  const ANALYTICS_SESSION_SEEN_KEY = "dart_analytics_session_seen_at";
  const ANALYTICS_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const uuidV4 = () => {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  };
  const validAnalyticsUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  const analyticsCookieValue = () => {
    try {
      return decodeURIComponent(document.cookie.match(/(?:^|;\s*)dart_vid=([^;]*)/)?.[1] || "");
    } catch { return ""; }
  };
  function readAnalyticsSessionValue(key) {
    try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
  }
  function writeAnalyticsSessionValue(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }
  // Keep the existing cookie identity. A tab-scoped fallback survives navigation
  // when cookies are unavailable; it stores no profile or analytics counters.
  const cookieVisitorId = analyticsCookieValue();
  const sessionVisitorId = readAnalyticsSessionValue(ANALYTICS_VISITOR_SESSION_KEY);
  const ANALYTICS_VISITOR_ID = validAnalyticsUuid(cookieVisitorId) ? cookieVisitorId
    : validAnalyticsUuid(sessionVisitorId) ? sessionVisitorId : uuidV4();
  writeAnalyticsSessionValue(ANALYTICS_VISITOR_SESSION_KEY, ANALYTICS_VISITOR_ID);
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${ANALYTICS_VISITOR_COOKIE}=${encodeURIComponent(ANALYTICS_VISITOR_ID)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  } catch {}
  let ANALYTICS_SESSION_ID = "";
  let analyticsLastSeen = 0;

  function ensureAnalyticsSession() {
    const storedSessionId = readAnalyticsSessionValue(ANALYTICS_SESSION_KEY) || ANALYTICS_SESSION_ID;
    const lastSeen = Number(readAnalyticsSessionValue(ANALYTICS_SESSION_SEEN_KEY) || analyticsLastSeen);
    const currentTime = Date.now();
    const started =
      !validAnalyticsUuid(storedSessionId) ||
      !lastSeen ||
      currentTime - lastSeen > ANALYTICS_SESSION_TIMEOUT_MS;
    ANALYTICS_SESSION_ID = started ? uuidV4() : storedSessionId;
    if (started) writeAnalyticsSessionValue(ANALYTICS_SESSION_KEY, ANALYTICS_SESSION_ID);
    analyticsLastSeen = currentTime;
    writeAnalyticsSessionValue(ANALYTICS_SESSION_SEEN_KEY, String(currentTime));
    return { sessionId: ANALYTICS_SESSION_ID, started };
  }

  async function sendAnalyticsEvent(eventType, detail, sessionId) {
    await apiRequest("/api/v1/analytics/events", {
      method: "POST",
      body: {
        eventType,
        eventId: detail.eventId || uuidV4(),
        visitorId: ANALYTICS_VISITOR_ID,
        sessionId,
        path: location.pathname || "/",
        ...(detail.modelId ? { modelId: String(detail.modelId) } : {}),
        ...(detail.color ? { color: String(detail.color) } : {}),
        ...(detail.size ? { size: String(detail.size) } : {}),
        ...(Number(detail.quantity) > 0 ? { quantity: Math.trunc(Number(detail.quantity)) } : {}),
        ...(detail.orderCode ? { orderCode: String(detail.orderCode) } : {}),
        ...(detail.reservationId ? { reservationId: String(detail.reservationId) } : {}),
      },
    });
  }

  async function trackAnalyticsEvent(eventType, detail = {}) {
    try {
      const session = ensureAnalyticsSession();
      if (session.started && eventType !== "visit") {
        await sendAnalyticsEvent("visit", {}, session.sessionId);
      }
      await sendAnalyticsEvent(eventType, detail, session.sessionId);
    } catch {
      // Analytics is best-effort and must never block navigation, cart or checkout.
    }
  }

  ensureAnalyticsSession();

  function analyticsCartKey(line) {
    return [line?.id, line?.color, line?.size].map((value) => String(value || "")).join("|");
  }

  function trackCartIncrease(previous, next) {
    const before = new Map((Array.isArray(previous) ? previous : []).map((line) => [analyticsCartKey(line), Number(line.quantity) || 0]));
    (Array.isArray(next) ? next : []).forEach((line) => {
      const delta = (Number(line.quantity) || 0) - (before.get(analyticsCartKey(line)) || 0);
      if (delta <= 0) return;
      void trackAnalyticsEvent("add_to_cart", {
        modelId: line.id,
        color: line.color,
        size: line.size,
        quantity: delta,
        reservationId: line.reservationId || CART_RESERVATION_ID,
      });
    });
  }
  // END Website analytics identity.

