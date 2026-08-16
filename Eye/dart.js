// ==========================================
// 1. الدوال العامة والمساعدة (Global Helpers & Utilities)
// ==========================================

// التخزين المحلي
function saveDataToStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function loadAllDataFromStorage() {
    if (localStorage.getItem('dart_models')) modelsData = JSON.parse(localStorage.getItem('dart_models'));
    if (localStorage.getItem('dart_items')) itemsData = JSON.parse(localStorage.getItem('dart_items'));
    if (localStorage.getItem('dart_customers')) customersData = JSON.parse(localStorage.getItem('dart_customers'));
    if (localStorage.getItem('dart_orders')) ordersData = JSON.parse(localStorage.getItem('dart_orders'));
    if (localStorage.getItem('dart_returns')) returnsData = JSON.parse(localStorage.getItem('dart_returns'));
    if (localStorage.getItem('dart_reviews')) reviewsData = JSON.parse(localStorage.getItem('dart_reviews'));
    if (localStorage.getItem('dart_cards')) cardsData = JSON.parse(localStorage.getItem('dart_cards'));
}

// تنسيق الصفوف والترتيب
function getRowClass(item) {
    return item.isDeleted ? 'model-row row-deleted' : 'model-row row-normal';
}

function getSortedData(dataArray) {
    return [...dataArray].sort((a, b) => Number(a.isDeleted) - Number(b.isDeleted));
}

function deletePermanently(id, sectionKey) {
    const sectionInfo = sectionsMap[sectionKey];
    if (!sectionInfo) return;

    if (confirm("هل أنت متأكد من الحذف النهائي؟ لن يمكنك استرجاع هذا العنصر.")) {
        sectionInfo.data = sectionInfo.data.filter(item => item.id !== id);
        sectionInfo.render(sectionInfo.data);
        saveSectionState(sectionKey);
    }
}

// التحكم للنوافذ المنبثقة
function openModal(modal) {
    if (!modal) return;
    modal.style.display = 'block';
    modal.classList.add('active');
}

function closeModal(modal) {
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
}


// ==========================================
// 2. قسم الموديلات (Models Module)
// ==========================================

// البيانات الأولية للموديلات
let modelsData = [
    { id: "1", modelId: "DA-Jen121", name: "Wide-leg", category: "pants", description: "بنطلون جينز اسباني", number: "24", cost: "490", selling: "690", discount: "0", discountedPrice: "690", colors: "ابيض, اسود", sizes: "32 34 36", status: "Active", date: "18-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

// عرض الموديلات
function renderModels(dataArray) {
    const container = document.getElementById('models-container');
    if (!container) return;
    container.innerHTML = '';
    
    getSortedData(dataArray).forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w100 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <div class="w100"><img src="${item.img || 'https://via.placeholder.com/50'}" alt="product" class="product-img model-img"></div>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.name}</span>
                <span class="text-item w150">${item.category}</span>
                <span class="text-item w200">${item.description}</span>
                <span class="text-item w150">${item.number || 0}</span>
                <span class="text-item w150">${item.cost} EGP</span>
                <span class="text-item w150">${item.selling} EGP</span>
                <span class="text-item w150">${item.discount}%</span>
                <span class="text-item w150">${item.discountedPrice} EGP</span>
                <span class="text-item w300">${item.colors || '-'}</span>
                <span class="text-item w300">${item.sizes || '-'}</span>
                <span class="text-item w150 status-${(item.status || 'Active').toLowerCase()}">• ${item.status || 'Active'}</span>
                <span class="text-item w150">${item.date || new Date().toLocaleDateString('en-GB')}</span>
            </div>
        `);
    });
}

// النافذة المنبثقة للموديلات
function setupModelModal() {
    const modal = document.getElementById('model-modal');
    const form = document.getElementById('model-form');
    const costInput = document.getElementById('modal-cost');
    const sellingInput = document.getElementById('modal-selling');
    const discountInput = document.getElementById('modal-discount');
    const finalPriceDisplay = document.getElementById('modal-final-price');

    if (costInput && sellingInput) {
        costInput.addEventListener('input', () => {
            const cost = parseFloat(costInput.value) || 0;
            if (cost > 0) {
                const suggestedSelling = cost * 1.40;
                sellingInput.value = suggestedSelling.toFixed(2);
            } else {
                sellingInput.value = '';
            }
            calculateFinalPrice();
        });
    }

    function calculateFinalPrice() {
        if (!sellingInput || !discountInput || !finalPriceDisplay) return '0.00';
        const selling = parseFloat(sellingInput.value) || 0;
        const discount = parseFloat(discountInput.value) || 0;
        const finalPrice = selling - (selling * (discount / 100));
        finalPriceDisplay.textContent = `${finalPrice.toFixed(2)} EGP`;
        return finalPrice.toFixed(2);
    }

    if (sellingInput && discountInput) {
        sellingInput.addEventListener('input', calculateFinalPrice);
        discountInput.addEventListener('input', calculateFinalPrice);
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-edit-id')?.value;
            const finalPrice = calculateFinalPrice();

            const modelPayload = {
                modelId: document.getElementById('modal-id').value,
                name: document.getElementById('modal-name').value,
                category: document.getElementById('modal-category').value,
                description: document.getElementById('modal-description').value,
                cost: document.getElementById('modal-cost').value,
                selling: document.getElementById('modal-selling').value,
                discount: document.getElementById('modal-discount').value || '0',
                discountedPrice: finalPrice,
                number: "0",
                colors: "ابيض, اسود",
                sizes: "M L XL",
                status: "Active",
                date: new Date().toLocaleDateString('en-GB'),
                img: "",
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = modelsData.findIndex(item => item.id === editId);
                if (index !== -1) modelsData[index] = { ...modelsData[index], ...modelPayload };
            } else {
                modelPayload.id = Date.now().toString();
                modelsData.push(modelPayload);
            }

            renderModels(modelsData);
            saveSectionState('models');
            closeModal(modal);
            form.reset();
        });
    }
}


// ==========================================
// 3. قسم القطع (Items Module)
// ==========================================

// البيانات الأولية للقطع
let itemsData = [
    { id: "1", modelId: "DA-Jen121", itemCode: "IT-992", color: "اسود", size: "34", status: "In stock", regDate: "18-10-2026", orderId: "ORD-200", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", purchaseDate: "20-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

// عرض القطع
function renderItems(dataArray) {
    const container = document.getElementById('items-container');
    if (!container) return;
    container.innerHTML = '';
    
    getSortedData(dataArray).forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w100 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <div class="w100"><img src="${item.img || 'https://via.placeholder.com/50'}" alt="item" class="product-img model-img"></div>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.itemCode}</span>
                <span class="text-item w150">${item.color}</span>
                <span class="text-item w150">${item.size}</span>
                <span class="text-item w150">${item.status}</span>
                <span class="text-item w200">${item.regDate}</span>
                <span class="text-item w150">${item.orderId || '-'}</span>
                <span class="text-item w200">${item.clientName || '-'}</span>
                <span class="text-item w150">${item.clientId || '-'}</span>
                <span class="text-item w150">${item.phone1 || '-'}</span>
                <span class="text-item w300">${item.phone2 || '-'}</span>
                <span class="text-item w150">${item.email || '-'}</span>
                <span class="text-item w150">${item.purchaseDate || '-'}</span>
            </div>
        `);
    });
}

function setupItemModal() {
    const modal = document.getElementById('item-add-modal');
    const form = document.getElementById('item-add-form');

    // 1. حفظ وتحديث القطعة عند Submit
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-item-add-edit-id')?.value;
            const previewImg = document.getElementById('item-preview-img');

            const itemPayload = {
                modelId: document.getElementById('modal-item-model-id')?.value || '',
                itemCode: document.getElementById('modal-item-code-pic')?.value || '',
                color: document.getElementById('modal-item-color')?.value || '',
                size: document.getElementById('modal-item-size')?.value || '',
                img: (previewImg && previewImg.style.display !== 'none') ? previewImg.src : '',
                regDate: new Date().toLocaleDateString('en-GB'),
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = itemsData.findIndex(i => String(i.id) === String(editId));
                if (index !== -1) itemsData[index] = { ...itemsData[index], ...itemPayload };
            } else {
                itemPayload.id = Date.now().toString();
                itemsData.push(itemPayload);
            }

            renderItems(itemsData);
            if (typeof saveSectionState === 'function') saveSectionState('items');

            if (modal) modal.style.display = 'none';
            form.reset();
            if (previewImg) previewImg.style.display = 'none';
        });
    }

    // 2. تعبئة البيانات وفتح النافذة عند الضغط على زر التعديل
    document.getElementById('items-container')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit');
        if (!editBtn) return;

        const row = editBtn.closest('[data-id]');
        const itemId = row?.dataset.id;
        const item = itemsData.find(i => String(i.id) === String(itemId));

        if (item) {
            document.getElementById('modal-item-add-edit-id').value = item.id;
            document.getElementById('modal-item-model-id').value = item.modelId || '';
            document.getElementById('modal-item-code-pic').value = item.itemCode || '';
            document.getElementById('modal-item-color').value = item.color || '';
            document.getElementById('modal-item-size').value = item.size || '';

            // عرض معاينة الصورة لو موجودة
            const previewImg = document.getElementById('item-preview-img');
            if (previewImg) {
                if (item.img) {
                    previewImg.src = item.img;
                    previewImg.style.display = 'block';
                } else {
                    previewImg.style.display = 'none';
                }
            }

            if (modal) modal.style.display = 'block';
        }
    });

    // 3. إغلاق النافذة عند الضغط على زر X
    document.getElementById('close-item-add-btn')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });

    // معالجة رفع الصورة وتحويلها لـ Base64 عند اختيار ملف
    document.getElementById('modal-item-file')?.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const previewImg = document.getElementById('item-preview-img');
                if (previewImg) {
                    previewImg.src = event.target.result; // تخزين نص الصورة
                    previewImg.style.display = 'block';
                }
            };
            reader.readAsDataURL(file); // قراءة الملف من الجهاز
        }
    });

    // كود زر فتح نافذة "إضافة عنصر جديد"
    document.getElementById('add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('item-add-form');
        if (form) form.reset(); // تصفير حقول المدخلات

        // 1. تفريغ الـ ID المخفي لضمان تنفيذ الإضافة وليس التعديل
        const editIdInput = document.getElementById('modal-item-add-edit-id');
        if (editIdInput) editIdInput.value = '';

        // 2. إخفاء وإلغاء معاينة الصورة القديمة
        const previewImg = document.getElementById('item-preview-img');
        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }

        // 3. فتح النافذة
        const modal = document.getElementById('item-add-modal');
        if (modal) modal.style.display = 'block';
    });
}


// ==========================================
// 4. قسم العملاء (Customers Module)
// ==========================================

// البيانات الأولية للعملاء
let customersData = [
    { id: "1", birthday: "15-09-2005", clientName: "أحمد محمود", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "ahmed@mail.com", country: "مصر", governorate: "القاهرة", monthlyOrders: "3", totalOrders: "12", totalAmount: "4500 EGP", dartCard: "yes", isDeleted: false, isChecked: false }
];

// عرض العملاء
function renderCustomers(dataArray) {
    const container = document.getElementById('customers-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w100 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item w150">${item.birthday || '-'}</span>
                <span class="text-item w150">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2 || '-'}</span>
                <span class="text-item w200">${item.email || '-'}</span>
                <span class="text-item w150">${item.country || 'مصر'}</span>
                <span class="text-item w200">${item.governorate || '-'}</span>
                <span class="text-item w150">${item.monthlyOrders || 0}</span>
                <span class="text-item w150">${item.totalOrders || 0}</span>
                <span class="text-item w300">${item.totalAmount || '0 EGP'}</span>
                <span class="text-item w200">${item.dartCard || 'no'}</span>
            </div>
        `);
    });
}

// النافذة المنبثقة للعملاء
function setupCustomerModal() {
    const modal = document.getElementById('customerModal');
    const form = document.getElementById('customerForm');

    // 1. حفظ وتحديث بيانات العميل
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-customer-edit-id')?.value;

            const customerPayload = {
                clientName: document.getElementById('custName')?.value || '',
                birthday: document.getElementById('custBirthday')?.value || '-',
                phone1: document.getElementById('custPhone1')?.value || '',
                phone2: document.getElementById('custPhone2')?.value || '-',
                email: document.getElementById('custEmail')?.value || '',
                country: document.getElementById('custCountry')?.value || 'Egypt',
                governorate: document.getElementById('custGovernorate')?.value || '',
                clientId: 'C-' + Math.floor(Math.random() * 1000),
                monthlyOrders: "0",
                totalOrders: "0",
                totalAmount: "0 EGP",
                dartCard: "no",
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = customersData.findIndex(c => String(c.id) === String(editId));
                if (index !== -1) customersData[index] = { ...customersData[index], ...customerPayload };
            } else {
                customerPayload.id = Date.now().toString();
                customersData.push(customerPayload);
            }

            renderCustomers(customersData);
            if (typeof saveSectionState === 'function') saveSectionState('customers');
            
            if (modal) modal.style.display = 'none';
            form.reset();
        });
    }

    // 2. قراءة البيانات وفتح النافذة عند الضغط على زر التعديل
    document.getElementById('customers-container')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit');
        if (!editBtn) return;

        const row = editBtn.closest('[data-id]');
        const customerId = row?.dataset.id;
        const customer = customersData.find(c => String(c.id) === String(customerId));

        if (customer) {
            document.getElementById('modal-customer-edit-id').value = customer.id;
            document.getElementById('custName').value = customer.clientName || '';
            document.getElementById('custBirthday').value = customer.birthday || '';
            document.getElementById('custPhone1').value = customer.phone1 || '';
            document.getElementById('custPhone2').value = customer.phone2 || '';
            document.getElementById('custEmail').value = customer.email || '';
            document.getElementById('custCountry').value = customer.country || '';
            document.getElementById('custGovernorate').value = customer.governorate || '';

            if (modal) modal.style.display = 'block';
        }
    });

    // 3. إغلاق النافذة عند الضغط على زر X
    document.querySelector('.close-customer-modal')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });

    // فتح نافذة إضافة عميل جديد وتصفير الحقول
    document.getElementById('add-customer-btn')?.addEventListener('click', () => {
        if (form) form.reset();
        
        // تصفير الـ ID المخفي لضمان الإضافة وليس التعديل
        const editIdInput = document.getElementById('modal-customer-edit-id');
        if (editIdInput) editIdInput.value = '';

        if (modal) modal.style.display = 'block';
    });
}


// ==========================================
// 5. قسم الطلبات (Orders Module)
// ==========================================

// إعدادات حالات الطلب
const orderStatuses = [
    { key: "Pending", label: "Pending", bg: "#fff3cd", color: "#856404", border: "#ffeeba" },
    { key: "Accepted", label: "Accepted", bg: "#cce5ff", color: "#004085", border: "#b8daff" },
    { key: "Out for Delivery", label: "Out for Delivery", bg: "#e2e3e5", color: "#383d41", border: "#d6d8db" },
    { key: "Delivered", label: "Delivered", bg: "#d4edda", color: "#155724", border: "#c3e6cb" }
];

// البيانات الأولية للطلبات
let ordersData = [
    { id: "1", orderId: "ORD-200", date: "18-10-2026", time: "02:30 PM", clientId: "C-101", clientName: "محمد علي", phone1: "0100000000", phone2: "0110000000", email: "user@mail.com", status: "Pending", totalProducts: 3, items: ["IT-992", "IT-993", "IT-994"], totalPrice: 1000, discount: 10, reasonDeduction: "خصم لفترة محدودة", paymentMethod: "Vodafone Cash", deliveryNotes: "الاتصال قبل الوصول", country: "مصر", governorate: "القاهرة", area: "حدائق القبة", street: "شارع بورسعيد", building: "عمارة 15", floor: "3", isDeleted: false, isChecked: false }
];

// عرض الطلبات
function renderOrders(dataArray) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        const totalPrice = Number(item.totalPrice) || 0;
        const discountPercent = Number(item.discount) || 0;
        const finalAmount = totalPrice - (totalPrice * (discountPercent / 100));

        const currentIndex = orderStatuses.findIndex(s => s.key === item.status);
        const currentStatusConfig = orderStatuses[currentIndex] || orderStatuses[0];
        const prevStatusConfig = (currentIndex > 0) ? orderStatuses[currentIndex - 1] : null;
        const nextStatusConfig = (currentIndex !== -1 && currentIndex < orderStatuses.length - 1) ? orderStatuses[currentIndex + 1] : null;

        let statusButtonsHTML = '';
        if (prevStatusConfig) {
            statusButtonsHTML += `<button class="btn-prev-status btn-status-prev" title="تراجع للخطوة السابقة"><i class="bx bx-undo"></i></button>`;
        }
        if (nextStatusConfig) {
            statusButtonsHTML += `<button class="btn-change-status btn-status-next" title="الانتقال للخطوة التالية" style="background-color:${nextStatusConfig.bg}; color:${nextStatusConfig.color}; border: 1px solid ${nextStatusConfig.border};">${nextStatusConfig.label}</button>`;
        } else {
            statusButtonsHTML += `<span class="status-delivered-text">Delivered</span>`;
        }

        let itemsBoxesHTML = '<div class="order-items-grid">';
        const requestedList = item.items || [];
        for (let i = 0; i < 5; i++) {
            const itemCode = requestedList[i] ? requestedList[i] : '-';
            itemsBoxesHTML += `<div class="order-item-chip">${itemCode}</div>`;
        }
        itemsBoxesHTML += '</div>';

        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w300 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                    ${statusButtonsHTML}
                </div>
                <span class="text-item w150">${item.orderId}</span>
                <span class="text-item w150">${item.date || '-'}</span>
                <span class="text-item w150">${item.time || '-'}</span>
                <span class="text-item w200 status-badge" style="color:${currentStatusConfig.color}">• ${item.status}</span>
                <span class="text-item w150">${item.clientId || '-'}</span>
                <span class="text-item w200">${item.clientName}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2 || '-'}</span>
                <span class="text-item w150">${item.email || '-'}</span>
                <span class="text-item w150">${item.totalProducts || (item.items ? item.items.length : 0)}</span>
                <div class="text-item w500">${itemsBoxesHTML}</div>
                <span class="text-item w150">${totalPrice} EGP</span>
                <span class="text-item w150">${discountPercent}%</span>
                <span class="text-item w150">${item.reasonDeduction || '-'}</span>
                <span class="text-item w150 order-final-amount">${finalAmount.toFixed(2)} EGP</span>
                <span class="text-item w150">${item.paymentMethod}</span>
                <span class="text-item w150">${item.deliveryNotes || '-'}</span>
                <span class="text-item w150">${item.country || 'مصر'}</span>
                <span class="text-item w150">${item.governorate || '-'}</span>
                <span class="text-item w150">${item.area || '-'}</span>
                <span class="text-item w150">${item.street || '-'}</span>
                <span class="text-item w150">${item.building || '-'}</span>
                <span class="text-item w150">${item.floor || '-'}</span>
            </div>
        `);
    });
}

// النافذة المنبثقة للطلبات
function setupOrderModal() {
    const modal = document.getElementById('order-modal') || document.getElementById('orderModal');
    const form = document.getElementById('orderForm');
    const phone1Input = document.getElementById('phone1');
    const clientNameInput = document.getElementById('clientName');
    const phone2Input = document.getElementById('phone2');
    const emailInput = document.getElementById('email');
    const govInput = document.getElementById('governorate');

    let currentSelectedItems = [];

    function searchAndFillCustomer(query) {
        if (!query) return;
        const cleanQuery = query.trim();
        const matchedClient = customersData.find(c => c.phone1 === cleanQuery || c.clientId === cleanQuery);
        
        if (matchedClient) {
            if (clientNameInput) clientNameInput.value = matchedClient.clientName || '';
            if (phone2Input) phone2Input.value = matchedClient.phone2 || '';
            if (emailInput) emailInput.value = matchedClient.email || '';
            if (govInput) govInput.value = matchedClient.governorate || '';
        }
    }

    if (phone1Input) {
        phone1Input.addEventListener('input', (e) => searchAndFillCustomer(e.target.value));
    }

    function calculatePrices() {
        let subtotal = 0;
        currentSelectedItems.forEach(itemCode => {
            const matchedItem = itemsData.find(i => i.itemCode === itemCode);
            if (matchedItem) {
                const matchedModel = modelsData.find(m => m.modelId === matchedItem.modelId);
                if (matchedModel) {
                    const priceToUse = parseFloat(matchedModel.discountedPrice || matchedModel.selling) || 0;
                    subtotal += priceToUse;
                }
            }
        });

        const discountPercentage = parseFloat(document.getElementById('customDiscount')?.value || 0) || 0;
        const discountAmountFromPercentage = (subtotal * discountPercentage) / 100;
        const deductions = parseFloat(document.getElementById('deductions')?.value || 0) || 0;
        
        const totalDiscount = discountAmountFromPercentage + deductions;
        const total = Math.max(0, subtotal - totalDiscount);

        const subtotalElem = document.getElementById('subtotalVal');
        const discountElem = document.getElementById('discountVal');
        const totalElem = document.getElementById('totalVal');

        if (subtotalElem) subtotalElem.textContent = subtotal.toFixed(2) + ' EGP';
        if (discountElem) discountElem.textContent = totalDiscount.toFixed(2) + ' EGP (' + discountPercentage + '%)';
        if (totalElem) totalElem.textContent = total.toFixed(2) + ' EGP';

        return { subtotal, discountPercentage, totalDiscount, total };
    }

    function updateSelectedUI() {
        const container = document.getElementById('selectedProductsList');
        if (container) {
            container.innerHTML = currentSelectedItems.map((code, index) => `
                <span style="background: #f1f1f1; border: 1px solid #ccc; padding: 4px 10px; border-radius: 4px; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; color: #333; margin-top: 5px;">
                    <b>${code}</b>
                    <button type="button" class="remove-item-btn" data-index="${index}" style="border:none; background:none; color:red; cursor:pointer; font-weight:bold; font-size: 15px;">&times;</button>
                </span>
            `).join('');
        }
        calculatePrices();
    }

    const selectedListContainer = document.getElementById('selectedProductsList');
    if (selectedListContainer) {
        selectedListContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-item-btn')) {
                const index = parseInt(e.target.getAttribute('data-index'));
                currentSelectedItems.splice(index, 1);
                updateSelectedUI();
            }
        });
    }

    window.loadOrderItemsForEdit = function(itemsArray) {
        currentSelectedItems = itemsArray ? [...itemsArray] : [];
        updateSelectedUI();
    };

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const editId = document.getElementById('modal-order-edit-id')?.value;
            const clientNameVal = clientNameInput ? clientNameInput.value.trim() : '';
            const phoneVal = phone1Input ? phone1Input.value.trim() : '';
            const emailVal = emailInput ? emailInput.value.trim() : '';

            if (!clientNameVal || !phoneVal) {
                alert('برجاء إدخال اسم العميل ورقم الهاتف الأساسي!');
                return;
            }

            if (currentSelectedItems.length === 0) {
                alert('برجاء إضافة قطعة واحدة على الأقل للطلب!');
                return;
            }

            const prices = calculatePrices();

            if (editId) {
                const index = ordersData.findIndex(o => o.id === editId);
                if (index !== -1) {
                    ordersData[index] = {
                        ...ordersData[index],
                        clientName: clientNameVal,
                        phone1: phoneVal,
                        phone2: phone2Input ? phone2Input.value.trim() : '',
                        email: emailVal,
                        governorate: govInput ? govInput.value.trim() : '',
                        paymentMethod: document.getElementById('paymentMethod')?.value || 'Cash',
                        discount: prices.discountPercentage,
                        items: [...currentSelectedItems],
                        deliveryNotes: document.getElementById('deliveryNotes')?.value || '',
                        totalProducts: currentSelectedItems.length,
                        totalPrice: prices.subtotal
                    };
                }
            } else {
                const orderPayload = {
                    id: Date.now().toString(),
                    orderId: 'ORD-' + Math.floor(Math.random() * 10000),
                    clientId: document.getElementById('clientId')?.value || 'C-New',
                    clientName: clientNameVal,
                    phone1: phoneVal,
                    phone2: phone2Input ? phone2Input.value.trim() : '',
                    email: emailVal,
                    governorate: govInput ? govInput.value.trim() : '',
                    paymentMethod: document.getElementById('paymentMethod')?.value || 'Cash',
                    discount: prices.discountPercentage,
                    items: [...currentSelectedItems],
                    deliveryNotes: document.getElementById('deliveryNotes')?.value || '',
                    status: "Pending",
                    date: new Date().toLocaleDateString('en-GB'),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    totalProducts: currentSelectedItems.length,
                    totalPrice: prices.subtotal,
                    isDeleted: false,
                    isChecked: false
                };
                ordersData.push(orderPayload);
            }

            renderOrders(ordersData);
            saveSectionState('orders');
            closeModal(modal);
            form.reset();
            currentSelectedItems = [];
            updateSelectedUI();
        });
    }
}


// ==========================================
// 6. قسم المرتجعات (Returns Module)
// ==========================================

// البيانات الأولية للمرتجعات
let returnsData = [
    { id: "1", returnId: "R-501", modelId: "DA-Jen121", itemCode: "IT-992", status: "Good", date: "10-08-2026", clientName: "ياسر إبراهيم", clientId: "C-201", phone1: "0101111222", phone2: "-", email: "yasser@mail.com", reason: "المقاس صغير", orderId: "ORD-200", isDeleted: false, isChecked: false }
];

// عرض المرتجعات
function renderReturns(dataArray) {
    const container = document.getElementById('returns-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        const isGood = item.status === 'Good';
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w150 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                    <button class="btn-toggle-return return-toggle-btn ${isGood ? 'return-status-bad' : 'return-status-good'}">
                        ${isGood ? 'Bad' : 'Good'}
                    </button>
                </div>
                <span class="text-item w150">${item.returnId}</span>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.itemCode}</span>
                <span class="text-item w150 status-text" style="color:${isGood ? 'green' : 'red'};">• ${item.status}</span>
                <span class="text-item w150">${item.date}</span>
                <span class="text-item overflow w200">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item w150">${item.email}</span>
                <span class="text-item w150">${item.reason}</span>
                <span class="text-item w150">${item.orderId}</span>
            </div>
        `);
    });
}

// النافذة المنبثقة للمرتجعات
function setupReturnModal() {
    const modal = document.getElementById('return-modal');
    const form = document.getElementById('return-form');

    // 1. حفظ وتحديث بيانات المرتجع
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-return-edit-id')?.value;

            const returnPayload = {
                clientName: document.getElementById('modal-return-name')?.value || '',
                itemCode: document.getElementById('modal-return-item-code')?.value || '',
                phone1: document.getElementById('modal-return-phone1')?.value || '',
                modelId: document.getElementById('modal-return-model-id')?.value || '',
                phone2: document.getElementById('modal-return-phone2')?.value || '-',
                email: document.getElementById('modal-return-email')?.value || '',
                status: document.getElementById('modal-item-condition')?.value || 'Good',
                reason: document.getElementById('modal-item-reason')?.value || '',
                date: new Date().toLocaleDateString('en-GB'),
                clientId: 'C-101',
                orderId: 'ORD-200',
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = returnsData.findIndex(r => String(r.id) === String(editId));
                if (index !== -1) {
                    returnsData[index] = { ...returnsData[index], ...returnPayload };
                }
            } else {
                returnPayload.id = Date.now().toString();
                returnPayload.returnId = 'R-' + Math.floor(Math.random() * 1000);
                returnsData.push(returnPayload);
            }

            renderReturns(returnsData);
            if (typeof saveSectionState === 'function') saveSectionState('returns');
            
            if (modal) modal.style.display = 'none';
            form.reset();
        });
    }

    // 2. قراءة البيانات وفتح النافذة عند الضغط على زر التعديل
    document.getElementById('returns-container')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit');
        if (!editBtn) return;

        const row = editBtn.closest('[data-id]');
        const returnId = row?.dataset.id;
        const item = returnsData.find(r => String(r.id) === String(returnId));

        if (item) {
            document.getElementById('modal-return-edit-id').value = item.id;
            document.getElementById('modal-return-name').value = item.clientName || '';
            document.getElementById('modal-return-item-code').value = item.itemCode || '';
            document.getElementById('modal-return-phone1').value = item.phone1 || '';
            document.getElementById('modal-return-model-id').value = item.modelId || '';
            document.getElementById('modal-return-phone2').value = item.phone2 || '';
            document.getElementById('modal-return-email').value = item.email || '';
            document.getElementById('modal-item-condition').value = item.status || 'Good';
            document.getElementById('modal-item-reason').value = item.reason || '';

            if (modal) modal.style.display = 'block';
        }
    });

    // 3. فتح النافذة لإضافة مرتجع جديد (تصفير الحقول والـ ID المخفي)
    document.getElementById('add-return-btn')?.addEventListener('click', () => {
        if (form) form.reset();
        
        const editIdInput = document.getElementById('modal-return-edit-id');
        if (editIdInput) editIdInput.value = '';

        if (modal) modal.style.display = 'block';
    });

    // 4. إغلاق النافذة عند الضغط على زر X
    document.getElementById('close-return-btn')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });
}


// ==========================================
// 7. قسم التقييمات (Reviews Module)
// ==========================================

// البيانات الأولية للتقييمات
let reviewsData = [
    { id: "1", date: "12-08-2026", clientName: "محمد علي", clientId: "C-101", status: "Active", rating: "5", title: "جودة ممتازة", review: "الخامة مريحة جدا", phone1: "0100000000", phone2: "-", email: "user@mail.com", isDeleted: false, isChecked: false }
];

// عرض التقييمات
function renderReviews(dataArray) {
    const container = document.getElementById('review-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        const isActive = item.status === 'Active';
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w200 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                    <button class="btn-toggle-review review-toggle-btn ${isActive ? 'review-status-active' : 'review-status-hidden'}">
                        ${isActive ? 'Hidden' : 'Publish'}
                    </button>
                </div>
                <span class="text-item w200">${item.date}</span>
                <span class="text-item w200">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150 status-text" style="color:${isActive ? 'green' : 'red'};">${item.status}</span>
                <span class="text-item w100">${item.rating} / 5</span>
                <span class="text-item w300">${item.title}</span>
                <span class="text-item w500">${item.review}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item w150">${item.email}</span>
            </div>
        `);
    });
}

// النافذة المنبثقة للتقييمات
function setupReviewModal() {
    const modal = document.getElementById('customer-review-modal');
    const form = document.getElementById('customer-review-form');

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-review-edit-id')?.value;

            const reviewPayload = {
                clientName: document.getElementById('modal-cust-rev-name')?.value || '',
                rating: document.getElementById('modal-cust-rating')?.value || '5',
                phone1: document.getElementById('modal-cust-rev-phone1')?.value || '',
                review: document.getElementById('modal-cust-review')?.value || '',
                phone2: document.getElementById('modal-cust-rev-phone2')?.value || '-',
                title: document.getElementById('modal-cust-title')?.value || '',
                email: document.getElementById('modal-cust-rev-email')?.value || '',
                status: document.getElementById('modal-cust-status')?.value || 'Active',
                date: new Date().toLocaleDateString('en-GB'),
                clientId: 'C-101',
                isDeleted: false,
                isChecked: false
            };

            // التحقق إذا كان تعديل أم إضافة
            if (editId && editId.trim() !== '') {
                const index = reviewsData.findIndex(r => String(r.id) === String(editId));
                if (index !== -1) reviewsData[index] = { ...reviewsData[index], ...reviewPayload };
            } else {
                reviewPayload.id = Date.now().toString();
                reviewsData.push(reviewPayload);
            }

            renderReviews(reviewsData);
            if (typeof saveSectionState === 'function') saveSectionState('review');
            if (typeof closeModal === 'function') closeModal(modal);

            form.reset();
            // تفريغ حقل הـ ID لضمان عمل الإضافة المرة القادمة
            document.getElementById('modal-review-edit-id').value = '';
        });
    }

    // حدث الضغط على زرار التعديل
    document.getElementById('review-container')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit');
        if (!editBtn) return;

        const row = editBtn.closest('[data-id]');
        const id = row?.getAttribute('data-id');
        const item = reviewsData.find(r => String(r.id) === String(id));

        if (item) {
            // تعبئة البيانات في النافذة
            document.getElementById('modal-review-edit-id').value = item.id;
            document.getElementById('modal-cust-rev-name').value = item.clientName || '';
            document.getElementById('modal-cust-rating').value = item.rating || '5';
            document.getElementById('modal-cust-rev-phone1').value = item.phone1 || '';
            document.getElementById('modal-cust-review').value = item.review || '';
            document.getElementById('modal-cust-rev-phone2').value = item.phone2 || '';
            document.getElementById('modal-cust-title').value = item.title || '';
            document.getElementById('modal-cust-rev-email').value = item.email || '';
            document.getElementById('modal-cust-status').value = item.status || 'Active';

            // فتح النافذة
            const modal = document.getElementById('customer-review-modal');
            if (modal) openModal(modal); // أو modal.style.display = 'flex';
        }
    });
}


// ==========================================
// 8. قسم الكروت (Cards Module)
// ==========================================

// البيانات الأولية للكروت
let cardsData = [
    { id: "1", cardId: "CRD-10", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", status: "Active", issueDate: "01-01-2026", expDate: "01-01-2027", purchasedItems: "15", purchasedLimit: "20", requestedProducts: ["IT-01", "IT-02"], isDeleted: false, isChecked: false }
];

// عرض الكروت
function renderCards(dataArray) {
    const container = document.getElementById('card-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        let boxesHTML = '<div class="card-items-grid">';
        (item.requestedProducts || []).forEach(code => {
            boxesHTML += `<div class="card-item-chip">${code}</div>`;
        });
        boxesHTML += '</div>';

        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w100 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item overflow w150">${item.cardId}</span>
                <span class="text-item overflow w150">${item.clientName}</span>
                <span class="text-item overflow w150">${item.clientId}</span>
                <span class="text-item overflow w150">${item.phone1}</span>
                <span class="text-item overflow w150">${item.phone2}</span>
                <span class="text-item overflow w200">${item.email}</span>
                <span class="text-item overflow w150">${item.status}</span>
                <span class="text-item overflow w200">${item.issueDate}</span>
                <span class="text-item overflow w150">${item.expDate}</span>
                <span class="text-item overflow w150">${item.purchasedItems}</span>
                <span class="text-item overflow w150">${item.purchasedLimit}</span>
                <div class="text-item overflow w1200">${boxesHTML}</div>
            </div>
        `);
    });
}

// النافذة المنبثقة للكروت
function setupCardModal() {
    const modal = document.getElementById('card-modal');
    const form = document.getElementById('card-form');

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-card-edit-id')?.value;

            const cardPayload = {
                cardId: document.getElementById('modal-card-code-id')?.value || ('CRD-' + Math.floor(Math.random() * 100)),
                clientName: document.getElementById('modal-card-client-name')?.value || '',
                clientId: document.getElementById('modal-card-client-id')?.value || '',
                phone1: document.getElementById('modal-card-phone1')?.value || '',
                phone2: document.getElementById('modal-card-phone2')?.value || '-',
                email: document.getElementById('modal-card-email')?.value || '',
                status: document.getElementById('modal-card-status')?.value || 'Active',
                issueDate: document.getElementById('modal-card-issue')?.value || new Date().toLocaleDateString('en-GB'),
                expDate: document.getElementById('modal-card-exp')?.value || '',
                purchasedItems: document.getElementById('modal-card-purchased')?.value || '0',
                purchasedLimit: document.getElementById('modal-card-limit')?.value || '20',
                requestedProducts: ["IT-01", "IT-02"],
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = cardsData.findIndex(c => c.id === editId);
                if (index !== -1) cardsData[index] = { ...cardsData[index], ...cardPayload };
            } else {
                cardPayload.id = Date.now().toString();
                cardsData.push(cardPayload);
            }

            renderCards(cardsData);
            saveSectionState('card');
            closeModal(modal);
            form.reset();
        });
    }
}


// ==========================================
// 9. خريطة الأقسام والتحكم العام بالتعديل (Sections Router & Dynamic Edit)
// ==========================================

const sectionsMap = {
    'models': { get data() { return modelsData; }, set data(v) { modelsData = v; }, render: renderModels, storageKey: 'dart_models' },
    'items': { get data() { return itemsData; }, set data(v) { itemsData = v; }, render: renderItems, storageKey: 'dart_items' },
    'customers': { get data() { return customersData; }, set data(v) { customersData = v; }, render: renderCustomers, storageKey: 'dart_customers' },
    'orders': { get data() { return ordersData; }, set data(v) { ordersData = v; }, render: renderOrders, storageKey: 'dart_orders' },
    'returns': { get data() { return returnsData; }, set data(v) { returnsData = v; }, render: renderReturns, storageKey: 'dart_returns' },
    'review': { get data() { return reviewsData; }, set data(v) { reviewsData = v; }, render: renderReviews, storageKey: 'dart_reviews' },
    'card': { get data() { return cardsData; }, set data(v) { cardsData = v; }, render: renderCards, storageKey: 'dart_cards' }
};

function saveSectionState(sectionKey) {
    const sec = sectionsMap[sectionKey];
    if (sec) saveDataToStorage(sec.storageKey, sec.data);
}

function renderAllSections() {
    Object.keys(sectionsMap).forEach(key => {
        if (document.getElementById(key)) {
            sectionsMap[key].render(sectionsMap[key].data);
        }
    });
}

// فتح تعديل العنصر ديناميكياً حسب القسم
function openEditModal(id, sectionKey) {
    const sectionInfo = sectionsMap[sectionKey];
    if (!sectionInfo) return;

    const item = sectionInfo.data.find(el => el.id === id);
    if (!item) return;

    if (sectionKey === 'models') {
        const modal = document.getElementById('model-modal');
        if (!modal) return;
        document.getElementById('modal-edit-id').value = item.id;
        document.getElementById('modal-id').value = item.modelId || '';
        document.getElementById('modal-name').value = item.name || '';
        document.getElementById('modal-category').value = item.category || '';
        document.getElementById('modal-description').value = item.description || '';
        document.getElementById('modal-cost').value = item.cost || '';
        document.getElementById('modal-selling').value = item.selling || '';
        document.getElementById('modal-discount').value = item.discount || '0';
        openModal(modal);
    } 
    else if (sectionKey === 'items') {
        const modal = document.getElementById('item-modal');
        if (!modal) return;
        document.getElementById('modal-item-edit-id').value = item.id;
        document.getElementById('modal-item-model-id').value = item.modelId || '';
        document.getElementById('modal-item-code').value = item.itemCode || '';
        document.getElementById('modal-item-color').value = item.color || '';
        document.getElementById('modal-item-size').value = item.size || '';
        document.getElementById('modal-item-status').value = item.status || '';
        openModal(modal);
    }
    else if (sectionKey === 'customers') {
        const modal = document.getElementById('customer-modal');
        if (!modal) return;
        document.getElementById('modal-customer-edit-id').value = item.id;
        document.getElementById('modal-cust-name').value = item.clientName || '';
        document.getElementById('modal-cust-birthday').value = item.birthday || '';
        document.getElementById('modal-cust-phone1').value = item.phone1 || '';
        document.getElementById('modal-cust-phone2').value = item.phone2 || '';
        document.getElementById('modal-cust-email').value = item.email || '';
        document.getElementById('modal-cust-country').value = item.country || '';
        document.getElementById('modal-cust-gov').value = item.governorate || '';
        openModal(modal);
    }
    else if (sectionKey === 'returns') {
        const modal = document.getElementById('return-modal');
        if (!modal) return;
        document.getElementById('modal-return-edit-id').value = item.id;
        document.getElementById('modal-return-name').value = item.clientName || '';
        document.getElementById('modal-return-code').value = item.itemCode || '';
        document.getElementById('modal-return-phone1').value = item.phone1 || '';
        document.getElementById('modal-return-model-id').value = item.modelId || '';
        document.getElementById('modal-return-phone2').value = item.phone2 || '';
        document.getElementById('modal-return-condition').value = item.status || '';
        document.getElementById('modal-return-email').value = item.email || '';
        document.getElementById('modal-return-reason').value = item.reason || '';
        openModal(modal);
    } 
    else if (sectionKey === 'review') {
        const modal = document.getElementById('review-modal');
        if (!modal) return;
        document.getElementById('modal-review-edit-id').value = item.id;
        document.getElementById('modal-rev-name').value = item.clientName || '';
        document.getElementById('modal-rev-rating').value = item.rating || '';
        document.getElementById('modal-rev-phone1').value = item.phone1 || '';
        document.getElementById('modal-rev-review').value = item.review || '';
        document.getElementById('modal-rev-phone2').value = item.phone2 || '';
        document.getElementById('modal-rev-title').value = item.title || '';
        document.getElementById('modal-rev-email').value = item.email || '';
        openModal(modal);
    }
    else if (sectionKey === 'card') {
        const modal = document.getElementById('card-modal');
        if (!modal) return;
        document.getElementById('modal-card-edit-id').value = item.id;
        document.getElementById('modal-card-code-id').value = item.cardId || '';
        document.getElementById('modal-card-client-name').value = item.clientName || '';
        document.getElementById('modal-card-client-id').value = item.clientId || '';
        document.getElementById('modal-card-phone1').value = item.phone1 || '';
        document.getElementById('modal-card-phone2').value = item.phone2 || '';
        document.getElementById('modal-card-email').value = item.email || '';
        document.getElementById('modal-card-status').value = item.status || '';
        document.getElementById('modal-card-issue').value = item.issueDate || '';
        document.getElementById('modal-card-exp').value = item.expDate || '';
        document.getElementById('modal-card-purchased').value = item.purchasedItems || '';
        document.getElementById('modal-card-limit').value = item.purchasedLimit || '';
        openModal(modal);
    }
    else if (sectionKey === 'orders') {
        const modal = document.getElementById('order-modal') || document.getElementById('orderModal');
        if (!modal) return;
        document.getElementById('modal-order-edit-id').value = item.id;
        document.getElementById('clientName').value = item.clientName || '';
        document.getElementById('phone1').value = item.phone1 || '';
        document.getElementById('phone2').value = item.phone2 || '';
        document.getElementById('email').value = item.email || '';
        document.getElementById('governorate').value = item.governorate || '';
        if (typeof window.loadOrderItemsForEdit === 'function') {
            window.loadOrderItemsForEdit(item.items);
        }
        openModal(modal);
    }
}


// ==========================================
// 10. تفويض الأحداث والتحكم الجماعي والبحث (Event Delegation & Global Handlers)
// ==========================================

function setupSectionEvents(containerId, dataArray, renderFn, sectionKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', (e) => {
        const row = e.target.closest('.model-row');
        if (!row) return;
        const id = row.getAttribute('data-id');

        if (e.target.closest('.btn-delete')) {
            const item = sectionsMap[sectionKey].data.find(el => el.id === id);
            if (item) {
                item.isDeleted = !item.isDeleted;
                renderFn(sectionsMap[sectionKey].data);
                saveSectionState(sectionKey);
            }
        }

        if (e.target.closest('.btn-hard-delete')) {
            deletePermanently(id, sectionKey);
        }

        if (e.target.closest('.btn-edit')) {
            openEditModal(id, sectionKey);
        }
    });

    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('model-checkbox')) {
            const row = e.target.closest('.model-row');
            if (!row) return;
            const id = row.getAttribute('data-id');
            const item = sectionsMap[sectionKey].data.find(el => el.id === id);
            if (item) {
                item.isChecked = e.target.checked;
                saveSectionState(sectionKey);
            }
        }
    });
}

function setupAllDelegatedEvents() {
    setupSectionEvents('models-container', modelsData, renderModels, 'models');
    setupSectionEvents('items-container', itemsData, renderItems, 'items');
    setupSectionEvents('customers-container', customersData, renderCustomers, 'customers');
    setupSectionEvents('card-container', cardsData, renderCards, 'card');

    const ordersContainer = document.getElementById('orders-container');
    if (ordersContainer) {
        setupSectionEvents('orders-container', ordersData, renderOrders, 'orders');
        ordersContainer.addEventListener('click', (e) => {
            if (e.target.closest('.btn-change-status')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const order = ordersData.find(o => o.id === row.getAttribute('data-id'));
                    if (order) {
                        const currentIndex = orderStatuses.findIndex(s => s.key === order.status);
                        if (currentIndex !== -1 && currentIndex < orderStatuses.length - 1) {
                            order.status = orderStatuses[currentIndex + 1].key;
                            renderOrders(ordersData);
                            saveSectionState('orders');
                        }
                    }
                }
            }

            if (e.target.closest('.btn-prev-status')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const order = ordersData.find(o => o.id === row.getAttribute('data-id'));
                    if (order) {
                        const currentIndex = orderStatuses.findIndex(s => s.key === order.status);
                        if (currentIndex > 0) {
                            order.status = orderStatuses[currentIndex - 1].key;
                            renderOrders(ordersData);
                            saveSectionState('orders');
                        }
                    }
                }
            }
        });
    }

    const returnsContainer = document.getElementById('returns-container');
    if (returnsContainer) {
        setupSectionEvents('returns-container', returnsData, renderReturns, 'returns');
        returnsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-toggle-return')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const item = returnsData.find(r => r.id === row.getAttribute('data-id'));
                    if (item) {
                        item.status = item.status === 'Good' ? 'Bad' : 'Good';
                        renderReturns(returnsData);
                        saveSectionState('returns');
                    }
                }
            }
        });
    }

    const reviewContainer = document.getElementById('review-container');
    if (reviewContainer) {
        setupSectionEvents('review-container', reviewsData, renderReviews, 'review');
        reviewContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-toggle-review')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const item = reviewsData.find(r => r.id === row.getAttribute('data-id'));
                    if (item) {
                        item.status = item.status === 'Active' ? 'Hidden' : 'Active';
                        renderReviews(reviewsData);
                        saveSectionState('review');
                    }
                }
            }
        });
    }
}

// التحكم بالحذف والشطب الجماعي
function setupHeaderBatchActions() {
    document.addEventListener('change', (e) => {
        if (e.target.matches('.cont-titel .title-name input[type="checkbox"]')) {
            const isChecked = e.target.checked;
            const activeSection = document.querySelector('.dashboard-section.active-section') || document.getElementById('models');
            if (!activeSection) return;

            const sectionId = activeSection.id;
            const sectionInfo = sectionsMap[sectionId];

            if (sectionInfo) {
                sectionInfo.data.forEach(item => item.isChecked = isChecked);
                sectionInfo.render(sectionInfo.data);
                saveSectionState(sectionId);
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.second .delete-btn')) {
            const activeSection = document.querySelector('.dashboard-section.active-section') || document.getElementById('models');
            if (!activeSection) return;

            const sectionId = activeSection.id;
            const sectionInfo = sectionsMap[sectionId];

            if (sectionInfo) {
                sectionInfo.data.forEach(item => {
                    if (item.isChecked) item.isDeleted = true;
                });
                sectionInfo.render(sectionInfo.data);
                saveSectionState(sectionId);
            }
        }
    });
}

// البحث والفلترة العامة
function setupSearchFilter() {
    const searchInput = document.querySelector('.search-box input, .search-bar input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const activeSection = document.querySelector('.dashboard-section.active-section') || document.getElementById('models');
        if (!activeSection) return;

        const sectionId = activeSection.id;
        const sectionInfo = sectionsMap[sectionId];

        if (sectionInfo) {
            if (!query) {
                sectionInfo.render(sectionInfo.data);
                return;
            }

            const filteredData = sectionInfo.data.filter(item => {
                return Object.values(item).some(val => 
                    String(val).toLowerCase().includes(query)
                );
            });

            sectionInfo.render(filteredData);
        }
    });
}

// إغلاق وفتح النوافذ المنبثقة بالزر العام والإضافة
function setupGlobalModalTriggers() {
    document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.add-btn, .btn-add, button[class*="add"]');
        if (!addBtn) return;
        
        const activeSection = document.querySelector('.dashboard-section.active-section');
        if (!activeSection) return;
        
        const sectionId = activeSection.id;
        const modalMap = {
            'models': 'model-modal',
            'items': 'item-add-modal',
            'customers': 'customerModal',
            'orders': 'orderModal',
            'returns': 'return-modal',
            'review': 'customer-review-modal',
            'card': 'card-modal'
        };

        const targetModalId = modalMap[sectionId];
        if (targetModalId) {
            const modal = document.getElementById(targetModalId);
            if (modal) {
                const form = modal.querySelector('form');
                if (form) form.reset();
                openModal(modal);
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.close-modal, .close-item-modal, .close-card-modal')) {
            const modal = e.target.closest('.modal');
            closeModal(modal);
        }
        
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });
}


// ==========================================
// 11. تشغيل التطبيق (DOM Content Loaded)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. تحميل البيانات المخزنة سابقاً
    loadAllDataFromStorage();

    // 2. إعداد التنقل بين السكاشن (Navigation)
    const menuLinks = document.querySelectorAll('.menu li a');
    const sections = document.querySelectorAll('.dashboard-section');

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            if (!targetId) return;

            menuLinks.forEach(l => l.classList.remove('active'));
            sections.forEach(sec => sec.classList.remove('active-section'));

            link.classList.add('active');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active-section');
            }
        });
    });

    // 3. عرض كافة السكاشن وتفعيل أحداث القوائم
    renderAllSections();
    setupAllDelegatedEvents();
    setupHeaderBatchActions();
    setupSearchFilter();
    setupGlobalModalTriggers();
    
    // 4. إعداد المودالات لكل السكاشن
    setupModelModal();
    setupItemModal();
    setupCustomerModal();
    setupOrderModal();
    setupReturnModal();
    setupReviewModal();
    setupCardModal();
});

function setupHeaderBatchActions() { /* unchanged */ }
function setupSearchFilter() { /* unchanged */ }

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-modal') || (e.target.tagName === 'SPAN' && e.target.closest('.modal')) || e.target.classList.contains('modal')) {
        const modal = e.target.closest('.modal') || e.target;
        modal.style.display = 'none'; modal.classList.remove('active');
    }
});

    const dataRepo = {
    '2027': { 
        revenue: [3000, 4500, 5000, 6200, 7000, 8100, 9000, 10500, 11200, 12500, ], 
        cost:    [1500, 2000, 2200, 3000, 3200, 4000, 4500, 5000, 5500, 6000, ] 
    },
    '2026': { 
        revenue: [3000, 4500, 5000, 6200, 7000, 8100, 9000, 10500, 11200, 12500, 14000, 15500], 
        cost:    [1500, 2000, 2200, 3000, 3200, 4000, 4500, 5000, 5500, 6000, 7000, 7500] 
    },
    '2025': { 
        revenue: [2800, 4000, 4800, 5900, 6800, 7500, 8500, 9800, 10500, 11800, 13000, 14500], 
        cost:    [1400, 1800, 2100, 2800, 3000, 3800, 4200, 4800, 5200, 5800, 6500, 7200] 
    },
};

    let currentMode = 'months';
    let currentYear = 2026;

    var options = {
        series: [{ name: 'Profit', data: [] }, { name: 'Cost', data: [] }],
        chart: { type: 'area', height: 200 },
        colors: ['#10b981', '#ef4444'],
        xaxis: { categories: [] }
    };

    var chart = new ApexCharts(document.querySelector("#myChart"), options);
    chart.render();

    function setMode(mode) {
        currentMode = mode;
        document.querySelectorAll('.mode-btns button').forEach(b => b.classList.remove('active'));
        document.getElementById('btn' + mode.charAt(0).toUpperCase() + mode.slice(1)).classList.add('active');
        updateChart();
    }

    function navigate(dir) {
        currentYear += dir;
        updateChart();
    }

    function updateChart() {
        document.getElementById('displayLabel').innerText = currentYear;
        
        // محاكاة سحب البيانات بناءً على السنة والنمط
        const yearData = dataRepo[currentYear] || { revenue: [0,0,0], cost: [0,0,0] };
        
        chart.updateOptions({
            series: [{ name: 'Profit', data: yearData.revenue }, { name: 'Cost', data: yearData.cost }],
            xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] }        });
    }

    // تشغيل مبدئي
    updateChart();