(function () {
  'use strict';
  window.DartOperationsV4 = Object.freeze({ active: true });
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_SAVED_IMAGE_BYTES = 650 * 1024;
  let dashboardAddress = null;

  const read = (key, fallback = []) =>
    window.DartState?.read?.(key, fallback) ?? fallback;
  const write = (key, value) => {
    if (key === 'dart_orders' && window.DartOrdersApi) {
      window.DartOrdersApi.write(value);
      return;
    }
    if (window.DartDomainState?.domainForStorageKey?.(key)) {
      window.DartDomainState.write(key, value);
      return;
    }
    window.DartState?.write?.(key, value, { source: 'operations-v4' });
  };
  const field = id => document.getElementById(id);
  const value = id => String(field(id)?.value || '').trim();
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
if (typeof dartMoney === 'function') {
    dartMoney = amount => `${Math.trunc(Number(amount) || 0)} EGP`;
  }
  if (typeof dartOrderNet === 'function') {
    dartOrderNet = order => {
      if (Number.isFinite(Number(order?.finalAmount))) return Math.max(0, Number(order.finalAmount));
      const subtotal = Number(order?.totalPrice) || 0;
      const discountAmount = Number.isFinite(Number(order?.orderLevelDiscountAmount))
        ? Number(order.orderLevelDiscountAmount)
        : subtotal * (Number(order?.discount) || 0) / 100;
      return Math.max(0, subtotal - discountAmount);
    };
  }

  const orderForm = field('orderForm');
  const repForm = field('rep-form');
  if (orderForm) { orderForm.dataset.dartV3 = '1'; orderForm.dataset.dartV2 = '1'; orderForm.dataset.dartV4 = '1'; }
  if (repForm) { repForm.dataset.dartV3 = '1'; repForm.dataset.dartV2 = '1'; repForm.dataset.dartV4 = '1'; }

  function migrateOrderTotals() {
    if (typeof ordersData === 'undefined') return;
    let changed = false;
    ordersData.forEach(order => {
      const subtotal = Number(order.totalPrice) || (order.priceSnapshot || []).reduce((sum, line) => sum + (Number(line.finalUnitPrice) || 0) * (Number(line.qty) || 1), 0);
      const discountAmount = Number.isFinite(Number(order.orderLevelDiscountAmount))
        ? Number(order.orderLevelDiscountAmount)
        : subtotal * (Number(order.discount) || 0) / 100;
      const finalAmount = Math.max(0, subtotal - discountAmount);
      if (order.totalPrice !== subtotal || order.orderLevelDiscountAmount !== discountAmount || order.finalAmount !== finalAmount) changed = true;
      order.totalPrice = subtotal;
      order.orderLevelDiscountAmount = discountAmount;
      order.finalAmount = finalAmount;
    });
    if (changed) write('dart_orders', ordersData);
  }

  function initDashboardAddress() {
    if (dashboardAddress || !window.DartAddress) return dashboardAddress;
    dashboardAddress = window.DartAddress.create({
      form:'#orderForm', map:'#dashboard-order-map', search:'#orderAddress', results:'#dashboard-address-results',
      latitude:'#orderLatitude', longitude:'#orderLongitude', fullAddress:'#orderFullAddress',
      country:'#orderCountry', governorate:'#governorate', area:'#orderArea', street:'#orderStreetName',
      building:'#orderBuildingNumber', floor:'#orderFloor', status:'#dashboard-address-status',
      manualButton:'#dashboard-locate-manual-address', overwriteFromMap:true
    });
    return dashboardAddress;
  }

  function resetOrderAddress() {
    ['orderAddress','orderLatitude','orderLongitude','orderFullAddress','orderCountry','governorate','orderArea','orderStreetName','orderBuildingNumber','orderFloor']
      .forEach(id => { if (field(id)) field(id).value = id === 'orderCountry' ? 'Egypt' : id === 'governorate' ? 'Cairo' : ''; });
    if (orderForm) { orderForm.dataset.dartAddressSource = ''; orderForm.dataset.dartAddressReady = 'false'; }
  }

  function bindOrderModalV4() {
    if (!orderForm || orderForm.dataset.dartV4Bound) return;
    orderForm.dataset.dartV4Bound = '1';
    let selected = [];
    const selectedList = field('selectedProductsList');
    const codeInput = field('productsInputCode');

    function calculate() {
      const existing=ordersData.find(order=>String(order.id)===value('modal-order-edit-id'));
      // BEGIN Immutable prices: existing lines and same-model additions retain the order's original transaction price/cost.
      const snapshot = selected.map(code=>{
        const saved=existing?.priceSnapshot?.find(line=>line.itemCode===code);
        if (saved) return structuredClone(saved);
        const current=dartPriceSnapshotForCodes([code])[0];
        if (!current) return current;
        const historical=existing?.priceSnapshot?.find(line=>String(line.modelCode)===String(current.modelCode));
        return historical ? {
          ...current,
          originalUnitPrice:Number(historical.originalUnitPrice)||0,
          discountPercent:Number(historical.discountPercent)||0,
          discountAmount:Number(historical.discountAmount)||0,
          finalUnitPrice:Number(historical.finalUnitPrice)||0,
          costSnapshot:Number(historical.costSnapshot)||0,
          inheritedFromOrderSnapshot:true
        } : current;
      });
      // END Immutable prices.
      const subtotal = snapshot.reduce((sum, line) => sum + (Number(line.finalUnitPrice) || 0) * (Number(line.qty) || 1), 0);
      const discountPercent = Math.min(100, Math.max(0, Number(value('deductions')) || 0));
      const discountAmount = subtotal * discountPercent / 100;
      const finalAmount = Math.max(0, subtotal - discountAmount);
      if (field('subtotalVal')) field('subtotalVal').textContent = dartMoney(subtotal);
      if (field('discountVal')) field('discountVal').textContent = dartMoney(discountAmount);
      if (field('totalVal')) field('totalVal').textContent = dartMoney(finalAmount);
      if (field('customDiscount')) field('customDiscount').value = Math.trunc(discountAmount);
      return { snapshot, subtotal, discountPercent, discountAmount, finalAmount };
    }

    function renderSelected() {
      if (selectedList) selectedList.innerHTML = selected.map((code, index) =>
        `<span class="order-item-chip"><b>${dartEsc(code)}</b><button type="button" class="remove-item-btn" data-index="${index}" aria-label="Remove ${dartEsc(code)}">&times;</button></span>`
      ).join('');
      calculate();
    }

    function populateLists() {
      const list = field('items-datalist');
      if (list) list.innerHTML = itemsData.filter(item => dartIsActive(item) && String(item.status).toLowerCase() === 'in stock')
        .map(item => `<option value="${dartEsc(item.itemCode)}">${dartEsc(item.modelId)} — ${dartEsc(item.color)} (${dartEsc(item.size)})</option>`).join('');
      if (typeof populateModelsDatalist === 'function') populateModelsDatalist();
    }

    field('openModalBtn')?.addEventListener('click', () => {
      orderForm.reset(); selected = []; resetOrderAddress(); populateLists(); renderSelected();
      if (field('modal-order-edit-id')) field('modal-order-edit-id').value = '';
      if (typeof openModal === 'function') openModal(field('orderModal'));
      initDashboardAddress()?.invalidate();
    });

    field('addProductBtn')?.addEventListener('click', () => {
      const code = value('productsInputCode');
      const item = typeof dartFindItemByCode === 'function' ? dartFindItemByCode(code) : null;
      if (!item || dartIsArchived(item) || String(item.status).toLowerCase() !== 'in stock') return alert('This physical item is not available.');
      if (!selected.includes(code)) selected.push(code);
      if (codeInput) codeInput.value = '';
      renderSelected();
    });

    field('autoAllocateProductBtn')?.addEventListener('click', () => {
      const result = dartAutoAllocate(value('orderModelCode'), value('orderItemColor'), value('orderItemSize'), Math.max(1, Number(value('orderItemQty')) || 1), selected);
      if (!result.ok) return alert(result.message);
      selected.push(...result.codes); renderSelected();
    });

    selectedList?.addEventListener('click', event => {
      const button = event.target.closest('.remove-item-btn');
      if (!button) return;
      selected.splice(Number(button.dataset.index), 1); renderSelected();
    });
    field('deductions')?.addEventListener('input', calculate);

    window.loadOrderItemsForEdit = codes => { selected = [...(codes || [])]; populateLists(); renderSelected(); };

    orderForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!selected.length) return alert('Add at least one physical item.');

      const address = initDashboardAddress()?.validate();
      if (!address?.ok) {
        return alert(address?.message || 'Complete and locate the delivery address.');
      }

      const prices = calculate();
      const editId = value('modal-order-edit-id');
      const existing = ordersData.find(order => String(order.id) === String(editId));
      const customerId = value('clientId') || '-';
      const customer = dartFindCustomerByCode(customerId);
      if (customer && dartIsArchived(customer)) {
        return alert('An archived customer cannot be used.');
      }

      let amountPaid = Math.max(0, Number(value('amountPaid')) || 0);
      let paymentStatus = value('paymentStatus') || 'Unpaid';
      if (paymentStatus === 'Paid') amountPaid = prices.finalAmount;
      if (paymentStatus === 'Unpaid') amountPaid = 0;
      if (amountPaid > prices.finalAmount) {
        return alert('Amount paid cannot exceed the final order total.');
      }

      const apiPayload = {
        ...(customerId && customerId !== '-' ? { clientId: customerId } : {}),
        clientName: value('clientName'),
        phone1: value('phone1'),
        ...(value('phone2') ? { phone2: value('phone2') } : {}),
        ...(value('email') && value('email') !== '-' ? { email: value('email') } : {}),
        paymentMethod: value('paymentMethod') || 'Cash on Delivery',
        paymentStatus,
        amountPaid,
        amountRefunded: Math.max(0, Number(value('amountRefunded')) || 0),
        orderSource: value('orderSource') || 'Manual',
        deliveryNotes: value('deliveryNotes'),
        itemCodes: [...selected],
        discountPercent: Math.max(0, Math.min(100, Number(prices.discountPercent) || 0)),
        country: value('orderCountry') || 'Egypt',
        governorate: value('governorate'),
        area: value('orderArea'),
        street: value('orderStreetName'),
        building: value('orderBuildingNumber'),
        floor: value('orderFloor'),
        latitude: value('orderLatitude'),
        longitude: value('orderLongitude'),
        fullAddress: value('orderFullAddress') || value('orderAddress'),
      };

      if (apiPayload.amountRefunded > prices.finalAmount) {
        return alert('Refund cannot exceed the final order total.');
      }

      if (window.DartOrdersApi?.createManual && window.DartOrdersApi?.updateManual) {
        try {
          if (existing) {
            await window.DartOrdersApi.updateManual(
              existing.orderId || existing.id,
              apiPayload,
            );
          } else {
            await window.DartOrdersApi.createManual(apiPayload);
          }

          await Promise.allSettled([
            window.DartOrdersApi.hydrate?.(true),
            window.DartCatalog?.hydrate?.(true),
            window.DartDomainState?.hydrateAudit?.(),
          ]);

          dartRefreshAll();
          closeModal(field('orderModal'));
          orderForm.reset();
          selected = [];
          resetOrderAddress();
          renderSelected();
        } catch (error) {
          alert(error.message || 'Order could not be saved to the database.');
        }
        return;
      }

      const payload = {
        clientId: customerId,
        clientName: value('clientName'),
        phone1: value('phone1'),
        phone2: value('phone2') || '-',
        email: value('email') || '-',
        paymentMethod: apiPayload.paymentMethod,
        paymentStatus,
        amountPaid,
        amountRefunded: apiPayload.amountRefunded,
        orderSource: apiPayload.orderSource,
        deliveryNotes: apiPayload.deliveryNotes,
        items: [...selected],
        totalProducts: selected.length,
        priceSnapshot: prices.snapshot,
        totalPrice: prices.subtotal,
        discount: prices.discountPercent,
        orderLevelDiscountAmount: prices.discountAmount,
        finalAmount: prices.finalAmount,
        reasonDeduction: prices.discountPercent ? 'Order discount' : '-',
        country: apiPayload.country,
        governorate: apiPayload.governorate,
        area: apiPayload.area,
        street: apiPayload.street,
        building: apiPayload.building,
        floor: apiPayload.floor,
        latitude: apiPayload.latitude,
        longitude: apiPayload.longitude,
        fullAddress: apiPayload.fullAddress,
        addressSource: address.source || orderForm.dataset.dartAddressSource || 'map',
      };

      if (existing) {
        const oldCodes = [...(existing.items || [])];
        const newlySelected = selected.filter(code => !oldCodes.includes(code));
        const reservation = dartReserveItems(existing, newlySelected);
        if (!reservation.ok) return alert(reservation.message);
        oldCodes.filter(code => !selected.includes(code)).forEach(code => {
          const item = dartFindItemByCode(code);
          if (item && item.status === 'Processing/Held') {
            item.status = 'In stock';
            item.orderId = '';
          }
        });
        const old = {...existing};
        Object.assign(existing, payload, {updatedAt: now()});
        dartAudit('EDIT', 'orders', existing.id, old, payload, 'Order, price and delivery address updated');
        dartLogOrder(existing, 'ORDER_EDITED', existing.status, existing.status, {notes:'Order, final price or address edited'});
      } else {
        const order = {
          id:uid('ODB'),
          orderId:dartNextBusinessCode('K', ordersData, 'orderId'),
          date:new Date().toLocaleDateString('en-GB'),
          time:new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
          status:'New',
          createdAt:now(),
          orderCreatedAt:now(),
          activityLog:[],
          isArchived:false,
          isDeleted:false,
          isChecked:false,
          ...payload
        };
        const reservation = dartReserveItems(order, selected);
        if (!reservation.ok) return alert(reservation.message);
        dartLogOrder(order, 'ORDER_CREATED', null, 'New', {notes:'Manual dashboard order'});
        ordersData.push(order);
        dartAudit('CREATE', 'orders', order.id, {}, order);
        dartNotify('new_order', `New order ${order.orderId}`, `${order.clientName} — ${selected.length} item(s)`, 'orders', order.id);
      }

      dartSaveAll();
      dartRefreshAll();
      closeModal(field('orderModal'));
      orderForm.reset();
      selected = [];
      resetOrderAddress();
      renderSelected();

    });
  }

  function previewImage(element, dataUrl) {
    if (!element) return;
    if (dataUrl) { element.src = dataUrl; element.hidden = false; }
    else { element.removeAttribute('src'); element.hidden = true; }
  }

  function dataUrlBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.ceil(base64.length * 3 / 4);
  }

  async function compressImage(file) {
    if (!file) return '';
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('Only JPG, PNG and WebP images are accepted.');
    if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('Each source image must be 5 MB or smaller.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source;
    });
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d', {alpha:false}).drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = .84; let result = canvas.toDataURL('image/webp', quality);
    while (dataUrlBytes(result) > MAX_SAVED_IMAGE_BYTES && quality > .42) { quality -= .08; result = canvas.toDataURL('image/webp', quality); }
    if (dataUrlBytes(result) > MAX_SAVED_IMAGE_BYTES) throw new Error('The compressed image is still too large. Use a smaller image.');
    return result;
  }

  function setupRepImagePreviews() {
    const pairs = [['modal-rep-id-front','modal-rep-id-front-preview'],['modal-rep-id-back','modal-rep-id-back-preview'],['modal-rep-face','modal-rep-face-preview']];
    pairs.forEach(([inputId, previewId]) => field(inputId)?.addEventListener('change', async event => {
      try { previewImage(field(previewId), await compressImage(event.target.files[0])); }
      catch (error) { event.target.value = ''; previewImage(field(previewId), ''); alert(error.message); }
    }));
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let securePasswordResetRequests = [];

  function requireAdminApi() {
    if (!window.DartAdminApi?.request) {
      throw new Error('Secure admin API is required for this operation.');
    }
    return window.DartAdminApi.request;
  }

  async function hydrateSecureRepresentatives() {
    const request = requireAdminApi();
    const payload = await request('/api/v1/admin/representatives');
    const rows = Array.isArray(payload.representatives) ? payload.representatives : [];
    representativeData = rows;
    return rows;
  }

  async function hydrateSecurePasswordRequests() {
    const request = requireAdminApi();
    const payload = await request('/api/v1/admin/password-reset-requests');
    securePasswordResetRequests = Array.isArray(payload.requests) ? payload.requests : [];
    renderPasswordRequests();
    return securePasswordResetRequests;
  }

  function renderRepresentativesV4(dataArray) {
    const container = field('representative-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(rep => {
      const current = ordersData.filter(
        order =>
          [String(rep.id), String(rep.repId)].includes(String(order.representativeId)) &&
          !DART_FINAL_ORDER_STATES.includes(order.status),
      ).length;
      const total = ordersData.filter(
        order => [String(rep.id), String(rep.repId)].includes(String(order.representativeId)),
      ).length;
      const serverBacked = UUID_RE.test(String(rep.id || ''));
      const maskedNationalId = rep.nationalIdLast4
        ? `••••••••••${dartEsc(rep.nationalIdLast4)}`
        : 'Stored securely';
      const documents = serverBacked
        ? [
            ['ID front', 'id_front'],
            ['ID back', 'id_back'],
            ['Face', 'face'],
          ].map(([label, type]) =>
            `<button type="button" class="dart-rep-document" data-document-type="${type}" title="${dartEsc(label)}">${dartEsc(label)}</button>`,
          ).join('')
        : '<span class="dart-photo-missing">Legacy record</span>';
      const approval = serverBacked && rep.status === 'Pending Approval'
        ? '<button class="dart-approve-rep" type="button">Approve</button><button class="dart-reject-rep" type="button">Reject</button>'
        : '';

      container.insertAdjacentHTML('beforeend', `
        <div class="${getRowClass(rep)}" data-id="${dartEsc(rep.id)}">
          <input type="checkbox" class="model-checkbox" ${rep.isChecked ? 'checked' : ''}>
          <div class="w300 button row-action-btns">
            <button class="action-btn btn-delete" title="${rep.status === 'Suspended' ? 'Activate' : 'Suspend'}"><i class="bx ${rep.status === 'Suspended' ? 'bx-revision' : 'bx-minus-circle'}"></i></button>
            <button class="action-btn btn-hard-delete" title="Delete account"><i class="bx bx-trash"></i></button>
            <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
            <button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button>
            <button class="dart-rep-reset" type="button" title="Set temporary password"><i class="bx bx-key"></i></button>
            ${approval}
          </div>
          <span class="text-item w200">${dartEsc(rep.name)}</span>
          <span class="text-item w150">${dartEsc(rep.repId)}</span>
          <span class="text-item w150"><span class="status-pill ${dartStatusClass(rep.status)}">${dartEsc(rep.status)}</span></span>
          <span class="text-item w150">${maskedNationalId}</span>
          <span class="text-item w150">${current}</span>
          <span class="text-item w100">${total}</span>
          <span class="text-item w150">${dartEsc(rep.phone1 || '-')}</span>
          <span class="text-item w150">${dartEsc(rep.phone2 || '-')}</span>
          <span class="text-item w200">${dartEsc(rep.email || '-')}</span>
          <span class="text-item w200">${dartEsc(rep.address || '-')}</span>
          <span class="text-item w300 dart-rep-photos">${documents}</span>
          <span class="text-item w150">${dartEsc(rep.createdAt ? new Date(rep.createdAt).toLocaleDateString('en-GB') : rep.date || '-')}</span>
        </div>`);
    });
  }

  function configureRepresentativeFormForCreate() {
    const nationalId = field('modal-representative-national-id');
    const password = field('modal-rep-password');
    if (nationalId) {
      nationalId.disabled = false;
      nationalId.required = true;
      nationalId.value = '';
      nationalId.placeholder = '14-digit National ID';
    }
    if (password) {
      password.disabled = false;
      password.required = true;
      password.minLength = 12;
      password.value = '';
    }
    ['modal-rep-id-front', 'modal-rep-id-back', 'modal-rep-face'].forEach(id => {
      const input = field(id);
      if (input) input.disabled = false;
    });
  }

  function configureRepresentativeFormForEdit(rep) {
    const nationalId = field('modal-representative-national-id');
    const password = field('modal-rep-password');
    if (nationalId) {
      nationalId.value = '';
      nationalId.required = false;
      nationalId.disabled = true;
      nationalId.placeholder = rep?.nationalIdLast4
        ? `Stored securely ••••${rep.nationalIdLast4}`
        : 'Stored securely';
    }
    if (password) {
      password.value = '';
      password.required = false;
      password.disabled = true;
    }
    ['modal-rep-id-front', 'modal-rep-id-back', 'modal-rep-face'].forEach(id => {
      const input = field(id);
      if (input) input.disabled = true;
    });
    ['modal-rep-id-front-preview', 'modal-rep-id-back-preview', 'modal-rep-face-preview']
      .forEach(id => previewImage(field(id), ''));
  }

  async function applyRepresentativeTargetStatus(rep, targetStatus) {
    const request = requireAdminApi();
    const current = String(rep.status || '');
    const target = String(targetStatus || current);
    if (target === current) return;

    if (current === 'Pending Approval' && target === 'Active') {
      await request(`/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/approve`, {
        method: 'POST',
      });
      return;
    }
    if (current === 'Pending Approval' && target === 'Rejected') {
      const reason = prompt('Rejection reason:')?.trim();
      if (!reason || reason.length < 3) throw new Error('A rejection reason is required.');
      await request(`/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/reject`, {
        method: 'POST',
        body: { reason },
      });
      return;
    }
    if (current === 'Active' && target === 'Suspended') {
      await request(`/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/state`, {
        method: 'POST',
        body: { action: 'suspend' },
      });
      return;
    }
    if (current === 'Suspended' && target === 'Active') {
      await request(`/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/state`, {
        method: 'POST',
        body: { action: 'activate' },
      });
      return;
    }
    throw new Error(`Unsupported representative status transition: ${current} → ${target}`);
  }

  function bindRepModalV4() {
    if (!repForm || repForm.dataset.dartV4Bound) return;
    repForm.dataset.dartV4Bound = '1';
    setupRepImagePreviews();

    field('openRepModalBtn')?.addEventListener('click', () => {
      repForm.reset();
      field('modal-rep-id').value = '';
      field('modal-representative-id').value = '';
      field('modal-rep-status').value = 'Pending Approval';
      configureRepresentativeFormForCreate();
      ['modal-rep-id-front-preview','modal-rep-id-back-preview','modal-rep-face-preview']
        .forEach(id => previewImage(field(id), ''));
      openModal(field('representative-modal'));
    });

    repForm.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const request = requireAdminApi();
        const editId = value('modal-rep-id');
        const existing = representativeData.find(rep => String(rep.id) === String(editId));
        const common = {
          name: value('modal-representative-name').trim(),
          address: value('modal-representative-address').trim(),
          phone1: value('modal-rep-phone1').trim(),
          ...(value('modal-rep-phone2').trim() ? { phone2: value('modal-rep-phone2').trim() } : {}),
          email: value('modal-rep-email').trim().toLowerCase(),
        };

        if (common.name.length < 3) throw new Error('Representative name is required.');
        if (!/^\S+@\S+\.\S+$/.test(common.email)) throw new Error('Enter a valid email address.');
        if (!/^01[0125]\d{8}$/.test(common.phone1.replace(/\D/g, ''))) {
          throw new Error('Enter a valid Egyptian phone number.');
        }
        if (common.address.length < 8) throw new Error('Enter the full address.');

        if (existing) {
          if (!UUID_RE.test(String(existing.id || ''))) {
            throw new Error('This is a legacy representative record. Migrate it before editing the account.');
          }
          await request(`/api/v1/admin/representatives/${encodeURIComponent(existing.id)}`, {
            method: 'PATCH',
            body: common,
          });
          await applyRepresentativeTargetStatus(existing, value('modal-rep-status') || existing.status);
        } else {
          const nationalId = value('modal-representative-national-id').trim();
          const password = value('modal-rep-password');
          const images = {
            idFrontImage: field('modal-rep-id-front-preview')?.src || '',
            idBackImage: field('modal-rep-id-back-preview')?.src || '',
            faceImage: field('modal-rep-face-preview')?.src || '',
          };
          if (!/^\d{14}$/.test(nationalId)) {
            throw new Error('National ID must contain exactly 14 digits.');
          }
          if (password.length < 12) {
            throw new Error('Temporary password must contain at least 12 characters.');
          }
          if (!images.idFrontImage || !images.idBackImage || !images.faceImage) {
            throw new Error('ID front, ID back and face photo are required.');
          }

          const created = await request('/api/v1/representatives/register', {
            method: 'POST',
            body: {
              ...common,
              nationalId,
              password,
              ...images,
            },
          });

          const requestedStatus = value('modal-rep-status') || 'Pending Approval';
          if (requestedStatus === 'Active' && created.userId) {
            await request(`/api/v1/admin/representatives/${encodeURIComponent(created.userId)}/approve`, {
              method: 'POST',
            });
          }
        }

        await hydrateSecureRepresentatives();
        dartRefreshAll();
        closeModal(field('representative-modal'));
        repForm.reset();
      } catch (error) {
        alert(error.message || 'Representative account could not be saved.');
      }
    });
  }

  async function setTemporaryPassword(accountType, accountId, password) {
    if (!UUID_RE.test(String(accountId || ''))) {
      throw new Error('This account is not yet linked to the secure identity database.');
    }
    if (String(password).length < 12) {
      throw new Error('Temporary password must contain at least 12 characters.');
    }
    const request = requireAdminApi();
    const type = String(accountType || '').toLowerCase() === 'representative'
      ? 'representative'
      : 'customer';
    const created = await request(
      `/api/v1/admin/accounts/${encodeURIComponent(accountId)}/password-reset-request`,
      { method: 'POST', body: { accountType: type } },
    );
    await request(
      `/api/v1/admin/password-reset-requests/${encodeURIComponent(created.requestId)}/temporary-password`,
      { method: 'POST', body: { temporaryPassword: password } },
    );
    await hydrateSecurePasswordRequests();
  }

  function renderPasswordRequests() {
    const pending = securePasswordResetRequests.filter(
      request => String(request.status).toLowerCase() === 'pending',
    );
    if (field('passwordRequestsCount')) {
      field('passwordRequestsCount').textContent = pending.length;
    }
    const list = field('password-requests-list');
    if (!list) return;
    list.innerHTML = pending.map(request => `
      <article class="dart-password-request" data-request-id="${dartEsc(request.id)}">
        <div>
          <strong>${dartEsc(request.accountType || 'customer')} — ${dartEsc(request.name || request.email || request.phone || '')}</strong>
          <small>${dartEsc(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : '')}</small>
        </div>
        <input type="password" minlength="12" placeholder="Temporary password (12+ characters)" aria-label="Temporary password">
        <button type="button" class="btn-done dart-complete-reset">Set & resolve</button>
      </article>`).join('') || '<div class="dart-empty-state">No pending password reset requests.</div>';
  }

  function bindDashboardActions() {
    field('openPasswordRequestsBtn')?.addEventListener('click', async () => {
      try {
        await hydrateSecurePasswordRequests();
        openModal(field('password-requests-modal'));
      } catch (error) {
        alert(error.message || 'Unable to load password reset requests.');
      }
    });

    document.addEventListener('click', async event => {
      const resetButton = event.target.closest('.dart-reset-password-btn');
      if (resetButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const customer = customersData.find(
          row => String(row.id) === String(resetButton.closest('.model-row')?.dataset.id),
        );
        if (!customer) return;
        try {
          if (!UUID_RE.test(String(customer.id || ''))) {
            throw new Error('This customer is not yet linked to the secure identity database.');
          }
          await requireAdminApi()(
            `/api/v1/admin/accounts/${encodeURIComponent(customer.id)}/password-reset-request`,
            { method: 'POST', body: { accountType: 'customer' } },
          );
          await hydrateSecurePasswordRequests();
          openModal(field('password-requests-modal'));
        } catch (error) {
          alert(error.message || 'Unable to create password reset request.');
        }
        return;
      }

      const complete = event.target.closest('.dart-complete-reset');
      if (complete) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const card = complete.closest('[data-request-id]');
        const requestId = card?.dataset.requestId;
        const password = card?.querySelector('input')?.value || '';
        if (!requestId) return;
        try {
          if (password.length < 12) throw new Error('Temporary password must contain at least 12 characters.');
          await requireAdminApi()(
            `/api/v1/admin/password-reset-requests/${encodeURIComponent(requestId)}/temporary-password`,
            { method: 'POST', body: { temporaryPassword: password } },
          );
          await hydrateSecurePasswordRequests();
          alert('Temporary password saved securely. Existing sessions were revoked and the user must replace it at next login.');
        } catch (error) {
          alert(error.message || 'Unable to set temporary password.');
        }
        return;
      }

      const row = event.target.closest('#representative-container .model-row');
      const rep = row && representativeData.find(item => String(item.id) === String(row.dataset.id));
      if (!rep) return;

      if (event.target.closest('.btn-delete')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          if (!UUID_RE.test(String(rep.id || ''))) throw new Error('Legacy representative must be migrated before account state changes.');
          const action = rep.status === 'Suspended' ? 'activate' : 'suspend';
          await requireAdminApi()(
            `/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/state`,
            { method: 'POST', body: { action } },
          );
          await hydrateSecureRepresentatives();
          dartRefreshAll();
        } catch (error) {
          alert(error.message || 'Representative state could not be changed.');
        }
        return;
      }

      if (event.target.closest('.btn-hard-delete')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!confirm('Delete this representative account permanently? Active sessions will be revoked.')) return;
        try {
          if (!UUID_RE.test(String(rep.id || ''))) throw new Error('Legacy representative must be migrated before deletion.');
          await requireAdminApi()(
            `/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/state`,
            { method: 'POST', body: { action: 'delete' } },
          );
          await hydrateSecureRepresentatives();
          dartRefreshAll();
        } catch (error) {
          alert(error.message || 'Representative account could not be deleted.');
        }
        return;
      }

      if (event.target.closest('.dart-approve-rep')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          await requireAdminApi()(
            `/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/approve`,
            { method: 'POST' },
          );
          await hydrateSecureRepresentatives();
          dartRefreshAll();
        } catch (error) {
          alert(error.message || 'Representative could not be approved.');
        }
        return;
      }

      if (event.target.closest('.dart-reject-rep')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const reason = prompt('Rejection reason:')?.trim();
        if (!reason || reason.length < 3) return alert('A rejection reason is required.');
        try {
          await requireAdminApi()(
            `/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/reject`,
            { method: 'POST', body: { reason } },
          );
          await hydrateSecureRepresentatives();
          dartRefreshAll();
        } catch (error) {
          alert(error.message || 'Representative could not be rejected.');
        }
        return;
      }

      if (event.target.closest('.dart-rep-reset')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const password = prompt('Set a temporary password (12+ characters):');
        if (!password) return;
        try {
          await setTemporaryPassword('representative', rep.id, password);
          alert('Temporary password saved securely. Existing sessions were revoked.');
        } catch (error) {
          alert(error.message || 'Unable to reset representative password.');
        }
        return;
      }

      const documentButton = event.target.closest('.dart-rep-document');
      if (documentButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          const type = documentButton.dataset.documentType;
          const payload = await requireAdminApi()(
            `/api/v1/admin/representatives/${encodeURIComponent(rep.id)}/documents/${encodeURIComponent(type)}`,
          );
          const dataUrl = payload.document?.dataUrl;
          if (!dataUrl) throw new Error('Verification document is unavailable.');
          field('full-item-image').src = dataUrl;
          field('full-item-image').alt = `${rep.name} — ${documentButton.textContent.trim()}`;
          openModal(field('image-preview-modal'));
        } catch (error) {
          alert(error.message || 'Unable to load representative document.');
        }
      }
    }, true);
  }

  function enhanceEditModal() {
    if (typeof openEditModal !== 'function' || openEditModal.dartV4Wrapped) return;
    const original = openEditModal;
    const wrapped = function (id, sectionKey) {
      original(id, sectionKey);
      if (sectionKey === 'orders') {
        const order = ordersData.find(row => String(row.id) === String(id)); if (!order) return;
        field('orderAddress').value = order.fullAddress || '';
        field('orderLatitude').value = order.latitude || '';
        field('orderLongitude').value = order.longitude || '';
        field('orderFullAddress').value = order.fullAddress || '';
        orderForm.dataset.dartAddressSource = order.addressSource || (order.latitude && order.longitude ? 'map' : 'manual');
        initDashboardAddress()?.invalidate();
        if (order.latitude && order.longitude) initDashboardAddress()?.selectLocation(Number(order.latitude), Number(order.longitude));
      }
      if (sectionKey === 'representative') {
        const rep = representativeData.find(row => String(row.id) === String(id));
        if (!rep) return;
        field('modal-rep-email').value = rep.email || '';
        field('modal-rep-status').value = rep.status || 'Pending Approval';
        field('modal-representative-id').value = rep.repId || '';
        configureRepresentativeFormForEdit(rep);
      }
    };
    wrapped.dartV4Wrapped = true; openEditModal = wrapped;
  }

  async function refreshSecureIdentityUi() {
    try {
      await hydrateSecureRepresentatives();
      if (typeof dartRefreshAll === 'function') dartRefreshAll();
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        console.warn('Unable to hydrate secure representative accounts', error);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    migrateOrderTotals();
    initDashboardAddress();
    bindOrderModalV4();
    bindRepModalV4();
    bindDashboardActions();
    enhanceEditModal();
    if (typeof renderRepresentative === 'function') {
      renderRepresentative = renderRepresentativesV4;
      if (typeof sectionsMap !== 'undefined' && sectionsMap.representative) {
        sectionsMap.representative.render = renderRepresentative;
      }
    }
    renderPasswordRequests();
    if (typeof dartRefreshAll === 'function') dartRefreshAll();
    refreshSecureIdentityUi();
  });

  window.addEventListener('dart:admin-authenticated', refreshSecureIdentityUi);
})();
