function dartCairoCalendar(reference = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(reference)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}
function dartBirthdayMonthDay(value) {
  const text = String(value || "").trim(),
    yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/),
    dayFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (yearFirst)
    return { month: Number(yearFirst[2]), day: Number(yearFirst[3]) };
  if (dayFirst)
    return { month: Number(dayFirst[2]), day: Number(dayFirst[1]) };
  const parsed = dartDateValue(value);
  return parsed
    ? { month: parsed.getMonth() + 1, day: parsed.getDate() }
    : null;
}
function dartBirthdayMessageBatch(reference = new Date()) {
  const cairo = dartCairoCalendar(reference);
  const targetOffset = cairo.hour >= 20 ? 1 : 0;
  const targetDate = new Date(
      Date.UTC(cairo.year, cairo.month - 1, cairo.day + targetOffset),
    ),
    target = {
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
    },
    key = `${target.year}-${String(target.month).padStart(2, "0")}-${String(target.day).padStart(2, "0")}`,
    history = window.DartState?.read?.("dart_birthday_messages", []) || [],
    all = customersData.filter(dartIsActive).filter((customer) => {
      const birthday = dartBirthdayMonthDay(customer.birthday);
      return (
        birthday &&
        birthday.day === target.day &&
        birthday.month === target.month
      );
    }),
    sent = new Set(
      history
        .filter((row) => row.birthdayDate === key && Boolean(row.outboxEventId))
        .flatMap((row) => [String(row.customerRecordId || ""), String(row.clientId || "")]),
    ),
    rows = all.filter(
      (customer) =>
        !sent.has(String(customer.id)) && !sent.has(String(customer.clientId)),
    );
  return { open: true, key, target, all, rows };
}
function renderBirthdayWidget() {
  const feed = document.getElementById("birthday-feed");
  if (!feed) return;
  const batch = dartBirthdayMessageBatch(),
    rows = batch.rows,
    label = document.getElementById("birthdayWindowLabel"),
    send = document.getElementById("sendBdayBtn");
  if (label)
    label.textContent = `Birthday messages for ${batch.key} · unsent only · refreshes at 8:00 PM Cairo`;
  if (!batch.all.length)
    feed.innerHTML =
      '<div class="dart-empty-state">No customer birthdays in the current message list.</div>';
  else if (!rows.length)
    feed.innerHTML =
      '<div class="dart-empty-state dart-birthday-all-sent">All birthday messages in this list have been queued.</div>';
  else
    feed.innerHTML = rows
      .map(
        (c) =>
          `<div class="bday-item overflow" data-client-id="${dartEsc(c.id)}" data-birthday-date="${dartEsc(batch.key)}"><input type="checkbox" class="bday-checkbox"><span class="bday-date w100">${dartEsc(c.birthday)}</span><span class="bday-name w150">${dartEsc(c.clientName)}</span><span class="bday-age w100">${dartEsc(dartClientAgeLabel(c.birthday))}</span><span class="bday-phone w100">${dartEsc(c.phone1)}</span><span class="orders w100">${dartCurrentMonthlyOrders(c.clientId)} Order</span><span class="from w100">${dartEsc(c.governorate || c.country || "-")}</span></div>`,
      )
      .join("");
  if (send) send.disabled = !rows.length || Boolean(send.dataset.saving);
  const master = document.getElementById("selectAllBirthdays");
  if (master) {
    master.disabled = !rows.length;
    master.checked = false;
    master.indeterminate = false;
    const boxes = [...feed.querySelectorAll(".bday-checkbox")];
    master.onchange = () => boxes.forEach((b) => (b.checked = master.checked));
    feed.onchange = () => {
      const checked = boxes.filter((b) => b.checked).length;
      master.checked = boxes.length > 0 && checked === boxes.length;
      master.indeterminate = checked > 0 && checked < boxes.length;
    };
  }
}

/* BEGIN Brand — birthday message queue action */
async function dartBirthdayDeliveryHealth() {
  if (!window.DartAdminAccess?.can?.("messaging.read")) return;
  const feed=document.getElementById("birthday-feed");
  if (!feed) return;
  let status=document.getElementById("birthdayDeliveryStatus");
  if(!status){status=document.createElement("p");status.id="birthdayDeliveryStatus";status.setAttribute("role","status");feed.after(status);}
  try {
    const {queue,events}=await window.DartAdminApi.request("/api/v1/admin/messaging/delivery-health");
    const whatsapp=(events || []).filter(event=>event.channel==="whatsapp");
    const states=whatsapp.slice(0,5).map(event=>`${event.eventType}: ${event.status}${event.deliveryErrorCode ? ` (${event.deliveryErrorCode})` : ""}`);
    const marketing=whatsapp.filter(event=>event.category==="marketing").length;
    const utility=whatsapp.filter(event=>event.category==="utility").length;
    status.textContent=`Message queue: ${queue.pending} pending · ${queue.uncertain} require review · ${queue.terminal+queue.exhausted} failed · oldest ${queue.oldestSeconds}s. Recent WhatsApp events: ${marketing} Marketing · ${utility} Utility. ${states.join(" · ")}`;
  } catch(error){status.textContent=error.message || "Delivery status unavailable";}
}
function setupBirthdayMessageActions() {
  const send=document.getElementById("sendBdayBtn");
  if(!send || send.dataset.dartBirthdayBound)return;
  send.dataset.dartBirthdayBound="1";
  send.addEventListener("click",async()=>{
    if(send.dataset.saving)return;
    const selected=[...document.querySelectorAll("#birthday-feed .bday-checkbox:checked")].map(box=>box.closest("[data-client-id]")).filter(Boolean);
    if(!selected.length){window.DartDialog.alert("Select at least one customer.");return;}
    send.dataset.saving="1";send.disabled=true;
    try {
      const result=await window.DartAdminApi.request("/api/v1/admin/messaging/birthdays",{method:"POST",body:{
        customerRefs:selected.map(row=>row.dataset.clientId),birthdayDate:selected[0].dataset.birthdayDate,
      }});
      await Promise.all(["birthday_messages","message_queue"].map(domain=>window.DartDomainState.hydrateDomain(domain,true)));
      renderBirthdayWidget();
      await dartBirthdayDeliveryHealth();
      window.DartDialog.alert(`${result.queued} birthday messages queued; ${result.alreadyQueued} already queued; ${result.skipped.length} without recorded consent. Queued is not delivery confirmation.`);
    }catch(error){window.DartDialog.alert(error.message || "Unable to queue birthday messages. Please retry.");}
    finally{delete send.dataset.saving;renderBirthdayWidget();}
  });
  void dartBirthdayDeliveryHealth();
}
/* END Brand — birthday message queue action */

