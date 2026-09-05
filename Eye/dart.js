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

// تحديث قائمة الموديلات داخل Datalist للقطع
function populateModelsDatalist() {
    const datalist = document.getElementById('models-list');
    if (!datalist) return;
    datalist.innerHTML = modelsData.map(m => `<option value="${m.modelId}">${m.name}</option>`).join('');
}

// استدعاء الدالة عند فتح النافذة المنبثقة للقطع
document.getElementById('add-btn')?.addEventListener('click', () => {
    populateModelsDatalist();
});
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

    document.querySelector('#models .add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('model-form');
        if (form) form.reset();
        const editIdInput = document.getElementById('modal-edit-id');
        if (editIdInput) editIdInput.value = ''; // Clears edit ID for new entry
        openModal(document.getElementById('model-modal'));
    });
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

        // Inside setupItemModal() function:

        document.querySelector('#items .add-btn')?.addEventListener('click', () => {
            const form = document.getElementById('item-add-form');
            if (form) form.reset();

            // Populate datalist with active models
            populateModelsDatalist();

            const editIdInput = document.getElementById('modal-item-add-edit-id');
            if (editIdInput) editIdInput.value = '';

            const previewImg = document.getElementById('item-preview-img');
            if (previewImg) {
                previewImg.src = '';
                previewImg.style.display = 'none';
            }

            const modal = document.getElementById('item-add-modal');
            if (modal) modal.style.display = 'block';
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

    document.querySelector('#items .add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('item-add-form');
        if (form) form.reset();
        
        const editIdInput = document.getElementById('modal-item-add-edit-id');
        if (editIdInput) editIdInput.value = ''; // Clears edit ID

        const previewImg = document.getElementById('item-preview-img');
        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }

        populateModelsDatalist();
        openModal(document.getElementById('item-add-modal'));
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
                <span class="text-item w500">${item.totalAmount || '0 EGP'}</span>
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
    const modal = document.getElementById('orderModal');
    const form = document.getElementById('orderForm');
    const phone1Input = document.getElementById('phone1');
    const clientNameInput = document.getElementById('clientName');
    const phone2Input = document.getElementById('phone2');
    const emailInput = document.getElementById('email');
    const govInput = document.getElementById('governorate');
    const itemsDatalist = document.getElementById('items-datalist');
    const productsInputCode = document.getElementById('productsInputCode');
    const addProductBtn = document.getElementById('addProductBtn');

    let currentSelectedItems = [];

    // ملء قائمة القطع المتاحة
    function populateItemsDatalist() {
        if (!itemsDatalist) return;
        itemsDatalist.innerHTML = itemsData
            .filter(i => !i.isDeleted)
            .map(i => `<option value="${i.itemCode}">${i.modelId} - ${i.color} (${i.size})</option>`)
            .join('');
    }

    // إضافة قطعة للطلب
    function addSelectedItem() {
        const code = productsInputCode?.value.trim();
        if (!code) return;
        
        const itemExists = itemsData.some(i => i.itemCode === code);
        if (!itemExists) {
            alert("كود القطعة غير موجود!");
            return;
        }

        if (!currentSelectedItems.includes(code)) {
            currentSelectedItems.push(code);
            updateSelectedUI();
        }
        productsInputCode.value = '';
    }

    if (addProductBtn) addProductBtn.onclick = addSelectedItem;

    // حساب الأسعار والخصومات
function calculatePrices() {
    let subtotal = 0;
    const selectedItems = Array.isArray(currentSelectedItems) ? currentSelectedItems : [];

    selectedItems.forEach(itemCode => {
        const matchedItem = itemsData?.find(i => i.itemCode === itemCode);
        if (matchedItem) {
            const matchedModel = modelsData?.find(m => m.modelId === matchedItem.modelId);
            if (matchedModel) {
                const hasDiscountPrice = matchedModel.discountedPrice !== undefined && 
                                        matchedModel.discountedPrice !== null && 
                                        matchedModel.discountedPrice !== '';
                                        
                const price = hasDiscountPrice 
                    ? parseFloat(matchedModel.discountedPrice) || 0 
                    : parseFloat(matchedModel.selling) || 0;

                subtotal += price;
            }
        }
    });

    const deductionPercent = parseFloat(document.getElementById('deductions')?.value || 0) || 0;
    const customDiscount = parseFloat(document.getElementById('customDiscount')?.value || 0) || 0;
    
    const deductionAmount = subtotal * (deductionPercent / 100);
    const calculatedDiscount = deductionAmount + customDiscount;
    const totalDiscount = Math.min(subtotal, calculatedDiscount);
    const total = subtotal - totalDiscount;

    // حساب النسبة المئوية الإجمالية للخصم (مثلاً 10%)
    const discountPercent = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;

    const subtotalEl = document.getElementById('subtotalVal');
    const discountEl = document.getElementById('discountVal');
    const totalEl = document.getElementById('totalVal');

    if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2) + ' EGP';
    if (discountEl) discountEl.textContent = totalDiscount.toFixed(2) + ' EGP';
    if (totalEl) totalEl.textContent = total.toFixed(2) + ' EGP';

    return { subtotal, totalDiscount, total, discountPercent };
}

    function updateSelectedUI() {
        const container = document.getElementById('selectedProductsList');
        if (container) {
            container.innerHTML = currentSelectedItems.map((code, index) => `
                <span class="order-item-chip" style="background:#e0e0e0; padding:4px 8px; border-radius:4px; margin:2px; display:inline-block;">
                    <b>${code}</b>
                    <button type="button" class="remove-item-btn" data-index="${index}" style="border:none; background:none; color:red; cursor:pointer;">&times;</button>
                </span>
            `).join('');
        }
        calculatePrices();
    }

    // إزالة قطعة من القائمة
    document.getElementById('selectedProductsList')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-item-btn')) {
            const index = parseInt(e.target.getAttribute('data-index'));
            currentSelectedItems.splice(index, 1);
            updateSelectedUI();
        }
    });

    // إعادة الحساب عند تغيير الخصومات
    document.getElementById('deductions')?.addEventListener('input', calculatePrices);
    document.getElementById('customDiscount')?.addEventListener('input', calculatePrices);

    // فتح النافذة المجهزة
    document.getElementById('openModalBtn')?.addEventListener('click', () => {
        populateItemsDatalist();
        currentSelectedItems = [];
        updateSelectedUI();
        if (modal) modal.style.display = 'block';
    });

    // حفظ / تعديل الطلب عند إرسال النموذج
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-order-edit-id')?.value;
            const prices = calculatePrices();

            const orderPayload = {
                orderId: editId ? undefined : 'ORD-' + Math.floor(100 + Math.random() * 900),
                date: new Date().toLocaleDateString('en-GB'),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'Pending',
                clientId: document.getElementById('clientId')?.value || '-',
                clientName: document.getElementById('clientName')?.value || '',
                phone1: document.getElementById('phone1')?.value || '',
                phone2: document.getElementById('phone2')?.value || '-',
                email: document.getElementById('email')?.value || '-',
                paymentMethod: document.getElementById('paymentMethod')?.value || 'Cash',
                deliveryNotes: document.getElementById('deliveryNotes')?.value || '',
                totalProducts: currentSelectedItems.length,
                items: [...currentSelectedItems],
                totalPrice: prices.subtotal,
                discount: prices.discountPercent,
                reasonDeduction: 'Discount',
                country: document.getElementById('orderCountry')?.value || 'Egypt',
                governorate: document.getElementById('governorate')?.value || '',
                area: document.getElementById('orderArea')?.value || '',
                street: document.getElementById('orderStreetName')?.value || '',
                building: document.getElementById('orderBuildingNumber')?.value || '',
                floor: document.getElementById('orderFloor')?.value || '',
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = ordersData.findIndex(o => String(o.id) === String(editId));
                if (index !== -1) ordersData[index] = { ...ordersData[index], ...orderPayload };
            } else {
                orderPayload.id = Date.now().toString();
                ordersData.push(orderPayload);
            }

            if (typeof renderOrders === 'function') renderOrders(ordersData);
            if (typeof saveSectionState === 'function') saveSectionState('orders');

            if (typeof closeModal === 'function') closeModal(modal);
            else if (modal) modal.style.display = 'none';

            form.reset();
            currentSelectedItems = [];
            updateSelectedUI();
            
            const editIdInput = document.getElementById('modal-order-edit-id');
            if (editIdInput) editIdInput.value = '';
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
// 8. قسم المندوبين (Representative Module)
// ==========================================

// البيانات الأولية للتقييمات
let representativeData = [
    { 
        id: "1", 
        name: "محمد علي", 
        repId: "REP-101", 
        status: "Active", 
        nationalId: "29910121201234", 
        currentOrders: "3", 
        totalOrders: "45", 
        phone1: "0100000000", 
        phone2: "-", 
        address: "القاهرة", 
        date: "12-08-2026", 
        isChecked: false 
    }
];

function renderRepresentative(dataArray) {
    const container = document.getElementById('representative-container');
    if (!container) return;
    container.innerHTML = '';

    getSortedData(dataArray).forEach(item => {
        const isActive = item.status === 'Active';
        
        container.insertAdjacentHTML('beforeend', `
            <div class="${getRowClass(item)}" data-id="${item.id}">
                <input type="checkbox" class="model-checkbox" ${item.isChecked ? 'checked' : ''}>
                <div class="w100 button row-action-btns">
                    <button class="action-btn btn-delete" title="شطب"><i class="bx bx-minus-circle"></i></button>
                    <button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item w200">${item.name}</span>
                <span class="text-item w150">${item.repId}</span>
                <span class="text-item w100" style="color:${isActive ? '#10b981' : '#ef4444'};">${item.status}</span>
                <span class="text-item w150">${item.nationalId}</span>
                <span class="text-item w150">${item.currentOrders}</span>
                <span class="text-item w100">${item.totalOrders}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item w200">${item.address}</span>
                <span class="text-item w150">${item.date}</span>
            </div>
        `);
    });
}

function setupRepresentativeModal() {
    const modal = document.getElementById('representative-modal');
    const form = document.getElementById('rep-form');
    const openBtn = document.getElementById('openRepModalBtn');
    const closeBtn = document.getElementById('close-rep-btn');
    const container = document.getElementById('representative-container');
    const deleteSelectedBtn = document.getElementById('deleteSelectedRepBtn');

    openBtn?.addEventListener('click', () => {
        form?.reset();
        document.getElementById('modal-rep-id').value = '';
        if (modal) modal.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const editId = document.getElementById('modal-rep-id')?.value;

        const payload = {
            name: document.getElementById('modal-representative-name')?.value || '',
            repId: document.getElementById('modal-representative-id')?.value || ('REP-' + Math.floor(100 + Math.random() * 900)),
            phone1: document.getElementById('modal-rep-phone1')?.value || '',
            phone2: document.getElementById('modal-rep-phone2')?.value || '-',
            nationalId: document.getElementById('modal-representative-national-id')?.value || '29900000000000',
            address: document.getElementById('modal-representative-address')?.value || 'القاهرة',
            currentOrders: '0',
            totalOrders: '0',
            status: 'Active',
            date: new Date().toLocaleDateString('en-GB'),
            isDeleted: false,
            isChecked: false
        };

        if (editId && editId.trim() !== '') {
            const index = representativeData.findIndex(r => String(r.id) === String(editId));
            if (index !== -1) {
                representativeData[index] = { ...representativeData[index], ...payload };
            }
        } else {
            payload.id = Date.now().toString();
            representativeData.push(payload);
        }

        renderRepresentative(representativeData);
        if (modal) modal.style.display = 'none';
        form.reset();
    });

    container?.addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        const id = row.getAttribute('data-id');

        // زر التعديل
        if (e.target.closest('.btn-edit')) {
            const item = representativeData.find(r => String(r.id) === String(id));
            if (item) {
                document.getElementById('modal-rep-id').value = item.id;
                document.getElementById('modal-representative-name').value = item.name || '';
                document.getElementById('modal-representative-id').value = item.repId || '';
                document.getElementById('modal-representative-national-id').value = item.nationalId || '';
                document.getElementById('modal-representative-address').value = item.address || '';
                document.getElementById('modal-rep-phone1').value = item.phone1 || '';
                document.getElementById('modal-rep-phone2').value = item.phone2 || '';
                if (modal) modal.style.display = 'flex';
            }
        }

        // زر الشطب (نقل العنصر للأسفل وتغيير الحالة)
        if (e.target.closest('.btn-delete')) {
            const item = representativeData.find(r => String(r.id) === String(id));
            if (item) {
                item.isDeleted = !item.isDeleted;
                renderRepresentative(representativeData);
            }
        }

        // زر الحذف النهائي (تأكيد الحذف)
        if (e.target.closest('.btn-hard-delete')) {
            if (confirm("هل أنت متأكد من الحذف النهائي؟")) {
                representativeData = representativeData.filter(r => String(r.id) !== String(id));
                renderRepresentative(representativeData);
            }
        }
    });

    // حذف المحدد
    deleteSelectedBtn?.addEventListener('click', () => {
        representativeData = representativeData.filter(r => !r.isChecked);
        renderRepresentative(representativeData);
    });

    container?.addEventListener('change', (e) => {
        if (e.target.classList.contains('model-checkbox')) {
            const row = e.target.closest('[data-id]');
            const id = row?.getAttribute('data-id');
            const item = representativeData.find(r => String(r.id) === String(id));
            if (item) item.isChecked = e.target.checked;
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    renderRepresentative(representativeData);
    setupRepresentativeModal();
});


// ==========================================
// 9. قسم الكروت (Cards Module)
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
// 10. خريطة الأقسام والتحكم العام بالتعديل (Sections Router & Dynamic Edit)
// ==========================================

const sectionsMap = {
    'models': { get data() { return modelsData; }, set data(v) { modelsData = v; }, render: renderModels, storageKey: 'dart_models' },
    'items': { get data() { return itemsData; }, set data(v) { itemsData = v; }, render: renderItems, storageKey: 'dart_items' },
    'customers': { get data() { return customersData; }, set data(v) { customersData = v; }, render: renderCustomers, storageKey: 'dart_customers' },
    'orders': { get data() { return ordersData; }, set data(v) { ordersData = v; }, render: renderOrders, storageKey: 'dart_orders' },
    'returns': { get data() { return returnsData; }, set data(v) { returnsData = v; }, render: renderReturns, storageKey: 'dart_returns' },
    'review': { get data() { return reviewsData; }, set data(v) { reviewsData = v; }, render: renderReviews, storageKey: 'dart_reviews' },
    'card': { get data() { return cardsData; }, set data(v) { cardsData = v; }, render: renderCards, storageKey: 'dart_cards' },
    'representative': { get data() { return cardsData; }, set data(v) { cardsData = v; }, render: renderCards, storageKey: 'dart_cards' },
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
    else if (sectionKey === 'representative') {
        const modal = document.getElementById('representative-modal');
        if (!modal) return;
        document.getElementById('modal-representative-id').value = item.id;
        document.getElementById('modal-representative-name').value = item.clientName || '';
        document.getElementById('modal-rep-phone1').value = item.phone1 || '';
        document.getElementById('modal-representative-address').value = item.address || '';
        document.getElementById('modal-rep-phone2').value = item.phone2 || '';
        document.getElementById('modal-representative-national-id').value = item.nationalId || '';
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
// 11. تفويض الأحداث والتحكم الجماعي والبحث (Event Delegation & Global Handlers)
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
            'representative': 'representative-modal',
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
// 12. الناف  (DOM Content Loaded)
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    // 1. تحميل البيانات المخزنة سابقاً
    loadAllDataFromStorage();

    // 2. إعداد التنقل (يحدد جميع الروابط في النافين التي تحتوي على data-target)
    const menuLinks = document.querySelectorAll('[data-target]');
    const sections = document.querySelectorAll('.dashboard-section');

    const savedSectionId = localStorage.getItem('dart_active_section') || 'brand'; 

    // دالة موحدة لتنفيذ التفعيل وتحديث النافين معاً
    function activateSection(targetId) {
        if (!targetId) return;

        // تحديث كلاس active لجميع الروابط المترابطة في القائمتين
        menuLinks.forEach(link => {
            if (link.getAttribute('data-target') === targetId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // إخفاء وإظهار السكاشن
        sections.forEach(sec => sec.classList.remove('active-section'));
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
            targetSection.classList.add('active-section');
        }

        // حفظ القسم النشط
        localStorage.setItem('dart_active_section', targetId);
    }

    // تفعيل القسم المخزن أو الافتراضي عند التحميل
    activateSection(savedSectionId);

    // إضافة الأحداث لكل الروابط
    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            activateSection(targetId);
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


// ===========================================
// 13. Chart in Brand Information
// ===========================================
function setupHeaderBatchActions() { /* unchanged */ }
function setupSearchFilter() { /* unchanged */ }

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-modal') || (e.target.tagName === 'SPAN' && e.target.closest('.modal')) || e.target.classList.contains('modal')) {
        const modal = e.target.closest('.modal') || e.target;
        modal.style.display = 'none'; modal.classList.remove('active');
    }
});

    const dataRepo = {
    '2026': { 
        revenue: [3000, 4500, 5000, 6200, 7000, 8100, 9000, 10500, 11200, 12500, 14000, 15500], 
    },
    '2025': { 
        revenue: [280, 400, 480, 590, 680, 750, 850, 1080, 1500, 1100, 1300, 1450], 
    },
};

    let currentMode = 'months';
    let currentYear = 2026;

    var options = {
        series: [{ name: 'Profit', data: [] }],
        chart: { 
            type: 'area', 
            height: 230,
            width: '100%',
            toolbar: { show: false },
            sparkline: { enabled: false }
        },
        colors: ['#43BFE5'],
        stroke: {
            curve: 'smooth',
            width: 2
        },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.4,
                opacityTo: 0.05
            }
        },
        dataLabels: { enabled: false },
        xaxis: { 
            categories: [],
            labels: { 
                style: { colors: '#e2e8f0', fontSize: '11px' } 
            },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: { 
                style: { colors: '#e2e8f0', fontSize: '11px' },
                formatter: (val) => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val
            }
        },
        grid: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            strokeDashArray: 4
        },
        tooltip: { 
            theme: 'dark' 
        }
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
        const yearData = dataRepo[currentYear] || { revenue: [0,0,0]};
        
        chart.updateOptions({
            series: [{ name: 'Profit', data: yearData.revenue }],
            xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] }        });
    }

    // تشغيل مبدئي
    updateChart();

    // البحث التلقائي وتعبئة بيانات العميل عبر برقم الهاتف
function autofillCustomerByPhone(phoneInput, fieldsMap) {
    if (!phoneInput) return;

    phoneInput.addEventListener('input', (e) => {
        const phoneVal = e.target.value.trim();
        if (phoneVal.length < 10) return;

        const customer = customersData.find(c => c.phone1 === phoneVal || c.phone2 === phoneVal);
        if (customer) {
            if (fieldsMap.name && document.getElementById(fieldsMap.name)) 
                document.getElementById(fieldsMap.name).value = customer.clientName || '';
            if (fieldsMap.clientId && document.getElementById(fieldsMap.clientId)) 
                document.getElementById(fieldsMap.clientId).value = customer.clientId || '';
            if (fieldsMap.phone2 && document.getElementById(fieldsMap.phone2)) 
                document.getElementById(fieldsMap.phone2).value = customer.phone2 || '';
            if (fieldsMap.email && document.getElementById(fieldsMap.email)) 
                document.getElementById(fieldsMap.email).value = customer.email || '';
            if (fieldsMap.governorate && document.getElementById(fieldsMap.governorate)) 
                document.getElementById(fieldsMap.governorate).value = customer.governorate || '';
            if (fieldsMap.country && document.getElementById(fieldsMap.country)) 
                document.getElementById(fieldsMap.country).value = customer.country || '';
        }
    });
}

// تفعيل البحث التلقائي في جميع النوافذ المنبثقة (Modals)
function initGlobalCustomerAutofill() {
    // 1. نافذة الطلبات Order Modal
    autofillCustomerByPhone(document.getElementById('phone1'), {
        name: 'clientName',
        clientId: 'clientId',
        phone2: 'phone2',
        email: 'email',
        governorate: 'governorate'
    });

    // 2. نافذة المرتجعات Returns Modal
    autofillCustomerByPhone(document.getElementById('modal-return-phone1'), {
        name: 'modal-return-name',
        phone2: 'modal-return-phone2',
        email: 'modal-return-email'
    });

    // 3. نافذة التقييمات Reviews Modal
    autofillCustomerByPhone(document.getElementById('modal-cust-rev-phone1'), {
        name: 'modal-cust-rev-name',
        phone2: 'modal-cust-rev-phone2',
        email: 'modal-cust-rev-email'
    });
}

// تشغيل التعبئة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    initGlobalCustomerAutofill();
});


function populateModelsDatalist() {
    const datalist = document.getElementById('models-list');
    if (!datalist) return;
    
    datalist.innerHTML = modelsData
        .filter(m => !m.isDeleted)
        .map(m => `<option value="${m.modelId}">${m.name} - ${m.category}</option>`)
        .join('');
}

const ctxTow = document.getElementById('analyticsChartTow').getContext('2d');

const gradVisitorsTow = ctxTow.createLinearGradient(0, 0, 0, 300);
gradVisitorsTow.addColorStop(0, 'rgba(171, 1, 43, 0.25)');
gradVisitorsTow.addColorStop(1, 'rgba(171, 1, 43, 0.0)');

const dataStoreTow = {
    daily: {
        labels: ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'],
        visitors: [120, 190, 300, 250, 200, 450, 380],
        sales: [15, 22, 45, 30, 28, 65, 50],
        note: 'أعلى نسبة مبيعات تحققت يوم الخميس بالتزامن مع زيادة الزوار بنسبة 25%.'
    },
    weekly: {
        labels: ['الأسبوع 1', 'الأسبوع 2', 'الأسبوع 3', 'الأسبوع 4'],
        visitors: [1200, 1800, 2400, 3100],
        sales: [140, 210, 310, 420],
        note: 'نمو متواصل في معدل تحويل الزوار إلى مبيعات للأسبوع الرابع على التوالي.'
    },
    monthly: {
        labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
        visitors: [5000, 7200, 8900, 11000, 9500, 13000],
        sales: [600, 850, 1100, 1400, 1150, 1700],
        note: 'شهر يونيو حقق أعلى معدل مبيعات وزيارات منذ بداية العام.'
    }
};

const analyticsChartTow = new Chart(ctxTow, {
    type: 'bar',
    data: {
        labels: dataStoreTow.daily.labels,
        datasets: [
            {
                type: 'line',
                label: 'الزوار',
                data: dataStoreTow.daily.visitors,
                borderColor: '#ab012b',
                backgroundColor: gradVisitorsTow,
                fill: true,
                tension: 0.4,
                yAxisID: 'yVisitorsTow',
                pointRadius: 4
            },
            {
                type: 'bar',
                label: 'المبيعات',
                data: dataStoreTow.daily.sales,
                backgroundColor: '#1abc9c',
                borderRadius: 6,
                yAxisID: 'ySalesTow',
                barPercentage: 0.5
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', align: 'end' },
            tooltip: { cornerRadius: 8, padding: 10 }
        },
        scales: {
            x: { grid: { display: false } },
            yVisitorsTow: {
                type: 'linear',
                position: 'left',
                beginAtZero: true,
                title: { display: true, text: 'الزوار' },
                grid: { color: '#f0f0f0' }
            },
            ySalesTow: {
                type: 'linear',
                position: 'right',
                beginAtZero: true,
                title: { display: true, text: 'المبيعات' },
                grid: { drawOnChartArea: false }
            }
        }
    }
});

function updateChartTow(period, btn) {
    document.querySelectorAll('.filter-btn-tow').forEach(b => b.classList.remove('active-tow'));
    btn.classList.add('active-tow');

    const selectedData = dataStoreTow[period];
    analyticsChartTow.data.labels = selectedData.labels;
    analyticsChartTow.data.datasets[0].data = selectedData.visitors;
    analyticsChartTow.data.datasets[1].data = selectedData.sales;
    analyticsChartTow.update();

    document.getElementById('chartNoteTextTow').innerHTML = `<strong>ملاحظة:</strong> ${selectedData.note}`;
}

function exportChartPNGTow() {
    const imageURI = analyticsChartTow.toBase64Image();
    const link = document.createElement('a');
    link.download = 'dart-analytics-report.png';
    link.href = imageURI;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ============================================================================
// DART OPERATIONS V2 — integrated business layer (additive refactor)
// ============================================================================
let damageData = [];
let notificationData = [];
let auditData = [];
const DART_SCHEMA_VERSION = 2;
const DART_LOW_STOCK_THRESHOLD = 5;
const DART_DEAD_STOCK_DAYS = 60;
const DART_ORDER_FLOW = ['New','Accepted','Preparing','Out With Representative','Representative On The Way','Delivered'];
const DART_FINAL_ORDER_STATES = ['Delivered','Refused','Cancelled'];
let dartPendingOrderAction = null;
const dartFilterState = {};

function dartNowISO(){ return new Date().toISOString(); }
function dartUid(prefix='ID'){ return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
function dartMoney(v){ return `${(Number(v)||0).toFixed(2)} EGP`; }
function dartEsc(v){
    return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function dartDateValue(v){
    if (!v) return null;
    if (/^\d{2}-\d{2}-\d{4}$/.test(v)) { const [d,m,y]=v.split('-'); return new Date(`${y}-${m}-${d}T00:00:00`); }
    const d=new Date(v); return Number.isNaN(d.getTime()) ? null : d;
}
function dartIsArchived(x){ return Boolean(x?.isArchived ?? x?.isDeleted); }
function dartIsActive(x){ return !dartIsArchived(x); }
function dartSetArchived(x,val){ x.isArchived=Boolean(val); x.isDeleted=Boolean(val); x.archivedAt=val?dartNowISO():null; }
function dartStatusClass(s){ return `status-${String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`; }
function dartPaymentIcon(method){
    const m=String(method||'').toLowerCase();
    if(m.includes('cash on')||m==='cash') return 'bx bx-money';
    if(m.includes('insta')) return 'bx bx-transfer';
    if(m.includes('wallet')||m.includes('vodafone')) return 'bx bx-wallet';
    if(m.includes('card')||m.includes('visa')||m.includes('credit')) return 'bx bx-credit-card';
    return 'bx bx-dollar-circle';
}
function dartFindModelByCode(code){ return modelsData.find(m => String(m.modelId)===String(code)); }
function dartFindItemByCode(code){ return itemsData.find(i => String(i.itemCode)===String(code)); }
function dartFindCustomerByCode(code){ return customersData.find(c => String(c.clientId)===String(code)); }
function dartFindRepById(id){ return representativeData.find(r => String(r.id)===String(id) || String(r.repId)===String(id)); }
function dartOrderNet(order){
    if(Array.isArray(order.priceSnapshot) && order.priceSnapshot.length){ return order.priceSnapshot.reduce((a,l)=>a+(Number(l.finalUnitPrice)||0)*(Number(l.qty)||1),0) - (Number(order.orderLevelDiscountAmount)||0); }
    const subtotal=Number(order.totalPrice)||0, pct=Number(order.discount)||0;
    return Math.max(0, subtotal - subtotal*pct/100);
}

function dartSaveAll(){
    saveDataToStorage('dart_models',modelsData); saveDataToStorage('dart_items',itemsData);
    saveDataToStorage('dart_customers',customersData); saveDataToStorage('dart_orders',ordersData);
    saveDataToStorage('dart_returns',returnsData); saveDataToStorage('dart_reviews',reviewsData);
    saveDataToStorage('dart_cards',cardsData); saveDataToStorage('dart_representatives',representativeData);
    saveDataToStorage('dart_damage',damageData); saveDataToStorage('dart_notifications',notificationData);
    saveDataToStorage('dart_audit',auditData); localStorage.setItem('dart_schema_version',String(DART_SCHEMA_VERSION));
}

function loadAllDataFromStorage(){
    const load=(k,fallback)=>{ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):fallback; }catch{return fallback;} };
    modelsData=load('dart_models',modelsData); itemsData=load('dart_items',itemsData); customersData=load('dart_customers',customersData);
    ordersData=load('dart_orders',ordersData); returnsData=load('dart_returns',returnsData); reviewsData=load('dart_reviews',reviewsData);
    cardsData=load('dart_cards',cardsData); representativeData=load('dart_representatives',representativeData);
    damageData=load('dart_damage',[]); notificationData=load('dart_notifications',[]); auditData=load('dart_audit',[]);
    [modelsData,itemsData,customersData,ordersData,returnsData,reviewsData,cardsData,representativeData,damageData].forEach(arr=>arr.forEach(x=>{
        if(x.isArchived===undefined) x.isArchived=Boolean(x.isDeleted); x.isDeleted=Boolean(x.isArchived); if(x.isChecked===undefined)x.isChecked=false;
    }));
    ordersData.forEach(o=>{
        const legacy={Pending:'New','Out for Delivery':'Out With Representative'}; o.status=legacy[o.status]||o.status||'New';
        o.activityLog=Array.isArray(o.activityLog)?o.activityLog:[]; o.paymentStatus=o.paymentStatus||'Unpaid'; o.orderSource=o.orderSource||'Manual';
        o.amountPaid=Number(o.amountPaid)||0; o.amountRefunded=Number(o.amountRefunded)||0;
        o.createdAt=o.createdAt||o.orderCreatedAt||dartNowISO();
        if(!Array.isArray(o.priceSnapshot)) o.priceSnapshot=[];
    });
    dartSaveAll();
}

function getRowClass(item){ return dartIsArchived(item)?'model-row row-deleted':'model-row row-normal'; }
function getSortedData(dataArray){ return [...(dataArray||[])].sort((a,b)=>Number(dartIsArchived(a))-Number(dartIsArchived(b))); }

function dartAudit(action,entityType,entityId,oldValues={},newValues={},note=''){
    auditData.unshift({id:dartUid('AUD'),action,entityType,entityId:String(entityId||''),timestamp:dartNowISO(),oldValues,newValues,actorRole:'Admin',actorId:null,note});
    if(auditData.length>1500) auditData.length=1500;
}
function dartNotify(type,title,message,entityType='',entityId='',severity='info'){
    notificationData.unshift({id:dartUid('NOT'),type,title,message,timestamp:dartNowISO(),relatedEntityType:entityType,relatedEntityId:String(entityId||''),read:false,severity});
    if(notificationData.length>500) notificationData.length=500;
    renderNotifications();
}
function dartLogOrder(order,type,previousStatus,newStatus,meta={}){
    order.activityLog=Array.isArray(order.activityLog)?order.activityLog:[];
    order.activityLog.push({id:dartUid('EVT'),type,previousStatus:previousStatus||null,newStatus:newStatus||order.status,timestamp:dartNowISO(),representativeId:meta.representativeId||order.representativeId||null,reason:meta.reason||'',notes:meta.notes||'',actorRole:meta.actorRole||'Admin',actorId:meta.actorId||null});
}

function dartCanHardDelete(sectionKey,id){
    const sid=String(id);
    const rel=[];
    if(sectionKey==='models'){
        const m=modelsData.find(x=>String(x.id)===sid); const code=m?.modelId;
        if(itemsData.some(i=>String(i.modelId)===String(code))) rel.push('Items');
        if(ordersData.some(o=>(o.priceSnapshot||[]).some(l=>String(l.modelCode)===String(code)))) rel.push('Orders');
    } else if(sectionKey==='items'){
        const it=itemsData.find(x=>String(x.id)===sid); const code=it?.itemCode;
        if(ordersData.some(o=>(o.items||[]).includes(code))) rel.push('Orders'); if(returnsData.some(r=>r.itemCode===code)) rel.push('Returns'); if(damageData.some(d=>d.itemCode===code)) rel.push('Damage');
    } else if(sectionKey==='customers'){
        const c=customersData.find(x=>String(x.id)===sid); if(ordersData.some(o=>o.clientId===c?.clientId)) rel.push('Orders');
    } else if(sectionKey==='representative'){
        if(ordersData.some(o=>String(o.representativeId)===sid)) rel.push('Orders');
    } else if(sectionKey==='orders'){
        const o=ordersData.find(x=>String(x.id)===sid); if((o?.items||[]).length) rel.push('Items'); if(returnsData.some(r=>r.orderId===o?.orderId)) rel.push('Returns');
    } else if(sectionKey==='returns'){
        const r=returnsData.find(x=>String(x.id)===sid); if(damageData.some(d=>d.returnId===r?.returnId)) rel.push('Damage');
    } else if(sectionKey==='damage'){
        const d=damageData.find(x=>String(x.id)===sid); if(d?.itemCode) rel.push('Item history');
    }
    return {allowed:rel.length===0,relations:[...new Set(rel)]};
}
function deletePermanently(id,sectionKey){
    const sec=sectionsMap[sectionKey]; if(!sec)return;
    const check=dartCanHardDelete(sectionKey,id);
    if(!check.allowed){ alert(`لا يمكن الحذف النهائي لأن السجل مرتبط بـ: ${check.relations.join(', ')}. استخدم الشطب/Archive بدلاً منه.`); return; }
    if(!confirm('هل أنت متأكد من الحذف النهائي؟ لن يمكنك استرجاع هذا العنصر.')) return;
    const old=sec.data.find(x=>String(x.id)===String(id)); sec.data=sec.data.filter(x=>String(x.id)!==String(id));
    dartAudit('PERMANENT_DELETE',sectionKey,id,old||{},{}); dartSaveAll(); dartRenderSection(sectionKey);
}

function dartModelDerived(model){
    const related=itemsData.filter(i=>String(i.modelId)===String(model.modelId) && dartIsActive(i));
    const available=related.filter(i=>String(i.status).toLowerCase()==='in stock');
    return {count:available.length,colors:[...new Set(related.map(i=>i.color).filter(Boolean))],sizes:[...new Set(related.map(i=>i.size).filter(Boolean))],img:related.find(i=>i.img)?.img||model.img||''};
}
function renderModels(dataArray){
    const c=document.getElementById('models-container'); if(!c)return; c.innerHTML='';
    getSortedData(dataArray).forEach(m=>{ const d=dartModelDerived(m); const out=d.count===0?'Out of stock':(m.status||'Active');
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(m)}" data-id="${dartEsc(m.id)}"><input type="checkbox" class="model-checkbox" ${m.isChecked?'checked':''} ${dartIsArchived(m)?'disabled':''}><div class="w100 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(m)?'استعادة':'شطب'}"><i class="bx ${dartIsArchived(m)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="models"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(d.img||'https://via.placeholder.com/50')}" class="product-img model-img"></div><span class="text-item w150">${dartEsc(m.modelId)}</span><span class="text-item w150">${dartEsc(m.name)}</span><span class="text-item w150">${dartEsc(m.category)}</span><span class="text-item w200">${dartEsc(m.description)}</span><span class="text-item w150">${d.count}</span><span class="text-item w150">${dartMoney(m.cost)}</span><span class="text-item w150">${dartMoney(m.selling)}</span><span class="text-item w150">${Number(m.discount)||0}%</span><span class="text-item w150">${dartMoney(m.discountedPrice ?? m.selling)}</span><span class="text-item w300">${dartEsc(d.colors.join(', ')||'-')}</span><span class="text-item w300">${dartEsc(d.sizes.join(', ')||'-')}</span><span class="text-item w150">• ${dartEsc(out)}</span><span class="text-item w150">${dartEsc(m.date||'-')}</span></div>`);
    });
}
function renderItems(dataArray){
    const c=document.getElementById('items-container'); if(!c)return; c.innerHTML='';
    getSortedData((dataArray||[]).filter(i=>!['Damaged','Destroyed'].includes(i.status))).forEach(i=>{
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(i)}" data-id="${dartEsc(i.id)}"><input type="checkbox" class="model-checkbox" ${i.isChecked?'checked':''} ${dartIsArchived(i)?'disabled':''}><div class="w100 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(i)?'استعادة':'شطب'}"><i class="bx ${dartIsArchived(i)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="items"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(i.img||'https://via.placeholder.com/50')}" class="product-img"></div><span class="text-item w150">${dartEsc(i.modelId)}</span><span class="text-item w150">${dartEsc(i.itemCode)}</span><span class="text-item w150">${dartEsc(i.color)}</span><span class="text-item w150">${dartEsc(i.size)}</span><span class="text-item w150"><span class="status-pill ${dartStatusClass(i.status)}">${dartEsc(i.status)}</span></span><span class="text-item w200">${dartEsc(i.regDate||'-')}</span><span class="text-item w150">${dartEsc(i.orderId||'-')}</span><span class="text-item w200">${dartEsc(i.clientName||'-')}</span><span class="text-item w150">${dartEsc(i.clientId||'-')}</span><span class="text-item w150">${dartEsc(i.phone1||'-')}</span><span class="text-item w300">${dartEsc(i.phone2||'-')}</span><span class="text-item w150">${dartEsc(i.email||'-')}</span><span class="text-item w150">${dartEsc(i.purchaseDate||'-')}</span></div>`);
    });
}
function dartCustomerStats(clientId){
    const os=ordersData.filter(o=>o.clientId===clientId), delivered=os.filter(o=>o.status==='Delivered');
    const purchased=delivered.flatMap(o=>o.items||[]); const returnedCodes=new Set(returnsData.filter(r=>r.clientId===clientId && r.isPostDeliveryReturn).map(r=>r.itemCode));
    const spent=delivered.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0);
    return {orders:os.length,delivered:delivered.length,purchased:purchased.length,activePurchased:purchased.filter(x=>!returnedCodes.has(x)).length,spent,lastPurchase:delivered.map(o=>o.deliveredAt||o.date).filter(Boolean).sort().at(-1)||'-'};
}
function renderCustomers(dataArray){
    const c=document.getElementById('customers-container'); if(!c)return; c.innerHTML='';
    getSortedData(dataArray).forEach(x=>{const st=dartCustomerStats(x.clientId);c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(x)}" data-id="${dartEsc(x.id)}"><input type="checkbox" class="model-checkbox" ${x.isChecked?'checked':''} ${dartIsArchived(x)?'disabled':''}><div class="w100 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(x)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-client-profile="1" title="Client history"><i class="bx bx-history"></i></button><button class="dart-reset-password-btn" title="Reset Password"><i class="bx bx-key"></i></button></div><span class="text-item w150">${dartEsc(x.birthday||'-')}</span><span class="text-item w150">${dartEsc(x.clientName)}</span><span class="text-item w150">${dartEsc(x.clientId)}</span><span class="text-item w150">${dartEsc(x.phone1)}</span><span class="text-item w150">${dartEsc(x.phone2||'-')}</span><span class="text-item w200">${dartEsc(x.email||'-')}</span><span class="text-item w150">${dartEsc(x.country||'Egypt')}</span><span class="text-item w200">${dartEsc(x.governorate||'-')}</span><span class="text-item w150">${ordersData.filter(o=>o.clientId===x.clientId && new Date(o.createdAt||0).getMonth()===new Date().getMonth()).length}</span><span class="text-item w150">${st.orders}</span><span class="text-item w300">${dartMoney(st.spent)}<small class="dart-kpi-inline">${st.purchased} items · last ${dartEsc(st.lastPurchase)}</small></span><span class="text-item w200">${dartEsc(x.dartCard||'no')}</span></div>`)});
}

function dartNextStatus(status){ const i=DART_ORDER_FLOW.indexOf(status); return i>=0&&i<DART_ORDER_FLOW.length-1?DART_ORDER_FLOW[i+1]:null; }
function dartCanTransition(order,target){
    if(!order || dartIsArchived(order)) return false; if(order.status===target)return false;
    if(target==='Cancelled') return !['Delivered','Refused','Cancelled'].includes(order.status);
    if(target==='Refused') return ['Out With Representative','Representative On The Way'].includes(order.status);
    if(target==='Preparing' && order.status==='Out With Representative') return true; // representative cancelled pickup
    if(order.status==='Needs Attention') return false;
    return dartNextStatus(order.status)===target;
}
function dartPriceSnapshotForCodes(codes){ return codes.map(code=>{const it=dartFindItemByCode(code),m=dartFindModelByCode(it?.modelId); const original=Number(m?.selling)||0,disc=Number(m?.discount)||0,final=Number(m?.discountedPrice)||(original-original*disc/100); return {itemCode:code,itemId:it?.id||null,modelCode:it?.modelId||'',color:it?.color||'',size:it?.size||'',originalUnitPrice:original,discountPercent:disc,finalUnitPrice:final,costSnapshot:Number(m?.cost)||0,qty:1};}); }
function dartReserveItems(order,codes){
    const seen=new Set(); for(const code of codes){ const it=dartFindItemByCode(code); if(!it||seen.has(code)||dartIsArchived(it)||String(it.status).toLowerCase()!=='in stock') return {ok:false,message:`Item ${code} is not available.`}; seen.add(code); }
    codes.forEach(code=>{const it=dartFindItemByCode(code); it.status='Processing/Held'; it.orderId=order.orderId; it.clientId=order.clientId; it.clientName=order.clientName; it.phone1=order.phone1; it.phone2=order.phone2; it.email=order.email;}); return {ok:true};
}
function dartReleaseOrderItems(order,toStatus='In stock'){
    (order.items||[]).forEach(code=>{const it=dartFindItemByCode(code); if(it && !['Damaged','Destroyed'].includes(it.status)){it.status=toStatus; if(toStatus==='In stock'){it.orderId='';it.clientId='';it.clientName='';it.purchaseDate='';}}});
}
function dartAssignRepresentative(order,repId){ const rep=dartFindRepById(repId); if(!rep||dartIsArchived(rep)||rep.status!=='Active')return false; order.representativeId=rep.id; order.representativeName=rep.name; return true; }
function dartCreateInspectionReturns(order,reason='Refused delivery'){
    (order.items||[]).forEach(code=>{ const it=dartFindItemByCode(code); if(!it)return; it.status='Return Inspection'; const exists=returnsData.some(r=>r.orderId===order.orderId&&r.itemCode===code&&!r.isPostDeliveryReturn); if(!exists) returnsData.push({id:dartUid('RETDB'),returnId:dartUid('R'),modelId:it.modelId,itemCode:code,status:'Pending Inspection',date:new Date().toLocaleDateString('en-GB'),clientName:order.clientName,clientId:order.clientId,phone1:order.phone1,phone2:order.phone2,email:order.email,reason,orderId:order.orderId,isPostDeliveryReturn:false,isArchived:false,isDeleted:false,isChecked:false}); });
}
function dartApplyTransition(order,target,meta={}){
    if(!dartCanTransition(order,target)) return {ok:false,message:`Invalid transition: ${order.status} → ${target}`};
    const prev=order.status, now=dartNowISO();
    if(target==='Out With Representative' && !meta.representativeId) return {ok:false,needsRep:true};
    if(target==='Out With Representative' && !dartAssignRepresentative(order,meta.representativeId)) return {ok:false,message:'Representative is not available.'};
    if(target==='Preparing' && prev==='Out With Representative'){ order.representativeId=null; order.representativeName=''; }
    order.status=target;
    const stamps={Accepted:'acceptedAt',Preparing:'preparingAt','Out With Representative':'outWithRepresentativeAt','Representative On The Way':'representativeOnWayAt',Delivered:'deliveredAt',Refused:'refusedAt',Cancelled:'cancelledAt','Needs Attention':'needsAttentionAt'};
    if(stamps[target])order[stamps[target]]=now;
    if(target==='Delivered'){
        (order.items||[]).forEach(code=>{const it=dartFindItemByCode(code);if(it){it.status='Sold';it.purchaseDate=new Date().toLocaleDateString('en-GB');}});
        if(order.paymentMethod && String(order.paymentMethod).toLowerCase().includes('cash') && order.paymentStatus==='Unpaid'){order.paymentStatus='Paid';order.amountPaid=dartOrderNet(order);order.paidAt=now;}
        if(order.dartCardId&&!order.dartCardUsageRecorded){const card=cardsData.find(c=>c.cardId===order.dartCardId&&c.status==='Active');if(card){card.purchasedItems=String(Number(card.purchasedItems||0)+Number(order.totalProducts||order.items?.length||0));card.requestedProducts=[...new Set([...(card.requestedProducts||[]),...(order.items||[])])];if(Number(card.purchasedItems)>=Number(card.itemLimit||card.purchasedLimit||10))card.status='Expired';order.dartCardUsageRecorded=true;}}
    }
    if(target==='Refused'){order.refusalReason=meta.reason||'Other';order.refusalNotes=meta.notes||'';dartCreateInspectionReturns(order,order.refusalReason);}
    if(target==='Cancelled'){order.cancelledByRole=meta.actorRole||'Admin';order.cancelledBy=meta.actorId||null;order.cancellationReason=meta.reason||'Cancelled';dartReleaseOrderItems(order,'In stock');}
    dartLogOrder(order,meta.type||'STATUS_CHANGED',prev,target,meta); dartAudit('ORDER_STATUS_CHANGE','orders',order.id,{status:prev},{status:target},meta.reason||'');
    dartNotify(`order_${target.toLowerCase().replaceAll(' ','_')}`,`${order.orderId}: ${target}`,meta.reason||`Order moved from ${prev} to ${target}.`,'orders',order.id,target==='Needs Attention'?'warning':'info');
    dartSaveAll(); dartRefreshAll(); return {ok:true};
}
function dartBatchTransition(orders,target,meta={}){
    const invalid=orders.filter(o=>!dartCanTransition(o,target)); if(invalid.length)return {ok:false,message:`غير مسموح للأوردرات: ${invalid.map(o=>o.orderId).join(', ')}`};
    if(target==='Out With Representative'&&!meta.representativeId)return {ok:false,needsRep:true};
    for(const o of orders){ if(target==='Out With Representative'&&!dartFindRepById(meta.representativeId))return {ok:false,message:'Representative unavailable.'}; }
    orders.forEach(o=>dartApplyTransition(o,target,{...meta,suppressRefresh:true})); dartSaveAll(); dartRefreshAll(); return {ok:true};
}

function renderOrders(dataArray){
    const c=document.getElementById('orders-container'); if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(o=>{const next=dartNextStatus(o.status), net=dartOrderNet(o), rep=o.representativeName||dartFindRepById(o.representativeId)?.name||'-';
        const chips=(o.items||[]).map(x=>`<div class="order-item-chip">${dartEsc(x)}</div>`).join('')||'-';
        const nextBtn=next?`<button class="dart-status-btn" data-order-target="${dartEsc(next)}">${dartEsc(next)}</button>`:'';
        const refuse=['Out With Representative','Representative On The Way'].includes(o.status)?`<button class="dart-refuse-btn" data-order-target="Refused">Refuse</button>`:'';
        const cancel=!DART_FINAL_ORDER_STATES.includes(o.status)?`<button class="dart-cancel-btn" data-order-target="Cancelled">Cancel</button>`:'';
        const pickup=o.status==='Out With Representative'?`<button class="dart-pickup-cancel-btn">Cancel Pickup</button>`:'';
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(o)}" data-id="${dartEsc(o.id)}"><input type="checkbox" class="model-checkbox" ${o.isChecked?'checked':''} ${dartIsArchived(o)?'disabled':''}><div class="w300 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(o)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-order-history="1"><i class="bx bx-history"></i></button><span class="dart-status-actions">${nextBtn}${refuse}${cancel}${pickup}</span></div><span class="text-item w150">${dartEsc(o.orderId)}</span><span class="text-item w150">${dartEsc(o.date||'-')}</span><span class="text-item w150">${dartEsc(o.time||'-')}</span><span class="text-item w200"><span class="status-pill ${dartStatusClass(o.status)}">${dartEsc(o.status)}</span></span><span class="text-item w150">${dartEsc(o.clientId||'-')}</span><span class="text-item w200">${dartEsc(o.clientName)}</span><span class="text-item w150">${dartEsc(o.phone1)}</span><span class="text-item w150">${dartEsc(o.phone2||'-')}</span><span class="text-item w150">${dartEsc(o.email||'-')}</span><span class="text-item w150">${(o.items||[]).length}</span><div class="text-item w500"><div class="order-items-grid">${chips}</div></div><span class="text-item w150">${dartMoney(o.totalPrice)}</span><span class="text-item w150">${Number(o.discount)||0}%</span><span class="text-item w150">${dartEsc(o.reasonDeduction||'-')}</span><span class="text-item w150 order-final-amount">${dartMoney(net)}</span><span class="text-item w150"><span class="payment-cell"><i class="${dartPaymentIcon(o.paymentMethod)}"></i>${dartEsc(o.paymentMethod||'-')}</span></span><span class="text-item w150">${dartEsc(o.paymentStatus||'Unpaid')}</span><span class="text-item w150">${dartEsc(o.orderSource||'Manual')}</span><span class="text-item w150">${dartEsc(rep)}</span><span class="text-item w150">${dartEsc(o.deliveryNotes||'-')}</span><span class="text-item w150">${dartEsc(o.country||'Egypt')}</span><span class="text-item w150">${dartEsc(o.governorate||'-')}</span><span class="text-item w150">${dartEsc(o.area||'-')}</span><span class="text-item w150">${dartEsc(o.street||'-')}</span><span class="text-item w150">${dartEsc(o.building||'-')}</span><span class="text-item w150">${dartEsc(o.floor||'-')}</span></div>`);
    }); updateOrderCards();
}

function renderReturns(dataArray){
    const c=document.getElementById('returns-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(r=>c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked?'checked':''} ${dartIsArchived(r)?'disabled':''}><div class="w150 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${r.status==='Pending Inspection'?'<button class="return-good-btn">Good</button><button class="return-bad-btn">Bad</button>':''}</div><span class="text-item w150">${dartEsc(r.returnId)}</span><span class="text-item w150">${dartEsc(r.modelId||'-')}</span><span class="text-item w150">${dartEsc(r.itemCode)}</span><span class="text-item w150">${dartEsc(r.status)}</span><span class="text-item w150">${dartEsc(r.date||'-')}</span><span class="text-item w200">${dartEsc(r.clientName||'-')}</span><span class="text-item w150">${dartEsc(r.clientId||'-')}</span><span class="text-item w150">${dartEsc(r.phone1||'-')}</span><span class="text-item w150">${dartEsc(r.phone2||'-')}</span><span class="text-item w150">${dartEsc(r.email||'-')}</span><span class="text-item w150">${dartEsc(r.reason||'-')}</span><span class="text-item w150">${dartEsc(r.orderId||'-')}</span></div>`));
}
function dartInspectReturn(r,condition){
    const it=dartFindItemByCode(r.itemCode); if(!it)return; const old=r.status; r.status=condition; r.inspectedAt=dartNowISO();
    if(condition==='Good'){it.status='In stock';it.orderId='';it.clientId='';it.clientName='';}
    else {it.status='Damaged'; if(!damageData.some(d=>d.itemCode===it.itemCode&&d.status==='Damaged')) damageData.push({id:dartUid('DMGDB'),damageId:dartUid('DMG'),itemCode:it.itemCode,modelId:it.modelId,img:it.img||'',color:it.color,size:it.size,status:'Damaged',reason:r.reason||'Return inspection - Bad',notes:'',date:new Date().toLocaleDateString('en-GB'),createdAt:dartNowISO(),orderId:r.orderId||'',clientId:r.clientId||'',clientName:r.clientName||'',returnId:r.returnId||'',isArchived:false,isDeleted:false,isChecked:false}); }
    dartAudit('RETURN_INSPECTION','returns',r.id,{status:old},{status:condition}); dartNotify(condition==='Good'?'return_good':'item_damaged',`${r.itemCode}: ${condition}`,condition==='Good'?'Item returned to stock.':'Item moved to Damage.','returns',r.id,condition==='Good'?'info':'warning'); dartSaveAll(); dartRefreshAll();
}
function renderDamage(dataArray){
    const c=document.getElementById('damage-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(d=>c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(d)}" data-id="${dartEsc(d.id)}"><input type="checkbox" class="model-checkbox" ${d.isChecked?'checked':''} ${dartIsArchived(d)?'disabled':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(d)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${d.status==='Damaged'?'<button class="dart-repair-btn">Repaired</button><button class="dart-destroy-btn">Destroyed</button>':''}</div><span class="text-item w150">${dartEsc(d.damageId)}</span><span class="text-item w150">${dartEsc(d.itemCode)}</span><span class="text-item w150">${dartEsc(d.modelId||'-')}</span><div class="w100"><img src="${dartEsc(d.img||'https://via.placeholder.com/50')}" class="product-img"></div><span class="text-item w150">${dartEsc(d.color||'-')}</span><span class="text-item w150">${dartEsc(d.size||'-')}</span><span class="text-item w150"><span class="status-pill ${dartStatusClass(d.status)}">${dartEsc(d.status)}</span></span><span class="text-item w200">${dartEsc(d.reason||'-')}</span><span class="text-item w150">${dartEsc(d.date||'-')}</span><span class="text-item w150">${dartEsc(d.orderId||'-')}</span><span class="text-item w150">${dartEsc(d.clientName||d.clientId||'-')}</span><span class="text-item w150">${dartEsc(d.returnId||'-')}</span></div>`));
}
function dartSetDamageStatus(d,status){const it=dartFindItemByCode(d.itemCode),old=d.status;d.status=status;d[status==='Repaired'?'repairDate':'destroyedAt']=dartNowISO();if(it)it.status=status==='Repaired'?'In stock':'Destroyed';dartAudit('DAMAGE_STATUS','damage',d.id,{status:old},{status});dartNotify('damage_status',`${d.itemCode}: ${status}`,status==='Repaired'?'Item returned to stock.':'Item permanently removed from usable inventory.','damage',d.id,status==='Destroyed'?'warning':'info');dartSaveAll();dartRefreshAll();}
function renderRepresentative(dataArray){
    const c=document.getElementById('representative-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(r=>{const assigned=ordersData.filter(o=>String(o.representativeId)===String(r.id)&&!DART_FINAL_ORDER_STATES.includes(o.status)).length,total=ordersData.filter(o=>String(o.representativeId)===String(r.id)).length,del=ordersData.filter(o=>String(o.representativeId)===String(r.id)&&o.status==='Delivered').length;c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked?'checked':''} ${dartIsArchived(r)?'disabled':''}><div class="w100 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button></div><span class="text-item w200">${dartEsc(r.name)}</span><span class="text-item w150">${dartEsc(r.repId)}</span><span class="text-item w100">${dartEsc(r.status||'Active')}</span><span class="text-item w150">${dartEsc(r.nationalId||'-')}</span><span class="text-item w150">${assigned}</span><span class="text-item w100">${total}<small class="dart-kpi-inline">${del} delivered</small></span><span class="text-item w150">${dartEsc(r.phone1||'-')}</span><span class="text-item w150">${dartEsc(r.phone2||'-')}</span><span class="text-item w200">${dartEsc(r.address||'-')}</span><span class="text-item w150">${dartEsc(r.date||'-')}</span></div>`)});
}

function dartGetSectionData(key){ return sectionsMap[key]?.data||[]; }
function dartSectionSearchText(x){return Object.entries(x).filter(([k])=>!['activityLog','priceSnapshot'].includes(k)).map(([,v])=>Array.isArray(v)?v.join(' '):String(v??'')).join(' ').toLowerCase();}
function dartApplyFilters(key,data){
    const state=dartFilterState[key]||{}; let out=[...(data||[])];
    if(state.search)out=out.filter(x=>dartSectionSearchText(x).includes(state.search));
    if(state.archive==='active')out=out.filter(dartIsActive); else if(state.archive==='archived')out=out.filter(dartIsArchived);
    const eq=(field,val,derive)=>{if(!val||val==='all')return;out=out.filter(x=>String(derive?derive(x):x[field]||'').toLowerCase()===String(val).toLowerCase());};
    if(key==='models'){eq('category',state.category); if(state.status){out=out.filter(m=>{const d=dartModelDerived(m);return state.status==='out-of-stock'?d.count===0:String(m.status||'Active').toLowerCase()===state.status.toLowerCase();});} if(state.priceRange){out=out.filter(m=>{const p=Number(m.discountedPrice??m.selling)||0;return state.priceRange==='0-500'?p<=500:state.priceRange==='500-1000'?p>500&&p<=1000:p>1000;});}}
    if(key==='items'){ if(state.category)out=out.filter(i=>String(dartFindModelByCode(i.modelId)?.category||'').toLowerCase()===state.category.toLowerCase()); if(state.status)out=out.filter(i=>String(i.status).toLowerCase().includes(state.status.toLowerCase().replace('active','in stock').replace('out-of-stock','sold'))); eq('size',state.size);eq('color',state.color); }
    if(key==='customers'){if(state.dartCard)eq('dartCard',state.dartCard);if(state.monthlyOrders==='up')out.sort((a,b)=>dartCustomerStats(b.clientId).orders-dartCustomerStats(a.clientId).orders);if(state.monthlyOrders==='low')out.sort((a,b)=>dartCustomerStats(a.clientId).orders-dartCustomerStats(b.clientId).orders);if(state.birthday){const now=new Date(),target=new Date(now);if(state.birthday==='tomorrow')target.setDate(now.getDate()+1);if(state.birthday==='yesterday')target.setDate(now.getDate()-1);out=out.filter(c=>{const d=dartDateValue(c.birthday);return d&&d.getDate()===target.getDate()&&d.getMonth()===target.getMonth();});}}
    if(key==='orders'){eq('status',state.status); if(state.totalPrice==='up')out.sort((a,b)=>dartOrderNet(b)-dartOrderNet(a));if(state.totalPrice==='low')out.sort((a,b)=>dartOrderNet(a)-dartOrderNet(b));if(state.date){const now=Date.now();out=out.filter(o=>{const d=new Date(o.createdAt||0);if(Number.isNaN(d.getTime()))return false;const age=now-d.getTime();if(state.date==='an-hour-ago')return age<=3600000;if(state.date==='two-hours-ago')return age<=7200000;if(state.date==='five-hours-ago')return age<=18000000;const today=new Date(),od=d.toDateString();if(state.date==='today')return od===today.toDateString();if(state.date==='yesterday'){const y=new Date(today);y.setDate(today.getDate()-1);return od===y.toDateString();}return true;});}}
    if(key==='returns'){eq('status',state.status); if(state.reason&&state.reason!=='all')out=out.filter(r=>String(r.reason||'').toLowerCase().includes(state.reason.replaceAll('_',' ')));}
    if(key==='review'){eq('status',state.status);if(state.rating==='up')out.sort((a,b)=>(Number(b.rating)||0)-(Number(a.rating)||0));if(state.rating==='low')out.sort((a,b)=>(Number(a.rating)||0)-(Number(b.rating)||0));}
    if(key==='representative'){if(state.status)out=out.filter(r=>String(r.status||'').toLowerCase()===state.status.toLowerCase().replace('active','active').replace('hidden','not available'));}
    if(key==='card'){eq('status',state.status);}
    if(key==='damage'){eq('status',state.status);}
    return out;
}
function dartRenderSection(key){const sec=sectionsMap[key];if(!sec)return; const filtered=dartApplyFilters(key,sec.data); sec.render(filtered); dartUpdateMasterCheckbox(key,filtered);}
function dartRefreshAll(){Object.keys(sectionsMap).forEach(k=>dartRenderSection(k));renderNotifications();updateBrandAnalytics();updateOrderCards();}
function renderAllSections(){dartRefreshAll();}

// Extend the existing sectionsMap rather than replacing it.
sectionsMap.representative={get data(){return representativeData;},set data(v){representativeData=v;},render:renderRepresentative,storageKey:'dart_representatives'};
sectionsMap.damage={get data(){return damageData;},set data(v){damageData=v;},render:renderDamage,storageKey:'dart_damage'};

function saveSectionState(sectionKey){const sec=sectionsMap[sectionKey];if(!sec)return;saveDataToStorage(sec.storageKey,sec.data);dartSaveAll();}
function dartArchiveRecord(key,id){const sec=sectionsMap[key],x=sec?.data.find(v=>String(v.id)===String(id));if(!x)return;const old=dartIsArchived(x),snapshot={...x};dartSetArchived(x,!old);x.isChecked=false;if(key==='items'&&!old&&x.status==='Processing/Held'&&x.orderId)dartRevalidateAllocatedItem(x,snapshot);dartAudit(old?'RESTORE':'ARCHIVE',key,id,{isArchived:old},{isArchived:!old});dartSaveAll();dartRefreshAll();}
function dartVisibleRows(key){const sec=document.getElementById(key);return [...(sec?.querySelectorAll('.model-row')||[])].filter(r=>r.offsetParent!==null&&!r.classList.contains('row-deleted'));}
function dartUpdateMasterCheckbox(key,viewData){const sec=document.getElementById(key),master=sec?.querySelector('.cont-titel .title-name input[type="checkbox"]');if(!master)return;const visible=(viewData||dartApplyFilters(key,dartGetSectionData(key))).filter(dartIsActive),selected=visible.filter(x=>x.isChecked);master.checked=visible.length>0&&selected.length===visible.length;master.indeterminate=selected.length>0&&selected.length<visible.length;if(key==='orders'){const n=document.getElementById('bulk-selected-count');if(n)n.textContent=`${selected.length} selected`;}}
function setupHeaderBatchActions(){
    if(document.documentElement.dataset.dartBatchReady)return;document.documentElement.dataset.dartBatchReady='1';
    document.addEventListener('change',e=>{if(!e.target.matches('.cont-titel .title-name input[type="checkbox"]'))return;const sec=e.target.closest('.dashboard-section'),key=sec?.id,info=sectionsMap[key];if(!info)return;const visible=dartApplyFilters(key,info.data).filter(dartIsActive);visible.forEach(x=>x.isChecked=e.target.checked);dartSaveAll();dartRenderSection(key);});
    document.addEventListener('click',e=>{const btn=e.target.closest('.dashboard-section .second .delete-btn');if(!btn)return;const key=btn.closest('.dashboard-section')?.id,info=sectionsMap[key];if(!info)return;const visibleIds=new Set(dartApplyFilters(key,info.data).filter(dartIsActive).map(x=>String(x.id)));let n=0;info.data.forEach(x=>{if(x.isChecked&&visibleIds.has(String(x.id))){dartSetArchived(x,true);x.isChecked=false;dartAudit('BULK_ARCHIVE',key,x.id,{isArchived:false},{isArchived:true});n++;}});if(n){dartSaveAll();dartRenderSection(key);}});
}
function setupSearchFilter(){
    document.querySelectorAll('.dashboard-section').forEach(sec=>{const key=sec.id;if(!sectionsMap[key])return;dartFilterState[key]=dartFilterState[key]||{archive:'active'};const search=sec.querySelector('.search-box input,.search-bar input');if(search&&!search.dataset.dartBound){search.dataset.dartBound='1';search.addEventListener('input',()=>{dartFilterState[key].search=search.value.toLowerCase().trim();dartRenderSection(key);});}
        const selects=[...sec.querySelectorAll('.filter-bar select')];const maps={models:['category','status','priceRange'],items:['category','status','size','color'],customers:['monthlyOrders','dartCard','birthday'],orders:['date','status','totalPrice'],returns:['reason','status'],review:['rating','status'],representative:['status'],card:['status'],damage:['status','archive']};
        (maps[key]||[]).forEach((f,i)=>{if(selects[i]&&!selects[i].dataset.filterKey)selects[i].dataset.filterKey=f;});
        if(!selects.some(s=>s.dataset.filterKey==='archive') && !['brand'].includes(key)){const wrap=document.createElement('div');wrap.className='select-box';wrap.innerHTML='<select data-filter-key="archive"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select><i class="bx bx-chevron-down arrow-icon"></i>';sec.querySelector('.filter-bar')?.insertBefore(wrap,sec.querySelector('.filter-bar .add-btn'));}
        sec.querySelectorAll('.filter-bar select').forEach(sel=>{if(sel.dataset.dartBound)return;sel.dataset.dartBound='1';sel.addEventListener('change',()=>{const f=sel.dataset.filterKey;if(f)dartFilterState[key][f]=sel.value;dartRenderSection(key);});});
    });
}

function dartSectionKeyFromContainer(container){return container.closest('.dashboard-section')?.id;}
function setupSectionEvents(containerId,dataArray,renderFn,sectionKey){
    const container=document.getElementById(containerId);if(!container||container.dataset.dartDelegated)return;container.dataset.dartDelegated='1';
    container.addEventListener('change',e=>{if(!e.target.classList.contains('model-checkbox'))return;const id=e.target.closest('.model-row')?.dataset.id,x=sectionsMap[sectionKey]?.data.find(v=>String(v.id)===String(id));if(x){x.isChecked=e.target.checked;dartSaveAll();dartUpdateMasterCheckbox(sectionKey);}});
    container.addEventListener('click',e=>{const row=e.target.closest('.model-row');if(!row)return;const id=row.dataset.id;
        if(e.target.closest('.btn-delete')){dartArchiveRecord(sectionKey,id);return;} if(e.target.closest('.btn-hard-delete')){deletePermanently(id,sectionKey);return;} if(e.target.closest('.btn-edit')){openEditModal(id,sectionKey);return;}
        if(sectionKey==='orders'){const o=ordersData.find(x=>String(x.id)===String(id));if(!o)return;const target=e.target.closest('[data-order-target]')?.dataset.orderTarget;if(target){dartRequestOrderTransition([o],target);return;}if(e.target.closest('.dart-pickup-cancel-btn')){dartApplyTransition(o,'Preparing',{type:'REPRESENTATIVE_CANCELLED_PICKUP',actorRole:'Representative',reason:'Representative cancelled pickup'});return;}if(e.target.closest('[data-order-history]')){dartShowOrderHistory(o);return;}}
        if(sectionKey==='returns'){const r=returnsData.find(x=>String(x.id)===String(id));if(e.target.closest('.return-good-btn'))dartInspectReturn(r,'Good');if(e.target.closest('.return-bad-btn'))dartInspectReturn(r,'Bad');}
        if(sectionKey==='damage'){const d=damageData.find(x=>String(x.id)===String(id));if(e.target.closest('.dart-repair-btn'))dartSetDamageStatus(d,'Repaired');if(e.target.closest('.dart-destroy-btn')&&confirm('Mark this physical item as permanently Destroyed?'))dartSetDamageStatus(d,'Destroyed');}
        if(sectionKey==='customers'){const x=customersData.find(v=>String(v.id)===String(id));if(e.target.closest('[data-client-profile]'))dartShowClientProfile(x);if(e.target.closest('.dart-reset-password-btn')){dartAudit('PASSWORD_RESET_REQUESTED','customers',x.id,{},{});dartNotify('password_reset','Password reset requested',`${x.clientName}: password reset must be completed by the secure backend/customer flow.`,'customers',x.id);alert('تم تسجيل طلب Reset Password. في النسخة الحالية لا يتم حفظ أو عرض كلمة مرور حقيقية.');}}
        if(e.target.closest('[data-history-entity]'))dartShowAuditFor(sectionKey,id);
    });
}
function setupAllDelegatedEvents(){
    const map={models:'models-container',items:'items-container',customers:'customers-container',orders:'orders-container',returns:'returns-container',review:'review-container',representative:'representative-container',card:'card-container',damage:'damage-container'};Object.entries(map).forEach(([k,id])=>setupSectionEvents(id,sectionsMap[k]?.data,sectionsMap[k]?.render,k));
}

function dartActiveReps(){return representativeData.filter(r=>dartIsActive(r)&&r.status==='Active');}
function dartRequestOrderTransition(orders,target){
    if(!orders.length)return;const invalid=orders.filter(o=>!dartCanTransition(o,target));if(invalid.length){alert(`الانتقال غير منطقي للأوردرات: ${invalid.map(o=>o.orderId).join(', ')}`);return;}
    if(target==='Out With Representative'){dartPendingOrderAction={orders,target};const sel=document.getElementById('rep-assignment-select');sel.innerHTML=dartActiveReps().map(r=>`<option value="${dartEsc(r.id)}">${dartEsc(r.name)} — ${dartEsc(r.repId)}</option>`).join('');if(!sel.options.length){alert('لا يوجد مندوب Active وغير مشطوب.');return;}openModal(document.getElementById('rep-assignment-modal'));return;}
    if(target==='Refused'||target==='Cancelled'){dartPendingOrderAction={orders,target};const title=document.getElementById('order-reason-title'),sel=document.getElementById('order-reason-select');title.textContent=target==='Refused'?'Refusal Reason':'Cancellation Reason';const reasons=target==='Refused'?['Customer changed mind','Price','Size','Color','Product different from expectation','Customer unavailable / did not answer','Product issue','Delivery issue','Other']:['Customer request','Admin decision','Inventory issue','Duplicate order','Address/Delivery issue','Other'];sel.innerHTML=reasons.map(r=>`<option value="${dartEsc(r)}">${dartEsc(r)}</option>`).join('');document.getElementById('order-reason-notes').value='';openModal(document.getElementById('order-reason-modal'));return;}
    if(orders.length===1)dartApplyTransition(orders[0],target);else dartBatchTransition(orders,target);
}
function dartSetupOperationalModals(){
    document.getElementById('confirm-rep-assignment')?.addEventListener('click',()=>{if(!dartPendingOrderAction)return;const rep=document.getElementById('rep-assignment-select').value;const {orders,target}=dartPendingOrderAction;const res=orders.length===1?dartApplyTransition(orders[0],target,{representativeId:rep}):dartBatchTransition(orders,target,{representativeId:rep});if(!res.ok)alert(res.message||'Operation failed');dartPendingOrderAction=null;closeModal(document.getElementById('rep-assignment-modal'));});
    document.getElementById('confirm-order-reason')?.addEventListener('click',()=>{if(!dartPendingOrderAction)return;const reason=document.getElementById('order-reason-select').value,notes=document.getElementById('order-reason-notes').value;const {orders,target}=dartPendingOrderAction,meta={reason,notes,actorRole:'Admin'};const res=orders.length===1?dartApplyTransition(orders[0],target,meta):dartBatchTransition(orders,target,meta);if(!res.ok)alert(res.message||'Operation failed');dartPendingOrderAction=null;closeModal(document.getElementById('order-reason-modal'));});
    document.getElementById('order-bulk-actions')?.addEventListener('click',e=>{const target=e.target.closest('[data-bulk-order-status]')?.dataset.bulkOrderStatus;if(!target)return;const visibleIds=new Set(dartApplyFilters('orders',ordersData).map(x=>String(x.id)));const selected=ordersData.filter(o=>o.isChecked&&visibleIds.has(String(o.id)));if(!selected.length){alert('حدد أوردر واحد على الأقل من الصفوف الظاهرة.');return;}dartRequestOrderTransition(selected,target);});
}

function dartAutoAllocate(modelCode,color,size,qty,exclude=[]){
    const model=dartFindModelByCode(modelCode);if(!model||dartIsArchived(model))return {ok:false,message:'Model غير موجود أو مشطوب.'};const excluded=new Set(exclude);const candidates=itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock'&&String(i.modelId)===String(modelCode)&&String(i.color).toLowerCase()===String(color).toLowerCase()&&String(i.size).toLowerCase()===String(size).toLowerCase()&&!excluded.has(i.itemCode));if(candidates.length<qty)return {ok:false,message:`المتاح ${candidates.length} فقط من ${modelCode} / ${color} / ${size}.`};return {ok:true,codes:candidates.slice(0,qty).map(i=>i.itemCode)};
}
function setupOrderModal(){
    const modal=document.getElementById('orderModal'),form=document.getElementById('orderForm');if(!form||form.dataset.dartV2)return;form.dataset.dartV2='1';let selected=[];
    const list=document.getElementById('selectedProductsList'),codeInput=document.getElementById('productsInputCode');
    function renderSel(){if(list)list.innerHTML=selected.map((code,i)=>`<span class="order-item-chip"><b>${dartEsc(code)}</b><button type="button" class="remove-item-btn" data-index="${i}">&times;</button></span>`).join('');calc();}
    function calc(){const snap=dartPriceSnapshotForCodes(selected),subtotal=snap.reduce((a,l)=>a+l.finalUnitPrice,0),pct=Number(document.getElementById('deductions')?.value)||0,total=Math.max(0,subtotal-subtotal*pct/100);document.getElementById('subtotalVal').textContent=dartMoney(subtotal);document.getElementById('discountVal').textContent=dartMoney(subtotal-total);document.getElementById('totalVal').textContent=dartMoney(total);return{subtotal,pct,total,snap};}
    function populate(){const dl=document.getElementById('items-datalist');if(dl)dl.innerHTML=itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').map(i=>`<option value="${dartEsc(i.itemCode)}">${dartEsc(i.modelId)} - ${dartEsc(i.color)} (${dartEsc(i.size)})</option>`).join('');populateModelsDatalist();}
    document.getElementById('openModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-order-edit-id').value='';selected=[];populate();renderSel();openModal(modal);});
    document.getElementById('addProductBtn')?.addEventListener('click',()=>{const code=codeInput.value.trim(),it=dartFindItemByCode(code);if(!it||dartIsArchived(it)||String(it.status).toLowerCase()!=='in stock'){alert('القطعة غير متاحة.');return;}if(!selected.includes(code))selected.push(code);codeInput.value='';renderSel();});
    document.getElementById('autoAllocateProductBtn')?.addEventListener('click',()=>{const model=document.getElementById('orderModelCode').value.trim(),color=document.getElementById('orderItemColor').value.trim(),size=document.getElementById('orderItemSize').value.trim(),qty=Math.max(1,Number(document.getElementById('orderItemQty').value)||1),r=dartAutoAllocate(model,color,size,qty,selected);if(!r.ok){alert(r.message);return;}selected.push(...r.codes);renderSel();});
    list?.addEventListener('click',e=>{if(!e.target.classList.contains('remove-item-btn'))return;selected.splice(Number(e.target.dataset.index),1);renderSel();});document.getElementById('deductions')?.addEventListener('input',calc);
    window.loadOrderItemsForEdit=(codes)=>{selected=[...(codes||[])];populate();renderSel();};
    form.addEventListener('submit',e=>{e.preventDefault();if(!selected.length){alert('أضف قطعة واحدة على الأقل.');return;}const editId=document.getElementById('modal-order-edit-id').value,existing=ordersData.find(o=>String(o.id)===String(editId)),prices=calc();
        const selectedClientId=document.getElementById('clientId').value||'-',selectedClient=dartFindCustomerByCode(selectedClientId);if(selectedClient&&dartIsArchived(selectedClient)){alert('لا يمكن إنشاء/تعديل طلب باستخدام عميل مشطوب.');return;}const payload={clientId:selectedClientId,clientName:document.getElementById('clientName').value,phone1:document.getElementById('phone1').value,phone2:document.getElementById('phone2').value||'-',email:document.getElementById('email').value||'-',paymentMethod:document.getElementById('paymentMethod').value||'Cash on Delivery',paymentStatus:document.getElementById('paymentStatus').value||'Unpaid',amountPaid:Number(document.getElementById('amountPaid').value)||0,amountRefunded:Number(document.getElementById('amountRefunded').value)||0,orderSource:document.getElementById('orderSource').value||'Manual',deliveryNotes:document.getElementById('deliveryNotes').value||'',items:[...selected],totalProducts:selected.length,totalPrice:prices.subtotal,discount:prices.pct,reasonDeduction:prices.pct?'Order discount':'-',country:document.getElementById('orderCountry').value||'Egypt',governorate:document.getElementById('governorate').value||'',area:document.getElementById('orderArea').value||'',street:document.getElementById('orderStreetName').value||'',building:document.getElementById('orderBuildingNumber').value||'',floor:document.getElementById('orderFloor').value||''};
        if(existing){const oldCodes=[...(existing.items||[])],newCodes=selected.filter(c=>!oldCodes.includes(c));const newCheck=dartReserveItems(existing,newCodes);if(!newCheck.ok){alert(newCheck.message);return;}oldCodes.filter(c=>!selected.includes(c)).forEach(c=>{const it=dartFindItemByCode(c);if(it&&it.status==='Processing/Held'){it.status='In stock';it.orderId='';}});const old={...existing};Object.assign(existing,payload);existing.priceSnapshot=dartPriceSnapshotForCodes(selected);dartAudit('EDIT','orders',existing.id,old,payload);dartLogOrder(existing,'ORDER_EDITED',existing.status,existing.status,{notes:'Order details edited'});
        }else{const order={id:dartUid('ODB'),orderId:dartUid('ORD'),date:new Date().toLocaleDateString('en-GB'),time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),status:'New',createdAt:dartNowISO(),orderCreatedAt:dartNowISO(),activityLog:[],isArchived:false,isDeleted:false,isChecked:false,...payload};const r=dartReserveItems(order,selected);if(!r.ok){alert(r.message);return;}order.priceSnapshot=dartPriceSnapshotForCodes(selected);dartLogOrder(order,'ORDER_CREATED',null,'New');ordersData.push(order);dartAudit('CREATE','orders',order.id,{},order);dartNotify('new_order',`New order ${order.orderId}`,`${order.clientName} — ${selected.length} item(s)`,'orders',order.id);}
        dartSaveAll();dartRefreshAll();closeModal(modal);form.reset();selected=[];renderSel();});
}

function setupModelModal(){
    const modal=document.getElementById('model-modal'),form=document.getElementById('model-form');if(!form||form.dataset.dartV2)return;form.dataset.dartV2='1';const cost=document.getElementById('modal-cost'),selling=document.getElementById('modal-selling'),disc=document.getElementById('modal-discount'),final=document.getElementById('modal-final-price');const calc=()=>{const s=Number(selling.value)||0,d=Math.min(100,Math.max(0,Number(disc.value)||0)),v=s-s*d/100;final.textContent=dartMoney(v);return v;};cost?.addEventListener('input',()=>{if(!selling.value&&Number(cost.value)>0)selling.value=(Number(cost.value)*1.4).toFixed(2);calc();});selling?.addEventListener('input',calc);disc?.addEventListener('input',calc);
    document.querySelector('#models .add-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-edit-id').value='';calc();openModal(modal);});
    form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-edit-id').value,payload={modelId:document.getElementById('modal-id').value.trim(),name:document.getElementById('modal-name').value,category:document.getElementById('modal-category').value,description:document.getElementById('modal-description').value,cost:Number(cost.value)||0,selling:Number(selling.value)||0,discount:Number(disc.value)||0,discountedPrice:calc(),status:'Active'};if(id){const m=modelsData.find(x=>String(x.id)===String(id)),old={...m};Object.assign(m,payload);dartAudit('EDIT','models',m.id,old,payload);}else{const m={id:dartUid('MDB'),date:new Date().toLocaleDateString('en-GB'),isArchived:false,isDeleted:false,isChecked:false,...payload};modelsData.push(m);dartAudit('CREATE','models',m.id,{},m);}dartSaveAll();dartRefreshAll();closeModal(modal);});
}

function setupItemModal(){
    const modal=document.getElementById('item-add-modal'),form=document.getElementById('item-add-form');if(!form||form.dataset.dartV2)return;form.dataset.dartV2='1';let image='';const file=document.getElementById('modal-item-file'),preview=document.getElementById('item-preview-img');file?.addEventListener('change',()=>{const f=file.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{image=rd.result;if(preview){preview.src=image;preview.style.display='block';}};rd.readAsDataURL(f);});document.querySelector('#items .add-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-item-add-edit-id').value='';image='';populateModelsDatalist();openModal(modal);});
    form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-item-add-edit-id').value,payload={modelId:document.getElementById('modal-item-model-id').value.trim(),itemCode:document.getElementById('modal-item-code-pic').value.trim(),color:document.getElementById('modal-item-color').value.trim(),size:document.getElementById('modal-item-size').value.trim()};const model=dartFindModelByCode(payload.modelId);if(!model||dartIsArchived(model)){alert('Model غير موجود أو مشطوب.');return;}if(itemsData.some(i=>i.itemCode===payload.itemCode&&String(i.id)!==String(id))){alert('Item Code يجب أن يكون فريدًا.');return;}if(id){const it=itemsData.find(x=>String(x.id)===String(id)),old={...it},affects=it.modelId!==payload.modelId||it.color!==payload.color||it.size!==payload.size;Object.assign(it,payload);if(image)it.img=image;dartAudit('EDIT','items',it.id,old,payload);if(affects&&it.orderId&&it.status==='Processing/Held')dartRevalidateAllocatedItem(it,old);}else{const it={id:dartUid('IDB'),status:'In stock',regDate:new Date().toLocaleDateString('en-GB'),img:image,isArchived:false,isDeleted:false,isChecked:false,...payload};itemsData.push(it);dartAudit('CREATE','items',it.id,{},it);}dartSaveAll();dartRefreshAll();closeModal(modal);});
}
function dartRevalidateAllocatedItem(item,old){const order=ordersData.find(o=>o.orderId===item.orderId&&!DART_FINAL_ORDER_STATES.includes(o.status));if(!order)return;const expected=(order.priceSnapshot||[]).find(l=>l.itemCode===old.itemCode)||{modelCode:old.modelId,color:old.color,size:old.size};const matches=item.modelId===expected.modelCode&&String(item.color).toLowerCase()===String(expected.color).toLowerCase()&&String(item.size).toLowerCase()===String(expected.size).toLowerCase();if(matches)return;const r=dartAutoAllocate(expected.modelCode,expected.color,expected.size,1,[item.itemCode]);if(r.ok){const replacement=dartFindItemByCode(r.codes[0]),idx=order.items.indexOf(item.itemCode);replacement.status='Processing/Held';replacement.orderId=order.orderId;replacement.clientId=order.clientId;replacement.clientName=order.clientName;if(idx>=0)order.items[idx]=replacement.itemCode;item.status='In stock';item.orderId='';order.priceSnapshot=dartPriceSnapshotForCodes(order.items);dartLogOrder(order,'ITEM_REALLOCATED',order.status,order.status,{notes:`${old.itemCode} → ${replacement.itemCode}`});dartNotify('item_allocation_changed',`${order.orderId}: item allocation changed`,`${old.itemCode} → ${replacement.itemCode}`,'orders',order.id);}else{const prev=order.status;order.previousOperationalStatus=prev;order.status='Needs Attention';order.needsAttentionAt=dartNowISO();order.needsAttentionReason=`No ${expected.modelCode} / ${expected.color} / ${expected.size} available after ${item.itemCode} edit.`;dartLogOrder(order,'INVENTORY_CONFLICT',prev,'Needs Attention',{notes:order.needsAttentionReason});dartNotify('needs_attention',`${order.orderId} needs attention`,order.needsAttentionReason,'orders',order.id,'warning');}}

function setupCustomerModal(){
    const modal=document.getElementById('customerModal'),form=document.getElementById('customerForm');if(!form||form.dataset.dartV2)return;form.dataset.dartV2='1';document.getElementById('openCustomerModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-customer-edit-id').value='';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-customer-edit-id').value,p={clientName:document.getElementById('custName').value,birthday:document.getElementById('custBirthday').value||'-',phone1:document.getElementById('custPhone1').value,phone2:document.getElementById('custPhone2').value||'-',email:document.getElementById('custEmail').value||'',country:document.getElementById('custCountry').value||'Egypt',governorate:document.getElementById('custGovernorate').value||''};if(id){const x=customersData.find(c=>String(c.id)===String(id)),old={...x};Object.assign(x,p);dartAudit('EDIT','customers',x.id,old,p);}else{const x={id:dartUid('CDB'),clientId:dartUid('C'),dartCard:'no',isArchived:false,isDeleted:false,isChecked:false,registeredAt:dartNowISO(),...p};customersData.push(x);dartAudit('CREATE','customers',x.id,{},x);}dartSaveAll();dartRefreshAll();closeModal(modal);});
}
function setupRepresentativeModal(){
    const modal=document.getElementById('representative-modal'),form=document.getElementById('rep-form');if(!form||form.dataset.dartV2)return;form.dataset.dartV2='1';document.getElementById('openRepModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-rep-id').value='';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-rep-id').value,p={name:document.getElementById('modal-representative-name').value,repId:document.getElementById('modal-representative-id').value,nationalId:document.getElementById('modal-representative-national-id').value,address:document.getElementById('modal-representative-address').value,phone1:document.getElementById('modal-rep-phone1').value,phone2:document.getElementById('modal-rep-phone2').value||'-',status:'Active'};if(id){const x=representativeData.find(r=>String(r.id)===String(id)),old={...x};Object.assign(x,p);dartAudit('EDIT','representative',x.id,old,p);}else{const x={id:dartUid('RDB'),date:new Date().toLocaleDateString('en-GB'),isArchived:false,isDeleted:false,isChecked:false,...p};representativeData.push(x);dartAudit('CREATE','representative',x.id,{},x);}dartSaveAll();dartRefreshAll();closeModal(modal);});
}
function setupReturnModal(){
    const modal=document.getElementById('return-modal'),form=document.getElementById('return-form');
    if(!form||form.dataset.dartV2)return; form.dataset.dartV2='1';
    document.getElementById('add-return-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-return-edit-id').value='';openModal(modal);});
    form.addEventListener('submit',e=>{e.preventDefault();
        const id=document.getElementById('modal-return-edit-id').value;
        const code=document.getElementById('modal-return-item-code').value.trim(),it=dartFindItemByCode(code);
        if(!it){alert('Item Code غير موجود.');return;}
        const order=ordersData.find(o=>(o.items||[]).includes(code) && o.status==='Delivered');
        const p={clientName:document.getElementById('modal-return-name').value||order?.clientName||'',clientId:order?.clientId||'',itemCode:code,modelId:document.getElementById('modal-return-model-id').value||it.modelId,phone1:document.getElementById('modal-return-phone1').value||order?.phone1||'',phone2:document.getElementById('modal-return-phone2').value||order?.phone2||'-',email:document.getElementById('modal-return-email').value||order?.email||'',reason:document.getElementById('modal-item-reason').value||'Other',status:'Pending Inspection',date:new Date().toLocaleDateString('en-GB'),orderId:order?.orderId||'',isPostDeliveryReturn:Boolean(order),refundAmount:Number(document.getElementById('modal-return-refund')?.value)||0};
        if(id){const r=returnsData.find(x=>String(x.id)===String(id)),old={...r};Object.assign(r,p);dartAudit('EDIT','returns',r.id,old,p);}else{const r={id:dartUid('RETDB'),returnId:dartUid('R'),isArchived:false,isDeleted:false,isChecked:false,...p};returnsData.push(r);it.status='Return Inspection';if(order&&r.refundAmount>0){order.amountRefunded=(Number(order.amountRefunded)||0)+r.refundAmount;order.refundedAt=dartNowISO();const net=dartOrderNet(order);order.paymentStatus=order.amountRefunded>=net?'Refunded':'Partially Refunded';dartLogOrder(order,'REFUND_RECORDED',order.status,order.status,{notes:`Refund ${r.refundAmount} EGP for ${code}`});}dartAudit('CREATE','returns',r.id,{},r);dartNotify('return_created',`Return ${r.returnId}`,`${code} entered return inspection.`,'returns',r.id);}
        dartSaveAll();dartRefreshAll();closeModal(modal);
    });
}

function dartSetupDamageModal(){const modal=document.getElementById('damage-modal'),form=document.getElementById('damage-form');document.getElementById('add-damage-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('damage-edit-id').value='';openModal(modal);});form?.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('damage-edit-id').value,code=document.getElementById('damage-item-code').value.trim(),it=dartFindItemByCode(code);if(!it){alert('Item Code غير موجود.');return;}const p={itemCode:code,modelId:it.modelId,img:it.img||'',color:it.color,size:it.size,reason:document.getElementById('damage-reason').value,notes:document.getElementById('damage-notes').value,status:document.getElementById('damage-status').value,date:new Date().toLocaleDateString('en-GB')};if(id){const d=damageData.find(x=>String(x.id)===String(id)),old={...d};Object.assign(d,p);dartAudit('EDIT','damage',d.id,old,p);dartSetDamageStatus(d,p.status);}else{const d={id:dartUid('DMGDB'),damageId:dartUid('DMG'),createdAt:dartNowISO(),isArchived:false,isDeleted:false,isChecked:false,...p};damageData.push(d);it.status=p.status==='Repaired'?'In stock':p.status;dartAudit('CREATE','damage',d.id,{},d);dartNotify('item_damaged',`${code}: ${p.status}`,p.reason,'damage',d.id,'warning');dartSaveAll();dartRefreshAll();}closeModal(modal);});}

function openEditModal(id,sectionKey){const info=sectionsMap[sectionKey],x=info?.data.find(v=>String(v.id)===String(id));if(!x)return;
    if(sectionKey==='models'){document.getElementById('modal-edit-id').value=x.id;document.getElementById('modal-id').value=x.modelId||'';document.getElementById('modal-name').value=x.name||'';document.getElementById('modal-category').value=x.category||'';document.getElementById('modal-description').value=x.description||'';document.getElementById('modal-cost').value=x.cost||0;document.getElementById('modal-selling').value=x.selling||0;document.getElementById('modal-discount').value=x.discount||0;document.getElementById('modal-final-price').textContent=dartMoney(x.discountedPrice??x.selling);openModal(document.getElementById('model-modal'));}
    else if(sectionKey==='items'){document.getElementById('modal-item-add-edit-id').value=x.id;document.getElementById('modal-item-model-id').value=x.modelId||'';document.getElementById('modal-item-code-pic').value=x.itemCode||'';document.getElementById('modal-item-color').value=x.color||'';document.getElementById('modal-item-size').value=x.size||'';openModal(document.getElementById('item-add-modal'));}
    else if(sectionKey==='customers'){document.getElementById('modal-customer-edit-id').value=x.id;document.getElementById('custName').value=x.clientName||'';document.getElementById('custBirthday').value=x.birthday||'';document.getElementById('custPhone1').value=x.phone1||'';document.getElementById('custPhone2').value=x.phone2||'';document.getElementById('custEmail').value=x.email||'';document.getElementById('custCountry').value=x.country||'Egypt';document.getElementById('custGovernorate').value=x.governorate||'Cairo';openModal(document.getElementById('customerModal'));}
    else if(sectionKey==='orders'){document.getElementById('modal-order-edit-id').value=x.id;document.getElementById('clientName').value=x.clientName||'';document.getElementById('clientId').value=x.clientId||'';document.getElementById('phone1').value=x.phone1||'';document.getElementById('phone2').value=x.phone2||'';document.getElementById('email').value=x.email||'';document.getElementById('paymentMethod').value=x.paymentMethod||'';document.getElementById('paymentStatus').value=x.paymentStatus||'Unpaid';document.getElementById('amountPaid').value=x.amountPaid||0;document.getElementById('amountRefunded').value=x.amountRefunded||0;document.getElementById('orderSource').value=x.orderSource||'Manual';document.getElementById('deliveryNotes').value=x.deliveryNotes||'';document.getElementById('orderCountry').value=x.country||'';document.getElementById('governorate').value=x.governorate||'';document.getElementById('orderArea').value=x.area||'';document.getElementById('orderStreetName').value=x.street||'';document.getElementById('orderBuildingNumber').value=x.building||'';document.getElementById('orderFloor').value=x.floor||'';document.getElementById('deductions').value=x.discount||0;window.loadOrderItemsForEdit?.(x.items||[]);openModal(document.getElementById('orderModal'));}
    else if(sectionKey==='returns'){document.getElementById('modal-return-edit-id').value=x.id;document.getElementById('modal-return-name').value=x.clientName||'';document.getElementById('modal-return-item-code').value=x.itemCode||'';document.getElementById('modal-return-phone1').value=x.phone1||'';document.getElementById('modal-return-model-id').value=x.modelId||'';document.getElementById('modal-return-phone2').value=x.phone2||'';document.getElementById('modal-return-email').value=x.email||'';document.getElementById('modal-item-reason').value=x.reason||'other';document.getElementById('modal-return-refund').value=x.refundAmount||0;openModal(document.getElementById('return-modal'));}
    else if(sectionKey==='representative'){document.getElementById('modal-rep-id').value=x.id;document.getElementById('modal-representative-name').value=x.name||'';document.getElementById('modal-representative-id').value=x.repId||'';document.getElementById('modal-representative-national-id').value=x.nationalId||'';document.getElementById('modal-representative-address').value=x.address||'';document.getElementById('modal-rep-phone1').value=x.phone1||'';document.getElementById('modal-rep-phone2').value=x.phone2||'';openModal(document.getElementById('representative-modal'));}
    else if(sectionKey==='damage'){document.getElementById('damage-edit-id').value=x.id;document.getElementById('damage-item-code').value=x.itemCode||'';document.getElementById('damage-reason').value=x.reason||'';document.getElementById('damage-notes').value=x.notes||'';document.getElementById('damage-status').value=x.status||'Damaged';openModal(document.getElementById('damage-modal'));}
    else { /* retain legacy edit behavior for Review/Card/Returns where supported */ }
}

function dartShowOrderHistory(o){const modal=document.getElementById('history-modal'),body=document.getElementById('history-modal-body');document.getElementById('history-modal-title').textContent=`Activity — ${o.orderId}`;body.innerHTML=`<div><b>Status:</b> ${dartEsc(o.status)} · <b>Payment:</b> ${dartEsc(o.paymentStatus)} · <b>Source:</b> ${dartEsc(o.orderSource)}</div><div class="dart-timeline">${(o.activityLog||[]).slice().reverse().map(e=>`<div class="dart-timeline-item"><b>${dartEsc(e.type)}</b> ${dartEsc(e.previousStatus||'')} ${e.previousStatus?'→':''} ${dartEsc(e.newStatus||'')}<div>${dartEsc(e.reason||e.notes||'')}</div><small>${dartEsc(new Date(e.timestamp).toLocaleString())} · ${dartEsc(e.actorRole||'')}</small></div>`).join('')||'<div class="dart-empty-state">No activity yet</div>'}</div>`;openModal(modal);}
function dartShowAuditFor(type,id){const body=document.getElementById('history-modal-body');document.getElementById('history-modal-title').textContent=`Audit History — ${type}`;const rows=auditData.filter(a=>a.entityType===type&&String(a.entityId)===String(id));body.innerHTML=`<div class="dart-timeline">${rows.map(a=>`<div class="dart-timeline-item"><b>${dartEsc(a.action)}</b><div>${dartEsc(a.note||'')}</div><small>${dartEsc(new Date(a.timestamp).toLocaleString())}</small></div>`).join('')||'<div class="dart-empty-state">No audit entries yet</div>'}</div>`;openModal(document.getElementById('history-modal'));}
function dartShowClientProfile(c){const st=dartCustomerStats(c.clientId),os=ordersData.filter(o=>o.clientId===c.clientId).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));document.getElementById('history-modal-title').textContent=`Client — ${c.clientName}`;document.getElementById('history-modal-body').innerHTML=`<div><b>${dartEsc(c.clientId)}</b> · ${dartEsc(c.phone1)} · ${dartEsc(c.email||'-')}</div><p>Orders: <b>${st.orders}</b> · Delivered: <b>${st.delivered}</b> · Items: <b>${st.purchased}</b> · Spent: <b>${dartMoney(st.spent)}</b></p><div class="dart-timeline">${os.map(o=>`<div class="dart-timeline-item"><b>${dartEsc(o.orderId)}</b> — ${dartEsc(o.status)}<div>${(o.items||[]).map(dartEsc).join(', ')}</div><small>${dartEsc(o.date||'')} · ${dartMoney(dartOrderNet(o))}</small></div>`).join('')||'<div class="dart-empty-state">No orders</div>'}</div>`;openModal(document.getElementById('history-modal'));}
function renderNotifications(){const feed=document.getElementById('updates-feed');if(!feed)return;feed.innerHTML=notificationData.slice(0,50).map(n=>`<div class="dart-notification ${n.read?'read':'unread'}" data-notification-id="${dartEsc(n.id)}"><span class="notif-dot"></span><div><div>${dartEsc(n.title)}</div><small>${dartEsc(n.message)}</small></div><time>${dartEsc(new Date(n.timestamp).toLocaleString())}</time></div>`).join('')||'<div class="dart-empty-state">No updates yet</div>';if(!feed.dataset.dartBound){feed.dataset.dartBound='1';feed.addEventListener('click',e=>{const el=e.target.closest('[data-notification-id]');if(!el)return;const n=notificationData.find(x=>x.id===el.dataset.notificationId);if(!n)return;n.read=true;dartSaveAll();renderNotifications();if(n.relatedEntityType&&document.getElementById(n.relatedEntityType)){document.querySelector(`[data-target="${n.relatedEntityType}"]`)?.click();setTimeout(()=>document.querySelector(`#${n.relatedEntityType} .model-row[data-id="${CSS.escape(n.relatedEntityId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),50);}});}}

function updateOrderCards(){const sec=document.getElementById('orders');if(!sec)return;const cards=sec.querySelectorAll('.cont-card-info .card-inf .numebr');if(cards.length>=4){cards[0].textContent=ordersData.filter(o=>!DART_FINAL_ORDER_STATES.includes(o.status)).length;cards[1].textContent=ordersData.filter(o=>o.status==='Delivered').length;cards[2].textContent=ordersData.filter(o=>o.status==='New').length;cards[3].textContent=dartMoney(ordersData.filter(o=>o.status==='Delivered').reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0));}}
function updateBrandAnalytics(){
    const delivered=ordersData.filter(o=>o.status==='Delivered'),revenue=delivered.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0),cost=delivered.reduce((a,o)=>a+(o.priceSnapshot||[]).reduce((s,l)=>s+(Number(l.costSnapshot)||0),0),0),profit=revenue-cost;
    const set=(sel,v)=>{const el=document.querySelector(sel);if(el)el.textContent=v;};set('#brand .customar-card .numebr',customersData.length);set('#brand .orders-card .numebr',ordersData.length);set('#brand .stock-card .numebr',itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').length);set('#brand .sold-card .numebr',itemsData.filter(i=>i.status==='Sold').length);set('#brand .sales-cont .sales',dartMoney(revenue));set('#brand .cost-cont .sales',dartMoney(cost));set('#brand .profit-cont .sales',dartMoney(profit));
    dartCheckStockAlerts();
}
function dartCheckStockAlerts(){
    modelsData.filter(dartIsActive).forEach(m=>{const d=dartModelDerived(m);if(d.count<=DART_LOW_STOCK_THRESHOLD){const key=`stock:${m.id}:${d.count===0?'out':'low'}`,has=notificationData.some(n=>n.dedupeKey===key&&!n.resolved);if(!has){const n={id:dartUid('NOT'),type:d.count===0?'out_of_stock':'low_stock',title:d.count===0?`${m.modelId} out of stock`:`${m.modelId} low stock`,message:`${d.count} available physical item(s).`,timestamp:dartNowISO(),relatedEntityType:'models',relatedEntityId:String(m.id),read:false,severity:'warning',dedupeKey:key,resolved:false};notificationData.unshift(n);}}});
}
function dartDeadStockItems(){const now=Date.now(),ms=DART_DEAD_STOCK_DAYS*864e5;return itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').filter(i=>{const d=dartDateValue(i.regDate);return d&&now-d.getTime()>=ms;});}

function setupGlobalModalTriggers(){
    if(document.documentElement.dataset.dartModalReady)return;document.documentElement.dataset.dartModalReady='1';document.addEventListener('click',e=>{if(e.target.closest('.close-modal')){closeModal(e.target.closest('.modal'));return;}if(e.target.classList.contains('modal'))closeModal(e.target);});
}

// Final V2 boot: runs after legacy declarations, while preserving the current HTML/CSS structure.
document.addEventListener('DOMContentLoaded',()=>{
    loadAllDataFromStorage();
    // Re-run navigation discovery so newly added Damage exists in both desktop/mobile nav.
    const links=document.querySelectorAll('[data-target]'),sections=document.querySelectorAll('.dashboard-section');
    function activate(id){sections.forEach(s=>s.classList.toggle('active-section',s.id===id));links.forEach(l=>l.classList.toggle('active',l.dataset.target===id));localStorage.setItem('dart_active_section',id);if(sectionsMap[id])dartRenderSection(id);}
    links.forEach(l=>{if(!l.dataset.dartNavBound){l.dataset.dartNavBound='1';l.addEventListener('click',e=>{e.preventDefault();activate(l.dataset.target);});}});
    setupSearchFilter();setupHeaderBatchActions();setupAllDelegatedEvents();setupGlobalModalTriggers();setupModelModal();setupItemModal();setupCustomerModal();setupOrderModal();setupRepresentativeModal();dartSetupDamageModal();dartSetupOperationalModals();
    dartRefreshAll();const saved=localStorage.getItem('dart_active_section');if(saved&&document.getElementById(saved))activate(saved);
});

// Dynamic Brand analytics extension. This intentionally appends to the current Brand UI.
function dartTopBy(values){const m=new Map();values.filter(Boolean).forEach(v=>m.set(v,(m.get(v)||0)+1));return [...m.entries()].sort((a,b)=>b[1]-a[1])[0]||['-',0];}
function dartEnsureAnalyticsGrid(){
    const brand=document.getElementById('brand'); if(!brand)return null;
    let grid=document.getElementById('dart-analytics-grid');
    if(!grid){grid=document.createElement('div');grid.id='dart-analytics-grid';grid.className='dart-analytics-grid';const anchor=brand.querySelector('.chart-one');anchor?.insertAdjacentElement('afterend',grid);}
    return grid;
}
function updateBrandAnalytics(){
    const delivered=ordersData.filter(o=>o.status==='Delivered');
    const successfulLines=delivered.flatMap(o=>(o.priceSnapshot||[]));
    const revenue=delivered.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0);
    const cost=successfulLines.reduce((a,l)=>a+(Number(l.costSnapshot)||0)*(Number(l.qty)||1),0);
    const profit=revenue-cost, margin=revenue?profit/revenue*100:0, aov=delivered.length?revenue/delivered.length:0;
    const deliveryRate=ordersData.length?delivered.length/ordersData.length*100:0;
    const refusalRate=ordersData.length?ordersData.filter(o=>o.status==='Refused').length/ordersData.length*100:0;
    const returnRate=successfulLines.length?returnsData.filter(r=>r.isPostDeliveryReturn).length/successfulLines.length*100:0;
    const deliveredByClient=new Map();delivered.forEach(o=>deliveredByClient.set(o.clientId,(deliveredByClient.get(o.clientId)||0)+1));
    const repeatCustomers=[...deliveredByClient.values()].filter(v=>v>1).length, repeatRate=deliveredByClient.size?repeatCustomers/deliveredByClient.size*100:0;
    const topModel=dartTopBy(successfulLines.map(l=>l.modelCode)),topColor=dartTopBy(successfulLines.map(l=>l.color)),topSize=dartTopBy(successfulLines.map(l=>l.size));
    const topCategory=dartTopBy(successfulLines.map(l=>dartFindModelByCode(l.modelCode)?.category));
    const lowStock=modelsData.filter(dartIsActive).filter(m=>{const n=dartModelDerived(m).count;return n>0&&n<=DART_LOW_STOCK_THRESHOLD;}).length;
    const outStock=modelsData.filter(dartIsActive).filter(m=>dartModelDerived(m).count===0).length;
    const dead=dartDeadStockItems().length, damaged=itemsData.filter(i=>i.status==='Damaged').length, attention=ordersData.filter(o=>o.status==='Needs Attention').length;
    const set=(sel,v)=>{const el=document.querySelector(sel);if(el)el.textContent=v;};
    set('#brand .customar-card .numebr',customersData.length);set('#brand .orders-card .numebr',ordersData.length);set('#brand .stock-card .numebr',itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').length);set('#brand .sold-card .numebr',itemsData.filter(i=>i.status==='Sold').length);set('#brand .sales-cont .sales',dartMoney(revenue));set('#brand .cost-cont .sales',dartMoney(cost));set('#brand .profit-cont .sales',dartMoney(profit));
    const cards=[['Gross Margin',`${margin.toFixed(1)}%`,'Profit ÷ revenue'],['AOV',dartMoney(aov),'Average delivered order'],['Delivery Rate',`${deliveryRate.toFixed(1)}%`,`${delivered.length} delivered`],['Refusal Rate',`${refusalRate.toFixed(1)}%`,`${ordersData.filter(o=>o.status==='Refused').length} refused`],['Return Rate',`${returnRate.toFixed(1)}%`,`${returnsData.filter(r=>r.isPostDeliveryReturn).length} returned item(s)`],['Repeat Customers',`${repeatRate.toFixed(1)}%`,`${repeatCustomers} returning`],['Top Model',topModel[0],`${topModel[1]} sold item(s)`],['Top Color',topColor[0],`${topColor[1]} sold item(s)`],['Top Size',topSize[0],`${topSize[1]} sold item(s)`],['Top Category',topCategory[0],`${topCategory[1]} sold item(s)`],['Low Stock',String(lowStock),'Threshold ≤ 5'],['Out of Stock',String(outStock),'Active models'],['Dead Stock',String(dead),'60+ days'],['Damaged',String(damaged),'Unavailable inventory'],['Needs Attention',String(attention),'Orders requiring review'],['Net Revenue',dartMoney(revenue),'After recorded refunds']];
    const grid=dartEnsureAnalyticsGrid();if(grid)grid.innerHTML=cards.map(([t,v,s])=>`<div class="dart-analytics-card"><h6>${dartEsc(t)}</h6><strong>${dartEsc(v)}</strong><small>${dartEsc(s)}</small></div>`).join('');
    // Keep the existing Apex chart, but feed it real delivered profit when possible.
    try{if(typeof chart!=='undefined'&&chart?.updateOptions){const y=new Date().getFullYear(),monthly=Array(12).fill(0);delivered.forEach(o=>{const d=new Date(o.deliveredAt||o.createdAt||0);if(d.getFullYear()===y){const orderCost=(o.priceSnapshot||[]).reduce((a,l)=>a+(Number(l.costSnapshot)||0),0);monthly[d.getMonth()]+=Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0))-orderCost;}});chart.updateOptions({series:[{name:'Profit',data:monthly}],xaxis:{categories:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']}});}}
    catch(err){console.warn('Dart analytics chart update skipped:',err);}
    dartCheckStockAlerts();
}

// Better low-stock dedupe: one active alert per model/condition, resolved when stock recovers.
function dartCheckStockAlerts(){
    modelsData.filter(dartIsActive).forEach(m=>{
        const n=dartModelDerived(m).count, lowKey=`stock:${m.id}:low`, outKey=`stock:${m.id}:out`;
        notificationData.filter(x=>x.dedupeKey===lowKey||x.dedupeKey===outKey).forEach(x=>{ if(n>DART_LOW_STOCK_THRESHOLD)x.resolved=true; if(n>0&&x.dedupeKey===outKey)x.resolved=true; });
        if(n===0){if(!notificationData.some(x=>x.dedupeKey===outKey&&!x.resolved))notificationData.unshift({id:dartUid('NOT'),type:'out_of_stock',title:`${m.modelId} out of stock`,message:'0 available physical items.',timestamp:dartNowISO(),relatedEntityType:'models',relatedEntityId:String(m.id),read:false,severity:'warning',dedupeKey:outKey,resolved:false});}
        else if(n<=DART_LOW_STOCK_THRESHOLD){if(!notificationData.some(x=>x.dedupeKey===lowKey&&!x.resolved))notificationData.unshift({id:dartUid('NOT'),type:'low_stock',title:`${m.modelId} low stock`,message:`${n} available physical item(s). Threshold: ${DART_LOW_STOCK_THRESHOLD}.`,timestamp:dartNowISO(),relatedEntityType:'models',relatedEntityId:String(m.id),read:false,severity:'warning',dedupeKey:lowKey,resolved:false});}
    });
}

// ============================================================================
// DART OPERATIONS V3 — requested refinements (IDs, analytics, UX, filters)
// ============================================================================
const DART_V3_ID_MIGRATION_KEY = 'dart_v3_sequential_ids_migrated';
const DART_PANTS_SIZES = ['26','28','30','32','34','36','38','40','42','44','46','48','50','52'];
const DART_TOP_SIZES = ['XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL','6XL'];

function dartNextBusinessCode(prefix, data, field){
    const re=new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}-?(\\d+)$`,'i');
    let max=0;
    data.forEach(x=>{const m=String(x?.[field]||'').match(re);if(m)max=Math.max(max,Number(m[1])||0);});
    return `${prefix}-${max+1}`;
}
function dartMigrateSequentialIds(){
    if(localStorage.getItem(DART_V3_ID_MIGRATION_KEY)==='1') return;
    const clientMap=new Map(),orderMap=new Map(),returnMap=new Map(),repMap=new Map();
    customersData.forEach((c,i)=>{const old=c.clientId;c.clientId=`DA-${i+1}`;if(old)clientMap.set(String(old),c.clientId);});
    ordersData.forEach((o,i)=>{const old=o.orderId;o.orderId=`K-${i+1}`;if(old)orderMap.set(String(old),o.orderId);});
    returnsData.forEach((r,i)=>{const old=r.returnId;r.returnId=`R-${i+1}`;if(old)returnMap.set(String(old),r.returnId);});
    representativeData.forEach((r,i)=>{const old=r.repId;r.repId=`Rep-${i+1}`;if(old)repMap.set(String(old),r.repId);});
    ordersData.forEach(o=>{if(clientMap.has(String(o.clientId)))o.clientId=clientMap.get(String(o.clientId));});
    itemsData.forEach(i=>{if(clientMap.has(String(i.clientId)))i.clientId=clientMap.get(String(i.clientId));if(orderMap.has(String(i.orderId)))i.orderId=orderMap.get(String(i.orderId));});
    returnsData.forEach(r=>{if(clientMap.has(String(r.clientId)))r.clientId=clientMap.get(String(r.clientId));if(orderMap.has(String(r.orderId)))r.orderId=orderMap.get(String(r.orderId));});
    damageData.forEach(d=>{if(clientMap.has(String(d.clientId)))d.clientId=clientMap.get(String(d.clientId));if(orderMap.has(String(d.orderId)))d.orderId=orderMap.get(String(d.orderId));if(returnMap.has(String(d.returnId)))d.returnId=returnMap.get(String(d.returnId));});
    cardsData.forEach(c=>{if(clientMap.has(String(c.clientId)))c.clientId=clientMap.get(String(c.clientId));});
    localStorage.setItem(DART_V3_ID_MIGRATION_KEY,'1');
}

function loadAllDataFromStorage(){
    const load=(k,fallback)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):fallback;}catch{return fallback;}};
    modelsData=load('dart_models',modelsData);itemsData=load('dart_items',itemsData);customersData=load('dart_customers',customersData);
    ordersData=load('dart_orders',ordersData);returnsData=load('dart_returns',returnsData);reviewsData=load('dart_reviews',reviewsData);
    cardsData=load('dart_cards',cardsData);representativeData=load('dart_representatives',representativeData);
    damageData=load('dart_damage',[]);notificationData=load('dart_notifications',[]);auditData=load('dart_audit',[]);
    [modelsData,itemsData,customersData,ordersData,returnsData,reviewsData,cardsData,representativeData,damageData].forEach(arr=>arr.forEach(x=>{
        if(x.isArchived===undefined)x.isArchived=Boolean(x.isDeleted);x.isDeleted=Boolean(x.isArchived);if(x.isChecked===undefined)x.isChecked=false;
    }));
    ordersData.forEach(o=>{const legacy={Pending:'New','Out for Delivery':'Out With Representative'};o.status=legacy[o.status]||o.status||'New';o.activityLog=Array.isArray(o.activityLog)?o.activityLog:[];o.paymentStatus=o.paymentStatus||'Unpaid';o.orderSource=o.orderSource||'Manual';o.amountPaid=Number(o.amountPaid)||0;o.amountRefunded=Number(o.amountRefunded)||0;o.createdAt=o.createdAt||o.orderCreatedAt||dartNowISO();if(!Array.isArray(o.priceSnapshot))o.priceSnapshot=[];});
    reviewsData.forEach(r=>{r.createdAt=r.createdAt||(()=>{const d=dartDateValue(r.date);return d?d.toISOString():dartNowISO();})();});
    dartMigrateSequentialIds();
    dartEnsureMonthlyDartCardWinners();
    dartSaveAll();
}

function dartModelDerived(model){
    const related=itemsData.filter(i=>String(i.modelId)===String(model.modelId) && dartIsActive(i));
    const available=related.filter(i=>String(i.status).toLowerCase()==='in stock');
    const sold=related.filter(i=>String(i.status).toLowerCase()==='sold');
    const damaged=itemsData.filter(i=>String(i.modelId)===String(model.modelId)&&['Damaged','Destroyed'].includes(i.status));
    return {count:available.length,total:related.length+damaged.filter(d=>!related.includes(d)).length,sold:sold.length,damaged:damaged.length,colors:[...new Set(related.map(i=>i.color).filter(Boolean))],sizes:[...new Set(related.map(i=>i.size).filter(Boolean))],img:related.find(i=>i.img)?.img||damaged.find(i=>i.img)?.img||model.img||''};
}

function renderModels(dataArray){
    const c=document.getElementById('models-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(m=>{const d=dartModelDerived(m),out=d.count===0?'Out of stock':(m.status||'Active');
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(m)}" data-id="${dartEsc(m.id)}"><input type="checkbox" class="model-checkbox" ${m.isChecked?'checked':''} ${dartIsArchived(m)?'disabled':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(m)?'استعادة':'شطب'}"><i class="bx ${dartIsArchived(m)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete" title="حذف نهائي"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit" title="تعديل"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="models" title="Audit History"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(d.img||'https://via.placeholder.com/50')}" class="product-img model-img"></div><span class="text-item w150">${dartEsc(m.modelId)}</span><span class="text-item w150">${dartEsc(m.name)}</span><span class="text-item w150">${dartEsc(m.category)}</span><span class="text-item w200">${dartEsc(m.description)}</span><span class="text-item w150">${d.count}</span><span class="text-item w150">${d.total}</span><span class="text-item w150">${d.sold}</span><span class="text-item w150">${d.damaged}</span><span class="text-item w150">${dartMoney(m.cost)}</span><span class="text-item w150">${dartMoney(m.selling)}</span><span class="text-item w150">${Number(m.discount)||0}%</span><span class="text-item w150">${dartMoney(m.discountedPrice??m.selling)}</span><span class="text-item w300">${dartEsc(d.colors.join(', ')||'-')}</span><span class="text-item w300">${dartEsc(d.sizes.join(', ')||'-')}</span><span class="text-item w150">• ${dartEsc(out)}</span><span class="text-item w150">${dartEsc(m.date||'-')}</span></div>`);
    });
}

function renderItems(dataArray){
    const c=document.getElementById('items-container');if(!c)return;c.innerHTML='';
    getSortedData((dataArray||[]).filter(i=>!['Damaged','Destroyed'].includes(i.status))).forEach(i=>{
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(i)}" data-id="${dartEsc(i.id)}"><input type="checkbox" class="model-checkbox" ${i.isChecked?'checked':''} ${dartIsArchived(i)?'disabled':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete" title="${dartIsArchived(i)?'استعادة':'شطب'}"><i class="bx ${dartIsArchived(i)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="items"><i class="bx bx-history"></i></button></div><div class="w100"><img src="${dartEsc(i.img||'https://via.placeholder.com/50')}" class="product-img dart-item-thumb" data-full-image="${dartEsc(i.img||'https://via.placeholder.com/50')}" title="Click to enlarge"></div><span class="text-item w150">${dartEsc(i.modelId)}</span><span class="text-item w150">${dartEsc(i.itemCode)}</span><span class="text-item w150">${dartEsc(i.color)}</span><span class="text-item w150">${dartEsc(i.size)}</span><span class="text-item w150"><span class="status-pill ${dartStatusClass(i.status)}">${dartEsc(i.status)}</span></span><span class="text-item w200">${dartEsc(i.regDate||'-')}</span><span class="text-item w150">${dartEsc(i.orderId||'-')}</span><span class="text-item w200">${dartEsc(i.clientName||'-')}</span><span class="text-item w150">${dartEsc(i.clientId||'-')}</span><span class="text-item w150">${dartEsc(i.phone1||'-')}</span><span class="text-item w300">${dartEsc(i.phone2||'-')}</span><span class="text-item w150">${dartEsc(i.email||'-')}</span><span class="text-item w150">${dartEsc(i.purchaseDate||'-')}</span></div>`);
    });
}

function dartMonthKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function dartDeliveredInMonth(clientId,year,month){return ordersData.filter(o=>o.clientId===clientId&&o.status==='Delivered').filter(o=>{const d=new Date(o.deliveredAt||o.createdAt||0);return d.getFullYear()===year&&d.getMonth()===month;});}
function dartCurrentMonthlyOrders(clientId){const n=new Date();return dartDeliveredInMonth(clientId,n.getFullYear(),n.getMonth()).length;}
function renderCustomers(dataArray){
    const c=document.getElementById('customers-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(x=>{const st=dartCustomerStats(x.clientId),monthly=dartCurrentMonthlyOrders(x.clientId);c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(x)}" data-id="${dartEsc(x.id)}"><input type="checkbox" class="model-checkbox" ${x.isChecked?'checked':''} ${dartIsArchived(x)?'disabled':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(x)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-client-profile="1" title="Client history"><i class="bx bx-history"></i></button><button class="dart-reset-password-btn" title="Reset Password"><i class="bx bx-key"></i></button></div><span class="text-item w150">${dartEsc(x.birthday||'-')}</span><span class="text-item w150">${dartEsc(x.clientName)}</span><span class="text-item w150">${dartEsc(x.clientId)}</span><span class="text-item w150">${dartEsc(x.phone1)}</span><span class="text-item w150">${dartEsc(x.phone2||'-')}</span><span class="text-item w200">${dartEsc(x.email||'-')}</span><span class="text-item w150">${dartEsc(x.country||'Egypt')}</span><span class="text-item w200">${dartEsc(x.governorate||'-')}</span><span class="text-item w150">${monthly}</span><span class="text-item w150">${st.delivered}</span><span class="text-item w300">${dartMoney(st.spent)}<small class="dart-kpi-inline">${st.purchased} items · last ${dartEsc(st.lastPurchase)}</small></span><span class="text-item w200">${dartEsc(x.dartCard||'no')}</span></div>`);});
}

function dartPreviousStatus(status){const i=DART_ORDER_FLOW.indexOf(status);return i>0?DART_ORDER_FLOW[i-1]:null;}
function dartRollbackOrderOneStep(order){
    if(!order||dartIsArchived(order)||['New','Refused','Cancelled','Needs Attention'].includes(order.status))return {ok:false,message:'لا يمكن الرجوع خطوة من هذه الحالة.'};
    const prevStatus=order.status,target=dartPreviousStatus(prevStatus);if(!target)return {ok:false,message:'لا توجد خطوة سابقة.'};
    if(!confirm(`رجوع ${order.orderId} من ${prevStatus} إلى ${target}؟ سيتم عكس أي تأثير مالي/مخزني مرتبط بهذه الخطوة.`))return {ok:false,message:'cancelled'};
    if(prevStatus==='Delivered'){
        (order.items||[]).forEach(code=>{const it=dartFindItemByCode(code);if(it&&it.status==='Sold'){it.status='Processing/Held';it.purchaseDate='';}});
        order.deliveredAt=null;
        if(order.paymentMethod&&String(order.paymentMethod).toLowerCase().includes('cash')&&order.paidAt){order.paymentStatus='Unpaid';order.amountPaid=0;order.paidAt=null;}
    }
    if(prevStatus==='Representative On The Way')order.representativeOnWayAt=null;
    if(prevStatus==='Out With Representative'){order.outWithRepresentativeAt=null;order.representativeId=null;order.representativeName='';}
    if(prevStatus==='Preparing')order.preparingAt=null;
    if(prevStatus==='Accepted')order.acceptedAt=null;
    order.status=target;dartLogOrder(order,'STATUS_ROLLBACK',prevStatus,target,{notes:'Admin rolled order back one step'});dartAudit('ORDER_STATUS_ROLLBACK','orders',order.id,{status:prevStatus},{status:target},'Manual one-step rollback');dartNotify('order_rollback',`${order.orderId}: moved back one step`,`${prevStatus} → ${target}`,'orders',order.id,'warning');dartSaveAll();dartRefreshAll();return {ok:true};
}

function renderOrders(dataArray){
    const c=document.getElementById('orders-container');if(!c)return;c.innerHTML='';
    const sorted=getSortedData(dataArray).sort((a,b)=>{if(dartIsArchived(a)!==dartIsArchived(b))return Number(dartIsArchived(a))-Number(dartIsArchived(b));return new Date(b.createdAt||0)-new Date(a.createdAt||0);});
    sorted.forEach(o=>{const next=dartNextStatus(o.status),net=dartOrderNet(o),rep=o.representativeName||dartFindRepById(o.representativeId)?.name||'-',chips=(o.items||[]).map(x=>`<div class="order-item-chip">${dartEsc(x)}</div>`).join('')||'-';
        const nextBtn=next?`<button class="dart-status-btn" data-order-target="${dartEsc(next)}">${dartEsc(next)}</button>`:'',back=dartPreviousStatus(o.status)&&!['Refused','Cancelled','Needs Attention'].includes(o.status)?'<button class="dart-back-btn" title="Back one step"><i class="bx bx-undo"></i></button>':'',refuse=['Out With Representative','Representative On The Way'].includes(o.status)?'<button class="dart-refuse-btn" data-order-target="Refused">Refuse</button>':'',cancel=!DART_FINAL_ORDER_STATES.includes(o.status)?'<button class="dart-cancel-btn" data-order-target="Cancelled">Cancel</button>':'',pickup=o.status==='Out With Representative'?'<button class="dart-pickup-cancel-btn">Cancel Pickup</button>':'';
        c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(o)}" data-id="${dartEsc(o.id)}"><input type="checkbox" class="model-checkbox" ${o.isChecked?'checked':''} ${dartIsArchived(o)?'disabled':''}><div class="w500 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(o)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-order-history="1"><i class="bx bx-history"></i></button>${back}<span class="dart-status-actions">${nextBtn}${refuse}${cancel}${pickup}</span></div><span class="text-item w150">${dartEsc(o.orderId)}</span><span class="text-item w150">${dartEsc(o.date||'-')}</span><span class="text-item w150">${dartEsc(o.time||'-')}</span><span class="text-item w200"><span class="status-pill ${dartStatusClass(o.status)}">${dartEsc(o.status)}</span></span><span class="text-item w150">${dartEsc(o.clientId||'-')}</span><span class="text-item w200">${dartEsc(o.clientName)}</span><span class="text-item w150">${dartEsc(o.phone1)}</span><span class="text-item w150">${dartEsc(o.phone2||'-')}</span><span class="text-item w150">${dartEsc(o.email||'-')}</span><span class="text-item w150">${(o.items||[]).length}</span><div class="text-item w500"><div class="order-items-grid">${chips}</div></div><span class="text-item w150">${dartMoney(o.totalPrice)}</span><span class="text-item w150">${Number(o.discount)||0}%</span><span class="text-item w150">${dartEsc(o.reasonDeduction||'-')}</span><span class="text-item w150 order-final-amount">${dartMoney(net)}</span><span class="text-item w150"><span class="payment-cell"><i class="${dartPaymentIcon(o.paymentMethod)}"></i>${dartEsc(o.paymentMethod||'-')}</span></span><span class="text-item w150">${dartEsc(o.paymentStatus||'Unpaid')}</span><span class="text-item w150">${dartEsc(o.orderSource||'Manual')}</span><span class="text-item w150">${dartEsc(rep)}</span><span class="text-item w150">${dartEsc(o.deliveryNotes||'-')}</span><span class="text-item w150">${dartEsc(o.country||'Egypt')}</span><span class="text-item w150">${dartEsc(o.governorate||'-')}</span><span class="text-item w150">${dartEsc(o.area||'-')}</span><span class="text-item w150">${dartEsc(o.street||'-')}</span><span class="text-item w150">${dartEsc(o.building||'-')}</span><span class="text-item w150">${dartEsc(o.floor||'-')}</span></div>`);
    });updateOrderCards();
}

function renderReturns(dataArray){
    const c=document.getElementById('returns-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).sort((a,b)=>new Date(b.createdAt||dartDateValue(b.date)||0)-new Date(a.createdAt||dartDateValue(a.date)||0)).forEach(r=>c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked?'checked':''} ${dartIsArchived(r)?'disabled':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${r.status==='Pending Inspection'?'<button class="return-good-btn">Good</button><button class="return-bad-btn">Bad</button>':''}</div><span class="text-item w150">${dartEsc(r.returnId)}</span><span class="text-item w150">${dartEsc(r.modelId||'-')}</span><span class="text-item w150">${dartEsc(r.itemCode)}</span><span class="text-item w150"><span class="return-status ${String(r.status).toLowerCase()==='good'?'return-status-good':''}">${dartEsc(r.status)}</span></span><span class="text-item w150">${dartEsc(r.date||'-')}</span><span class="text-item w200">${dartEsc(r.clientName||'-')}</span><span class="text-item w150">${dartEsc(r.clientId||'-')}</span><span class="text-item w150">${dartEsc(r.phone1||'-')}</span><span class="text-item w150">${dartEsc(r.phone2||'-')}</span><span class="text-item w150">${dartEsc(r.email||'-')}</span><span class="text-item w300 overflow">${dartEsc(r.reason||'-')}</span><span class="text-item w150">${dartEsc(r.orderId||'-')}</span></div>`));
}

function renderReviews(dataArray){
    const c=document.getElementById('review-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).forEach(r=>{const active=r.status==='Active';c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked?'checked':''}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="btn-toggle-review review-toggle-btn ${active?'review-status-active':'review-status-hidden'}">${active?'Hide':'Activate'}</button></div><span class="text-item w200">${dartEsc(new Date(r.createdAt).toLocaleString())}</span><span class="text-item w200">${dartEsc(r.clientName)}</span><span class="text-item w150">${dartEsc(r.clientId||'-')}</span><span class="text-item w150 status-text" style="color:${active?'green':'red'}">${dartEsc(r.status)}</span><span class="text-item w100">${dartEsc(r.rating)} / 5</span><span class="text-item w300">${dartEsc(r.title)}</span><span class="text-item w500 overflow">${dartEsc(r.review)}</span><span class="text-item w150">${dartEsc(r.phone1)}</span><span class="text-item w150">${dartEsc(r.phone2)}</span><span class="text-item w150">${dartEsc(r.email)}</span></div>`);});
}

function renderRepresentative(dataArray){
    const c=document.getElementById('representative-container');if(!c)return;c.innerHTML='';
    getSortedData(dataArray).forEach(r=>{const current=ordersData.filter(o=>String(o.representativeId)===String(r.id)&&!DART_FINAL_ORDER_STATES.includes(o.status)).length,total=ordersData.filter(o=>String(o.representativeId)===String(r.id)).length;c.insertAdjacentHTML('beforeend',`<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked?'checked':''}><div class="w300 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r)?'bx-revision':'bx-minus-circle'}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button></div><span class="text-item w200">${dartEsc(r.name)}</span><span class="text-item w150">${dartEsc(r.repId)}</span><span class="text-item w100" style="color:${r.status==='Active'?'#10b981':'#ef4444'}">${dartEsc(r.status)}</span><span class="text-item w150">${dartEsc(r.nationalId||'-')}</span><span class="text-item w150">${current}</span><span class="text-item w100">${total}</span><span class="text-item w150">${dartEsc(r.phone1)}</span><span class="text-item w150">${dartEsc(r.phone2||'-')}</span><span class="text-item w200">${dartEsc(r.address||'-')}</span><span class="text-item w150">${dartEsc(r.date||'-')}</span></div>`);});
}

function dartApplyFilters(key,data){
    const state=dartFilterState[key]||{},raw=[...(data||[])];let out=raw;
    if(state.search)out=out.filter(x=>dartSectionSearchText(x).includes(state.search));
    if(state.archive==='active')out=out.filter(dartIsActive);else if(state.archive==='archived')out=out.filter(dartIsArchived);
    const eq=(field,val,derive)=>{if(!val||val==='all')return;out=out.filter(x=>String(derive?derive(x):x[field]||'').toLowerCase()===String(val).toLowerCase());};
    if(key==='models'){eq('category',state.category);if(state.status&&state.status!=='all')out=out.filter(m=>{const d=dartModelDerived(m);return state.status==='out-of-stock'?d.count===0:String(m.status||'Active').toLowerCase()===state.status.toLowerCase();});if(state.priceRange&&state.priceRange!=='all')out=out.filter(m=>{const p=Number(m.discountedPrice??m.selling)||0;return state.priceRange==='0-500'?p<=500:state.priceRange==='500-1000'?p>500&&p<=1000:p>1000;});}
    if(key==='items'){if(state.category&&state.category!=='all')out=out.filter(i=>String(dartFindModelByCode(i.modelId)?.category||'').toLowerCase()===state.category.toLowerCase());if(state.status&&state.status!=='all')out=out.filter(i=>String(i.status).toLowerCase().includes(state.status.toLowerCase().replace('active','in stock').replace('out-of-stock','sold')));if(state.sizeProfile==='pants')out=out.filter(i=>DART_PANTS_SIZES.includes(String(i.size)));if(state.sizeProfile==='tops')out=out.filter(i=>DART_TOP_SIZES.includes(String(i.size).toUpperCase()));eq('size',state.size);eq('color',state.color);}
    if(key==='customers'){if(state.dartCard&&state.dartCard!=='all')eq('dartCard',state.dartCard);if(state.monthlyOrders==='up')out.sort((a,b)=>dartCurrentMonthlyOrders(b.clientId)-dartCurrentMonthlyOrders(a.clientId));if(state.monthlyOrders==='low')out.sort((a,b)=>dartCurrentMonthlyOrders(a.clientId)-dartCurrentMonthlyOrders(b.clientId));if(state.birthday&&state.birthday!=='all'){const now=new Date(),target=new Date(now);if(state.birthday==='tomorrow')target.setDate(now.getDate()+1);if(state.birthday==='yesterday')target.setDate(now.getDate()-1);out=out.filter(c=>{const d=dartDateValue(c.birthday);return d&&d.getDate()===target.getDate()&&d.getMonth()===target.getMonth();});}}
    if(key==='orders'){eq('status',state.status);if(state.totalPrice==='up')out.sort((a,b)=>dartOrderNet(b)-dartOrderNet(a));else if(state.totalPrice==='low')out.sort((a,b)=>dartOrderNet(a)-dartOrderNet(b));else out.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));if(state.date&&state.date!=='all'){const now=Date.now();out=out.filter(o=>{const d=new Date(o.createdAt||0);if(Number.isNaN(d.getTime()))return false;const age=now-d.getTime();if(state.date==='an-hour-ago')return age<=3600000;if(state.date==='two-hours-ago')return age<=7200000;if(state.date==='five-hours-ago')return age<=18000000;const today=new Date(),od=d.toDateString();if(state.date==='today')return od===today.toDateString();if(state.date==='yesterday'){const y=new Date(today);y.setDate(today.getDate()-1);return od===y.toDateString();}return true;});}}
    if(key==='returns'){eq('status',state.status);if(state.reason&&state.reason!=='all')out=out.filter(r=>String(r.reason||'').toLowerCase().includes(String(state.reason).replaceAll('_',' ').toLowerCase()));out.sort((a,b)=>new Date(b.createdAt||dartDateValue(b.date)||0)-new Date(a.createdAt||dartDateValue(a.date)||0));}
    if(key==='review'){if(state.status&&state.status!=='all')eq('status',state.status);if(state.rating==='up'||state.rating==='Up')out.sort((a,b)=>(Number(b.rating)||0)-(Number(a.rating)||0));else if(state.rating==='low')out.sort((a,b)=>(Number(a.rating)||0)-(Number(b.rating)||0));else out.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));}
    if(key==='representative'){if(state.status&&state.status!=='all')out=out.filter(r=>String(r.status||'').toLowerCase()===String(state.status).toLowerCase().replace('hidden','not available'));}
    if(key==='card'){if(state.status&&state.status!=='all')eq('status',state.status);}if(key==='damage'){if(state.status&&state.status!=='all')eq('status',state.status);}
    return out;
}

function dartNotificationCategory(n){const t=String(n.type||'').toLowerCase();if(t.includes('damage')||t.includes('destroy')||t.includes('repair'))return'damage';if(t.includes('return')||t.includes('refus'))return'return';if(t.includes('payment')||t.includes('refund'))return'payment';if(t.includes('stock')||t.includes('item')||t.includes('inventory'))return'inventory';if(t.includes('client')||t.includes('password'))return'customer';if(t.includes('order')||t.includes('representative')||t.includes('pickup')||t.includes('attention'))return'order';return'system';}
function dartNotificationIcon(cat){return({order:'fa-solid fa-box',inventory:'fa-solid fa-shirt',return:'fa-solid fa-rotate-left',damage:'fa-solid fa-triangle-exclamation',payment:'fa-solid fa-wallet',customer:'fa-solid fa-user',system:'fa-solid fa-circle-info'})[cat]||'fa-solid fa-bell';}
function renderNotifications(){const feed=document.getElementById('updates-feed');if(!feed)return;const filter=document.getElementById('notificationFilter')?.value||'all',list=notificationData.filter(n=>filter==='all'||dartNotificationCategory(n)===filter).slice(0,80);feed.innerHTML=list.map(n=>{const cat=dartNotificationCategory(n);return`<div class="dart-notification notif-${cat} ${n.read?'read':'unread'}" data-notification-id="${dartEsc(n.id)}"><span class="notif-icon"><i class="${dartNotificationIcon(cat)}"></i></span><div class="notif-main"><div class="notif-title">${dartEsc(n.title)}</div><small>${dartEsc(n.message)}</small></div><time>${dartEsc(new Date(n.timestamp).toLocaleString())}</time></div>`;}).join('')||'<div class="dart-empty-state">No updates yet</div>';if(!feed.dataset.dartBound){feed.dataset.dartBound='1';feed.addEventListener('click',e=>{const el=e.target.closest('[data-notification-id]');if(!el)return;const n=notificationData.find(x=>x.id===el.dataset.notificationId);if(!n)return;n.read=true;dartSaveAll();renderNotifications();if(n.relatedEntityType&&document.getElementById(n.relatedEntityType)){document.querySelector(`[data-target="${n.relatedEntityType}"]`)?.click();setTimeout(()=>document.querySelector(`#${n.relatedEntityType} .model-row[data-id="${CSS.escape(n.relatedEntityId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),50);}});}const f=document.getElementById('notificationFilter');if(f&&!f.dataset.dartBound){f.dataset.dartBound='1';f.addEventListener('change',renderNotifications);}}

function dartTomorrowBirthdays(){const t=new Date();t.setDate(t.getDate()+1);return customersData.filter(dartIsActive).filter(c=>{const d=dartDateValue(c.birthday);return d&&d.getDate()===t.getDate()&&d.getMonth()===t.getMonth();});}
function renderBirthdayWidget(){const feed=document.getElementById('birthday-feed');if(!feed)return;const rows=dartTomorrowBirthdays();feed.innerHTML=rows.map(c=>`<div class="bday-item overflow" data-client-id="${dartEsc(c.id)}"><input type="checkbox" class="bday-checkbox"><span class="bday-date w100">${dartEsc(c.birthday)}</span><span class="bday-name w150">${dartEsc(c.clientName)}</span><span class="bday-phone w100">${dartEsc(c.phone1)}</span><span class="orders w100">${dartCurrentMonthlyOrders(c.clientId)} Order</span><span class="from w100">${dartEsc(c.governorate||c.country||'-')}</span></div>`).join('')||'<div class="dart-empty-state">No birthdays tomorrow</div>';const master=document.getElementById('selectAllBirthdays');if(master){master.checked=false;master.indeterminate=false;const boxes=[...feed.querySelectorAll('.bday-checkbox')];master.onchange=()=>boxes.forEach(b=>b.checked=master.checked);feed.onchange=()=>{const checked=boxes.filter(b=>b.checked).length;master.checked=boxes.length>0&&checked===boxes.length;master.indeterminate=checked>0&&checked<boxes.length;};}}
function renderTopClients(){const feed=document.getElementById('top-clients-feed');if(!feed)return;const rows=customersData.filter(dartIsActive).map(c=>({c,s:dartCustomerStats(c.clientId)})).sort((a,b)=>b.s.delivered-a.s.delivered||b.s.spent-a.s.spent).slice(0,100);feed.innerHTML=rows.map(({c,s},i)=>`<div class="bday-item overflow"><span class="bday-num">${i+1})</span><span class="bday-date w100">${dartEsc(c.birthday||'-')}</span><span class="bday-name w150">${dartEsc(c.clientName)}</span><span class="bday-id w100">${dartEsc(c.clientId)}</span><span class="bday-phone w100">${dartEsc(c.phone1)}</span><span class="bday-orders w100">${s.delivered} Order</span><span class="bday-amount w150">${dartMoney(s.spent)}</span><span class="bday-from w100">${dartEsc(c.governorate||c.country||'-')}</span></div>`).join('')||'<div class="dart-empty-state">No clients yet</div>';}

function dartEnsureMonthlyDartCardWinners(){
    const now=new Date(),prev=new Date(now.getFullYear(),now.getMonth()-1,1),key=dartMonthKey(prev),marker=`dart_card_awarded_${key}`;if(localStorage.getItem(marker)==='1')return;
    cardsData.forEach(card=>{if(card.status==='Active'){const expiredByItems=Number(card.purchasedItems||0)>=Number(card.itemLimit||card.purchasedLimit||10),expiry=dartDateValue(card.expDate),expiredByDate=expiry&&expiry<now;if(expiredByItems||expiredByDate)card.status='Expired';}});
    const activeCardClients=new Set(cardsData.filter(card=>card.status==='Active').map(card=>String(card.clientId)));customersData.forEach(customer=>{customer.dartCard=activeCardClients.has(String(customer.clientId))?'yes':'no';});
    const candidates=customersData.filter(dartIsActive).filter(c=>!activeCardClients.has(String(c.clientId))).map(c=>{const os=dartDeliveredInMonth(c.clientId,prev.getFullYear(),prev.getMonth());return{c,count:os.length,spent:os.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0)};}).filter(x=>x.count>0).sort((a,b)=>b.count-a.count||b.spent-a.spent);
    if(!candidates.length){localStorage.setItem(marker,'1');return;}
    const maxCount=candidates[0].count,winners=candidates.filter(x=>x.count===maxCount).sort((a,b)=>b.spent-a.spent).slice(0,3);
    winners.forEach((w,idx)=>{if(!cardsData.some(c=>c.awardMonth===key&&c.clientId===w.c.clientId)){cardsData.push({id:dartUid('CARDDB'),cardId:`DART-${key}-${idx+1}`,clientName:w.c.clientName,clientId:w.c.clientId,phone1:w.c.phone1,phone2:w.c.phone2||'-',email:w.c.email||'',status:'Active',issueDate:new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString('en-GB'),expDate:new Date(now.getFullYear()+1,now.getMonth(),1).toLocaleDateString('en-GB'),purchasedItems:'0',purchasedLimit:'10',itemLimit:10,discountPercent:40,requestedProducts:[],awardMonth:key,isArchived:false,isDeleted:false,isChecked:false});w.c.dartCard='yes';}});
    localStorage.setItem(marker,'1');
}

function dartTotalInventoryCost(){return itemsData.reduce((a,i)=>{const m=dartFindModelByCode(i.modelId);return a+(Number(m?.cost)||0);},0);}
function dartInStockSellingValue(){return itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').reduce((a,i)=>{const m=dartFindModelByCode(i.modelId);return a+(Number(m?.discountedPrice??m?.selling)||0);},0);}
function dartDamageLoss(){return itemsData.filter(i=>['Damaged','Destroyed'].includes(i.status)).reduce((a,i)=>{const m=dartFindModelByCode(i.modelId);return a+(Number(m?.cost)||0);},0);}
function dartEnsureBrandExtraCards(){const grid=dartEnsureAnalyticsGrid();if(!grid)return;}
function dartInfoButton(title,text){return `<button type="button" class="dart-info-btn" data-info-title="${dartEsc(title)}" data-info-text="${dartEsc(text)}" title="Info"><i class="fa-solid fa-info"></i></button>`;}
function updateBrandAnalytics(){
    const delivered=ordersData.filter(o=>o.status==='Delivered'),revenue=delivered.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0),totalCost=dartTotalInventoryCost(),stockSell=dartInStockSellingValue(),damageLoss=dartDamageLoss(),soldCost=delivered.flatMap(o=>o.priceSnapshot||[]).reduce((a,l)=>a+(Number(l.costSnapshot)||0)*(Number(l.qty)||1),0),profit=revenue-soldCost-damageLoss;
    const set=(sel,v)=>{const el=document.querySelector(sel);if(el)el.textContent=v;};set('#brand .customar-card .numebr',customersData.filter(dartIsActive).length);set('#brand .orders-card .numebr',ordersData.length);set('#brand .stock-card .numebr',itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').length);set('#brand .sold-card .numebr',itemsData.filter(i=>i.status==='Sold').length);set('#brand .sales-cont .sales',dartMoney(revenue));set('#brand .cost-cont .sales',dartMoney(totalCost));set('#brand .profit-cont .sales',dartMoney(profit));
    const successfulLines=delivered.flatMap(o=>o.priceSnapshot||[]),aov=delivered.length?revenue/delivered.length:0,margin=revenue?profit/revenue*100:0,deliveryRate=ordersData.length?delivered.length/ordersData.length*100:0,refusalRate=ordersData.length?ordersData.filter(o=>o.status==='Refused').length/ordersData.length*100:0,returnRate=successfulLines.length?returnsData.filter(r=>r.isPostDeliveryReturn).length/successfulLines.length*100:0,topModel=dartTopBy(successfulLines.map(l=>l.modelCode)),topColor=dartTopBy(successfulLines.map(l=>l.color)),topSize=dartTopBy(successfulLines.map(l=>l.size));
    const cards=[['In Stock Selling Value',dartMoney(stockSell),'Total current selling value of active In Stock physical items','fa-solid fa-tags'],['Damage Loss',dartMoney(damageLoss),'Cost value of Damaged and Destroyed physical items','fa-solid fa-triangle-exclamation'],['Gross Margin',`${margin.toFixed(1)}%`,'Net profit after sold cost and damage loss divided by sales','fa-solid fa-percent'],['AOV',dartMoney(aov),'Average value of Delivered orders','fa-solid fa-receipt'],['Delivery Rate',`${deliveryRate.toFixed(1)}%`,'Delivered orders ÷ all orders','fa-solid fa-truck-fast'],['Refusal Rate',`${refusalRate.toFixed(1)}%`,'Refused orders ÷ all orders','fa-solid fa-ban'],['Return Rate',`${returnRate.toFixed(1)}%`,'Post-delivery returned items ÷ sold items','fa-solid fa-rotate-left'],['Top Model',topModel[0],`${topModel[1]} sold item(s)`,'fa-solid fa-shirt'],['Top Color',topColor[0],`${topColor[1]} sold item(s)`,'fa-solid fa-palette'],['Top Size',topSize[0],`${topSize[1]} sold item(s)`,'fa-solid fa-ruler'],['Low Stock',String(modelsData.filter(dartIsActive).filter(m=>{const n=dartModelDerived(m).count;return n>0&&n<=DART_LOW_STOCK_THRESHOLD;}).length),'Models at 5 or fewer available items','fa-solid fa-boxes-stacked'],['Dead Stock',String(dartDeadStockItems().length),'In Stock items unsold for 60+ days','fa-solid fa-clock']];
    const grid=dartEnsureAnalyticsGrid();if(grid)grid.innerHTML=cards.map(([t,v,s,ic],i)=>`<div class="dart-analytics-card kpi-tone-${i%6}"><div class="kpi-card-head"><i class="${ic}"></i>${dartInfoButton(t,s)}</div><h6>${dartEsc(t)}</h6><strong>${dartEsc(v)}</strong><small>${dartEsc(s)}</small></div>`).join('');
    document.querySelectorAll('#brand .card-inf-2,#brand .sales-cont,#brand .cost-cont,#brand .profit-cont').forEach((el,i)=>{if(!el.querySelector('.dart-info-btn'))el.insertAdjacentHTML('afterbegin',dartInfoButton(el.querySelector('h5,h4')?.textContent||'Metric',['Live value calculated from connected dashboard data.','Total orders currently stored.','Customer rating based on Review data.','Physical items currently available.','Physical items successfully sold.','Net Delivered order sales after refunds.','Total cost price of all physical items in the system.','Sales minus sold cost and damage loss.'][i]||'Live dashboard metric.'));});
    try{if(typeof chart!=='undefined'&&chart?.updateOptions){const y=new Date().getFullYear(),monthly=Array(12).fill(0);delivered.forEach(o=>{const d=new Date(o.deliveredAt||o.createdAt||0);if(d.getFullYear()===y)monthly[d.getMonth()]+=Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0));});chart.updateOptions({series:[{name:'Sales',data:monthly}],xaxis:{categories:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']}});}}
    catch(err){console.warn('Dart sales chart update skipped:',err);}renderBirthdayWidget();renderTopClients();dartCheckStockAlerts();
}

function setupModelModal(){
    const modal=document.getElementById('model-modal'),form=document.getElementById('model-form');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';form.dataset.dartV2='1';const cost=document.getElementById('modal-cost'),selling=document.getElementById('modal-selling'),disc=document.getElementById('modal-discount'),final=document.getElementById('modal-final-price');const calc=()=>{const s=Number(selling.value)||0,d=Math.min(100,Math.max(0,Number(disc.value)||0)),v=s-s*d/100;final.textContent=dartMoney(v);return v;};cost?.addEventListener('input',()=>{if(Number(cost.value)>=0)selling.value=(Number(cost.value)*1.5).toFixed(2);calc();});selling?.addEventListener('input',calc);disc?.addEventListener('input',calc);document.querySelector('#models .add-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-edit-id').value='';calc();openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-edit-id').value,p={modelId:document.getElementById('modal-id').value.trim(),name:document.getElementById('modal-name').value,category:document.getElementById('modal-category').value,description:document.getElementById('modal-description').value,cost:Number(cost.value)||0,selling:Number(selling.value)||0,discount:Number(disc.value)||0,discountedPrice:calc(),status:'Active'};if(modelsData.some(m=>m.modelId===p.modelId&&String(m.id)!==String(id))){alert('Model ID يجب أن يكون فريدًا.');return;}if(id){const m=modelsData.find(x=>String(x.id)===String(id)),old={...m};Object.assign(m,p);dartAudit('EDIT','models',m.id,old,p,`Model updated: ${Object.keys(p).filter(k=>String(old[k])!==String(p[k])).join(', ')||'no field changes'}`);}else{const m={id:dartUid('MDB'),date:new Date().toLocaleDateString('en-GB'),isArchived:false,isDeleted:false,isChecked:false,...p};modelsData.push(m);dartAudit('CREATE','models',m.id,{},m,'Model created');}dartSaveAll();dartRefreshAll();closeModal(modal);});
}

function setupCustomerModal(){const modal=document.getElementById('customerModal'),form=document.getElementById('customerForm');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';form.dataset.dartV2='1';document.getElementById('openCustomerModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-customer-edit-id').value='';document.getElementById('custCountry').value='Egypt';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-customer-edit-id').value,p={clientName:document.getElementById('custName').value,birthday:document.getElementById('custBirthday').value||'-',phone1:document.getElementById('custPhone1').value,phone2:document.getElementById('custPhone2').value||'-',email:document.getElementById('custEmail').value||'',country:document.getElementById('custCountry').value||'Egypt',governorate:document.getElementById('custGovernorate').value||''};if(id){const x=customersData.find(c=>String(c.id)===String(id)),old={...x};Object.assign(x,p);dartAudit('EDIT','customers',x.id,old,p);}else{const x={id:dartUid('CDB'),clientId:dartNextBusinessCode('DA',customersData,'clientId'),dartCard:'no',isArchived:false,isDeleted:false,isChecked:false,registeredAt:dartNowISO(),...p};customersData.push(x);dartAudit('CREATE','customers',x.id,{},x);}dartSaveAll();dartRefreshAll();closeModal(modal);});}
function setupRepresentativeModal(){const modal=document.getElementById('representative-modal'),form=document.getElementById('rep-form');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';form.dataset.dartV2='1';document.getElementById('openRepModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-rep-id').value='';const field=document.getElementById('modal-representative-id');if(field)field.value=dartNextBusinessCode('Rep',representativeData,'repId');openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-rep-id').value,p={name:document.getElementById('modal-representative-name').value,repId:id?(document.getElementById('modal-representative-id').value||''):dartNextBusinessCode('Rep',representativeData,'repId'),nationalId:document.getElementById('modal-representative-national-id').value,address:document.getElementById('modal-representative-address').value,phone1:document.getElementById('modal-rep-phone1').value,phone2:document.getElementById('modal-rep-phone2').value||'-',status:'Active'};if(representativeData.some(r=>r.repId===p.repId&&String(r.id)!==String(id))){alert('Rep ID مستخدم بالفعل.');return;}if(id){const x=representativeData.find(r=>String(r.id)===String(id)),old={...x};Object.assign(x,p);dartAudit('EDIT','representative',x.id,old,p);}else{const x={id:dartUid('RDB'),date:new Date().toLocaleDateString('en-GB'),isArchived:false,isDeleted:false,isChecked:false,...p};representativeData.push(x);dartAudit('CREATE','representative',x.id,{},x);}dartSaveAll();dartRefreshAll();closeModal(modal);});}
function setupReturnModal(){const modal=document.getElementById('return-modal'),form=document.getElementById('return-form');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';form.dataset.dartV2='1';document.getElementById('add-return-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-return-edit-id').value='';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-return-edit-id').value,code=document.getElementById('modal-return-item-code').value.trim(),it=dartFindItemByCode(code);if(!it){alert('Item Code غير موجود.');return;}const order=ordersData.find(o=>(o.items||[]).includes(code)&&o.status==='Delivered'),p={clientName:document.getElementById('modal-return-name').value||order?.clientName||'',clientId:order?.clientId||'',itemCode:code,modelId:document.getElementById('modal-return-model-id').value||it.modelId,phone1:document.getElementById('modal-return-phone1').value||order?.phone1||'',phone2:document.getElementById('modal-return-phone2').value||order?.phone2||'-',email:document.getElementById('modal-return-email').value||order?.email||'',reason:document.getElementById('modal-item-reason').value||'Other',status:document.getElementById('modal-item-condition').value||'Good',date:new Date().toLocaleDateString('en-GB'),orderId:order?.orderId||'',isPostDeliveryReturn:Boolean(order),refundAmount:Number(document.getElementById('modal-return-refund')?.value)||0,createdAt:dartNowISO()};if(id){const r=returnsData.find(x=>String(x.id)===String(id)),old={...r};Object.assign(r,p);dartAudit('EDIT','returns',r.id,old,p);}else{const r={id:dartUid('RETDB'),returnId:dartNextBusinessCode('R',returnsData,'returnId'),isArchived:false,isDeleted:false,isChecked:false,...p};returnsData.push(r);it.status='Return Inspection';dartAudit('CREATE','returns',r.id,{},r);dartNotify('return_created',`Return ${r.returnId}`,`${code} entered return inspection.`,'returns',r.id);}dartSaveAll();dartRefreshAll();closeModal(modal);});}
function setupReviewModal(){const modal=document.getElementById('customer-review-modal'),form=document.getElementById('customer-review-form');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';document.getElementById('openReviewModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-review-edit-id').value='';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-review-edit-id').value,name=document.getElementById('modal-cust-rev-name').value,client=customersData.find(c=>c.clientName===name)||null,p={clientName:name,clientId:client?.clientId||'',rating:document.getElementById('modal-cust-rating').value||'5',phone1:document.getElementById('modal-cust-rev-phone1').value||client?.phone1||'',review:document.getElementById('modal-cust-review').value||'',phone2:document.getElementById('modal-cust-rev-phone2').value||client?.phone2||'-',title:document.getElementById('modal-cust-title').value||'',email:document.getElementById('modal-cust-rev-email').value||client?.email||'',status:document.getElementById('modal-cust-status').value||'Active'};if(id){const r=reviewsData.find(x=>String(x.id)===String(id)),old={...r};Object.assign(r,p);dartAudit('EDIT','review',r.id,old,p);}else{const r={id:dartUid('REVDB'),createdAt:dartNowISO(),date:new Date().toLocaleString(),isArchived:false,isDeleted:false,isChecked:false,...p};reviewsData.push(r);dartAudit('CREATE','review',r.id,{},r);}dartSaveAll();dartRefreshAll();closeModal(modal);});}

function openEditModal(id,sectionKey){const info=sectionsMap[sectionKey],x=info?.data.find(v=>String(v.id)===String(id));if(!x)return;if(sectionKey==='review'){document.getElementById('modal-review-edit-id').value=x.id;document.getElementById('modal-cust-rev-name').value=x.clientName||'';document.getElementById('modal-cust-rating').value=x.rating||'5';document.getElementById('modal-cust-rev-phone1').value=x.phone1||'';document.getElementById('modal-cust-review').value=x.review||'';document.getElementById('modal-cust-rev-phone2').value=x.phone2||'';document.getElementById('modal-cust-title').value=x.title||'';document.getElementById('modal-cust-rev-email').value=x.email||'';document.getElementById('modal-cust-status').value=x.status||'Active';openModal(document.getElementById('customer-review-modal'));return;}if(sectionKey==='models'){document.getElementById('modal-edit-id').value=x.id;document.getElementById('modal-id').value=x.modelId||'';document.getElementById('modal-name').value=x.name||'';document.getElementById('modal-category').value=x.category||'';document.getElementById('modal-description').value=x.description||'';document.getElementById('modal-cost').value=x.cost||0;document.getElementById('modal-selling').value=x.selling||0;document.getElementById('modal-discount').value=x.discount||0;document.getElementById('modal-final-price').textContent=dartMoney(x.discountedPrice??x.selling);openModal(document.getElementById('model-modal'));return;}if(sectionKey==='items'){document.getElementById('modal-item-add-edit-id').value=x.id;document.getElementById('modal-item-model-id').value=x.modelId||'';document.getElementById('modal-item-code-pic').value=x.itemCode||'';document.getElementById('modal-item-color').value=x.color||'';document.getElementById('modal-item-size').value=x.size||'';openModal(document.getElementById('item-add-modal'));return;}if(sectionKey==='customers'){document.getElementById('modal-customer-edit-id').value=x.id;document.getElementById('custName').value=x.clientName||'';document.getElementById('custBirthday').value=x.birthday||'';document.getElementById('custPhone1').value=x.phone1||'';document.getElementById('custPhone2').value=x.phone2||'';document.getElementById('custEmail').value=x.email||'';document.getElementById('custCountry').value=x.country||'Egypt';document.getElementById('custGovernorate').value=x.governorate||'Cairo';openModal(document.getElementById('customerModal'));return;}if(sectionKey==='returns'){document.getElementById('modal-return-edit-id').value=x.id;document.getElementById('modal-return-name').value=x.clientName||'';document.getElementById('modal-return-item-code').value=x.itemCode||'';document.getElementById('modal-return-phone1').value=x.phone1||'';document.getElementById('modal-return-model-id').value=x.modelId||'';document.getElementById('modal-return-phone2').value=x.phone2||'';document.getElementById('modal-return-email').value=x.email||'';document.getElementById('modal-item-condition').value=['Good','Bad'].includes(x.status)?x.status:'Good';document.getElementById('modal-item-reason').value=x.reason||'سبب آخر';if(document.getElementById('modal-return-refund'))document.getElementById('modal-return-refund').value=x.refundAmount||0;openModal(document.getElementById('return-modal'));return;}if(sectionKey==='representative'){document.getElementById('modal-rep-id').value=x.id;document.getElementById('modal-representative-name').value=x.name||'';document.getElementById('modal-representative-id').value=x.repId||'';document.getElementById('modal-representative-national-id').value=x.nationalId||'';document.getElementById('modal-representative-address').value=x.address||'';document.getElementById('modal-rep-phone1').value=x.phone1||'';document.getElementById('modal-rep-phone2').value=x.phone2||'';openModal(document.getElementById('representative-modal'));return;}if(sectionKey==='orders'){document.getElementById('modal-order-edit-id').value=x.id;document.getElementById('clientName').value=x.clientName||'';document.getElementById('clientId').value=x.clientId||'';document.getElementById('phone1').value=x.phone1||'';document.getElementById('phone2').value=x.phone2||'';document.getElementById('email').value=x.email||'';document.getElementById('paymentMethod').value=x.paymentMethod||'';document.getElementById('paymentStatus').value=x.paymentStatus||'Unpaid';document.getElementById('amountPaid').value=x.amountPaid||0;document.getElementById('amountRefunded').value=x.amountRefunded||0;document.getElementById('orderSource').value=x.orderSource||'Manual';document.getElementById('deliveryNotes').value=x.deliveryNotes||'';document.getElementById('orderCountry').value=x.country||'';document.getElementById('governorate').value=x.governorate||'';document.getElementById('orderArea').value=x.area||'';document.getElementById('orderStreetName').value=x.street||'';document.getElementById('orderBuildingNumber').value=x.building||'';document.getElementById('orderFloor').value=x.floor||'';document.getElementById('deductions').value=x.discount||0;window.loadOrderItemsForEdit?.(x.items||[]);openModal(document.getElementById('orderModal'));return;}if(sectionKey==='damage'){document.getElementById('damage-edit-id').value=x.id;document.getElementById('damage-item-code').value=x.itemCode||'';document.getElementById('damage-reason').value=x.reason||'';document.getElementById('damage-notes').value=x.notes||'';document.getElementById('damage-status').value=x.status||'Damaged';openModal(document.getElementById('damage-modal'));}}

function setupAllDelegatedEvents(){const map={models:'models-container',items:'items-container',customers:'customers-container',orders:'orders-container',returns:'returns-container',review:'review-container',representative:'representative-container',card:'card-container',damage:'damage-container'};Object.entries(map).forEach(([k,id])=>setupSectionEvents(id,sectionsMap[k]?.data,sectionsMap[k]?.render,k));const orders=document.getElementById('orders-container');if(orders&&!orders.dataset.dartV3Back){orders.dataset.dartV3Back='1';orders.addEventListener('click',e=>{const b=e.target.closest('.dart-back-btn');if(!b)return;const id=b.closest('.model-row')?.dataset.id,o=ordersData.find(x=>String(x.id)===String(id));if(o)dartRollbackOrderOneStep(o);});}const items=document.getElementById('items-container');if(items&&!items.dataset.dartV3Img){items.dataset.dartV3Img='1';items.addEventListener('click',e=>{const img=e.target.closest('.dart-item-thumb');if(!img)return;document.getElementById('full-item-image').src=img.dataset.fullImage;openModal(document.getElementById('image-preview-modal'));});}const reviews=document.getElementById('review-container');if(reviews&&!reviews.dataset.dartV3Toggle){reviews.dataset.dartV3Toggle='1';reviews.addEventListener('click',e=>{const btn=e.target.closest('.btn-toggle-review');if(!btn)return;const id=btn.closest('.model-row')?.dataset.id,r=reviewsData.find(x=>String(x.id)===String(id));if(!r)return;const old=r.status;r.status=old==='Active'?'Hidden':'Active';dartAudit('REVIEW_VISIBILITY','review',r.id,{status:old},{status:r.status});dartSaveAll();dartRenderSection('review');});}}

function setupOrderModal(){
    const modal=document.getElementById('orderModal'),form=document.getElementById('orderForm');if(!form||form.dataset.dartV3)return;form.dataset.dartV3='1';form.dataset.dartV2='1';let selected=[];const list=document.getElementById('selectedProductsList'),codeInput=document.getElementById('productsInputCode');function renderSel(){if(list)list.innerHTML=selected.map((code,i)=>`<span class="order-item-chip"><b>${dartEsc(code)}</b><button type="button" class="remove-item-btn" data-index="${i}">&times;</button></span>`).join('');calc();}function calc(){const snap=dartPriceSnapshotForCodes(selected),subtotal=snap.reduce((a,l)=>a+l.finalUnitPrice,0),pct=Number(document.getElementById('deductions')?.value)||0,total=Math.max(0,subtotal-subtotal*pct/100);document.getElementById('subtotalVal').textContent=dartMoney(subtotal);document.getElementById('discountVal').textContent=dartMoney(subtotal-total);document.getElementById('totalVal').textContent=dartMoney(total);return{subtotal,pct,total,snap};}function populate(){const dl=document.getElementById('items-datalist');if(dl)dl.innerHTML=itemsData.filter(i=>dartIsActive(i)&&String(i.status).toLowerCase()==='in stock').map(i=>`<option value="${dartEsc(i.itemCode)}">${dartEsc(i.modelId)} - ${dartEsc(i.color)} (${dartEsc(i.size)})</option>`).join('');populateModelsDatalist();}document.getElementById('openModalBtn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-order-edit-id').value='';selected=[];populate();renderSel();openModal(modal);});document.getElementById('addProductBtn')?.addEventListener('click',()=>{const code=codeInput.value.trim(),it=dartFindItemByCode(code);if(!it||dartIsArchived(it)||String(it.status).toLowerCase()!=='in stock'){alert('القطعة غير متاحة.');return;}if(!selected.includes(code))selected.push(code);codeInput.value='';renderSel();});document.getElementById('autoAllocateProductBtn')?.addEventListener('click',()=>{const r=dartAutoAllocate(document.getElementById('orderModelCode').value.trim(),document.getElementById('orderItemColor').value.trim(),document.getElementById('orderItemSize').value.trim(),Math.max(1,Number(document.getElementById('orderItemQty').value)||1),selected);if(!r.ok){alert(r.message);return;}selected.push(...r.codes);renderSel();});list?.addEventListener('click',e=>{if(!e.target.classList.contains('remove-item-btn'))return;selected.splice(Number(e.target.dataset.index),1);renderSel();});document.getElementById('deductions')?.addEventListener('input',calc);window.loadOrderItemsForEdit=codes=>{selected=[...(codes||[])];populate();renderSel();};form.addEventListener('submit',e=>{e.preventDefault();if(!selected.length){alert('أضف قطعة واحدة على الأقل.');return;}const editId=document.getElementById('modal-order-edit-id').value,existing=ordersData.find(o=>String(o.id)===String(editId)),prices=calc(),selectedClientId=document.getElementById('clientId').value||'-',selectedClient=dartFindCustomerByCode(selectedClientId);if(selectedClient&&dartIsArchived(selectedClient)){alert('لا يمكن استخدام عميل مشطوب.');return;}const payload={clientId:selectedClientId,clientName:document.getElementById('clientName').value,phone1:document.getElementById('phone1').value,phone2:document.getElementById('phone2').value||'-',email:document.getElementById('email').value||'-',paymentMethod:document.getElementById('paymentMethod').value||'Cash on Delivery',paymentStatus:document.getElementById('paymentStatus').value||'Unpaid',amountPaid:Number(document.getElementById('amountPaid').value)||0,amountRefunded:Number(document.getElementById('amountRefunded').value)||0,orderSource:document.getElementById('orderSource').value||'Manual',deliveryNotes:document.getElementById('deliveryNotes').value||'',items:[...selected],totalProducts:selected.length,totalPrice:prices.subtotal,discount:prices.pct,reasonDeduction:prices.pct?'Order discount':'-',country:document.getElementById('orderCountry').value||'Egypt',governorate:document.getElementById('governorate').value||'',area:document.getElementById('orderArea').value||'',street:document.getElementById('orderStreetName').value||'',building:document.getElementById('orderBuildingNumber').value||'',floor:document.getElementById('orderFloor').value||''};if(existing){const oldCodes=[...(existing.items||[])],newCodes=selected.filter(c=>!oldCodes.includes(c)),check=dartReserveItems(existing,newCodes);if(!check.ok){alert(check.message);return;}oldCodes.filter(c=>!selected.includes(c)).forEach(c=>{const it=dartFindItemByCode(c);if(it&&it.status==='Processing/Held'){it.status='In stock';it.orderId='';}});const old={...existing};Object.assign(existing,payload);existing.priceSnapshot=dartPriceSnapshotForCodes(selected);dartAudit('EDIT','orders',existing.id,old,payload);dartLogOrder(existing,'ORDER_EDITED',existing.status,existing.status,{notes:'Order details edited'});}else{const order={id:dartUid('ODB'),orderId:dartNextBusinessCode('K',ordersData,'orderId'),date:new Date().toLocaleDateString('en-GB'),time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),status:'New',createdAt:dartNowISO(),orderCreatedAt:dartNowISO(),activityLog:[],isArchived:false,isDeleted:false,isChecked:false,...payload};const r=dartReserveItems(order,selected);if(!r.ok){alert(r.message);return;}order.priceSnapshot=dartPriceSnapshotForCodes(selected);dartLogOrder(order,'ORDER_CREATED',null,'New');ordersData.push(order);dartAudit('CREATE','orders',order.id,{},order);dartNotify('new_order',`New order ${order.orderId}`,`${order.clientName} — ${selected.length} item(s)`,'orders',order.id);}dartSaveAll();dartRefreshAll();closeModal(modal);form.reset();selected=[];renderSel();});
}

function setupSearchFilter(){document.querySelectorAll('.dashboard-section').forEach(sec=>{const key=sec.id;if(!sectionsMap[key])return;dartFilterState[key]=dartFilterState[key]||{archive:'active'};const search=sec.querySelector('.search-box input,.search-bar input');if(search&&!search.dataset.dartBound){search.dataset.dartBound='1';search.addEventListener('input',()=>{dartFilterState[key].search=search.value.toLowerCase().trim();dartRenderSection(key);});}const selects=[...sec.querySelectorAll('.filter-bar select')],maps={models:['category','status','priceRange'],items:['category','status','sizeProfile','size','color'],customers:['monthlyOrders','dartCard','birthday'],orders:['date','status','totalPrice'],returns:['reason','status'],review:['rating','status'],representative:['status'],card:['status'],damage:['status','archive']};(maps[key]||[]).forEach((f,i)=>{if(selects[i]&&!selects[i].dataset.filterKey)selects[i].dataset.filterKey=f;});if(!selects.some(s=>s.dataset.filterKey==='archive')&&!['brand'].includes(key)){const wrap=document.createElement('div');wrap.className='select-box';wrap.innerHTML='<select data-filter-key="archive"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select><i class="bx bx-chevron-down arrow-icon"></i>';sec.querySelector('.filter-bar')?.insertBefore(wrap,sec.querySelector('.filter-bar .add-btn'));}sec.querySelectorAll('.filter-bar select').forEach(sel=>{if(sel.dataset.dartBound)return;sel.dataset.dartBound='1';sel.addEventListener('change',()=>{const f=sel.dataset.filterKey;if(f)dartFilterState[key][f]=sel.value;if(key==='items'&&f==='sizeProfile')dartPopulateItemSizeFilter(sel.value);dartRenderSection(key);});});});dartPopulateItemSizeFilter(document.getElementById('item-size-profile-filter')?.value||'all');}
function dartPopulateItemSizeFilter(profile){const sel=document.getElementById('item-size-filter');if(!sel)return;const sizes=profile==='pants'?DART_PANTS_SIZES:profile==='tops'?DART_TOP_SIZES:[...new Set([...DART_PANTS_SIZES,...DART_TOP_SIZES,...itemsData.map(i=>String(i.size||'')).filter(Boolean)])];const old=sel.value;sel.innerHTML='<option value="all">All Sizes</option>'+sizes.map(s=>`<option value="${dartEsc(s)}">${dartEsc(s)}</option>`).join('');if([...sel.options].some(o=>o.value===old))sel.value=old;}

// Enhance Audit History to show what changed, not only the action name.
function dartShowAuditFor(type,id){const body=document.getElementById('history-modal-body');document.getElementById('history-modal-title').textContent=`Audit History — ${type}`;const rows=auditData.filter(a=>a.entityType===type&&String(a.entityId)===String(id));body.innerHTML=`<div class="dart-timeline">${rows.map(a=>{const keys=[...new Set([...Object.keys(a.oldValues||{}),...Object.keys(a.newValues||{})])].filter(k=>JSON.stringify(a.oldValues?.[k])!==JSON.stringify(a.newValues?.[k]));const changes=keys.map(k=>`<div><b>${dartEsc(k)}:</b> ${dartEsc(a.oldValues?.[k]??'-')} → ${dartEsc(a.newValues?.[k]??'-')}</div>`).join('');return`<div class="dart-timeline-item"><b>${dartEsc(a.action)}</b>${changes||`<div>${dartEsc(a.note||'No field details')}</div>`}<small>${dartEsc(new Date(a.timestamp).toLocaleString())}</small></div>`;}).join('')||'<div class="dart-empty-state">No audit entries yet</div>'}</div>`;openModal(document.getElementById('history-modal'));}

// V3 UI-only binding that does not depend on backend connectivity.
document.addEventListener('DOMContentLoaded',()=>{
    document.addEventListener('click',e=>{const b=e.target.closest('.dart-info-btn');if(!b)return;alert(`${b.dataset.infoTitle}\n\n${b.dataset.infoText}`);});
    renderBirthdayWidget();renderTopClients();renderNotifications();updateBrandAnalytics();
});

// Final V3 precision overrides.
function dartModelDerived(model){
    const allRelated=itemsData.filter(i=>String(i.modelId)===String(model.modelId));
    const activeRelated=allRelated.filter(dartIsActive);
    const available=activeRelated.filter(i=>String(i.status).toLowerCase()==='in stock');
    const sold=allRelated.filter(i=>String(i.status).toLowerCase()==='sold');
    const damaged=allRelated.filter(i=>['Damaged','Destroyed'].includes(i.status));
    return {count:available.length,total:allRelated.length,sold:sold.length,damaged:damaged.length,colors:[...new Set(activeRelated.map(i=>i.color).filter(Boolean))],sizes:[...new Set(activeRelated.map(i=>i.size).filter(Boolean))],img:activeRelated.find(i=>i.img)?.img||allRelated.find(i=>i.img)?.img||model.img||''};
}
function dartSparkline(values){const vals=values.map(Number),max=Math.max(1,...vals),w=120,h=28,pts=vals.map((v,i)=>`${(i/(Math.max(1,vals.length-1))*w).toFixed(1)},${(h-(v/max)*(h-4)-2).toFixed(1)}`).join(' ');return `<svg class="dart-mini-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;}
function dartLastSixMonthSeries(metric){const now=new Date(),months=[];for(let back=5;back>=0;back--){const d=new Date(now.getFullYear(),now.getMonth()-back,1),y=d.getFullYear(),m=d.getMonth(),os=ordersData.filter(o=>o.status==='Delivered').filter(o=>{const x=new Date(o.deliveredAt||o.createdAt||0);return x.getFullYear()===y&&x.getMonth()===m;});if(metric==='sales')months.push(os.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0));else if(metric==='aov')months.push(os.length?os.reduce((a,o)=>a+Math.max(0,dartOrderNet(o)-(Number(o.amountRefunded)||0)),0)/os.length:0);else{const ds=damageData.filter(x=>{const q=new Date(x.createdAt||dartDateValue(x.date)||0);return q.getFullYear()===y&&q.getMonth()===m&&['Damaged','Destroyed'].includes(x.status);});months.push(ds.reduce((a,x)=>{const it=dartFindItemByCode(x.itemCode),model=dartFindModelByCode(it?.modelId||x.modelId);return a+(Number(model?.cost)||0);},0));}}return months;}
const dartUpdateBrandAnalyticsBase=updateBrandAnalytics;
updateBrandAnalytics=function(){
    dartUpdateBrandAnalyticsBase();
    const ratingCard=document.querySelectorAll('#brand .card-inf-2')[2];if(ratingCard){const activeReviews=reviewsData.filter(r=>r.status==='Active'),avg=activeReviews.length?activeReviews.reduce((a,r)=>a+(Number(r.rating)||0),0)/activeReviews.length:0;const n=ratingCard.querySelector('.numebr');if(n)n.textContent=avg.toFixed(1);}
    const grid=document.getElementById('dart-analytics-grid');if(grid){const cards=[...grid.querySelectorAll('.dart-analytics-card')];const byTitle=t=>cards.find(c=>c.querySelector('h6')?.textContent===t);[['In Stock Selling Value','sales'],['Damage Loss','damage'],['AOV','aov']].forEach(([title,metric])=>{const c=byTitle(title);if(c&&!c.querySelector('.dart-mini-chart'))c.insertAdjacentHTML('beforeend',dartSparkline(dartLastSixMonthSeries(metric)));});}
};

// Permanent monotonic counters: a business ID is never reused even after hard delete.
function dartNextBusinessCode(prefix,data,field){
    const key=`dart_counter_${String(prefix).toLowerCase()}`;
    const re=new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}-(\\d+)$`,'i');
    let stored=Number(localStorage.getItem(key))||0,existing=0;
    (data||[]).forEach(x=>{const m=String(x?.[field]||'').match(re);if(m)existing=Math.max(existing,Number(m[1])||0);});
    const next=Math.max(stored,existing)+1;localStorage.setItem(key,String(next));return `${prefix}-${next}`;
}

function dartCreateInspectionReturns(order,reason='Refused delivery'){
    (order.items||[]).forEach(code=>{const it=dartFindItemByCode(code);if(!it)return;it.status='Return Inspection';const exists=returnsData.some(r=>r.orderId===order.orderId&&r.itemCode===code&&!r.isPostDeliveryReturn);if(!exists)returnsData.push({id:dartUid('RETDB'),returnId:dartNextBusinessCode('R',returnsData,'returnId'),modelId:it.modelId,itemCode:code,status:'Pending Inspection',date:new Date().toLocaleDateString('en-GB'),createdAt:dartNowISO(),clientName:order.clientName,clientId:order.clientId,phone1:order.phone1,phone2:order.phone2,email:order.email,reason,orderId:order.orderId,isPostDeliveryReturn:false,isArchived:false,isDeleted:false,isChecked:false});});
}

function setupReturnModal(){const modal=document.getElementById('return-modal'),form=document.getElementById('return-form');if(!form||form.dataset.dartV3Final)return;form.dataset.dartV3Final='1';form.dataset.dartV3='1';form.dataset.dartV2='1';document.getElementById('add-return-btn')?.addEventListener('click',()=>{form.reset();document.getElementById('modal-return-edit-id').value='';openModal(modal);});form.addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('modal-return-edit-id').value,code=document.getElementById('modal-return-item-code').value.trim(),it=dartFindItemByCode(code);if(!it){alert('Item Code غير موجود.');return;}const order=ordersData.find(o=>(o.items||[]).includes(code)&&o.status==='Delivered'),condition=document.getElementById('modal-item-condition').value||'Good',p={clientName:document.getElementById('modal-return-name').value||order?.clientName||'',clientId:order?.clientId||'',itemCode:code,modelId:document.getElementById('modal-return-model-id').value||it.modelId,phone1:document.getElementById('modal-return-phone1').value||order?.phone1||'',phone2:document.getElementById('modal-return-phone2').value||order?.phone2||'-',email:document.getElementById('modal-return-email').value||order?.email||'',reason:document.getElementById('modal-item-reason').value||'Other',status:condition,date:new Date().toLocaleDateString('en-GB'),orderId:order?.orderId||'',isPostDeliveryReturn:Boolean(order),refundAmount:Number(document.getElementById('modal-return-refund')?.value)||0,createdAt:dartNowISO()};let r;if(id){r=returnsData.find(x=>String(x.id)===String(id));const old={...r};Object.assign(r,p);dartAudit('EDIT','returns',r.id,old,p);}else{r={id:dartUid('RETDB'),returnId:dartNextBusinessCode('R',returnsData,'returnId'),isArchived:false,isDeleted:false,isChecked:false,...p};returnsData.push(r);dartAudit('CREATE','returns',r.id,{},r);dartNotify('return_created',`Return ${r.returnId}`,`${code} returned as ${condition}.`,'returns',r.id);}if(condition==='Good'){it.status='In stock';it.orderId='';it.clientId='';it.clientName='';it.purchaseDate='';}else if(condition==='Bad'){it.status='Damaged';if(!damageData.some(d=>d.itemCode===it.itemCode&&d.status==='Damaged'))damageData.push({id:dartUid('DMGDB'),damageId:dartUid('DMG'),itemCode:it.itemCode,modelId:it.modelId,img:it.img||'',color:it.color,size:it.size,status:'Damaged',reason:r.reason||'Returned Bad',notes:'',date:new Date().toLocaleDateString('en-GB'),createdAt:dartNowISO(),orderId:r.orderId||'',clientId:r.clientId||'',clientName:r.clientName||'',returnId:r.returnId,isArchived:false,isDeleted:false,isChecked:false});}if(order&&p.refundAmount>0){order.amountRefunded=(Number(order.amountRefunded)||0)+p.refundAmount;order.refundedAt=dartNowISO();order.paymentStatus=order.amountRefunded>=dartOrderNet(order)?'Refunded':'Partially Refunded';dartLogOrder(order,'REFUND_RECORDED',order.status,order.status,{notes:`Refund ${p.refundAmount} EGP for ${code}`});}dartSaveAll();dartRefreshAll();closeModal(modal);});}

// Friendly mapping for the existing Return reason filter values to Arabic stored reasons.
const dartApplyFiltersV3Base=dartApplyFilters;
dartApplyFilters=function(key,data){let out=dartApplyFiltersV3Base(key,data);if(key==='returns'){const state=dartFilterState.returns||{},v=state.reason;if(v&&v!=='all'){const map={wrong_size:['مقاس','size'],defective:['عيب','تلف','defect'],not_as_described:['صورة','وصف','different'],wrong_item:['مختلف','wrong'],quality_issue:['خامة','quality'],changed_mind:['رأي','بحاجة','mind'],missing_parts:['نقص','missing'],other:['آخر','other']},terms=map[v]||[String(v).replaceAll('_',' ')];out=[...(data||[])].filter(r=>terms.some(t=>String(r.reason||'').toLowerCase().includes(String(t).toLowerCase())));const st=dartFilterState.returns;if(st.search)out=out.filter(x=>dartSectionSearchText(x).includes(st.search));if(st.archive==='active')out=out.filter(dartIsActive);else if(st.archive==='archived')out=out.filter(dartIsArchived);if(st.status&&st.status!=='all')out=out.filter(r=>String(r.status).toLowerCase()===String(st.status).toLowerCase());out.sort((a,b)=>new Date(b.createdAt||dartDateValue(b.date)||0)-new Date(a.createdAt||dartDateValue(a.date)||0));}}return out;};
// Final finance interpretation: damaged/destroyed physical items are financial loss, not Total Cost.
function dartTotalInventoryCost(){return itemsData.filter(i=>!['Damaged','Destroyed'].includes(i.status)).reduce((a,i)=>{const m=dartFindModelByCode(i.modelId);return a+(Number(m?.cost)||0);},0);}
// Ensure migrated sequences reserve their highest number and migrate review references too.
const dartMigrateSequentialIdsPrevious=dartMigrateSequentialIds;
dartMigrateSequentialIds=function(){
    if(localStorage.getItem(DART_V3_ID_MIGRATION_KEY)==='1')return;
    const oldClients=customersData.map(c=>String(c.clientId||''));
    dartMigrateSequentialIdsPrevious();
    const clientMap=new Map(oldClients.map((old,i)=>[old,customersData[i]?.clientId]));
    reviewsData.forEach(r=>{if(clientMap.has(String(r.clientId)))r.clientId=clientMap.get(String(r.clientId));});
    const max=(arr,field,prefix)=>arr.reduce((m,x)=>{const q=String(x?.[field]||'').match(new RegExp(`^${prefix}-(\\d+)$`,'i'));return Math.max(m,q?Number(q[1]):0);},0);
    localStorage.setItem('dart_counter_k',String(max(ordersData,'orderId','K')));
    localStorage.setItem('dart_counter_da',String(max(customersData,'clientId','DA')));
    localStorage.setItem('dart_counter_r',String(max(returnsData,'returnId','R')));
    localStorage.setItem('dart_counter_rep',String(max(representativeData,'repId','Rep')));
    dartSaveAll();
};
