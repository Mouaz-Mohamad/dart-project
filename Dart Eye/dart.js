// 1. نظام التنقل بين السكاشن وإدارة الـ Active
document.addEventListener('DOMContentLoaded', () => {
    const menuLinks = document.querySelectorAll('.menu li a');
    const sections = document.querySelectorAll('.dashboard-section');

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            if (!targetId) return;

            // إزالة الـ active من كل الروابط وإخفاء السكاشن
            menuLinks.forEach(l => l.classList.remove('active'));
            sections.forEach(sec => sec.classList.remove('active-section'));

            // تفعيل الرابط وإظهار السكشن المستهدف
            link.classList.add('active');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active-section');
            }
        });
    });

    // تشغيل دالة عرض بيانات الموديلات فور تحميل الصفحة
    renderModels(modelsData);
});

// 2. مصفوفة البيانات (Data)
const modelsData = [
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
    {
    id: "1",
    modelId: "DA-Jen121",
    name: "Wid-leg",
    category: "pants",
    description: "بنطلون جينز اسباني 9.5 اونص",
    number: "24",
    cost: "490",
    selling: "690",
    discount: "0",
    discountedPrice: "0",
    colors: "ابيض اسود كاكاوى",
    sizes: "32 34 36 38",
    status: "Active",
    date: "18-10-2026",
    imgSrc: "../Photos/products/1.jpg"
    },
];

// 3. دالة عرض وتكرار الصفوف
function renderModels(dataArray) {
    const container = document.getElementById('models-container');
    if (!container) return;
    container.innerHTML = ''; // تفريغ الحاوية أولاً

    dataArray.forEach(item => {
        const rowHTML = `
            <div class="model-row">
                <input type="checkbox" id="check-${item.id}" class="model-checkbox">
                
                <div class="w100 button">
                    <button id="btn-delete-${item.id}" class="action-btn btn-delete" title="مسح">
                        <i class="bx bx-trash"></i>
                    </button>
                    <button id="btn-edit-${item.id}" class="action-btn btn-edit" title="تعديل">
                        <i class="bx bx-edit"></i>
                    </button>
                </div>

                <div class="w100">
                    <img src="${item.imgSrc}" id="img-${item.id}" class="model-img" alt="Model Photo">
                </div>

                <span id="id-model-${item.id}" class="text-item w150">${item.modelId}</span>
                <span id="name-${item.id}" class="text-item w150">${item.name}</span>
                <span id="category-${item.id}" class="text-item w150">${item.category}</span>
                <span id="description-${item.id}" class="text-item w200">${item.description}</span>
                <span id="number-${item.id}" class="text-item w150">${item.number}</span>
                <span id="cost-${item.id}" class="text-item w150">${item.cost} EGP</span>
                <span id="selling-${item.id}" class="text-item w150">${item.selling} EGP</span>
                <span id="discount-${item.id}" class="text-item w150">${item.discount} %</span>
                <span id="discounted-price-${item.id}" class="text-item w150">${item.discountedPrice} EGP</span>
                <span id="colors-${item.id}" class="text-item w300">${item.colors}</span>
                <span id="sizes-${item.id}" class="text-item w300">${item.sizes}</span>
                <span id="status-${item.id}" class="text-item status-active w150">• ${item.status}</span>
                <span id="date-${item.id}" class="text-item w150">${item.date}</span>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', rowHTML);
    });
}