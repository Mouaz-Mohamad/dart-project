(function () {
  'use strict';

  // Business collections are hydrated from PostgreSQL through the shared adapters.

  const email = value => String(value || '').trim().toLowerCase();
  const phone = value => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) return `+${digits}`;
    if (digits.startsWith('01') && digits.length === 11) return `+2${digits}`;
    return digits ? `+${digits}` : '';
  };

  function customerConflict(editId) {
    const wantedEmail = email(document.getElementById('custEmail')?.value);
    const wantedPhones = [phone(document.getElementById('custPhone1')?.value), phone(document.getElementById('custPhone2')?.value)].filter(Boolean);
    const dashboardMatch = customersData.find(customer => String(customer.id) !== String(editId || '') &&
      ((wantedEmail && email(customer.email) === wantedEmail) ||
       wantedPhones.some(value => [phone(customer.phone1), phone(customer.phone2)].includes(value))));
    if (window.DartAdminApi) return dashboardMatch || null;
    if (window.DartDomainState) return dashboardMatch;
    const users = window.DartState?.read?.('dart_users', []) || [];
    const editingCustomer = customersData.find(customer => String(customer.id) === String(editId || ''));
    const userMatch = users.find(user => user.customerId !== editingCustomer?.clientId &&
      ((wantedEmail && email(user.email) === wantedEmail) || wantedPhones.some(value => [phone(user.phone1), phone(user.phone2)].includes(value))));
    return dashboardMatch || userMatch;
  }

  document.addEventListener('submit', event => {
    if (event.target.id !== 'customerForm') return;
    const form = event.target;
    if (!form.checkValidity()) { event.preventDefault(); event.stopImmediatePropagation(); form.reportValidity(); return; }
    const editId = document.getElementById('modal-customer-edit-id')?.value;
    if (customerConflict(editId)) {
      event.preventDefault(); event.stopImmediatePropagation();
      alert('لا يمكن الحفظ: البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل لعميل آخر.');
    }
  }, true);

  document.addEventListener('submit', event => {
    if (event.target.id !== 'return-form') return;
    const itemCode = document.getElementById('modal-return-item-code')?.value.trim();
    const order = ordersData.find(row => row.status === 'Delivered' && (row.items || []).includes(itemCode));
    const refund = Number(document.getElementById('modal-return-refund')?.value) || 0;
    const remaining = order ? Math.max(0, Number(order.totalPrice || 0) * (1 - Number(order.discount || 0) / 100) - Number(order.amountRefunded || 0)) : 0;
    const existingId = document.getElementById('modal-return-edit-id')?.value;
    const duplicate = returnsData.some(row => String(row.id) !== String(existingId || '') && row.itemCode === itemCode && !['Rejected', 'Closed'].includes(row.status));
    if (!order || duplicate || refund < 0 || refund > remaining) {
      event.preventDefault(); event.stopImmediatePropagation();
      alert(!order ? 'لا يمكن إنشاء مرتجع إلا لقطعة من طلب تم تسليمه.' : duplicate ? 'يوجد مرتجع قائم لهذه القطعة.' : `قيمة الاسترداد القصوى المتبقية ${Math.trunc(remaining)} EGP.`);
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const send = document.getElementById('sendBdayBtn');
    if (send) send.addEventListener('click', async () => {
      const selected = [...document.querySelectorAll('#birthday-feed .bday-checkbox:checked')]
        .map(box => box.closest('[data-client-id]')).filter(Boolean);
      if (!selected.length) { alert('اختر عميلًا واحدًا على الأقل.'); return; }
      const queue = structuredClone(window.DartState?.read?.('dart_message_queue', []) || []);
      const history = structuredClone(window.DartState?.read?.('dart_birthday_messages', []) || []);
      const birthdayDiscountPercent = Math.max(
        0,
        Math.min(
          100,
          Number(window.DartSiteSettings?.get?.().birthdayDiscountPercent) || 30,
        ),
      );
      selected.forEach((row, index) => {
        const recordId = row.dataset.clientId;
        const birthdayDate = row.dataset.birthdayDate;
        const customer = customersData.find(item => String(item.id) === String(recordId));
        if (!customer || history.some(item => item.birthdayDate === birthdayDate && (String(item.customerRecordId) === String(recordId) || String(item.clientId) === String(customer.clientId)))) return;
        const messageId = `BDAY-${birthdayDate}-${customer.clientId}`;
        queue.unshift({
          id: `${messageId}-${Date.now()}-${index}`,
          messageKey: messageId,
          customerId: customer.clientId,
          customerName: customer.clientName,
          phone: customer.phone1,
          birthdayDate,
          type: 'birthday-discount',
          discountPercent: birthdayDiscountPercent,
          rewardDays: 7,
          status: 'Pending API',
          createdAt: new Date().toISOString()
        });
        history.unshift({
          id: messageId,
          customerRecordId: recordId,
          clientId: customer.clientId,
          birthdayDate,
          queuedAt: new Date().toISOString(),
          status: 'Queued for Backend'
        });
      });
      if (window.DartDomainState?.write) {
        window.DartDomainState.write('dart_message_queue', queue);
        window.DartDomainState.write('dart_birthday_messages', history);
        await Promise.all([
          window.DartDomainState.syncDomain?.('message_queue'),
          window.DartDomainState.syncDomain?.('birthday_messages'),
        ]);
      } else {
        throw new Error('Birthday messaging requires the secure server state.');
      }
      renderBirthdayWidget();
      alert(`تم تسجيل رسائل خصم عيد الميلاد ${birthdayDiscountPercent}% وإخفاء العملاء من البوكس. سيقوم الـBackend بالإرسال الفعلي.`);
    });
  });

  window.addEventListener('dart:data-changed', () => {
    try { loadAllDataFromStorage(false); dartRefreshAll(); } catch (error) { console.warn('Dashboard sync failed', error); }
  });
})();
