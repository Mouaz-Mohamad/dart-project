const dartApplyFiltersV3Base = dartApplyFilters;
dartApplyFilters = function (key, data) {
  let out = dartApplyFiltersV3Base(key, data);
  if (key === "returns") {
    const state = dartFilterState.returns || {},
      v = state.reason;
    if (v && v !== "all") {
      const map = {
          wrong_size: ["مقاس", "size"],
          defective: ["عيب", "تلف", "defect"],
          not_as_described: ["صورة", "وصف", "different"],
          wrong_item: ["مختلف", "wrong"],
          quality_issue: ["خامة", "quality"],
          changed_mind: ["رأي", "بحاجة", "mind"],
          missing_parts: ["نقص", "missing"],
          other: ["آخر", "other"],
        },
        terms = map[v] || [String(v).replace(/_/g, " ")];
      out = [...(data || [])].filter((r) =>
        terms.some((t) =>
          String(r.reason || "")
            .toLowerCase()
            .includes(String(t).toLowerCase()),
        ),
      );
      const st = dartFilterState.returns;
      if (st.search)
        out = out.filter((x) => dartSectionSearchText(x).includes(st.search));
      if (st.archive === "active") out = out.filter(dartIsActive);
      else if (st.archive === "archived") out = out.filter(dartIsArchived);
      if (st.status && st.status !== "all")
        out = out.filter(
          (r) =>
            String(r.status).toLowerCase() === String(st.status).toLowerCase(),
        );
      out.sort(
        (a, b) =>
          new Date(b.createdAt || dartDateValue(b.date) || 0) -
          new Date(a.createdAt || dartDateValue(a.date) || 0),
      );
    }
  }
  return out;
};
// Brand Total Cost owns each physical piece once, regardless of its current status.
function dartTotalInventoryCost() {
  return itemsData
    .filter((i) => !i.isDeleted)
    .reduce((a, i) => {
      const m = dartFindModelByCode(i.modelId);
      return a + (Number(i.costSnapshot ?? m?.cost) || 0);
    }, 0);
}

// END DART EYE | DASHBOARD CORE
