// ==========================================
// 1. مصفوفات البيانات (المنتجات، التقييمات، والمخزون)
// ==========================================
const productsData = [
    {
        id: 1,
        category: "shirt",
        title: "Wide leg jeans",
        code: "DA-P785",
        price: 450,
        image: "Photos/products/1.jpg",
        description: "بنطال جينز فاخر بأرجل واسعة ومصنوع من القطن الخالص بنسبة 100%، ليمنحك قصة مريحة، وراحة تدوم طويلاً، وإطلالة يومية عفوية وأنيقة.",
        stock: {
            "32": { "نيلي": 0, "بيج": 0, "ابيض": 0, "اسود": 0 },
            "34": { "نيلي": 0, "بيج": 0, "ابيض": 0, "اسود": 0 },
            "36": { "نيلي": 0, "بيج": 0, "ابيض": 0, "اسود": 0 }
        }
    },
    {
        id: 2,
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
        title: "قميص جينز | بيج",
        code: "DA-T695",
        price: 749,
        image: "/Photos/products/15.jfif",
        description: "قميص أنيق بتصميم عصري يناسب جميع الأوقات، خامة عالية الجودة ومريحة جداً.",
        stock: {
            "32": { "نيلي": 2, "بيج": 2, "ابيض": 2, "اسود": 2 },
            "34": { "نيلي": 1, "بيج": 0, "ابيض": 3, "اسود": 1 },
            "36": { "نيلي": 0, "بيج": 1, "ابيض": 1, "اسود": 2 }
        }
    },
    {
        id: 6,
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "jeans",
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
        category: "T-shirt",
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

let cachedProductTemplate = null;

function getProductTemplate() {
    if (!cachedProductTemplate) {
        const templateEl = document.getElementById('productTemplate');
        if (templateEl) {
            cachedProductTemplate = templateEl.cloneNode(true);
        }
    }
    return cachedProductTemplate;
}

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
    const menuFacke = document.querySelector('.menu-facke');

    if (iconMenu) {
        iconMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sideMenu) sideMenu.classList.toggle('active');
            if (menuFacke) menuFacke.classList.toggle('active');
        });

        document.addEventListener('click', (event) => {
            if (sideMenu && !sideMenu.contains(event.target) && !iconMenu.contains(event.target)) {
                sideMenu.classList.remove('active');
            }
            if (menuFacke && !menuFacke.contains(event.target) && !iconMenu.contains(event.target)) {
                menuFacke.classList.remove('active');
            }
        });

        window.addEventListener('scroll', () => {
            if (sideMenu) sideMenu.classList.remove('active');
            if (menuFacke) menuFacke.classList.remove('active');
        });
    }
}

function renderProductsLogic() {
    const productTemplate = document.getElementById('productTemplate');
    if (!productTemplate) return;

    const productsContainer = document.getElementById('productsContainer');
    if (productsContainer) {
        const homeProducts = productsData.slice(0, 8);
        homeProducts.forEach(item => {
            const card = createProductCard(item, productTemplate);
            productsContainer.appendChild(card);
        });
    }

    const bestProductsContainer = document.getElementById('bestProductsContainer');
    if (bestProductsContainer) {
        const bestProducts = productsData.slice(0, 5);
        bestProducts.forEach(item => {
            const card = createProductCard(item, productTemplate);
            bestProductsContainer.appendChild(card);
        });
    }

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

function createProductCard(item, template) {
    const card = template.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';
    card.style.position = 'relative';
    card.setAttribute('data-id', item.id);

    // فحص العناصر قبل استخدامها لتفادي توقف الكود
    const img = card.querySelector('.product-img');
    if (img) {
        img.src = item.image;
        img.alt = item.title;
    }

    const category = card.querySelector('.product-category');
    if (category) category.textContent = item.category;

    const title = card.querySelector('.product-title');
    if (title) title.textContent = item.title;

    const code = card.querySelector('.product-code');
    if (code) code.textContent = `Code : ${item.code}`;

    const price = card.querySelector('.product-price');
    if (price) price.textContent = `EGP ${item.price}`;

    let totalStock = 0;
    if (item.stock) {
        Object.values(item.stock).forEach(sizeObj => {
            Object.values(sizeObj).forEach(qty => {
                totalStock += qty;
            });
        });
    }

    if (totalStock <= 0) {
        card.classList.add('out-of-stock');
        const badge = document.createElement('span');
        badge.className = 'out-of-stock-badge';
        badge.textContent = 'Out of Stock';
        card.appendChild(badge);
    }

    const cartBtn = card.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.setAttribute('data-id', item.id);
    }

    return card;
}

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
    const productCard = e.target.closest('.product-card');
    const cartBtn = e.target.closest('.cart-btn');

    if (productCard || cartBtn) {
        document.body.classList.add('modal-open');
        const targetElement = cartBtn || productCard;
        const productId = targetElement.getAttribute('data-id');

        activeProduct = productsData.find(p => p.id == productId);
        if (activeProduct) {
            openProductModal(activeProduct);
        }
    }

    if (e.target.closest('.model .fa-x')) {
        closeProductModal();
    }

    const modal = document.getElementById('SectionModel');
    if (e.target === modal) {
        closeProductModal();
    }
});

window.addEventListener('popstate', () => {
    const modal = document.getElementById('SectionModel');
    if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        document.body.classList.remove('modal-open');
    }
});

function closeProductModal() {
    const modal = document.getElementById('SectionModel');
    if (!modal) return;

    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');

    if (history.state && history.state.modalOpen) {
        history.back();
    }
}

function openProductModal(product) {
    const modal = document.getElementById('SectionModel');
    if (!modal) return;

    history.pushState({ modalOpen: true }, "");

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
                showToast("من فضلك اختر المقاس أولاً!");
                return;
            }

            const stockQty = product.stock[selectedSize]?.[color] ?? 0;
            if (stockQty <= 0) {
                showToast("عذراً، هذا اللون غير متوفر للمقاس المختار!");
                return;
            }

            colorsContainer.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedColor = color;
        });

        colorsContainer.appendChild(btn);
    });

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
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

function showToast(message) {
    const existingToast = document.querySelector('.custom-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function updateCartCount() {
    const totalItems = cartData.reduce((sum, item) => sum + (item.quantity || 1), 0);
    
    const elements = document.querySelectorAll('.cart-count, #cartCount');
    elements.forEach(el => {
        el.textContent = totalItems;
        el.style.display = totalItems > 0 ? 'inline-block' : 'none';
    });
}

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
            const product = productsData.find(p => p.id === item.id);
            const availableStock = product?.stock?.[item.size]?.[item.color] ?? 0;

            if (cartData[index].quantity >= availableStock) {
                showToast(`عذراً، المتاح بالمخزون ${availableStock} قطع فقط.`);
                return;
            }

            cartData[index].quantity += 1;
            saveCartToLocalStorage();
            renderCart();
        });

        card.querySelector('.decrease').addEventListener('click', () => {
            if (cartData[index].quantity > 1) {
                cartData[index].quantity -= 1;
                saveCartToLocalStorage();
                renderCart();
            }
        });

        card.querySelector('.remove-item-btn').addEventListener('click', () => {
            cartData.splice(index, 1);
            saveCartToLocalStorage();
            renderCart();
        });

        container.appendChild(card);
    });

    updateCartTotals();
    updateCartCount();
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
                showToast("من فضلك اختر المقاس!");
                return;
            }
            if (!selectedColor) {
                showToast("من فضلك اختر اللون!");
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
            showToast("تم إضافة المنتج إلى السلة بنجاح!");
            updateCartCount();
            showCartBanner(activeProduct.title);
            closeProductModal();
            renderCart();
        });
    }

    if (discountBtn && discountInput) {
        discountBtn.addEventListener('click', () => {
            const code = discountInput.value.trim().toUpperCase();
            if (code === "DART10") {
                appliedDiscountRate = 0.10;
                showToast("تم تطبيق خصم 10% بنجاح!");
            } else if (code === "DART20") {
                appliedDiscountRate = 0.20;
                showToast("تم تطبيق خصم 20% بنجاح!");
            } else {
                appliedDiscountRate = 0;
                showToast("كود الخصم غير صحيح!");
            }
            updateCartTotals();
        });
    }

    if (toCheckoutBtn && checkoutView) {
        toCheckoutBtn.addEventListener('click', () => {
            if (cartData.length === 0) {
                showToast("السلة فارغة، أضف منتجات أولاً!");
                return;
            }
            checkoutView.style.display = 'block';
            window.scrollTo({ top: checkoutView.offsetTop, behavior: 'smooth' });
        });
    }

    if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // فحص وجود موقع من الخريطة/GPS
            const latVal = document.getElementById('lat-input')?.value.trim();
            const addressInputVal = document.getElementById('address-input')?.value.trim();
            const hasGpsAddress = Boolean(latVal || addressInputVal);

            // فحص إدخال أي عنوان يدوياً داخل other-addres
            const manualInputs = document.querySelectorAll('.other-addres input');
            let hasManualAddress = false;
            manualInputs.forEach(inputEl => {
                if (inputEl.value.trim() !== '') {
                    hasManualAddress = true;
                }
            });

            // الشرط: إما إحداثيات/عنوان الخريطة أو أحد الحقول اليدوية
            if (!hasGpsAddress && !hasManualAddress) {
                showToast("يرجى تحديد الموقع على الخريطة أو إدخال العنوان يدوياً لإتمام الطلب!");
                return;
            }

            cartData = [];
            saveCartToLocalStorage();
            appliedDiscountRate = 0;
            updateCartCount();
            showToast("تم إتمام طلبك بنجاح! شكراً لك.");
            setTimeout(() => {
                window.location.href = "index.html";
            }, 1500);
        });
    }
}


// ==========================================
// 5. تهيئة الخريطة والبحث عن العنوان (معتمد على GPS و OpenStreetMap)
// ==========================================
function initAddressMap() {
    const mapElement = document.getElementById('map');
    const input = document.getElementById('address-input');
    const resultsList = document.getElementById('results-list');

    // إخفاء حقول العنوان اليدوي والتحكم في ظهورها عند النقر على السهم
    const otherAddressDiv = document.querySelector('.other-addres');
    const arrowBtn = document.querySelector('.arrwo-for-other-adrees');

    if (otherAddressDiv) {
        otherAddressDiv.style.display = 'none';
    }

    if (arrowBtn && otherAddressDiv) {
        arrowBtn.addEventListener('click', () => {
            const isHidden = otherAddressDiv.style.display === 'none';
            otherAddressDiv.style.display = isHidden ? 'block' : 'none';
        });
    }

    if (!mapElement || typeof L === 'undefined') return;

    try {
        if (window.orderMap) window.orderMap.remove();

        const egyptBounds = L.latLngBounds([22.0, 25.0], [31.7, 37.0]);

        const map = L.map('map', { 
            attributionControl: false,
            zoomControl: false,
            maxBounds: egyptBounds,
            maxBoundsViscosity: 0.8
        }).setView([26.8206, 30.8025], 6);
        
        window.orderMap = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(map);

        setTimeout(() => map.invalidateSize(), 300);

        if (window.ResizeObserver) {
            new ResizeObserver(() => map.invalidateSize()).observe(mapElement);
        }

        const customIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `<div style="color: #ef4444; font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); cursor: pointer;">
                    <i class="fa-solid fa-location-dot"></i>
                   </div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });

        let marker = null;
        let selectedAddressData = null;
        let timeout = null;

        window.getCartAddressData = function() {
            return selectedAddressData || {
                address: input ? input.value : '',
                lat: document.getElementById('lat-input')?.value || null,
                lng: document.getElementById('lng-input')?.value || null
            };
        };

        async function setLocation(lat, lon, addressName = null) {
            const latInp = document.getElementById('lat-input');
            const lngInp = document.getElementById('lng-input');
            const fmtInp = document.getElementById('formatted-address-input');

            if (latInp) latInp.value = lat;
            if (lngInp) lngInp.value = lon;

            map.setView([lat, lon], 16);

            if (marker) {
                marker.setLatLng([lat, lon]);
            } else {
                marker = L.marker([lat, lon], { draggable: true, icon: customIcon }).addTo(map);

                marker.on('dragend', (e) => {
                    const position = e.target.getLatLng();
                    setLocation(position.lat, position.lng);
                });
            }

            if (!addressName) {
                const loadingHtml = '<div style="display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري جلب العنوان...</div>';
                if (input) input.value = "جاري جلب اسم الشارع...";
                marker.bindPopup(loadingHtml).openPopup();

                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
                    const data = await res.json();
                    addressName = data.display_name || `${lat}, ${lon}`;
                } catch {
                    addressName = `${lat}, ${lon}`;
                }
            }

            if (input) input.value = addressName;
            if (fmtInp) fmtInp.value = addressName;

            selectedAddressData = { address: addressName, lat: lat, lng: lon };
            marker.bindPopup(addressName).openPopup();

            localStorage.setItem('user_last_address', JSON.stringify(selectedAddressData));
        }

        map.on('click', (e) => {
            setLocation(e.latlng.lat, e.latlng.lng);
        });

        const savedLoc = localStorage.getItem('user_last_address');
        if (savedLoc) {
            try {
                const parsed = JSON.parse(savedLoc);
                setLocation(parsed.lat, parsed.lng, parsed.address);
            } catch {
                fetchGPS();
            }
        } else {
            fetchGPS();
        }

        function fetchGPS() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
                    (err) => console.log('تعذر جلب موقع GPS تلقائياً:', err),
                    { enableHighAccuracy: true, timeout: 8000 }
                );
            }
        }

        const controlsGroup = L.control({ position: 'bottomright' });
        controlsGroup.onAdd = function() {
            const container = L.DomUtil.create('div', 'map-controls-container');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '8px';
            container.style.margin = '10px';

            const locateBtn = document.createElement('button');
            locateBtn.type = 'button';
            locateBtn.title = 'العودة لموقعي';
            locateBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i>';
            Object.assign(locateBtn.style, {
                backgroundColor: '#ffffff', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#111827'
            });
            locateBtn.onclick = (e) => { L.DomEvent.stopPropagation(e); fetchGPS(); };

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.title = 'مسح العنوان المحفوظ';
            resetBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            Object.assign(resetBtn.style, {
                backgroundColor: '#ffffff', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#ef4444'
            });
            resetBtn.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                localStorage.removeItem('user_last_address');
                selectedAddressData = null;
                if (input) input.value = '';
                if (document.getElementById('lat-input')) document.getElementById('lat-input').value = '';
                if (document.getElementById('lng-input')) document.getElementById('lng-input').value = '';
                if (document.getElementById('formatted-address-input')) document.getElementById('formatted-address-input').value = '';
                if (marker) map.removeLayer(marker);
                marker = null;
            };

            container.appendChild(locateBtn);
            container.appendChild(resetBtn);
            return container;
        };
        controlsGroup.addTo(map);

        if (input && resultsList) {
            input.addEventListener('input', () => {
                clearTimeout(timeout);
                const query = input.value.trim();

                if (query.length < 2) {
                    resultsList.style.display = 'none';
                    return;
                }

                resultsList.innerHTML = '<li style="color:#888; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري البحث...</li>';
                resultsList.style.display = 'block';

                timeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=eg&addressdetails=1`);
                        const data = await response.json();
                        resultsList.innerHTML = '';

                        if (data && data.length > 0) {
                            data.forEach(item => {
                                const li = document.createElement('li');
                                li.textContent = item.display_name;
                                li.onclick = () => {
                                    setLocation(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
                                    resultsList.style.display = 'none';
                                };
                                resultsList.appendChild(li);
                            });
                        } else {
                            resultsList.innerHTML = '<li style="color:#888; padding:10px;">لم يتم العثور على نتائج داخل مصر</li>';
                        }
                    } catch {
                        resultsList.innerHTML = '<li style="color:red; padding:10px;">حدث خطأ أثناء جلب البيانات</li>';
                    }
                }, 400);
            });

            document.addEventListener('click', (e) => {
                if (e.target !== input) resultsList.style.display = 'none';
            });
        }
    } catch (err) {
        console.error("خطأ في الخريطة:", err);
    }
}

// ==========================================
// 6. الفلترة والبانر
// ==========================================

function filterProductsByCategory(selectedCat) {
    const container = document.getElementById('productsContainer');
    const template = document.getElementById('productTemplate');

    if (!container || !template) return;

    container.innerHTML = '';

    const isAll = !selectedCat || selectedCat.toLowerCase() === 'all';
    const filtered = isAll 
        ? productsData 
        : productsData.filter(item => item.category && item.category.toLowerCase() === selectedCat.toLowerCase());

    filtered.forEach(item => {
        const card = createProductCard(item, template);
        card.classList.add('fade-in');
        container.appendChild(card);
    });
}

function renderFilterButtons() {
    const filterContainer = document.getElementById('filterContainer');
    if (!filterContainer || !productsData.length) return;

    const categories = ['All', ...new Set(productsData.map(p => p.category).filter(Boolean))];

    filterContainer.innerHTML = categories.map((cat, index) => `
        <button type="button" class="filter-btn ${index === 0 ? 'active' : ''}" data-category="${cat}">
            ${cat}
        </button>
    `).join('');

    filterContainer.onclick = function(e) {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const cat = btn.getAttribute('data-category');
        filterProductsByCategory(cat);
    };
}

function showCartBanner(productTitle) {
    let banner = document.getElementById('cartBanner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cartBanner';
        banner.className = 'cart-banner';
        document.body.appendChild(banner);
    }

    banner.innerHTML = `
        <span style="font-size: 13px;">تم إضافة "${productTitle}" للسلة</span>
        <div style="display: flex; gap: 10px; align-items: center;">
            <a href="#cartView" id="bannerGoToCart" style="color: #fff; background: #000; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 12px;">السلة</a>
            <span onclick="document.getElementById('cartBanner').classList.remove('show')" style="cursor: pointer; font-size: 16px; font-weight: bold;">&times;</span>
        </div>
    `;

    banner.classList.add('show');

    clearTimeout(window.cartBannerTimeout);
    window.cartBannerTimeout = setTimeout(() => {
        banner.classList.remove('show');
    }, 2500);
}

// ==========================================
// 7. معلومات المستخدم والملف الشخصي
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.profile-details, .order-info, .return-info');
    if (!sections.length) return;

    function closeAllSections() {
        sections.forEach(sec => sec.classList.remove('active'));
        document.body.classList.remove('no-scroll');
    }

    function openTargetSection(selector) {
        const targetSection = document.querySelector(selector);
        if (targetSection) {
            closeAllSections();
            targetSection.classList.add('active');
            document.body.classList.add('no-scroll');
            history.pushState({ activeSection: selector }, '');
        }
    }

    const profileBtns = document.querySelectorAll('.profile');
    if (profileBtns.length) {
        profileBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.profile-details')));
    }

    const orderBtns = document.querySelectorAll('.orde2r');
    if (orderBtns.length) {
        orderBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.order-info')));
    }

    const returnBtns = document.querySelectorAll('.retur2n');
    if (returnBtns.length) {
        returnBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.return-info')));
    }

    const closeBtns = document.querySelectorAll('.fa-arrow-right-from-bracket');
    if (closeBtns.length) {
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (history.state && history.state.activeSection) {
                    history.back();
                } else {
                    closeAllSections();
                }
            });
        });
    }

    window.addEventListener('popstate', () => {
        closeAllSections();
    });

    sections.forEach(section => {
        let startX = 0;
        let startY = 0;

        section.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }
        }, { passive: true });

        section.addEventListener('touchend', (e) => {
            if (!e.changedTouches || !e.changedTouches[0]) return;

            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;

            if (endX - startX > 100 || endY - startY > 150) {
                if (history.state && history.state.activeSection) {
                    history.back();
                } else {
                    closeAllSections();
                }
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const enterBtns = document.querySelectorAll('.enter-btn');

    enterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const form = btn.closest('form');
            if (form && form.checkValidity()) {
                e.preventDefault();
                window.location.href = '/profile.html';
            }
        });
    });
});

// ==========================================
// 8. صفحة المندوب (Page REP)
// ==========================================

var countdownTimer = null;
var watchId = null;

window.onload = function() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => { console.log("GPS Permission Granted"); },
            (error) => { console.warn("GPS Permission Warning: ", error.message); },
            { enableHighAccuracy: true }
        );
    }

    const savedState = localStorage.getItem('order_45_state');
    if (savedState === 'on_the_way') {
        restoreActiveState();
    } else if (savedState === 'delivered') {
        restoreCompletedState();
    }
};

function startCountdown() {
    const goBtn = document.getElementById('goBtn');
    let count = 3;

    goBtn.disabled = true;
    goBtn.innerText = `Opening Maps in ${count}...`;

    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            goBtn.innerText = `Opening Maps in ${count}...`;
        } else {
            clearInterval(countdownTimer);
            startDelivery();
        }
    }, 1000);
}

function startDelivery() {
    localStorage.setItem('order_45_state', 'on_the_way');
    restoreActiveState();

    const addressText = document.getElementById('customerAddress')?.innerText.trim() || '';
    const encodedAddress = encodeURIComponent(addressText);
    
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}&travelmode=driving`, '_blank');
}

function restoreActiveState() {
    const statusBadge = document.getElementById('orderStatus');
    const goBtn = document.getElementById('goBtn');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (!statusBadge || !goBtn) return;

    statusBadge.innerText = "On the Way (Step 4)";
    statusBadge.className = "rep-status-badge rep-status-active";

    goBtn.style.display = 'none';
    if (completeBtn) completeBtn.style.display = 'flex';
    if (cancelBtn) cancelBtn.style.display = 'flex';
    if (gpsStatus) gpsStatus.style.display = 'block';

    startGpsTracking();
}

function startGpsTracking() {
    if ("geolocation" in navigator && typeof watchId !== 'undefined' && !watchId) {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                console.log(`Driver Lat: ${position.coords.latitude}, Lng: ${position.coords.longitude}`);
            },
            (error) => { console.warn("Tracking Warning: ", error.message); },
            { enableHighAccuracy: true }
        );
    }
}

function cancelDelivery() {
    if (typeof countdownTimer !== 'undefined' && countdownTimer) clearInterval(countdownTimer);
    if (typeof watchId !== 'undefined' && watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    localStorage.removeItem('order_45_state');

    const goBtn = document.getElementById('goBtn');
    const statusBadge = document.getElementById('orderStatus');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (goBtn) {
        goBtn.disabled = false;
        goBtn.innerText = "GO (Start Delivery)";
        goBtn.style.display = 'flex';
    }

    if (statusBadge) {
        statusBadge.innerText = "Assigned (Step 3)";
        statusBadge.className = "rep-status-badge";
    }

    if (completeBtn) completeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (gpsStatus) gpsStatus.style.display = 'none';
}

function completeDelivery() {
    if (typeof watchId !== 'undefined' && watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    localStorage.setItem('order_45_state', 'delivered');
    restoreCompletedState();
}

function restoreCompletedState() {
    const statusBadge = document.getElementById('orderStatus');
    const goBtn = document.getElementById('goBtn');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (!statusBadge) return;

    statusBadge.innerText = "Delivered (Step 5)";
    statusBadge.className = "rep-status-badge rep-status-completed";

    if (goBtn) goBtn.style.display = 'none';
    if (completeBtn) completeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    if (gpsStatus) {
        gpsStatus.style.display = 'block';
        gpsStatus.innerText = "Order Completed";
        gpsStatus.style.color = "#16a34a";
    }
}

// ==========================================
// 9. التشغيل عند تحميل الصفحة
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
    renderFilterButtons();
    renderReviewsLogic();
    initCartAndCheckoutEvents();
    initAddressMap();
    updateCartCount();
});