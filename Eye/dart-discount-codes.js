// DART CODE GUIDE | Eye/dart-discount-codes.js
// إدارة أكواد الخصم عبر السيرفر. لا تكتب مبالغ أو حدود استخدام في LocalStorage.
(() => {
  "use strict";
  if (typeof document === "undefined") return;
  const $ = id => document.getElementById(id);
  const form = $("dart-code-form");
  const list = $("dart-codes-list");
  if (!form || !list) return;
  const status = $("dart-code-status");
  let codes = [];
  const can = action => window.DartAdminAccess?.can?.(`promotions.${action}`) === true;
  const api = (path, options) => {
    if (!window.DartAdminApi?.request) throw new Error("Secure admin API is unavailable");
    return window.DartAdminApi.request(path,options);
  };
  const money = value => Math.max(0,Math.round(Number(value || 0) * 100));
  const amount = value => (Number(value || 0) / 100).toFixed(2);
  function notice(message,error=false) {
    status.textContent=message;
    status.dataset.state=error?"error":"success";
  }
  function clear() {
    form.reset();
    $("dart-code-id").value="";
    $("dart-code-version").value="";
    $("dart-code-code").readOnly=false;
    $("dart-code-submit").textContent="Create code";
    $("dart-code-cancel").hidden=true;
    $("dart-code-customer").placeholder="Blank = all customers; or Client ID";
    $("dart-code-customer-limit").value="1";
    $("dart-code-status-select").value="Draft";
  }
  function edit(row) {
    $("dart-code-id").value=row.id;
    $("dart-code-version").value=row.version;
    $("dart-code-name").value=row.name||"";
    $("dart-code-code").value=row.code||"";
    $("dart-code-code").readOnly=true;
    $("dart-code-kind").value=row.kind;
    $("dart-code-percent").value=row.percent;
    $("dart-code-amount").value=amount(row.amountMinor);
    $("dart-code-max").value=amount(row.maxDiscountMinor);
    $("dart-code-min").value=amount(row.minOrderMinor);
    $("dart-code-start").value=row.startsOn||"";
    $("dart-code-end").value=row.endsOn||"";
    $("dart-code-status-select").value=row.status;
    $("dart-code-total").value=row.totalUsageLimit;
    $("dart-code-customer-limit").value=row.perCustomerUsageLimit;
    $("dart-code-customer").value=row.customerUserId||"";
    $("dart-code-scope").value=row.productScope?.mode||"all";
    $("dart-code-scope-values").value=(row.productScope?.values||[]).join(", ");
    $("dart-code-submit").textContent="Save changes";
    $("dart-code-cancel").hidden=false;
    form.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function render() {
    list.replaceChildren();
    if (!codes.length) {
      const empty = document.createElement("p");
      empty.className="dart-settings-empty";
      empty.textContent="No discount codes yet.";
      list.append(empty);
      return;
    }
    for (const code of codes) {
      const row = document.createElement("div");
      row.className="dart-settings-list-row dart-promotion-row";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      const details = document.createElement("small");
      title.textContent=`${code.code} · ${code.kind === "amount" ? amount(code.amountMinor)+" EGP" : Number(code.percent)+"%"}`;
      details.textContent=`${code.name} · ${code.status} · ${code.customerUserId ? "Personal" : "Public"} ·
        ${code.used} used / ${code.reserved} reserved ·
        ${code.totalUsageLimit ? Math.max(0,Number(code.totalUsageLimit)-Number(code.used)-Number(code.reserved))+" remaining" : "Unlimited"}`;
      info.append(title,details);
      const btn = document.createElement("button");
      btn.type="button";
      btn.textContent="Edit";
      btn.disabled=!can("manage");
      btn.addEventListener("click",()=>edit(code));
      row.append(info,btn);
      list.append(row);
    }
  }
  async function load() {
    if (!can("read")) return;
    try {
      const data = await api("/api/v1/admin/discount-codes");
      codes=Array.isArray(data.codes)?data.codes:[];
      render();
    } catch(error) {
      notice(error.message||"Unable to load discount codes",true);
    }
  }
  form.addEventListener("submit",async event => {
    event.preventDefault();
    if (!can("manage")) return notice("Not authorized to manage discount codes",true);
    const value = key => $("dart-code-"+key).value.trim();
    const start=value("start"),end=value("end");
    if (start && end && end<start) return notice("End date must be on or after start date",true);
    const scope=value("scope");
    const values=value("scope-values").split(",").map(x=>x.trim()).filter(Boolean);
    if (scope!=="all" && !values.length) return notice("Choose the eligible products",true);
    const input={
      name:value("name"),code:value("code").toUpperCase(),status:value("status-select"),
      kind:value("kind"),percent:Number(value("percent")||0),amountMinor:money(value("amount")),
      maxDiscountMinor:money(value("max")),minOrderMinor:money(value("min")),
      startsOn:start||null,endsOn:end||null,
      totalUsageLimit:Number(value("total")||0),
      perCustomerUsageLimit:Number(value("customer-limit")||0),
      customerRef:value("customer")||null,
      productScope:{mode:scope,values:scope==="all"?[]:values}
    };
    const id=$("dart-code-id").value,version=Number($("dart-code-version").value);
    const button=$("dart-code-submit");
    button.disabled=true;
    notice("Saving discount code…");
    try {
      const result = id
        ? await api(`/api/v1/admin/discount-codes/${encodeURIComponent(id)}`,{method:"PUT",body:{expectedVersion:version,discountCode:input}})
        : await api("/api/v1/admin/discount-codes",{method:"POST",body:input});
      clear();
      await load();
      notice(`Saved ${result.discountCode?.code || input.code} successfully`);
    } catch(error) { notice(error.message||"Unable to save code",true); }
    finally {button.disabled=false;}
  });
  $("dart-code-cancel").addEventListener("click",clear);
  $("dart-code-refresh").addEventListener("click",()=>void load());
  window.addEventListener("dart:admin-authenticated",()=>void load());
  document.addEventListener("DOMContentLoaded",()=>void load(),{once:true});
  // Scripts can be loaded after DOMContentLoaded when the dashboard is prefetched.
  if (document.readyState!=="loading") void load();
})();