function dartApplyFilters(key, data) {
  const state = dartFilterState[key] || {},
    raw = [...(data || [])];
  let out = raw;
  if (state.search)
    out = out.filter((x) => dartSectionSearchText(x).includes(state.search));
  if (state.archive === "active") out = out.filter(dartIsActive);
  else if (state.archive === "archived") out = out.filter(dartIsArchived);
  const eq = (field, val, derive) => {
    if (!val || val === "all") return;
    out = out.filter(
      (x) =>
        String(derive ? derive(x) : x[field] || "").toLowerCase() ===
        String(val).toLowerCase(),
    );
  };
  if (key === "models") {
    eq("category", state.category);
    if (state.status && state.status !== "all")
      out = out.filter((m) => {
        const d = dartModelDerived(m);
        return state.status === "out-of-stock"
          ? d.count === 0
          : String(m.status || "Active").toLowerCase() ===
              state.status.toLowerCase();
      });
    if (state.priceRange && state.priceRange !== "all")
      out = out.filter((m) => {
        const p = Number(m.discountedPrice ?? m.selling) || 0;
        return state.priceRange === "0-500"
          ? p <= 500
          : state.priceRange === "500-1000"
            ? p > 500 && p <= 1000
            : p > 1000;
      });
  }
  if (key === "items") {
    if (state.category && state.category !== "all")
      out = out.filter(
        (i) =>
          String(
            dartFindModelByCode(i.modelId)?.category || "",
          ).toLowerCase() === state.category.toLowerCase(),
      );
    if (state.status && state.status !== "all")
      out = out.filter((i) =>
        String(i.status)
          .toLowerCase()
          .includes(
            state.status
              .toLowerCase()
              .replace("active", "in stock")
              .replace("out-of-stock", "sold"),
          ),
      );
    if (state.sizeProfile === "pants")
      out = out.filter((i) => DART_PANTS_SIZES.includes(String(i.size)));
    if (state.sizeProfile === "tops")
      out = out.filter((i) =>
        DART_TOP_SIZES.includes(String(i.size).toUpperCase()),
      );
    eq("size", state.size);
    eq("color", state.color);
  }
  if (key === "customers") {
    if (state.dartCard && state.dartCard !== "all")
      eq("dartCard", state.dartCard);
    if (state.monthlyOrders === "up")
      out.sort(
        (a, b) =>
          dartCurrentMonthlyOrders(b.clientId) -
          dartCurrentMonthlyOrders(a.clientId),
      );
    if (state.monthlyOrders === "low")
      out.sort(
        (a, b) =>
          dartCurrentMonthlyOrders(a.clientId) -
          dartCurrentMonthlyOrders(b.clientId),
      );
    if (state.birthday && state.birthday !== "all") {
      const now = new Date(),
        target = new Date(now);
      if (state.birthday === "tomorrow") target.setDate(now.getDate() + 1);
      if (state.birthday === "yesterday") target.setDate(now.getDate() - 1);
      out = out.filter((c) => {
        const d = dartDateValue(c.birthday);
        return (
          d &&
          d.getDate() === target.getDate() &&
          d.getMonth() === target.getMonth()
        );
      });
    }
  }
  if (key === "orders") {
    eq("status", state.status);
    if (state.totalPrice === "up")
      out.sort((a, b) => dartOrderNet(b) - dartOrderNet(a));
    else if (state.totalPrice === "low")
      out.sort((a, b) => dartOrderNet(a) - dartOrderNet(b));
    else
      out.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
    if (state.date && state.date !== "all") {
      const now = Date.now();
      out = out.filter((o) => {
        const d = new Date(o.createdAt || 0);
        if (Number.isNaN(d.getTime())) return false;
        const age = now - d.getTime();
        if (state.date === "an-hour-ago") return age <= 3600000;
        if (state.date === "two-hours-ago") return age <= 7200000;
        if (state.date === "five-hours-ago") return age <= 18000000;
        const today = new Date(),
          od = d.toDateString();
        if (state.date === "today") return od === today.toDateString();
        if (state.date === "yesterday") {
          const y = new Date(today);
          y.setDate(today.getDate() - 1);
          return od === y.toDateString();
        }
        return true;
      });
    }
  }
  if (key === "returns") {
    eq("status", state.status);
    if (state.reason && state.reason !== "all")
      out = out.filter((r) =>
        String(r.reason || "")
          .toLowerCase()
          .includes(String(state.reason).replace(/_/g, " ").toLowerCase()),
      );
    out.sort(
      (a, b) =>
        new Date(b.createdAt || dartDateValue(b.date) || 0) -
        new Date(a.createdAt || dartDateValue(a.date) || 0),
    );
  }
  if (key === "review") {
    if (state.status && state.status !== "all") eq("status", state.status);
    if (state.rating === "up" || state.rating === "Up")
      out.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    else if (state.rating === "low")
      out.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
    else
      out.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
    if (state.source && state.source !== "all")
      out = out.filter((r) =>
        String(
          r.source || (r.recordType === "contact" ? "Contact Us" : "Review"),
        )
          .toLowerCase()
          .includes(state.source.toLowerCase()),
      );
  }
  if (key === "representative") {
    if (state.status && state.status !== "all")
      out = out.filter(
        (r) =>
          String(r.status || "").toLowerCase() ===
          String(state.status).toLowerCase().replace("hidden", "not available"),
      );
  }
  if (key === "card") {
    if (state.status && state.status !== "all") eq("status", state.status);
  }
  if (key === "damage") {
    if (state.status && state.status !== "all") eq("status", state.status);
  }
  return out;
}

