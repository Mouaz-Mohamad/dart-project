(function () {
  'use strict';

  const RESET_MARKER = 'dart_demo_reset_2026_09_05';
  const PASSWORD_REQUESTS_KEY = 'dart_password_reset_requests';
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_SAVED_IMAGE_BYTES = 650 * 1024;
  let dashboardAddress = null;

  const read = (key, fallback = []) => {
    try { const parsed = JSON.parse(localStorage.getItem(key)); return parsed ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const field = id => document.getElementById(id);
  const value = id => String(field(id)?.value || '').trim();
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

  async function hashPassword(password) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(password)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function safeDemoReset() {
    if (localStorage.getItem(RESET_MARKER) === '1') return;
    const defaults = [
      {modelId:'DA-P785', name:'Wide Leg Jeans', category:'Jeans', selling:450, img:'/Photos/products/1.jpg', sizes:['32','34','36'], colors:['نيلي','بيج']},
      {modelId:'DA-T695-03', name:'Dart Denim Shirt', category:'Shirt', selling:749, img:'/Photos/products/13.jfif', sizes:['32','34','36'], colors:['نيلي','بيج']},
      {modelId:'DA-T695-04', name:'Dart Signature Shirt', category:'Shirt', selling:749, img:'/Photos/products/14.jfif', sizes:['32','34','36'], colors:['ابيض','اسود']}
    ];
    const seenModelCodes = new Set();
    const sourceModels = (typeof modelsData !== 'undefined' ? modelsData : []).filter(model => {
      const code = String(model?.modelId || '');
      const valid = model && (code || model.name) && Number(model.selling || model.discountedPrice) > 0 && model.img && !seenModelCodes.has(code);
      if (valid) seenModelCodes.add(code);
      return valid;
    });
    const chosen = defaults.map((fallback, index) => {
      const source = sourceModels[index];
      return {
        id:source?.id || uid('MDB'), modelId:source?.modelId || fallback.modelId,
        name:source?.name || fallback.name, category:source?.category || fallback.category,
        description:source?.description || `${fallback.name} — retained Dart demo design.`,
        cost:Number(source?.cost || 0), selling:Number(source?.selling || fallback.selling),
        discount:Number(source?.discount || 0), discountedPrice:Number(source?.discountedPrice || source?.selling || fallback.selling),
        status:'Active', date:source?.date || new Date().toLocaleDateString('en-GB'),
        img:source?.img || fallback.img, sizeChart:source?.sizeChart || null,
        isArchived:false, isDeleted:false, isChecked:false,
        _fallback:fallback
      };
    });
    const selectedModels = chosen.map(({_fallback, ...model}) => model);
    const selectedItems = [];
    chosen.forEach((model, modelIndex) => {
      const sourceItems = (typeof itemsData !== 'undefined' ? itemsData : []).filter(item => String(item.modelId) === String(model.modelId) && item.img);
      for (let index = 0; index < 4; index += 1) {
        const source = sourceItems[index];
        selectedItems.push({
          id:source?.id || uid('IDB'), modelId:model.modelId,
          itemCode:source?.itemCode || `IT-${String(modelIndex + 1).padStart(2,'0')}-${String(index + 1).padStart(3,'0')}`,
          color:source?.color || model._fallback.colors[index % model._fallback.colors.length],
          size:String(source?.size || model._fallback.sizes[index % model._fallback.sizes.length]),
          status:'In stock', regDate:source?.regDate || new Date().toLocaleDateString('en-GB'),
          img:source?.img || model.img, orderId:'', clientId:'', clientName:'', phone1:'', phone2:'', email:'', purchaseDate:'',
          isArchived:false, isDeleted:false, isChecked:false
        });
      }
    });
    const emptyKeys = ['dart_users','dart_customers','dart_orders','dart_returns','dart_reviews','dart_cards',
      'dart_representatives','dart_damage','dart_notifications','dart_audit','dart_cart','dart_contact_messages',
      'dart_message_queue','dart_promotions',PASSWORD_REQUESTS_KEY];
    emptyKeys.forEach(key => { if (localStorage.getItem(key) === null) write(key, []); });
    if (!read('dart_models', []).length) write('dart_models', selectedModels);
    if (!read('dart_items', []).length) write('dart_items', selectedItems);
    if (localStorage.getItem('dart_platform_counters') === null) write('dart_platform_counters', {});
    localStorage.setItem('dart_catalog_seed_v4', '1');
    localStorage.setItem(RESET_MARKER, '1');
    if (typeof modelsData !== 'undefined') modelsData = read('dart_models', selectedModels);
    if (typeof itemsData !== 'undefined') itemsData = read('dart_items', selectedItems);
    if (typeof customersData !== 'undefined') customersData = read('dart_customers', []);
    if (typeof ordersData !== 'undefined') ordersData = read('dart_orders', []);
    if (typeof returnsData !== 'undefined') returnsData = read('dart_returns', []);
    if (typeof reviewsData !== 'undefined') reviewsData = read('dart_reviews', []);
    if (typeof cardsData !== 'undefined') cardsData = read('dart_cards', []);
    if (typeof representativeData !== 'undefined') representativeData = read('dart_representatives', []);
    if (typeof damageData !== 'undefined') damageData = read('dart_damage', []);
    if (typeof notificationData !== 'undefined') notificationData = read('dart_notifications', []);
    if (typeof auditData !== 'undefined') auditData = read('dart_audit', []);
  }

  safeDemoReset();

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
      const snapshot = typeof dartPriceSnapshotForCodes === 'function' ? dartPriceSnapshotForCodes(selected) : [];
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

    orderForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!selected.length) return alert('Add at least one physical item.');
      const address = initDashboardAddress()?.validate();
      if (!address?.ok) return alert(address?.message || 'Complete and locate the delivery address.');
      const prices = calculate();
      const editId = value('modal-order-edit-id');
      const existing = ordersData.find(order => String(order.id) === String(editId));
      const customerId = value('clientId') || '-';
      const customer = dartFindCustomerByCode(customerId);
      if (customer && dartIsArchived(customer)) return alert('An archived customer cannot be used.');
      let amountPaid = Math.max(0, Number(value('amountPaid')) || 0);
      let paymentStatus = value('paymentStatus') || 'Unpaid';
      if (paymentStatus === 'Paid') amountPaid = prices.finalAmount;
      if (paymentStatus === 'Unpaid') amountPaid = 0;
      if (amountPaid > prices.finalAmount) return alert('Amount paid cannot exceed the final order total.');
      const payload = {
        clientId:customerId, clientName:value('clientName'), phone1:value('phone1'), phone2:value('phone2') || '-', email:value('email') || '-',
        paymentMethod:value('paymentMethod') || 'Cash on Delivery', paymentStatus, amountPaid,
        amountRefunded:Math.max(0, Number(value('amountRefunded')) || 0), orderSource:value('orderSource') || 'Manual',
        deliveryNotes:value('deliveryNotes'), items:[...selected], totalProducts:selected.length,
        priceSnapshot:prices.snapshot, totalPrice:prices.subtotal, discount:prices.discountPercent,
        orderLevelDiscountAmount:prices.discountAmount, finalAmount:prices.finalAmount,
        reasonDeduction:prices.discountPercent ? 'Order discount' : '-', country:value('orderCountry'), governorate:value('governorate'),
        area:value('orderArea'), street:value('orderStreetName'), building:value('orderBuildingNumber'), floor:value('orderFloor'),
        latitude:value('orderLatitude'), longitude:value('orderLongitude'), fullAddress:value('orderFullAddress') || value('orderAddress'),
        addressSource:address.source || orderForm.dataset.dartAddressSource || 'map'
      };
      if (payload.amountRefunded > prices.finalAmount) return alert('Refund cannot exceed the final order total.');
      if (existing) {
        const oldCodes = [...(existing.items || [])];
        const newlySelected = selected.filter(code => !oldCodes.includes(code));
        const reservation = dartReserveItems(existing, newlySelected);
        if (!reservation.ok) return alert(reservation.message);
        oldCodes.filter(code => !selected.includes(code)).forEach(code => {
          const item = dartFindItemByCode(code);
          if (item && item.status === 'Processing/Held') { item.status = 'In stock'; item.orderId = ''; }
        });
        const old = {...existing}; Object.assign(existing, payload, {updatedAt:now()});
        dartAudit('EDIT', 'orders', existing.id, old, payload, 'Order, price and delivery address updated');
        dartLogOrder(existing, 'ORDER_EDITED', existing.status, existing.status, {notes:'Order, final price or address edited'});
      } else {
        const order = {
          id:uid('ODB'), orderId:dartNextBusinessCode('K', ordersData, 'orderId'),
          date:new Date().toLocaleDateString('en-GB'), time:new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
          status:'New', createdAt:now(), orderCreatedAt:now(), activityLog:[], isArchived:false, isDeleted:false, isChecked:false,
          ...payload
        };
        const reservation = dartReserveItems(order, selected);
        if (!reservation.ok) return alert(reservation.message);
        dartLogOrder(order, 'ORDER_CREATED', null, 'New', {notes:'Manual dashboard order'});
        ordersData.push(order);
        dartAudit('CREATE', 'orders', order.id, {}, order);
        dartNotify('new_order', `New order ${order.orderId}`, `${order.clientName} — ${selected.length} item(s)`, 'orders', order.id);
      }
      dartSaveAll(); dartRefreshAll(); closeModal(field('orderModal'));
      orderForm.reset(); selected = []; resetOrderAddress(); renderSelected();
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

  function repConflict(payload, editId = '') {
    const email = String(payload.email || '').toLowerCase();
    const phone = String(payload.phone1 || '').replace(/\D/g, '');
    return representativeData.find(rep => String(rep.id) !== String(editId) && !dartIsArchived(rep) &&
      (String(rep.nationalId) === String(payload.nationalId) || String(rep.email || '').toLowerCase() === email || String(rep.phone1 || '').replace(/\D/g, '') === phone));
  }

  function renderRepresentativesV4(dataArray) {
    const container = field('representative-container'); if (!container) return;
    container.innerHTML = '';
    getSortedData(dataArray).forEach(rep => {
      const current = ordersData.filter(order => String(order.representativeId) === String(rep.id) && !DART_FINAL_ORDER_STATES.includes(order.status)).length;
      const total = ordersData.filter(order => String(order.representativeId) === String(rep.id)).length;
      const photos = [['ID front',rep.idFrontImage],['ID back',rep.idBackImage],['Face',rep.faceImage]].map(([label,src]) => src
        ? `<button type="button" class="dart-rep-photo" data-image="${dartEsc(src)}" data-label="${dartEsc(label)}"><img src="${dartEsc(src)}" alt="${dartEsc(rep.name)} — ${dartEsc(label)}"></button>`
        : `<span class="dart-photo-missing" title="${dartEsc(label)} missing">—</span>`).join('');
      const approval = rep.status === 'Pending Approval'
        ? '<button class="dart-approve-rep" type="button">Approve</button><button class="dart-reject-rep" type="button">Reject</button>' : '';
      container.insertAdjacentHTML('beforeend', `<div class="${getRowClass(rep)}" data-id="${dartEsc(rep.id)}">
        <input type="checkbox" class="model-checkbox" ${rep.isChecked?'checked':''}>
        <div class="w300 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(rep)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button><button class="dart-rep-reset" type="button" title="Set temporary password"><i class="bx bx-key"></i></button>${approval}</div>
        <span class="text-item w200">${dartEsc(rep.name)}</span><span class="text-item w150">${dartEsc(rep.repId)}</span>
        <span class="text-item w150"><span class="status-pill ${dartStatusClass(rep.status)}">${dartEsc(rep.status)}</span></span>
        <span class="text-item w150">${dartEsc(rep.nationalId||'-')}</span><span class="text-item w150">${current}</span><span class="text-item w100">${total}</span>
        <span class="text-item w150">${dartEsc(rep.phone1||'-')}</span><span class="text-item w150">${dartEsc(rep.phone2||'-')}</span><span class="text-item w200">${dartEsc(rep.email||'-')}</span>
        <span class="text-item w200">${dartEsc(rep.address||'-')}</span><span class="text-item w300 dart-rep-photos">${photos}</span><span class="text-item w150">${dartEsc(rep.date||'-')}</span>
      </div>`);
    });
  }

  function bindRepModalV4() {
    if (!repForm || repForm.dataset.dartV4Bound) return;
    repForm.dataset.dartV4Bound = '1'; setupRepImagePreviews();
    field('openRepModalBtn')?.addEventListener('click', () => {
      repForm.reset(); field('modal-rep-id').value = ''; field('modal-representative-id').value = dartNextBusinessCode('Rep', representativeData, 'repId');
      field('modal-rep-status').value = 'Active';
      ['modal-rep-id-front-preview','modal-rep-id-back-preview','modal-rep-face-preview'].forEach(id => previewImage(field(id), ''));
      openModal(field('representative-modal'));
    });
    repForm.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const editId = value('modal-rep-id');
        const existing = representativeData.find(rep => String(rep.id) === String(editId));
        const payload = {
          name:value('modal-representative-name'), repId:value('modal-representative-id') || dartNextBusinessCode('Rep', representativeData, 'repId'),
          nationalId:value('modal-representative-national-id'), address:value('modal-representative-address'), phone1:value('modal-rep-phone1'),
          phone2:value('modal-rep-phone2') || '-', email:value('modal-rep-email').toLowerCase(), status:value('modal-rep-status') || 'Pending Approval'
        };
        if (!/^\d{14}$/.test(payload.nationalId)) throw new Error('National ID must contain exactly 14 digits.');
        if (!/^\S+@\S+\.\S+$/.test(payload.email)) throw new Error('Enter a valid email address.');
        if (!/^01[0125]\d{8}$/.test(payload.phone1.replace(/\D/g,''))) throw new Error('Enter a valid Egyptian phone number.');
        if (repConflict(payload, editId)) throw new Error('National ID, email or primary phone is already used by another representative.');
        const images = {
          idFrontImage:field('modal-rep-id-front-preview')?.src || existing?.idFrontImage || '',
          idBackImage:field('modal-rep-id-back-preview')?.src || existing?.idBackImage || '',
          faceImage:field('modal-rep-face-preview')?.src || existing?.faceImage || ''
        };
        if (!images.idFrontImage || !images.idBackImage || !images.faceImage) throw new Error('ID front, ID back and face photo are required.');
        const password = value('modal-rep-password');
        if (!existing && password.length < 8) throw new Error('Set a temporary password of at least 8 characters.');
        if (password && password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (password) { payload.passwordHash = await hashPassword(password); payload.mustChangePassword = true; payload.passwordUpdatedAt = now(); }
        if (existing) {
          const old = {...existing}; Object.assign(existing, payload, images, {updatedAt:now()});
          if (payload.status === 'Active' && old.status !== 'Active') existing.approvedAt = now();
          dartAudit('EDIT', 'representative', existing.id, old, payload, 'Representative account updated');
        } else {
          const rep = {id:uid('RDB'), date:new Date().toLocaleDateString('en-GB'), createdAt:now(), approvedAt:payload.status==='Active'?now():null, isArchived:false, isDeleted:false, isChecked:false, ...payload, ...images};
          representativeData.push(rep); dartAudit('CREATE', 'representative', rep.id, {}, {...payload, images:'3 protected images'});
        }
        dartSaveAll(); dartRefreshAll(); closeModal(field('representative-modal'));
      } catch (error) { alert(error.message); }
    });
  }

  async function setTemporaryPassword(accountType, accountId, password) {
    if (String(password).length < 8) throw new Error('Temporary password must be at least 8 characters.');
    const passwordHash = await hashPassword(password);
    if (accountType === 'Representative') {
      const rep = representativeData.find(row => String(row.id) === String(accountId) || String(row.repId) === String(accountId));
      if (!rep) throw new Error('Representative account not found.');
      rep.passwordHash = passwordHash; rep.mustChangePassword = true; rep.passwordUpdatedAt = now();
      write('dart_representatives', representativeData);
    } else {
      const users = read('dart_users', []);
      const user = users.find(row => String(row.id) === String(accountId) || String(row.customerId) === String(accountId));
      if (!user) throw new Error('Customer login account not found.');
      user.passwordHash = passwordHash; user.mustChangePassword = true; user.passwordUpdatedAt = now();
      write('dart_users', users);
    }
  }

  function renderPasswordRequests() {
    const requests = read(PASSWORD_REQUESTS_KEY, []);
    const pending = requests.filter(request => request.status === 'Pending');
    if (field('passwordRequestsCount')) field('passwordRequestsCount').textContent = pending.length;
    const list = field('password-requests-list'); if (!list) return;
    list.innerHTML = pending.map(request => `<article class="dart-password-request" data-request-id="${dartEsc(request.id)}">
      <div><strong>${dartEsc(request.accountType || 'Customer')} — ${dartEsc(request.displayName || request.identifier || '')}</strong><small>${dartEsc(new Date(request.createdAt).toLocaleString())}</small></div>
      <input type="password" minlength="8" placeholder="Temporary password" aria-label="Temporary password">
      <button type="button" class="btn-done dart-complete-reset">Set & resolve</button>
    </article>`).join('') || '<div class="dart-empty-state">No pending password reset requests.</div>';
  }

  function bindDashboardActions() {
    field('openPasswordRequestsBtn')?.addEventListener('click', () => { renderPasswordRequests(); openModal(field('password-requests-modal')); });
    document.addEventListener('click', async event => {
      const resetButton = event.target.closest('.dart-reset-password-btn');
      if (resetButton) {
        event.preventDefault(); event.stopImmediatePropagation();
        const customer = customersData.find(row => String(row.id) === String(resetButton.closest('.model-row')?.dataset.id));
        if (!customer) return;
        const users = read('dart_users', []), user = users.find(row => row.customerId === customer.clientId);
        const requests = read(PASSWORD_REQUESTS_KEY, []);
        if (!requests.some(request => request.status === 'Pending' && request.accountId === (user?.id || customer.clientId))) {
          requests.unshift({id:uid('PWR'), accountType:'Customer', accountId:user?.id || customer.clientId, identifier:customer.email || customer.phone1, displayName:customer.clientName, status:'Pending', createdAt:now(), source:'Dashboard'});
          write(PASSWORD_REQUESTS_KEY, requests);
        }
        renderPasswordRequests(); openModal(field('password-requests-modal')); return;
      }
      const complete = event.target.closest('.dart-complete-reset');
      if (complete) {
        const card = complete.closest('[data-request-id]'), requestId = card?.dataset.requestId, password = card?.querySelector('input')?.value;
        const requests = read(PASSWORD_REQUESTS_KEY, []), request = requests.find(row => row.id === requestId);
        try {
          await setTemporaryPassword(request.accountType, request.accountId, password);
          request.status = 'Resolved'; request.resolvedAt = now(); write(PASSWORD_REQUESTS_KEY, requests);
          dartAudit('PASSWORD_RESET', request.accountType.toLowerCase(), request.accountId, {}, {mustChangePassword:true}, 'Temporary password assigned');
          renderPasswordRequests(); alert('Temporary password saved. The account owner must replace it at the next login.');
        } catch (error) { alert(error.message); }
        return;
      }
      const row = event.target.closest('#representative-container .model-row');
      const rep = row && representativeData.find(item => String(item.id) === String(row.dataset.id));
      if (!rep) return;
      if (event.target.closest('.dart-approve-rep')) {
        rep.status = 'Active'; rep.approvedAt = now(); rep.rejectedAt = null; dartSaveAll(); dartAudit('REP_APPROVED','representative',rep.id,{}, {status:'Active'}); dartRefreshAll(); return;
      }
      if (event.target.closest('.dart-reject-rep')) {
        const reason = prompt('Rejection reason:') || 'Not specified'; rep.status = 'Rejected'; rep.rejectionReason = reason; rep.rejectedAt = now(); dartSaveAll(); dartAudit('REP_REJECTED','representative',rep.id,{}, {status:'Rejected',reason}); dartRefreshAll(); return;
      }
      if (event.target.closest('.dart-rep-reset')) {
        const password = prompt('Set a temporary password (8+ characters):'); if (!password) return;
        try { await setTemporaryPassword('Representative', rep.id, password); rep.mustChangePassword = true; dartSaveAll(); alert('Temporary password saved. The representative must replace it at the next login.'); }
        catch (error) { alert(error.message); }
        return;
      }
      const photo = event.target.closest('.dart-rep-photo');
      if (photo) {
        field('full-item-image').src = photo.dataset.image; field('full-item-image').alt = `${rep.name} — ${photo.dataset.label}`; openModal(field('image-preview-modal'));
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
        const rep = representativeData.find(row => String(row.id) === String(id)); if (!rep) return;
        field('modal-rep-email').value = rep.email || '';
        field('modal-rep-status').value = rep.status || 'Pending Approval';
        field('modal-rep-password').value = '';
        previewImage(field('modal-rep-id-front-preview'), rep.idFrontImage);
        previewImage(field('modal-rep-id-back-preview'), rep.idBackImage);
        previewImage(field('modal-rep-face-preview'), rep.faceImage);
      }
    };
    wrapped.dartV4Wrapped = true; openEditModal = wrapped;
  }

  document.addEventListener('DOMContentLoaded', () => {
    migrateOrderTotals();
    initDashboardAddress(); bindOrderModalV4(); bindRepModalV4(); bindDashboardActions(); enhanceEditModal();
    if (typeof renderRepresentative === 'function') {
      renderRepresentative = renderRepresentativesV4;
      if (typeof sectionsMap !== 'undefined' && sectionsMap.representative) sectionsMap.representative.render = renderRepresentative;
    }
    renderPasswordRequests();
    if (typeof dartRefreshAll === 'function') dartRefreshAll();
  });

  window.addEventListener('storage', event => {
    if (event.key === PASSWORD_REQUESTS_KEY) renderPasswordRequests();
  });
})();
