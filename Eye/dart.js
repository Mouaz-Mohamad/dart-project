// ==========================================
// 1. تشغيل التطبيق والأحداث العامة
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
    setupReturnModal();
    setupReviewModal();
});

// ==========================================
// 2. البيانات الأوليّة
// ==========================================
let modelsData = [
    { id: "1", modelId: "DA-Jen121", name: "Wide-leg", category: "pants", description: "بنطلون جينز اسباني", number: "24", cost: "490", selling: "690", discount: "0", discountedPrice: "690", colors: "ابيض, اسود", sizes: "32 34 36", status: "Active", date: "18-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

let itemsData = [
    { id: "1", modelId: "DA-Jen121", itemCode: "IT-992", color: "اسود", size: "34", status: "In stock", regDate: "18-10-2026", orderId: "ORD-200", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", purchaseDate: "20-10-2026", img: "https://images.unsplash.com/photo-1542272604-787c3835535d", isDeleted: false, isChecked: false }
];

let customersData = [
    { id: "1", birthday: "2005-09-15", clientName: "أحمد محمود", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "ahmed@mail.com", country: "Egypt", governorate: "Cairo", monthlyOrders: "3", totalOrders: "12", totalAmount: "4500 EGP", dartCard: "yes", isDeleted: false, isChecked: false }
];

let ordersData = [
    { id: "1", orderId: "ORD-200", date: "18-10-2026", time: "02:30 PM", clientId: "C-101", clientName: "محمد علي", phone1: "0100000000", phone2: "0110000000", email: "user@mail.com", status: "Pending", totalProducts: 3, items: ["IT-992", "IT-993", "IT-994"], totalPrice: 1000, discount: 10, reasonDeduction: "خصم", paymentMethod: "cash", deliveryNotes: "الاتصال قبل الوصول", googleMapLink: "", country: "مصر", governorate: "القاهرة", area: "حدائق القبة", street: "شارع بورسعيد", building: "عمارة 15", floor: "3", isDeleted: false, isChecked: false }
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

let cardsData = [];

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
// 3. التخزين المحلي
// ==========================================
function saveDataToStorage(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
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
        if (document.getElementById(key)) sectionsMap[key].render(sectionsMap[key].data);
    });
}
function getRowClass(item) { return item.isDeleted ? 'model-row row-deleted' : 'model-row row-normal'; }
function getSortedData(dataArray) { return [...dataArray].sort((a, b) => Number(a.isDeleted) - Number(b.isDeleted)); }
function deletePermanently(id, sectionKey) {
    const sectionInfo = sectionsMap[sectionKey];
    if (!sectionInfo) return;
    if (confirm("هل أنت متأكد من الحذف النهائي؟")) {
        sectionInfo.data = sectionInfo.data.filter(item => item.id !== id);
        sectionInfo.render(sectionInfo.data);
        saveSectionState(sectionKey);
    }
}

// ==========================================
// 4. الـ Rendering
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
        if (prevStatusConfig) statusButtonsHTML += `<button class="btn-prev-status btn-status-prev" title="تراجع"><i class="bx bx-undo"></i></button>`;
        if (nextStatusConfig) {
            statusButtonsHTML += `<button class="btn-change-status btn-status-next" title="التالي" style="background-color:${nextStatusConfig.bg}; color:${nextStatusConfig.color}; border: 1px solid ${nextStatusConfig.border};">${nextStatusConfig.label}</button>`;
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
                    <button class="btn-toggle-return return-toggle-btn ${isGood ? 'return-status-good' : 'return-status-bad'}">
                        ${isGood ? 'Good' : 'Bad'}
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
                <span class="text-item w150">${item.orderId || '-'}</span>
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
                        ${isActive ? 'Active' : 'Hidden'}
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

function renderCards() {}

// ==========================================
// 5. المودالز
// ==========================================

function openEditModal(id, sectionKey) {
    const sectionInfo = sectionsMap[sectionKey];
    if (!sectionInfo) return;
    const item = sectionInfo.data.find(el => el.id === id);
    if (!item) return;

    if (sectionKey === 'models') {
        const modal = document.getElementById('model-modal');
        document.getElementById('modal-edit-id').value = item.id;
        document.getElementById('modal-id').value = item.modelId || '';
        document.getElementById('modal-name').value = item.name || '';
        document.getElementById('modal-category').value = item.category || '';
        document.getElementById('modal-description').value = item.description || '';
        document.getElementById('modal-cost').value = item.cost || '';
        document.getElementById('modal-selling').value = item.selling || '';
        document.getElementById('modal-discount').value = item.discount || '0';
        modal.style.display = 'block'; modal.classList.add('active');
    } 
    else if (sectionKey === 'items') {
        const modal = document.getElementById('item-add-modal');
        document.getElementById('modal-item-add-edit-id').value = item.id;
        document.getElementById('modal-item-model-id').value = item.modelId || '';
        document.getElementById('modal-item-code-pic').value = item.itemCode || '';
        document.getElementById('modal-item-color').value = item.color || '';
        document.getElementById('modal-item-size').value = item.size || '';
        const previewImg = document.getElementById('item-preview-img');
        if(previewImg) { previewImg.src = item.img || ''; previewImg.style.display = 'block'; }
        modal.style.display = 'block'; modal.classList.add('active');
    }
    else if (sectionKey === 'customers') {
        const modal = document.getElementById('customerModal');
        document.getElementById('modal-customer-edit-id').value = item.id;
        document.getElementById('custName').value = item.clientName || '';
        
        let bday = item.birthday || '';
        if(bday && bday.includes('-') && bday.split('-')[0].length === 2) {
            bday = bday.split('-').reverse().join('-'); 
        }
        document.getElementById('custBirthday').value = bday;
        
        document.getElementById('custEmail').value = item.email || '';
        document.getElementById('custPhone1').value = item.phone1 || '';
        document.getElementById('custPhone2').value = item.phone2 || '';
        document.getElementById('custCountry').value = item.country || '';
        document.getElementById('custGovernorate').value = item.governorate || '';
        modal.style.display = 'block'; modal.classList.add('active');
    }
    else if (sectionKey === 'orders') {
        const modal = document.getElementById('orderModal');
        document.getElementById('modal-order-edit-id').value = item.id;
        document.getElementById('clientId').value = item.clientId || '';
        document.getElementById('clientName').value = item.clientName || '';
        document.getElementById('phone1').value = item.phone1 || '';
        document.getElementById('phone2').value = item.phone2 || '';
        document.getElementById('email').value = item.email || '';
        document.getElementById('governorate').value = item.governorate || '';
        document.getElementById('deliveryNotes').value = item.deliveryNotes || '';
        document.getElementById('orderAddress').value = item.googleMapLink || '';
        if (typeof window.loadOrderItemsForEdit === 'function') window.loadOrderItemsForEdit(item.items);
        modal.style.display = 'block'; modal.classList.add('active');
    }
    else if (sectionKey === 'returns') {
        const modal = document.getElementById('return-modal');
        document.getElementById('modal-return-edit-id').value = item.id;
        document.getElementById('modal-return-name').value = item.clientName || '';
        document.getElementById('modal-return-item-code').value = item.itemCode || '';
        document.getElementById('modal-return-phone1').value = item.phone1 || '';
        document.getElementById('modal-return-model-id').value = item.modelId || '';
        document.getElementById('modal-return-phone2').value = item.phone2 || '';
        document.getElementById('modal-return-email').value = item.email || '';
        document.getElementById('modal-item-condition').value = item.status || 'Good';
        document.getElementById('modal-item-reason').value = item.reason || '';
        modal.style.display = 'block'; modal.classList.add('active');
    }
    else if (sectionKey === 'review') {
        const modal = document.getElementById('customer-review-modal');
        document.getElementById('modal-review-edit-id').value = item.id;
        document.getElementById('modal-cust-rev-name').value = item.clientName || '';
        document.getElementById('modal-cust-rating').value = item.rating || '5';
        document.getElementById('modal-cust-rev-phone1').value = item.phone1 || '';
        document.getElementById('modal-cust-review').value = item.review || '';
        document.getElementById('modal-cust-rev-phone2').value = item.phone2 || '';
        document.getElementById('modal-cust-title').value = item.title || '';
        document.getElementById('modal-cust-rev-email').value = item.email || '';
        document.getElementById('modal-cust-status').value = item.status || 'Active';
        modal.style.display = 'block'; modal.classList.add('active');
    }
}

function setupModelModal() {
    const modal = document.getElementById('model-modal');
    const addBtn = document.querySelector('#models .add-btn');
    const form = document.getElementById('model-form');
    if (addBtn) addBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-edit-id').value = ''; modal.style.display = 'block'; });
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-edit-id').value;
            const payload = {
                modelId: document.getElementById('modal-id').value, name: document.getElementById('modal-name').value, category: document.getElementById('modal-category').value, description: document.getElementById('modal-description').value, cost: document.getElementById('modal-cost').value, selling: document.getElementById('modal-selling').value, discount: document.getElementById('modal-discount').value || '0', status: "Active", date: new Date().toLocaleDateString('en-GB')
            };
            if (editId) {
                const idx = modelsData.findIndex(i => i.id === editId);
                if (idx !== -1) modelsData[idx] = { ...modelsData[idx], ...payload };
            } else { payload.id = Date.now().toString(); modelsData.push(payload); }
            renderModels(modelsData); saveSectionState('models'); modal.style.display = 'none';
        });
    }
}

function setupItemModal() {
    const modal = document.getElementById('item-add-modal');
    const addBtn = document.querySelector('#items .add-btn');
    const form = document.getElementById('item-add-form');
    const fileInput = document.getElementById('modal-item-file');
    const previewImg = document.getElementById('item-preview-img');

    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) { previewImg.src = event.target.result; previewImg.style.display = 'block'; };
                reader.readAsDataURL(file);
            }
        });
    }

    if (addBtn) addBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-item-add-edit-id').value = ''; previewImg.style.display='none'; modal.style.display = 'block'; });
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-item-add-edit-id').value;
            const payload = {
                modelId: document.getElementById('modal-item-model-id').value, itemCode: document.getElementById('modal-item-code-pic').value, color: document.getElementById('modal-item-color').value, size: document.getElementById('modal-item-size').value, status: 'In stock', regDate: new Date().toLocaleDateString('en-GB'), img: previewImg.src || "https://via.placeholder.com/50"
            };
            if (editId) {
                const idx = itemsData.findIndex(i => i.id === editId);
                if (idx !== -1) itemsData[idx] = { ...itemsData[idx], ...payload };
            } else { payload.id = Date.now().toString(); itemsData.push(payload); }
            renderItems(itemsData); saveSectionState('items'); modal.style.display = 'none';
        });
    }
}

function setupCustomerModal() {
    const modal = document.getElementById('customerModal');
    const addBtn = document.querySelector('#openCustomerModalBtn');
    const form = document.getElementById('customerForm');
    if (addBtn) addBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-customer-edit-id').value = ''; modal.style.display = 'block'; });
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-customer-edit-id').value;
            const payload = {
                clientName: document.getElementById('custName').value, birthday: document.getElementById('custBirthday').value, email: document.getElementById('custEmail').value, phone1: document.getElementById('custPhone1').value, phone2: document.getElementById('custPhone2').value, country: document.getElementById('custCountry').value, governorate: document.getElementById('custGovernorate').value
            };
            if (editId) {
                const idx = customersData.findIndex(i => i.id === editId);
                if (idx !== -1) customersData[idx] = { ...customersData[idx], ...payload };
            } else { payload.id = Date.now().toString(); customersData.push(payload); }
            renderCustomers(customersData); saveSectionState('customers'); modal.style.display = 'none';
        });
    }
}

function setupOrderModal() {
    const modal = document.getElementById('orderModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const form = document.getElementById('orderForm');
    const phone1Input = document.getElementById('phone1');
    let currentSelectedItems = [];

    if (phone1Input) {
        phone1Input.addEventListener('input', (e) => {
            const matchedClient = customersData.find(c => c.phone1 === e.target.value.trim());
            if (matchedClient) {
                document.getElementById('clientName').value = matchedClient.clientName || '';
                document.getElementById('clientId').value = matchedClient.clientId || '';
                document.getElementById('phone2').value = matchedClient.phone2 || '';
                document.getElementById('email').value = matchedClient.email || '';
                document.getElementById('governorate').value = matchedClient.governorate || '';
            }
        });
    }

    window.loadOrderItemsForEdit = function(itemsArray) { currentSelectedItems = itemsArray ? [...itemsArray] : []; };

    if (openModalBtn) openModalBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-order-edit-id').value = ''; currentSelectedItems = []; modal.style.display = 'block'; });

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-order-edit-id').value;
            const payload = {
                clientId: document.getElementById('clientId').value, clientName: document.getElementById('clientName').value, phone1: phone1Input.value, phone2: document.getElementById('phone2').value, email: document.getElementById('email').value, paymentMethod: document.getElementById('paymentMethod').value, deliveryNotes: document.getElementById('deliveryNotes').value, googleMapLink: document.getElementById('orderAddress').value, items: currentSelectedItems
            };
            if (editId) {
                const idx = ordersData.findIndex(i => i.id === editId);
                if (idx !== -1) ordersData[idx] = { ...ordersData[idx], ...payload };
            } else { payload.id = Date.now().toString(); payload.status = "Pending"; ordersData.push(payload); }
            renderOrders(ordersData); saveSectionState('orders'); modal.style.display = 'none';
        });
    }
}

function setupReturnModal() {
    const modal = document.getElementById('return-modal');
    const addBtn = document.querySelector('#openReturnModalBtn');
    const form = document.getElementById('return-form');
    const phoneInput = document.getElementById('modal-return-phone1');

    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            const matchedClient = customersData.find(c => c.phone1 === e.target.value.trim());
            if (matchedClient) {
                document.getElementById('modal-return-name').value = matchedClient.clientName || '';
                document.getElementById('modal-return-phone2').value = matchedClient.phone2 || '';
                document.getElementById('modal-return-email').value = matchedClient.email || '';
            }
        });
    }

    if (addBtn) addBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-return-edit-id').value = ''; modal.style.display = 'block'; });

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-return-edit-id').value;
            const payload = {
                clientName: document.getElementById('modal-return-name').value, itemCode: document.getElementById('modal-return-item-code').value, phone1: phoneInput.value, modelId: document.getElementById('modal-return-model-id').value, phone2: document.getElementById('modal-return-phone2').value, email: document.getElementById('modal-return-email').value, status: document.getElementById('modal-item-condition').value, reason: document.getElementById('modal-item-reason').value, date: new Date().toLocaleDateString('en-GB')
            };
            if (editId) {
                const idx = returnsData.findIndex(i => i.id === editId);
                if (idx !== -1) returnsData[idx] = { ...returnsData[idx], ...payload };
            } else { payload.id = Date.now().toString(); payload.returnId = "R-" + Math.floor(Math.random() * 1000); returnsData.push(payload); }
            renderReturns(returnsData); saveSectionState('returns'); modal.style.display = 'none';
        });
    }
}

function setupReviewModal() {
    const modal = document.getElementById('customer-review-modal');
    const addBtn = document.querySelector('#openReviewModalBtn');
    const form = document.getElementById('customer-review-form');

    if (addBtn) addBtn.addEventListener('click', () => { form.reset(); document.getElementById('modal-review-edit-id').value = ''; modal.style.display = 'block'; });

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = document.getElementById('modal-review-edit-id').value;
            const payload = {
                clientName: document.getElementById('modal-cust-rev-name').value, rating: document.getElementById('modal-cust-rating').value, phone1: document.getElementById('modal-cust-rev-phone1').value, review: document.getElementById('modal-cust-review').value, phone2: document.getElementById('modal-cust-rev-phone2').value, title: document.getElementById('modal-cust-title').value, email: document.getElementById('modal-cust-rev-email').value, status: document.getElementById('modal-cust-status').value, date: new Date().toLocaleDateString('en-GB')
            };
            if (editId) {
                const idx = reviewsData.findIndex(i => i.id === editId);
                if (idx !== -1) reviewsData[idx] = { ...reviewsData[idx], ...payload };
            } else { payload.id = Date.now().toString(); reviewsData.push(payload); }
            renderReviews(reviewsData); saveSectionState('review'); modal.style.display = 'none';
        });
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
            if (item) { item.isDeleted = !item.isDeleted; renderFn(sectionsMap[sectionKey].data); saveSectionState(sectionKey); }
        }
        if (e.target.closest('.btn-hard-delete')) deletePermanently(id, sectionKey);
        if (e.target.closest('.btn-edit')) openEditModal(id, sectionKey);
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
            const row = e.target.closest('.model-row');
            if (!row) return;
            const order = ordersData.find(o => o.id === row.getAttribute('data-id'));
            if (e.target.closest('.btn-change-status') && order) {
                const currentIndex = orderStatuses.findIndex(s => s.key === order.status);
                if (currentIndex !== -1 && currentIndex < orderStatuses.length - 1) { order.status = orderStatuses[currentIndex + 1].key; renderOrders(ordersData); saveSectionState('orders'); }
            }
            if (e.target.closest('.btn-prev-status') && order) {
                const currentIndex = orderStatuses.findIndex(s => s.key === order.status);
                if (currentIndex > 0) { order.status = orderStatuses[currentIndex - 1].key; renderOrders(ordersData); saveSectionState('orders'); }
            }
        });
    }

    const returnsContainer = document.getElementById('returns-container');
    if (returnsContainer) {
        setupSectionEvents('returns-container', returnsData, renderReturns, 'returns');
        returnsContainer.addEventListener('click', (e) => {
            if (e.target.closest('.btn-toggle-return')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const ret = returnsData.find(r => r.id === row.getAttribute('data-id'));
                    if (ret) { ret.status = ret.status === 'Good' ? 'Bad' : 'Good'; renderReturns(returnsData); saveSectionState('returns'); }
                }
            }
        });
    }

    const reviewContainer = document.getElementById('review-container');
    if (reviewContainer) {
        setupSectionEvents('review-container', reviewsData, renderReviews, 'review');
        reviewContainer.addEventListener('click', (e) => {
            if (e.target.closest('.btn-toggle-review')) {
                const row = e.target.closest('.model-row');
                if (row) {
                    const rev = reviewsData.find(r => r.id === row.getAttribute('data-id'));
                    if (rev) { rev.status = rev.status === 'Active' ? 'Hidden' : 'Active'; renderReviews(reviewsData); saveSectionState('review'); }
                }
            }
        });
    }
}

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
        chart: { type: 'area', height: 350 },
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