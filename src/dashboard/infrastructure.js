/* Database/hosting controls are loaded only when Settings is opened. No provider tokens reach the browser. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const form = byId("infrastructure-form");
  if (!form) return;
  let current = null, loading = false, saving = false, dirty = false, generation = 0, hostingUsage = null, databaseUsage = null;
  const can = () => window.DartAdminAccess?.can?.("settings.manage") === true;
  const request = (path, options) => window.DartAdminApi.request("/api/v1/admin/infrastructure" + path, options);
  const number = id => Number(byId(id).value);
  const format = value => value == null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const status = (message, error = false) => { byId("infrastructure-status").textContent = message; byId("infrastructure-status").dataset.error = String(error); };
  const fields = () => ({
    schedule: { enabled: byId("infra-enabled").checked, intervalMinutes: number("infra-interval"), quietEnabled: byId("infra-quiet").checked,
      quietStart: byId("infra-start").value, quietEnd: byId("infra-end").value },
    calculator: { plan: byId("infra-plan").value, computeCu: number("infra-cu"), computeRateUsd: number("infra-rate"),
      freeAllowanceCuHours: number("infra-allowance"), hostingBudgetUsd: number("infra-hosting-budget") },
  });
  function metrics(id, entries) {
    const fragment = document.createDocumentFragment();
    for (const [title, value] of entries) {
      const term = document.createElement("dt"), description = document.createElement("dd");
      term.textContent = title; description.textContent = value; const tile = document.createElement("div"); tile.append(term, description); fragment.append(tile);
    }
    byId(id).replaceChildren(fragment);
  }
  const date = value => value ? new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) : "—";
  const plan = value => ({ launch_v3: "Launch · مدفوعة", launch: "Launch · مدفوعة", pro: "Pro", hobby: "Hobby" }[value] || value || "—");
  const duration = (start, end) => {
    const seconds = Math.floor((Date.parse(end) - Date.parse(start)) / 1000);
    return Number.isFinite(seconds) && seconds >= 0 ? `${format(Math.floor(seconds / 3600))} س ${format(Math.floor(seconds % 3600 / 60))} د` : "—";
  };
  function renderUsage() {
    if (databaseUsage?.available) {
      const a = databaseUsage.account || {}, c = databaseUsage.compute;
      metrics("infrastructure-database-usage", [
        ["الحساب", a.email || "—"], ["الخطة", plan(a.plan)],
        ["استهلاك الدورة", `${format(databaseUsage.usedCuHours)} CU-hour`],
        ["حالة القاعدة", c ? ({ active: "نشطة", idle: "نائمة" }[c.state] || c.state) : "—"],
        ["مدة التشغيل الحالية", c?.state === "active" ? duration(c.startedAt, databaseUsage.asOf) : "—"],
        ["حجم التشغيل", c ? `${format(c.minCu)} – ${format(c.maxCu)} CU` : "—"],
        ["نقل البيانات", databaseUsage.transferBytes == null ? "—" : `${format(databaseUsage.transferBytes / 1024 ** 2)} MB`],
        ["نهاية الدورة", date(databaseUsage.periodEnd)],
        ["النوم بعد الخمول", c?.suspendSeconds == null ? "—" : c.suspendSeconds === 0 ? "غير مفعّل" : `${format(c.suspendSeconds / 60)} دقيقة`],
        ["آخر تحديث", date(databaseUsage.asOf)]
      ]);
    }
    if (hostingUsage?.available) {
      const a = hostingUsage.account || {}, deployments = hostingUsage.deployments || [];
      const complete = deployments.length && deployments.every(item => item.available && item.complete);
      metrics("infrastructure-hosting-usage", [
        ["الحساب", a.email || a.name || "—"], ["الفريق والخطة", `${a.team || "—"} · ${plan(a.plan)}`],
        ["الديبلوي هذا الشهر", complete ? format(deployments.reduce((sum, item) => sum + item.count, 0)) : "غير مكتمل"],
        ["طلبات الموقع والـAPI", format(hostingUsage.requests)],
        ["المصروفات المسجلة للفريق", hostingUsage.billedUsd == null ? "—" : `$${format(hostingUsage.billedUsd)}`],
        ["آخر تحديث", date(hostingUsage.asOf)]
      ]);
    }
  }
  function estimate() {
    if (!current) return;
    const { schedule: s, calculator: c } = fields();
    const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const quiet = s.quietEnabled ? (minute(s.quietEnd) - minute(s.quietStart) + 1440) % 1440 : 0;
    if (!s.intervalMinutes || s.intervalMinutes < 5 || s.intervalMinutes % 5 || (s.quietEnabled && s.quietStart === s.quietEnd)) {
      byId("infrastructure-estimate").textContent = "أدخل فاصلًا صحيحًا بمضاعفات 5 دقائق وفترة توقف صحيحة."; return;
    }
    const runs = s.enabled ? Math.ceil((1440 - quiet) / s.intervalMinutes) : 0;
    const cuHours = Math.min(1440, runs * 5) * 30 / 60 * c.computeCu;
    byId("infrastructure-estimate").textContent = `${runs} فحص/يوم تقريبًا · ${runs * 30} فحص/30 يوم · ${format(cuHours)} CU-hour · ${c.plan === "paid" ? format(cuHours * c.computeRateUsd) + " USD تشغيل" : cuHours > c.freeAllowanceCuHours ? "يتجاوز الحصة المجانية المدخلة" : "داخل الحصة المجانية المدخلة"}`;
    renderUsage();
  }
  function fill(payload) {
    current = payload;
    window.dispatchEvent(new CustomEvent("dart:background-schedule", { detail: { schedule: payload.settings.schedule } }));
    const s = payload.settings.schedule, c = payload.settings.calculator;
    byId("infra-enabled").checked = s.enabled; byId("infra-quiet").checked = s.quietEnabled;
    for (const [id, value] of Object.entries({ "infra-interval": s.intervalMinutes, "infra-start": s.quietStart, "infra-end": s.quietEnd,
      "infra-plan": c.plan, "infra-cu": c.computeCu, "infra-rate": c.computeRateUsd, "infra-allowance": c.freeAllowanceCuHours, "infra-hosting-budget": c.hostingBudgetUsd })) byId(id).value = value;
    dirty = false; byId("infrastructure-fields").disabled = false; byId("infrastructure-process").disabled = false;
    byId("infrastructure-save").disabled = !payload.schedulerConfigured;
    estimate();
  }
  async function load(force = false) {
    if (!can() || loading || saving || dirty || (current && !force)) return;
    loading = true; const epoch = generation;
    status("جارٍ تحميل الإعدادات…");
    try {
      const payload = await request(""); if (epoch !== generation || !can()) return;
      fill(payload); status(payload.schedulerConfigured ? "التوقيت بتوقيت مصر." : "ربط الجدولة مطلوب لتفعيل الحفظ.");
    } catch { if (epoch === generation) status("تعذر تحميل الإعدادات. أعد المحاولة بعد استعادة اتصال قاعدة البيانات.", true); }
    finally { loading = false; }
  }
  function access() {
    for (const id of ["settings-tab-database", "settings-tab-hosting", "settings-database-card", "settings-hosting-card"]) byId(id).hidden = !can();
    window.DartSettingsTabs?.refresh?.();
  }
  form.addEventListener("input", () => { dirty = true; estimate(); });
  byId("infra-hosting-budget").addEventListener("input", () => { dirty = true; estimate(); status("ميزانية غير محفوظة؛ احفظ من قسم قاعدة البيانات."); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (!current || saving || !can() || !form.reportValidity() || !byId("infra-hosting-budget").reportValidity()) return;
    saving = true; const epoch = generation, settings = fields();
    byId("infrastructure-fields").disabled = true; byId("infra-hosting-budget").disabled = true;
    status("جارٍ حفظ ومزامنة الجدول…");
    try {
      const payload = await request("", { method: "PUT", body: { expectedRevision: current.revision, settings } });
      if (epoch !== generation || !can()) return; fill(payload); void window.DartSiteSettings?.hydrate?.(true).catch(() => {}); status("تم حفظ الإعدادات ومزامنتها مع العامل المجدول.");
    } catch (error) { if (epoch === generation) status(error.status === 409 ? "الإعدادات اتغيرت من جهاز آخر. احتفظ بقيمك، ثم اضغط إعادة تحميل وراجعها قبل الحفظ." : "تعذر حفظ ومزامنة الجدول. راجع اتصال القاعدة وصلاحيات GitHub؛ لم يتم تأكيد الحفظ.", true); }
    finally { saving = false; if (epoch === generation && can()) { byId("infrastructure-fields").disabled = false; byId("infra-hosting-budget").disabled = false; } }
  });
  byId("infrastructure-reload").addEventListener("click", async () => {
    if (dirty && !await window.DartDialog.confirm("إعادة التحميل هتلغي تعديلاتك غير المحفوظة. متأكد؟")) return;
    dirty = false; void load(true);
  });
  byId("infrastructure-process").addEventListener("click", async () => {
    if (!can() || !await window.DartDialog.confirm("إرسال دفعة من الرسائل المعلّقة الآن، حتى أثناء فترة التوقف؟")) return;
    const button = byId("infrastructure-process"), epoch = generation; button.disabled = true; status("جارٍ معالجة الرسائل المعلّقة…");
    try { const result = await request("/process", { method: "POST", body: {} }); if (epoch === generation && can()) status(`تمت المعالجة: ${result.published || 0} منشور، ${result.failed || 0} فشل، ${result.uncertain || 0} غير مؤكد. لا تعني كلمة منشور تأكيد وصول الرسالة.`); }
    catch { if (epoch === generation) status("تعذر تأكيد نتيجة الإرسال. راجع سجل الرسائل قبل إعادة المحاولة.", true); }
    finally { if (epoch === generation && can()) button.disabled = false; }
  });
  for (const kind of ["database", "hosting"]) {
    const button = byId(`infrastructure-${kind}-refresh`), output = `infrastructure-${kind}-usage`;
    button.addEventListener("click", async () => {
      if (!can()) return; const epoch = generation; button.disabled = true; metrics(output, [["الحالة", "جارٍ قراءة البيانات…"]]);
      try {
        const data = await request(`/usage/${kind}`); if (epoch !== generation || !can()) return;
        if (kind === "database") databaseUsage = data; else hostingUsage = data;
        if (!data.available) metrics(output, [["الحالة", "الحساب غير مربوط بالخادم."]]);
        else { await load(); renderUsage(); }
      } catch { if (epoch === generation) metrics(output, [["الحالة", "تعذر الاتصال. أعد المحاولة."]]); }
      finally { button.disabled = false; }
    });
  }
  document.addEventListener("click", event => {
    const tab = event.target.closest?.('[data-settings-tab="database"],[data-settings-tab="hosting"]');
    if (!tab) return;
    void load();
    const kind = tab.dataset.settingsTab;
    if (can() && !(kind === "database" ? databaseUsage : hostingUsage)) byId(`infrastructure-${kind}-refresh`).click();
  });
  window.addEventListener("dart:admin-authenticated", access);
  window.addEventListener("dart:admin-logged-out", () => {
    generation++; current = hostingUsage = databaseUsage = null; dirty = false; form.reset();
    byId("infrastructure-fields").disabled = true; byId("infrastructure-process").disabled = true;
    for (const kind of ["database", "hosting"]) metrics(`infrastructure-${kind}-usage`, [["الحالة", "سجّل الدخول لعرض البيانات."]]); access();
  });
  access();
})();
