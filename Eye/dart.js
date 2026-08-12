document.addEventListener('DOMContentLoaded', () => {
    // 1. نظام التنقل بين السكاشن
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

    // 2. طباعة البيانات لكل السكاشن
    if (document.getElementById('models')) renderModels(modelsData);
    if (document.getElementById('items')) renderItems(itemsData);
    if (document.getElementById('customers')) renderCustomers(customersData);
    if (document.getElementById('orders')) renderOrders(ordersData);
    if (document.getElementById('returns')) renderReturns(returnsData);
    if (document.getElementById('review')) renderReviews(reviewsData);
    if (document.getElementById('card')) renderCards(cardsData);
});

// ==========================================
// مصفوفات البيانات
// ==========================================

const modelsData = [
    { id: "1", modelId: "DA-Jen121", name: "Wide-leg", category: "pants", description: "بنطلون جينز اسباني", number: "24", cost: "490", selling: "690", discount: "0", discountedPrice: "0", colors: "ابيض, اسود", sizes: "32 34 36", status: "Active", date: "18-10-2026", img: "Eye/Dart-Bird-.png" }
];

const itemsData = [
    { id: "1", modelId: "DA-Jen121", itemCode: "IT-992", color: "اسود", size: "34", status: "In stock", regDate: "18-10-2026", orderId: "ORD-200", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", purchaseDate: "20-10-2026", img: "Eye/Dart-Bird-.png" }
];

const customersData = [
    { id: "1", birthday: "15-09-2005", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", country: "مصر", governorate: "القاهرة", monthlyOrders: "3", totalOrders: "12", totalAmount: "4500 EGP", dartCard: "yes" }
];

const ordersData = [
    { id: "1", orderId: "ORD-200", clientName: "محمد علي", total: "690 EGP", status: "Completed", date: "20-10-2026" }
];

const returnsData = [
    { id: "1", returnId: "R-501", modelId: "DA-Jen121", itemCode: "IT-992", status: "Good", date: "10-08-2026", clientName: "ياسر إبراهيم", clientId: "C-201", phone1: "0101111222", phone2: "-", email: "yasser@mail.com", reason: "المقاس صغير", orderId: "ORD-200" }
];

const reviewsData = [
    { id: "1", date: "12-08-2026", clientName: "محمد علي", clientId: "C-101", status: "Active", rating: "5", title: "جودة ممتازة", review: "الخامة مريحة جدا", phone1: "0100000000", phone2: "-", email: "user@mail.com" }
];

const cardsData = [
    { 
        id: "1", cardId: "CRD-10", clientName: "محمد علي", clientId: "C-101", phone1: "0100000000", phone2: "-", email: "user@mail.com", status: "Active", issueDate: "01-01-2026", expDate: "01-01-2027", purchasedItems: "15", purchasedLimit: "20", 
        requestedProducts: ["IT-01", "IT-02", "IT-03", "IT-04", "IT-05", "IT-06", "IT-07", "IT-08", "IT-09", "IT-10", "IT-11", "IT-12", "IT-13", "IT-14", "IT-15", "IT-16", "IT-17", "IT-18", "IT-19", "IT-20"] 
    }
];

// ==========================================
// دوال العرض
// ==========================================

function renderModels(dataArray) {
    const container = document.getElementById('models-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
                </div>
                <div class="w100"><img src="${item.img}" alt="product" class="product-img"></div>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.name}</span>
                <span class="text-item w150">${item.category}</span>
                <span class="text-item w200">${item.description}</span>
                <span class="text-item w150">${item.number}</span>
                <span class="text-item w150">${item.cost} EGP</span>
                <span class="text-item w150">${item.selling} EGP</span>
                <span class="text-item w150">${item.discount}%</span>
                <span class="text-item w150">${item.discountedPrice}</span>
                <span class="text-item w300">${item.colors}</span>
                <span class="text-item w300">${item.sizes}</span>
                <span class="text-item w150 status-${item.status.toLowerCase()}">• ${item.status}</span>
                <span class="text-item w150">${item.date}</span>
            </div>
        `);
    });
}

function renderItems(dataArray) {
    const container = document.getElementById('items-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
                </div>
                <div class="w100"><img src="${item.img}" alt="item" class="product-img"></div>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.itemCode}</span>
                <span class="text-item w150">${item.color}</span>
                <span class="text-item w150">${item.size}</span>
                <span class="text-item w150">${item.status}</span>
                <span class="text-item w200">${item.regDate}</span>
                <span class="text-item w150">${item.orderId}</span>
                <span class="text-item w200">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w300">${item.phone2}</span>
                <span class="text-item w150">${item.email}</span>
                <span class="text-item w150">${item.purchaseDate}</span>
            </div>
        `);
    });
}

function renderCustomers(dataArray) {
    const container = document.getElementById('customers-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        // البحث عما إذا كان للعميل كارت في cardsData بناءً على الـ clientId
        const cardInfo = cardsData.find(card => card.clientId === item.clientId);
        
        let cardHtml = '';
        if (cardInfo) {
            cardHtml = `
                <div style="display:flex; align-items:center; gap:5px;">
                    <span>yes</span>
                    <div style="border:1px solid #ccc; padding:2px 6px; font-size:11px; border-radius:3px; background:#f9f9f9;" title="Purchased Items">${cardInfo.purchasedItems}</div>
                    <div style="border:1px solid #ccc; padding:2px 6px; font-size:11px; border-radius:3px; background:#f9f9f9;" title="Purchased Limit">${cardInfo.purchasedLimit}</div>
                </div>
            `;
        } else {
            cardHtml = `<span>no</span>`;
        }

        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
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
                <div class="text-item w200">${cardHtml}</div>
            </div>
        `);
    });
}

function renderOrders(dataArray) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item w150">${item.orderId}</span>
                <span class="text-item w200">${item.clientName}</span>
                <span class="text-item w150">${item.total}</span>
                <span class="text-item w150">${item.status}</span>
                <span class="text-item w200">${item.date}</span>
            </div>
        `);
    });
}

function renderReturns(dataArray) {
    const container = document.getElementById('returns-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        const isGood = item.status === 'Good';
        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
                </div>
                <div class="w100 button">
                    <button class="btn-good" style="display: ${isGood ? 'none' : 'inline-block'}; color: white; border: 1px solid green; padding: 5px; cursor: pointer;" onclick="toggleReturnStatus(this)">Good</button>
                    <button class="btn-bad" style="display: ${isGood ? 'inline-block' : 'none'}; color: white; border: 1px solid red; padding: 5px; cursor: pointer;" onclick="toggleReturnStatus(this)">Bad</button>
                </div>
                <span class="text-item w100">${item.returnId}</span>
                <span class="text-item w150">${item.modelId}</span>
                <span class="text-item w150">${item.itemCode}</span>
                <span class="text-item w150 status-text" style="font-weight:bold;">${item.status}</span>
                <span class="text-item w150">${item.date}</span>
                <span class="text-item overflow w200">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item overflow w150">${item.email}</span>
                <span class="text-item overflow w150">${item.reason}</span>
                <span class="text-item w150">${item.orderId}</span>
            </div>
        `);
    });
}

function renderReviews(dataArray) {
    const container = document.getElementById('review-container');
    if (!container) return;
    container.innerHTML = '';
    dataArray.forEach(item => {
        const isActive = item.status === 'Active';
        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="btn-publish" style="display: ${isActive ? 'none' : 'inline-block'}; color: white; border: 1px solid green; padding: 5px; cursor: pointer;" onclick="toggleReviewStatus(this)">Publish</button>
                    <button class="btn-hide" style="display: ${isActive ? 'inline-block' : 'none'}; color: white; border: 1px solid red; padding: 5px; cursor: pointer;" onclick="toggleReviewStatus(this)">Hidden</button>
                </div>
                <span class="text-item w200">${item.date}</span>
                <span class="text-item w200">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150 status-text" style="font-weight:bold;">${item.status}</span>
                <span class="text-item w100">${item.rating} / 5</span>
                <span class="text-item overflow w300">${item.title}</span>
                <span class="text-item overflow w500">${item.review}</span>
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
    dataArray.forEach(item => {
        let boxesHTML = '<div class="item-boxes-grid" style="display:flex; flex-wrap:wrap; gap:5px;">';
        item.requestedProducts.forEach(code => {
            boxesHTML += `<div class="item-box" style="border:1px solid #ccc; padding:4px 8px; font-size:12px; border-radius:4px;">${code}</div>`;
        });
        boxesHTML += '</div>';

        container.insertAdjacentHTML('beforeend', `
            <div class="model-row" style="display:flex; align-items:center;">
                <input type="checkbox" class="model-checkbox">
                <div class="w100 button">
                    <button class="action-btn btn-delete"><i class="bx bx-trash"></i></button>
                    <button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>
                </div>
                <span class="text-item w150">${item.cardId}</span>
                <span class="text-item w150">${item.clientName}</span>
                <span class="text-item w150">${item.clientId}</span>
                <span class="text-item w150">${item.phone1}</span>
                <span class="text-item w150">${item.phone2}</span>
                <span class="text-item w200">${item.email}</span>
                <span class="text-item w150">${item.status}</span>
                <span class="text-item w200">${item.issueDate}</span>
                <span class="text-item w150">${item.expDate}</span>
                <span class="text-item w150">${item.purchasedItems}</span>
                <span class="text-item w150">${item.purchasedLimit}</span>
                <div class="text-item w1200">${boxesHTML}</div>
            </div>
        `);
    });
}

function toggleReviewStatus(btn) {
    const row = btn.closest('.model-row');
    const publishBtn = row.querySelector('.btn-publish');
    const hideBtn = row.querySelector('.btn-hide');
    const statusText = row.querySelector('.status-text');

    if (btn.classList.contains('btn-publish')) {
        publishBtn.style.display = 'none';
        hideBtn.style.display = 'inline-block';
        statusText.textContent = 'Active';
    } else {
        publishBtn.style.display = 'inline-block';
        hideBtn.style.display = 'none';
        statusText.textContent = 'Hidden';
    }
}

function toggleReturnStatus(btn) {
    const row = btn.closest('.model-row');
    const goodBtn = row.querySelector('.btn-good');
    const badBtn = row.querySelector('.btn-bad');
    const statusText = row.querySelector('.status-text');

    if (btn.classList.contains('btn-good')) {
        goodBtn.style.display = 'none';
        badBtn.style.display = 'inline-block';
        statusText.textContent = 'Good';
    } else {
        goodBtn.style.display = 'inline-block';
        badBtn.style.display = 'none';
        statusText.textContent = 'Bad';
    }
}