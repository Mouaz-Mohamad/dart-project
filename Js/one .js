// ==========================================
// 1. مصفوفات البيانات (المنتجات، التقييمات، والمخزون)
// ==========================================
// ==========================================
// 1. مصفوفات البيانات (المنتجات، التقييمات، والمخزون)
// ==========================================
const productsData = [
    {
        id: 1,
        category: "قمصان",
        title: "Wide leg jeans",
        code: "DA-P785",
        price: 450,
        image: "Photos/products/1.jpg",
        description: "بنطال جينز فاخر بأرجل واسعة ومصنوع من القطن الخالص بنسبة 100%، ليمنحك قصة مريحة، وراحة تدوم طويلاً، وإطلالة يومية عفوية وأنيقة.",
        stock: {
            "32": { "نيلي": 0, "بيج": 0, "ابيض": 0, "اسود": 0 },
            "34": { "نيلي": 0, "بيج": 0, "ابيض": 0, "اسود": 0 },
            "36": { "نيلي": 0, "بيج": 2, "ابيض": 0, "اسود": 0 }
        }
    },
    {
        id: 2,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/2.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 3,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "/Photos/products/13.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 4,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/14.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 5,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/18.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 6,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "/Photos/products/11.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 7,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/10.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 8,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "/Photos/products/9.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 9,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/7.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 10,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/6.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 11,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/5.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 12,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/4.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 13,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "Photos/products/3.jpg",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 14,
        category: "قمصان",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "/Photos/products/14.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    }
    
    // يمكنك إضافة باقي المنتجات هنا بنفس الهيكل
];

const reviewsData = [
    { name: "سارة محمود", date: "15 يوليو 2026", rating: 5, title: "خامة ممتازة وتقفيل محترم", comment: "القماش مريح جداً في اللبس والتقفيل نضيف مفيش خيوط طالعة، المقاس مضبوط بالظبط زي الجدول. أكيد هطلب تاني" },
    { name: "خالد علي", date: "10 يوليو 2026", rating: 5, title: "شيك ومريح جداً", comment: "التصميم جميل وعصري والألوان نفس الصور بالظبط والتوصيل سريع." },
    { name: "أحمد حسام", date: "02 يوليو 2026", rating: 4, title: "مقاس مظبوط خامة جيدة", comment: "الخامة جيدة جداً بالنسبة للسعر والمقاس جه مظبوط بظبط." },
    { name: "مريم إبراهيم", date: "28 يونيو 2026", rating: 5, title: "خدمة عملاء رائعة", comment: "المنتج ممتاز والتغليف شيك جداً، هطلب منكم تاني أكيد." }
];

let cartData = JSON.parse(localStorage.getItem('dart_cart')) || [];
let appliedDiscountRate = 0;

let selectedSize = null;
let selectedColor = null;
let activeProduct = null;

// ==========================================
// 2. الدوال المساعدة الأساسية
// ==========================================
async function loadSection(containerId, filePath) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const html = await response.text();
        container.innerHTML = html;
    } catch (error) {
        console.error(`خطأ في تحميل (${filePath}):`, error);
    }
}

function initHeader() {
    const iconMenu = document.querySelector('.icon-menu');
    const sideMenu = document.querySelector('.side-menu');

    if (iconMenu && sideMenu) {
        iconMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            sideMenu.classList.toggle('active');
        });

        document.addEventListener('click', (event) => {
            if (!sideMenu.contains(event.target) && !iconMenu.contains(event.target)) {
                sideMenu.classList.remove('active');
            }
        });

        window.addEventListener('scroll', () => {
            sideMenu.classList.remove('active');
        });
    }
}

// دالة عرض المنتجات (تدعم الرئيسية وصفحة المنتجات المقسمة)
function renderProductsLogic() {
    const productTemplate = document.getElementById('productTemplate');
    if (!productTemplate) return;

    // 1. الصفحة الرئيسية (عرض أول 8 منتجات كحد أقصى)
    const productsContainer = document.getElementById('productsContainer');
    if (productsContainer) {
        const homeProducts = productsData.slice(0, 8);
        homeProducts.forEach(item => {
            const card = createProductCard(item, productTemplate);
            productsContainer.appendChild(card);
        });
    }

    // 2. صفحة المنتجات المقسمة (Part 1 أول 6 منتجات، Part 2 الباقي)
    const part1Container = document.getElementById('productsPart1');
    const part2Container = document.getElementById('productsPart2');

    if (part1Container || part2Container) {
        const firstPartProducts = productsData.slice(0, 6);
        const secondPartProducts = productsData.slice(6);

        if (part1Container) {
            firstPartProducts.forEach(item => {
                const card = createProductCard(item, productTemplate);
                part1Container.appendChild(card);
            });
        }

        if (part2Container) {
            secondPartProducts.forEach(item => {
                const card = createProductCard(item, productTemplate);
                part2Container.appendChild(card);
            });
        }
    }
}

// دالة مساعدة لإنشاء كارت المنتج
function createProductCard(item, template) {
    const card = template.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';

    card.querySelector('.product-img').src = item.image;
    card.querySelector('.product-img').alt = item.title;
    card.querySelector('.product-category').textContent = item.category;
    card.querySelector('.product-title').textContent = item.title;
    card.querySelector('.product-code').textContent = `كود : ${item.code}`;
    card.querySelector('.product-price').textContent = `EGP ${item.price}`;

    const cartBtn = card.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.setAttribute('data-id', item.id);
    }

    return card;
}

// دالة مساعدة لإنشاء كارت المنتج (معدلة لفحص المخزون الكلي)
function createProductCard(item, template) {
    const card = template.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';
    card.style.position = 'relative'; // عشان البادج يظهر مظبوط فوق الصورة

    card.querySelector('.product-img').src = item.image;
    card.querySelector('.product-img').alt = item.title;
    card.querySelector('.product-category').textContent = item.category;
    card.querySelector('.product-title').textContent = item.title;
    card.querySelector('.product-code').textContent = `كود : ${item.code}`;
    card.querySelector('.product-price').textContent = `EGP ${item.price}`;

    // 1. حساب إجمالي المخزون للمنتج (كل المقاسات والألوان)
    let totalStock = 0;
    if (item.stock) {
        Object.values(item.stock).forEach(sizeObj => {
            Object.values(sizeObj).forEach(qty => {
                totalStock += qty;
            });
        });
    }

    const cartBtn = card.querySelector('.cart-btn');

    // 2. لو المخزون صفر أو أقل
    if (totalStock <= 0) {
        card.classList.add('out-of-stock');

        // إضافة جملة OUT OF STOCK فوق الصورة
        const badge = document.createElement('span');
        badge.className = 'out-of-stock-badge';
        badge.textContent = 'Out of Stock';
        card.appendChild(badge);

        // تعطيل زرار السلة عشان محدش يفتح المودال أو يطلب
    //     if (cartBtn) {
    //         cartBtn.style.pointerEvents = 'none';
    //         cartBtn.style.opacity = '0.5';
    //         cartBtn.textContent = 'غير متوفر';
    //     }
    // } else {
    //     if (cartBtn) {
    //         cartBtn.setAttribute('data-id', item.id);
    //     }
    }

    return card;
}

// دالة عرض التقييمات
function renderReviewsLogic() {
    const reviewsContainer = document.getElementById('reviewsContainer');
    const reviewTemplate = document.getElementById('reviewTemplate');

    if (reviewsContainer && reviewTemplate) {
        reviewsData.forEach(item => {
            const card = reviewTemplate.cloneNode(true);
            card.removeAttribute('id');
            card.style.display = 'flex';

            const starsContainer = card.querySelector('.stars');
            starsContainer.innerHTML = '';
            for (let i = 1; i <= 5; i++) {
                const star = document.createElement('i');
                star.className = i <= item.rating ? 'fa-solid fa-star' : 'fa-regular fa-star';
                starsContainer.appendChild(star);
            }

            card.querySelector('.review-title').textContent = item.title;
            card.querySelector('.review-text').textContent = item.comment;
            card.querySelector('.user-name-').textContent = item.name;
            card.querySelector('.review-date').textContent = item.date;

            reviewsContainer.appendChild(card);
        });
    }
}

// ==========================================
// 3. نظام المودال (عرض التفاصيل، المقاسات، الألوان)
// ==========================================
document.addEventListener('click', (e) => {
    // التحقق من الضغط على زرار السلة أو على الكارت نفسه
    const productCard = e.target.closest('.product-card'); // تأكد إن ده كلاس الكارت عندك
    const cartBtn = e.target.closest('.cart-btn');

    if (productCard || cartBtn) {
        // بنجيب الـ id سواء من الزرار أو من الكارت نفسه لو الزرار مش هو اللي اتداس
        const targetElement = cartBtn || productCard;
        const productId = targetElement.getAttribute('data-id') || 
        productCard.querySelector('.cart-btn')?.getAttribute('data-id');

        activeProduct = productsData.find(p => p.id == productId);
        if (activeProduct) {
            openProductModal(activeProduct);
        }
    }

    if (e.target.closest('.model .fa-x')) {
        const modal = document.getElementById('SectionModel');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto'; // إعادة التمرير عند الإغلاق
        }
    }
});

function openProductModal(product) {
    const modal = document.getElementById('SectionModel');
    if (!modal) return;

    modal.querySelector('img').src = product.image;
    modal.querySelector('.model-product-category').textContent = product.category;
    modal.querySelector('.model-product-code').textContent = product.code;
    modal.querySelector('.model-product-title').textContent = product.title;
    modal.querySelector('.price-number').textContent = product.price;
    modal.querySelector('.model-all-detelis').textContent = product.description;

    selectedSize = null;
    selectedColor = null;

    const sizesContainer = modal.querySelector('.sizes-container');
    sizesContainer.innerHTML = '';
    
    Object.keys(product.stock).forEach(size => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'size-btn';
        btn.textContent = size;
        btn.setAttribute('data-size', size);
        
        const sizeColors = product.stock[size];
        const totalSizeStock = Object.values(sizeColors).reduce((sum, qty) => sum + qty, 0);
        
        if (totalSizeStock <= 0) {
            btn.classList.add('disabled');
        }

        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            sizesContainer.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedSize = size;
            
            updateColorsAvailability(product, size);
        });

        sizesContainer.appendChild(btn);
    });

    const colorsContainer = modal.querySelector('.colors-container');
    colorsContainer.innerHTML = '';
    
    let allColors = [];
    Object.values(product.stock).forEach(colorsObj => {
        Object.keys(colorsObj).forEach(color => {
            if (!allColors.includes(color)) allColors.push(color);
        });
    });

    allColors.forEach(color => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-btn';
        btn.textContent = color;
        btn.setAttribute('data-color', color);

        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            
            if (!selectedSize) {
                alert("من فضلك اختر المقاس أولاً!");
                return;
            }

            const stockQty = product.stock[selectedSize]?.[color] ?? 0;
            if (stockQty <= 0) {
                alert("عذراً، هذا اللون غير متوفر للمقاس المختار!");
                return;
            }

            colorsContainer.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedColor = color;
        });

        colorsContainer.appendChild(btn);
    });

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // منع التمرير في الخلفية
}

function updateColorsAvailability(product, size) {
    const modal = document.getElementById('SectionModel');
    const colorBtns = modal.querySelectorAll('.color-btn');
    
    colorBtns.forEach(btn => {
        const color = btn.getAttribute('data-color');
        const qty = product.stock[size]?.[color] ?? 0;
        
        if (qty <= 0) {
            btn.classList.add('disabled');
            if (selectedColor === color) {
                btn.classList.remove('active');
                selectedColor = null;
            }
        } else {
            btn.classList.remove('disabled');
        }
    });
}

// ==========================================
// 4. دوال السلة، الخصم، وإتمام الطلب
// ==========================================
function updateCartTotals() {
    const subtotalEl = document.getElementById('subtotalVal');
    const totalEl = document.getElementById('totalVal');
    const discountEl = document.getElementById('discountVal');

    let subtotal = cartData.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let discountAmount = subtotal * appliedDiscountRate;
    let finalTotal = subtotal - discountAmount;

    if (subtotalEl) subtotalEl.textContent = `${subtotal} EGP`;
    if (discountEl) discountEl.textContent = `${discountAmount} EGP`;
    if (totalEl) totalEl.textContent = `${finalTotal} EGP`;
}

function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const template = document.getElementById('cartItemTemplate');
    
    if (!container || !template) return;

    container.querySelectorAll('.cart-product-card:not(#cartItemTemplate)').forEach(el => el.remove());

    cartData.forEach((item, index) => {
        const card = template.cloneNode(true);
        card.removeAttribute('id');
        card.style.display = 'flex';

        card.querySelector('.cart-product-img').src = item.image;
        card.querySelector('.cart-product-title').textContent = item.title;
        card.querySelector('.p-size').textContent = item.size;
        card.querySelector('.p-color').textContent = item.color;
        card.querySelector('.cart-item-price').textContent = `${item.price} EGP`;
        card.querySelector('.qty-value').textContent = item.quantity;
        card.querySelector('.p-total').textContent = item.price * item.quantity;

        card.querySelector('.increase').addEventListener('click', () => {
            // التحقق من المخزون المتاح للمنتج باللون والمقاس المختار
            const product = productsData.find(p => p.id === item.id);
            const availableStock = product?.stock?.[item.size]?.[item.color] ?? 0;

            if (cartData[index].quantity >= availableStock) {
                alert(`عذراً، الكمية المطلوبة غير متوفرة. المتاح بالمخزون لهذا المقاس واللون هو ${availableStock} قطع فقط.`);
                return;
            }

            cartData[index].quantity += 1;
            saveCartToLocalStorage();
            renderCart();
            updateCartTotals();
        });

        card.querySelector('.decrease').addEventListener('click', () => {
            if (cartData[index].quantity > 1) {
                cartData[index].quantity -= 1;
                saveCartToLocalStorage();
                renderCart();
                updateCartTotals();
            }
        });

        card.querySelector('.remove-item-btn').addEventListener('click', () => {
            cartData.splice(index, 1);
            saveCartToLocalStorage();
            renderCart();
            updateCartTotals();
        });

        container.appendChild(card);
    });

    updateCartTotals();
}

function saveCartToLocalStorage() {
    localStorage.setItem('dart_cart', JSON.stringify(cartData));
}

function initCartAndCheckoutEvents() {
    const cartView = document.getElementById('cartView');
    const checkoutView = document.getElementById('checkoutView');
    const toCheckoutBtn = document.getElementById('toCheckoutBtn');
    const checkoutForm = document.getElementById('checkoutForm');
    const modalBuyBtn = document.getElementById('modalBuyBtn');
    
    const discountBtn = document.getElementById('applyDiscountBtn');
    const discountInput = document.getElementById('discountInput');

    if (cartView) cartView.style.display = 'block';

    renderCart();

    if (modalBuyBtn) {
        modalBuyBtn.addEventListener('click', () => {
            if (!selectedSize) {
                alert("من فضلك اختر المقاس!");
                return;
            }
            if (!selectedColor) {
                alert("من فضلك اختر اللون!");
                return;
            }

            cartData.push({
                id: activeProduct.id,
                title: activeProduct.title,
                price: activeProduct.price,
                size: selectedSize,
                color: selectedColor,
                quantity: 1,
                image: activeProduct.image
            });

            saveCartToLocalStorage();
            alert("تم إضافة المنتج إلى السلة بنجاح!");
            const modal = document.getElementById('SectionModel');
            if (modal) {
                modal.style.display = 'none';
                document.body.style.overflow = 'auto'; // إعادة التمرير بعد الشراء
            }
            renderCart();
        });
    }

    if (discountBtn && discountInput) {
        discountBtn.addEventListener('click', () => {
            const code = discountInput.value.trim().toUpperCase();
            if (code === "DART10") {
                appliedDiscountRate = 0.10;
                alert("تم تطبيق خصم 10% بنجاح!");
            } else if (code === "DART20") {
                appliedDiscountRate = 0.20;
                alert("تم تطبيق خصم 20% بنجاح!");
            } else {
                appliedDiscountRate = 0;
                alert("كود الخصم غير صحيح!");
            }
            updateCartTotals();
        });
    }

    if (toCheckoutBtn && checkoutView) {
        toCheckoutBtn.addEventListener('click', () => {
            if (cartData.length === 0) {
                alert("السلة فارغة، أضف منتجات أولاً!");
                return;
            }
            checkoutView.style.display = 'block';
            window.scrollTo({ top: checkoutView.offsetTop, behavior: 'smooth' });
        });
    }

    if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
            e.preventDefault();
            cartData = [];
            saveCartToLocalStorage();
            appliedDiscountRate = 0;
            alert("تم إتمام طلبك بنجاح! شكراً لك.");
            window.location.href = "index.html";
        });
    }
}

// ==========================================
// 5. التشغيل عند تحميل الصفحة
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSection('header-container', 'sections/Nav-Bar.html'),
        loadSection('search-serial-container', 'sections/search-serial.html'),
        loadSection('leaderboard-card', 'sections/leaderboard-card.html'),
        loadSection('birthday', 'sections/birthday.html'),
        loadSection('feedback-form', 'sections/form-feedback.html'),
        loadSection('return-form', 'sections/form-return.html'),
        loadSection('contact-form', 'sections/form-contact.html'),
        loadSection('story', 'sections/story.html'),
        loadSection('dart-for-you', 'sections/dart-for-you.html'),
        loadSection('birthday-details', 'sections/birthday-details.html'),
        loadSection('card-details', 'sections/card.html'),
        loadSection('why', 'sections/why-dart.html'),
        loadSection('footer', 'sections/footer.html'),
    ]);

    initHeader();
    renderProductsLogic();
    renderReviewsLogic();
    initCartAndCheckoutEvents();
});





