  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString("en-GB");
  }
  function profileField(label, value) {
    return `<div class="profile-record-field"><small>${escapeHtml(label)}</small><span>${escapeHtml(value ?? "-")}</span></div>`;
  }

  function recordDartCardUsage(order) {
    if (!order.dartCardId || order.dartCardUsageRecorded) return;
    const cards = read("dart_cards", []),
      card = cards.find(
        (row) => row.cardId === order.dartCardId && row.status === "Active",
      );
    if (!card) return;
    card.purchasedItems = String(
      Number(card.purchasedItems || 0) +
        Number(order.totalProducts || order.items?.length || 0),
    );
    card.requestedProducts = [
      ...new Set([...(card.requestedProducts || []), ...(order.items || [])]),
    ];
    if (
      Number(card.purchasedItems) >=
      Number(card.itemLimit || card.purchasedLimit || 10)
    )
      card.status = "Expired";
    order.dartCardUsageRecorded = true;
    write("dart_cards", cards);
  }

  function customerNameParts(value, count = 2) {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "Not disclosed";
    return parts.slice(0, Math.max(1, count)).join(" ");
  }


