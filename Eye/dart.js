// ==========================================
// 1. تشغيل التطبيق والأحداث العامة (DOMContentLoaded & Navigation)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadAllDataFromStorage();

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

    renderAllSections();
    setupAllDelegatedEvents();
    setupHeaderBatchActions();
    setupSearchFilter();
    setupModelModal();
    setupItemModal();
    setupOrderModal();
    setupCustomerModal();
    setupCardModal();
});

// ==========================================
// 2. البيانات الأوليّة (Initial Data & Mappings)
// ==========================================
let modelsData = [
    { id: "1", modelId: "DA-Jen121", name: "Wide-leg", category: "pants", description: "بنطلون جينز اسباني", number: "24", cost: "490", selling: "690", discount: "0", discountedPrice: "690", colors: "ابيض, اسود", sizes: "32 34 36", status: "Active", date: "18-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

let itemsData = [
    { id: "1", modelId: "DA-Jen121", itemCode: "IT-992", color: "اسود", size: "34", status: "In stock", regDate: "18-10-2026", orderId: "ORD-200", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", purchaseDate: "20-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

let customersData = [
    { id: "1", birthday: "15-09-2005", clientName: "أحمد محمود", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "ahmed@mail.com", country: "مصر", governorate: "القاهرة", monthlyOrders: "3", totalOrders: "12", totalAmount: "4500 EGP", dartCard: "yes", isDeleted: false, isChecked: false }
];

let ordersData = [
    { id: "1", orderId: "ORD-200", date: "18-10-2026", time: "02:30 PM", clientId: "C-101", clientName: "محمد علي", phone1: "0100000000", phone2: "0110000000", email: "user@mail.com", status: "Pending", totalProducts: 3, items: ["IT-992", "IT-993", "IT-994"], totalPrice: 1000, discount: 10, reasonDeduction: "خصم لفترة محدودة", paymentMethod: "Vodafone Cash", deliveryNotes: "الاتصال قبل الوصول", country: "مصر", governorate: "القاهرة", area: "حدائق القبة", street: "شارع بورسعيد", building: "عمارة 15", floor: "3", isDeleted: false, isChecked: false }
];

const orderStatuses = [
    { key: "Pending", label: "Pending", bg: "#fff3cd", color: "#856404", border: "#ffeeba" },
    { key: "Accepted", label: "Accepted", bg: "#cce5ff", color: "#004085", border: "#b8daff" },
    { key: "Out for Delivery", label: "Out for Delivery", bg: "#e2e3e5", color: "#383d41", border: "#d6d8db" },
    { key: "Delivered", label: "Delivered", bg: "#d4edda", color: "#155724", border: "#c3e6cb" }
];

let returnsData = [
    { id: "1", returnId: "R-501", modelId: "DA-Jen121", itemCode: "IT-992", status: "Good", date: "10-08-2026", clientName: "ياسر إبراهيم", clientId: "C-201", phone1: "0101111222", phone2: "-", email: "yasser@mail.com", reason: "المقاس صغير", orderId: "ORD-200", isDeleted: false, isChecked: false }
];

let reviewsData = [
    { id: "1", date: "12-08-2026", clientName: "محمد علي", clientId: "C-101", status: "Active", rating: "5", title: "جودة ممتازة", review: "الخامة مريحة جدا", phone1: "0100000000", phone2: "-", email: "user@mail.com", isDeleted: false, isChecked: false }
];

let cardsData = [
    { id: "1", cardId: "CRD-10", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", status: "Active", issueDate: "01-01-2026", expDate: "01-01-2027", purchasedItems: "15", purchasedLimit: "20", requestedProducts: ["IT-01", "IT-02"], isDeleted: false, isChecked: false }
];

const sectionsMap = {
    'models': { get data() { return modelsData; }, set data(v) { modelsData = v; }, render: renderModels, storageKey: 'dart_models' },
    'items': { get data() { return itemsData; }, set data(v) { itemsData = v; }, render: renderItems, storageKey: 'dart_items' },
    'customers': { get data() { return customersData; }, set data(v) { customersData = v; }, render: renderCustomers, storageKey: 'dart_customers' },
    'orders': { get data() { return ordersData; }, set data(v) { ordersData = v; }, render: renderOrders, storageKey: 'dart_orders' },
    'returns': { get data() { return returnsData; }, set data(v) { returnsData = v; }, render: renderReturns, storageKey: 'dart_returns' },
    'review': { get data() { return reviewsData; }, set data(v) { reviewsData = v; }, render: renderReviews, storageKey: 'dart_reviews' },
    'card': { get data() { return cardsData; }, set data(v) { cardsData = v; }, render: renderCards, storageKey: 'dart_cards' }
};

// ==========================================
// 3. دوال التخزين المحلي (LocalStorage Helpers)
// ==========================================
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

// ==========================================
// 4. دوال العرض والـ Rendering للسكاشن
// ==========================================
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
                <div class="w100"><img src="${item.img}" alt="item" class="product-img model-img"></div>
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
                <span class="text-item w150">${item.birthday}</span>
                <span class="text-item w150">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item w200">${item.email}</span>
                <span class="text-item w150">${item.country}</span>
                <span class="text-item w200">${item.governorate}</span>
                <span class="text-item w150">${item.monthlyOrders}</span>
                <span class="text-item w150">${item.totalOrders}</span>
                <span class="text-item w300">${item.totalAmount}</span>
                <span class="text-item w200">${item.dartCard}</span>
            </div>
        `);
    });
}

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

// ==========================================
// 5. النوافذ المنبثقة (Modals Management)
// ==========================================
function setupModelModal() {
    const modal = document.getElementById('model-modal');
    const addBtn = document.querySelector('#models .add-btn, .btn-add-model');
    const closeBtn = modal ? modal.querySelector('.close-modal') : null;
    const form = document.getElementById('model-form');

    const costInput = document.getElementById('modal-cost');
    const sellingInput = document.getElementById('modal-selling');
    const discountInput = document.getElementById('modal-discount');
    const finalPriceDisplay = document.getElementById('modal-final-price');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            if (form) form.reset();
            const editId = document.getElementById('modal-edit-id');
            if (editId) editId.value = '';
            if (finalPriceDisplay) finalPriceDisplay.textContent = '0 EGP';
            modal.style.display = 'block';
            modal.classList.add('active');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.classList.remove('active');
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    });

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
                img: "https://images.unsplash.com/photo-1542272604-787c3835535d",
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
            modal.style.display = 'none';
            modal.classList.remove('active');
            form.reset();
        });
    }
}

function setupItemModal() {
    const modal = document.getElementById('item-add-modal');
    const addBtn = document.querySelector('#items .add-btn');
    const closeBtn = modal ? modal.querySelector('.close-modal') : null;
    const form = document.getElementById('item-add-form');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            if (form) form.reset();
            const editIdInput = document.getElementById('modal-item-add-edit-id');
            if (editIdInput) editIdInput.value = '';
            
            // تعبئة قائمة الـ datalist الخاصة بالموديلات تلقائياً في نافذة القطع
            const datalist = document.getElementById('models-list');
            if (datalist) {
                datalist.innerHTML = '';
                modelsData.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.modelId;
                    datalist.appendChild(opt);
                });
            }

            modal.style.display = 'block';
            modal.classList.add('active');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.classList.remove('active');
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-item-add-edit-id')?.value;

            const itemPayload = {
                modelId: document.getElementById('modal-item-model-id')?.value || '',
                itemCode: document.getElementById('modal-item-code-pic')?.value || '',
                color: document.getElementById('modal-item-color')?.value || '',
                size: document.getElementById('modal-item-size')?.value || '',
                status: 'In stock',
                regDate: new Date().toLocaleDateString('en-GB'),
                img: "https://images.unsplash.com/photo-1542272604-787c3835535d",
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = itemsData.findIndex(i => i.id === editId);
                if (index !== -1) itemsData[index] = { ...itemsData[index], ...itemPayload };
            } else {
                itemPayload.id = Date.now().toString();
                itemsData.push(itemPayload);
            }

            renderItems(itemsData);
            saveSectionState('items');
            modal.style.display = 'none';
            modal.classList.remove('active');
            form.reset();
        });
    }
}

function setupCustomerModal() {
    const modal = document.getElementById('customerModal');
    const addBtn = document.querySelector('#customers .add-btn, #openCustomerModalBtn');
    const closeBtn = modal ? modal.querySelector('.close-modal') : null;
    const form = document.getElementById('customerForm');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            if (form) form.reset();
            const editIdInput = document.getElementById('modal-customer-edit-id');
            if (editIdInput) editIdInput.value = '';
            modal.style.display = 'block';
            modal.classList.add('active');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.classList.remove('active');
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-customer-edit-id')?.value;

            const customerPayload = {
                clientName: document.getElementById('custName')?.value || '',
                birthday: document.getElementById('custBirthday')?.value || '',
                email: document.getElementById('custEmail')?.value || '',
                phone1: document.getElementById('custPhone1')?.value || '',
                phone2: document.getElementById('custPhone2')?.value || '-',
                country: document.getElementById('custCountry')?.value || 'مصر',
                governorate: document.getElementById('custGovernorate')?.value || 'القاهرة',
                clientId: 'C-' + Math.floor(Math.random() * 1000),
                monthlyOrders: '1',
                totalOrders: '1',
                totalAmount: '0 EGP',
                dartCard: 'yes',
                isDeleted: false,
                isChecked: false
            };

            if (editId) {
                const index = customersData.findIndex(c => c.id === editId);
                if (index !== -1) customersData[index] = { ...customersData[index], ...customerPayload };
            } else {
                customerPayload.id = Date.now().toString();
                customersData.push(customerPayload);
            }

            renderCustomers(customersData);
            saveSectionState('customers');
            modal.style.display = 'none';
            modal.classList.remove('active');
            form.reset();
        });
    }
}

function setupCardModal() {
    // كارت دارت
}

function setupOrderModal() {
    const modal = document.getElementById('orderModal');
    const openModalBtn = document.getElementById('openModalBtn') || document.getElementById('openOrderModalBtn');
    const closeModalBtn = modal ? modal.querySelector('.close-modal, #closeModalBtn') : null;
    const form = document.getElementById('orderForm');
    
    const phone1Input = document.getElementById('phone1');
    const clientNameInput = document.getElementById('clientName');
    const phone2Input = document.getElementById('phone2');
    const emailInput = document.getElementById('email');
    const govInput = document.getElementById('governorate');

    let currentSelectedItems = [];

    // ميزة الربط التلقائي للعملاء بمجرد كتابة رقم التليفون
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

    function populateItemsDatalist() {
        const datalist = document.getElementById('items-datalist');
        if (!datalist) return;
        datalist.innerHTML = '';
        if (typeof itemsData !== 'undefined' && Array.isArray(itemsData)) {
            itemsData.forEach(item => {
                if (!item.isDeleted && item.itemCode) {
                    const option = document.createElement('option');
                    option.value = item.itemCode;
                    option.textContent = `${item.itemCode} - ${item.color || ''} (${item.size || ''})`;
                    datalist.appendChild(option);
                }
            });
        }
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

        return { subtotal, totalDiscount, total };
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

    function setupItemsInputArea() {
        const productInputElem = document.getElementById('productsInputCode');
        const addProductBtn = document.getElementById('addProductBtn');

        populateItemsDatalist();

        function handleAddProduct() {
            if (!productInputElem) return;
            const val = productInputElem.value.trim();
            if (val) {
                if (!currentSelectedItems.includes(val)) {
                    currentSelectedItems.push(val);
                    productInputElem.value = '';
                    updateSelectedUI();
                } else {
                    alert('هذه القطعة مضافة بالفعل!');
                    productInputElem.value = '';
                }
            }
        }

        if (addProductBtn) {
            addProductBtn.onclick = (e) => {
                e.preventDefault();
                handleAddProduct();
            };
        }

        if (productInputElem) {
            productInputElem.onchange = handleAddProduct;
        }

        const discountInput = document.getElementById('customDiscount');
        const deductionsInput = document.getElementById('deductions');
        if (discountInput) discountInput.oninput = calculatePrices;
        if (deductionsInput) deductionsInput.oninput = calculatePrices;
    }

    window.loadOrderItemsForEdit = function(itemsArray) {
        currentSelectedItems = itemsArray ? [...itemsArray] : [];
        updateSelectedUI();
    };

    if (openModalBtn && modal) {
        openModalBtn.addEventListener('click', () => {
            if (form) form.reset();
            const editIdInput = document.getElementById('modal-order-edit-id');
            if (editIdInput) editIdInput.value = '';
            currentSelectedItems = [];
            modal.classList.add('active');
            modal.style.display = 'block';
            setupItemsInputArea();
            updateSelectedUI();
        });
    }

    if (closeModalBtn && modal) {
        closeModalBtn.addEventListener('click', () => {
            modal.classList.remove('active');
            modal.style.display = 'none';
        });
    }

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
                        discount: prices.totalDiscount,
                        items: [...currentSelectedItems],
                        deliveryNotes: document.getElementById('deliveryNotes')?.value || '',
                        totalProducts: currentSelectedItems.length,
                        totalPrice: prices.total
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
                    discount: prices.totalDiscount,
                    items: [...currentSelectedItems],
                    deliveryNotes: document.getElementById('deliveryNotes')?.value || '',
                    status: "Pending",
                    date: new Date().toLocaleDateString('en-GB'),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    totalProducts: currentSelectedItems.length,
                    totalPrice: prices.total,
                    isDeleted: false,
                    isChecked: false
                };
                ordersData.push(orderPayload);
            }

            renderOrders(ordersData);
            saveSectionState('orders');
            modal.classList.remove('active');
            modal.style.display = 'none';
            form.reset();
            const editIdInput = document.getElementById('modal-order-edit-id');
            if (editIdInput) editIdInput.value = '';
            currentSelectedItems = [];
            updateSelectedUI();
        });
    }

    setupItemsInputArea();
}

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
        modal.style.display = 'block';
        modal.classList.add('active');
    } else if (sectionKey === 'orders') {
        const modal = document.getElementById('orderModal');
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
        modal.style.display = 'block';
        modal.classList.add('active');
    }
}

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
    }

    const reviewContainer = document.getElementById('review-container');
    if (reviewContainer) {
        setupSectionEvents('review-container', reviewsData, renderReviews, 'review');
    }
}

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

// فتح النوافذ المنبثقة عند الضغط على زر Add في أي قسم
document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.add-btn, .btn-add, button[class*="add"]');
    if (!addBtn) return;
    
    const activeSection = document.querySelector('.dashboard-section.active-section');
    if (!activeSection) return;
    
    const sectionId = activeSection.id;
    let targetModal = null;

    if (sectionId === 'models') targetModal = document.getElementById('model-modal');
    else if (sectionId === 'items') targetModal = document.getElementById('item-add-modal');
    else if (sectionId === 'orders') targetModal = document.getElementById('orderModal');
    else if (sectionId === 'customers') targetModal = document.getElementById('customerModal');
    else if (sectionId === 'returns') targetModal = document.getElementById('return-modal');
    else if (sectionId === 'review') targetModal = document.getElementById('customer-review-modal');

    if (targetModal) {
        targetModal.style.display = 'block';
        targetModal.classList.add('active');
    }
});

// التحكم الكامل في إغلاق النوافذ المنبثقة (سواء بـ X أو بالضغط خارج النافذة)
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-modal') || e.target.tagName === 'SPAN' && e.target.closest('.modal')) {
        const modal = e.target.closest('.modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    }
    
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
        e.target.classList.remove('active');
    }
});