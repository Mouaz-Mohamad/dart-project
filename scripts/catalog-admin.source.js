// Admin-only, in-memory catalogue baseline. PostgreSQL owns every durable write.
(function () {
  "use strict";
  let baseline = { models: [], items: [] }, flight, epoch = 0;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => !["isChecked", "version", "updatedAt"].includes(key))
      .map((key) => [key, canonical(value[key])]));
  }
  function changes(current, previous, key) {
    const old = new Map(previous.map((row) => [String(row[key]), row]));
    const present = new Set(current.map((row) => String(row[key])));
    const rows = current.filter((row) => JSON.stringify(canonical(row)) !==
      JSON.stringify(canonical(old.get(String(row[key])))));
    for (const row of previous) if (!present.has(String(row[key])) && !(row.isDeleted && row.active === false)) {
      rows.push({ ...row, active: false, isDeleted: true });
    }
    return { rows, versions: Object.fromEntries(rows.map((row) => [
      String(row[key]), Number(old.get(String(row[key]))?.version || 0),
    ])) };
  }
  function merge(current, rows, key) {
    const updated = new Map(rows.map((row) => [String(row[key]), row]));
    return current.map((row) => {
      const next = updated.get(String(row[key]));
      updated.delete(String(row[key]));
      return next ? { ...next, isChecked: row.isChecked } : row;
    }).concat([...updated.values()]);
  }
  window.DartCatalogAdmin = {
    capture(state) { baseline = clone({ models: state.models || [], items: state.items || [] }); },
    reset() { baseline = { models: [], items: [] }; flight = null; epoch += 1; },
    flush(persist, dirty) {
      if (flight) return flight;
      const started = epoch;
      const run = (async () => { do { await persist(); } while (started === epoch && dirty()); })();
      flight = run;
      void run.finally(() => { if (flight === run) flight = null; }).catch(() => {});
      return run;
    },
    merge,
    async save(api, state, isCurrent) {
      const models = changes(state.models, baseline.models, "modelId");
      const items = changes(state.items, baseline.items, "id");
      if (!models.rows.length && !items.rows.length) return { ...state, partial: false };
      const sent = clone(state);
      let result, partial = models.rows.length <= 500 && items.rows.length <= 1000;
      const legacy = () => api("/api/v1/admin/catalog-state", {
        method: "PUT", body: { expectedVersion: state.version, models: sent.models, items: sent.items },
      });
      if (partial) {
        try {
          result = await api("/api/v1/admin/catalog-state", { method: "PATCH", body: {
            expectedVersion: state.version, models: models.rows, items: items.rows,
            recordVersions: { models: models.versions, items: items.versions },
          } });
        } catch (error) {
          if (![404, 405].includes(error.status)) throw error;
          result = await legacy(); partial = false;
        }
      } else result = await legacy();
      if (isCurrent()) {
        baseline = partial ? {
          models: merge(baseline.models, result.models || [], "modelId"),
          items: merge(baseline.items, result.items || [], "id"),
        } : clone(result);
      }
      return { ...result, partial };
    },
  };
})();
