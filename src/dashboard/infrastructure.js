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
  const format = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
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
      term.textContent = title; description.textContent = value; fragment.append(term, description);
    }
    byId(id).replaceChildren(fragment);
  }
  function renderUsage() {
    if (databaseUsage?.available && current) {
      const c = fields().calculator, used = databaseUsage.usedCuHours;
      metrics("infrastructure-database-usage", [["استهلاك التشغيل", `${format(used)} CU-hour`],
        ["المتبقي حسب الحصة التي أدخلتها", c.plan === "free" ? `${format(Math.max(0, c.freeAllowanceCuHours - used))} CU-hour` : "خطة مدفوعة حسب الاستهلاك"],
        ["موعد نهاية دورة الاستهلاك", databaseUsage.periodEnd ? new Date(databaseUsage.periodEnd).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) : "غير متاح"],
        ["حجم التخزين", databaseUsage.storageBytes == null ? "غير متاح" : `${format(databaseUsage.storageBytes / 1024 ** 2)} MB`],
        ["وقت القراءة", new Date(databaseUsage.asOf).toLocaleString("ar-EG")]]);
    }
    if (hostingUsage?.available) {
      const deployments = hostingUsage.deployments || [], complete = deployments.length && deployments.every(item => item.available && item.complete);
      const count = deployments.reduce((sum, item) => sum + (item.count || 0), 0), billed = hostingUsage.billedUsd;
      const budget = number("infra-hosting-budget");
      metrics("infrastructure-hosting-usage", [["ديبلوي المشاريع المحددة هذا الشهر", complete ? format(count) : "غير مكتمل — تعذر قراءة بعض الصفحات أو المشاريع"],
        ["عدد طلبات المشاريع", hostingUsage.requests == null ? "غير متاح بالصلاحيات الحالية" : format(hostingUsage.requests)],
        ["مصروفات الفريق المسجلة بالدولار", billed == null ? "غير متاح بالصلاحيات الحالية" : format(billed)],
        ["المتبقي من ميزانيتك المدخلة", !budget || billed == null ? "غير متاح — أدخل ميزانية واقرأ التكلفة" : `${format(Math.max(0, budget - billed))} USD`],
        ["المتوقع إذا استمر نفس معدل المصروفات", billed == null ? "غير متاح" : `${format(billed * new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0).getDate() / Math.max(1, (Date.now() - Date.parse(hostingUsage.periodStart)) / 86400000))} USD — تقدير وليس فاتورة`],
        ["حد الديبلوي / الرصيد الرسمي المتبقي", "غير متاح من واجهة القراءة — راجع فوترة Vercel"],
        ["وقت القراءة", new Date(hostingUsage.asOf).toLocaleString("ar-EG")]]);
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
      fill(payload); status(payload.schedulerConfigured ? "تم تحميل الإعدادات." : "يلزم ربط صلاحية Variables في GitHub بالخادم لحفظ جدول التشغيل. الحاسبة متاحة للتجربة.");
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
        if (!data.available) metrics(output, [["الحالة", "غير متاح — يلزم ربط صلاحيات القراءة بالخادم أو مراجعة اتصال المزود. لا يتم عرض أرقام تقديرية مكان الاستهلاك الفعلي."]]);
        else { await load(); renderUsage(); }
      } catch { if (epoch === generation) metrics(output, [["الحالة", "تعذر الاتصال. أعد المحاولة."]]); }
      finally { button.disabled = false; }
    });
  }
  document.addEventListener("click", event => {
    if (event.target.closest?.('[data-settings-tab="database"],[data-settings-tab="hosting"]')) void load();
  });
  window.addEventListener("dart:admin-authenticated", access);
  window.addEventListener("dart:admin-logged-out", () => {
    generation++; current = hostingUsage = databaseUsage = null; dirty = false; form.reset();
    byId("infrastructure-fields").disabled = true; byId("infrastructure-process").disabled = true;
    for (const kind of ["database", "hosting"]) metrics(`infrastructure-${kind}-usage`, [["الحالة", "سجّل الدخول لعرض البيانات."]]); access();
  });
  access();
})();
