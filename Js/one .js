// ==========================================
// 1. مصفوفات البيانات (المنتجات والتقييمات)
// ==========================================
const productsData = [
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 749, image: "Photos/products/1.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/2.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/3.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/4.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/5.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/6.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/7.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/9.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/10.jpg" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/11.jfif" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/12.jfif" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/13.jfif" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/14.jfif" },
    { category: "قمصان", title: "قميص جينز | بيج", code: "DA-T695", price: 849, image: "Photos/products/15.jfif" }
];

const reviewsData = [
    { name: "سارة محمود", date: "15 يوليو 2026", rating: 5, title: "خامة ممتازة وتقفيل محترم", comment: "القماش مريح جداً في اللبس والتقفيل نضيف مفيش خيوط طالعة، المقاس مضبوط بالظبط زي الجدول. أكيد هطلب تاني" },
    { name: "خالد علي", date: "10 يوليو 2026", rating: 5, title: "شيك ومريح جداً", comment: "التصميم جميل وعصري والألوان نفس الصور بالظبط والتوصيل سريع." },
    { name: "أحمد حسام", date: "02 يوليو 2026", rating: 4, title: "مقاس مظبوط خامة جيدة", comment: "الخامة جيدة جداً بالنسبة للسعر والمقاس جه مظبوط بظبط." },
    { name: "مريم إبراهيم", date: "28 يونيو 2026", rating: 5, title: "خدمة عملاء رائعة", comment: "المنتج ممتاز والتغليف شيك جداً، هطلب منكم تاني أكيد." }
];

// المتغيرات العامة للسلة والخصم
let cartData = [
    { id: 1, title: "تيشيرت بيزك", price: 540, size: "M", color: "black", quantity: 1, image: "Photos/products/1.jpg" },
    { id: 2, title: "تيشيرت بيزك", price: 860, size: "M", color: "black", quantity: 1, image: "Photos/products/1.jpg" },
];
let appliedDiscountRate = 0;

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

// دالة عرض المنتجات
function renderProductsLogic() {
    const productTemplate = document.getElementById('productTemplate');
    if (!productTemplate) return;

    const productsContainer = document.getElementById('productsContainer');
    if (productsContainer) {
        const mainPageProducts = productsData.slice(0, 10);
        mainPageProducts.forEach(item => {
            const card = productTemplate.cloneNode(true);
            card.removeAttribute('id');
            card.style.display = 'flex';

            card.querySelector('.product-img').src = item.image;
            card.querySelector('.product-img').alt = item.title;
            card.querySelector('.product-category').textContent = item.category;
            card.querySelector('.product-title').textContent = item.title;
            card.querySelector('.product-code').textContent = `كود : ${item.code}`;
            card.querySelector('.product-price').textContent = `EGP ${item.price}`;

            productsContainer.appendChild(card);
        });
    }

    const productsPart1 = document.getElementById('productsPart1');
    const productsPart2 = document.getElementById('productsPart2');

    if (productsPart1 || productsPart2) {
        productsData.forEach((item, index) => {
            const card = productTemplate.cloneNode(true);
            card.removeAttribute('id');
            card.style.display = 'flex';

            card.querySelector('.product-img').src = item.image;
            card.querySelector('.product-img').alt = item.title;
            card.querySelector('.product-category').textContent = item.category;
            card.querySelector('.product-title').textContent = item.title;
            card.querySelector('.product-code').textContent = `كود : ${item.code}`;
            card.querySelector('.product-price').textContent = `EGP ${item.price}`;

            if (index < 6) {
                if (productsPart1) productsPart1.appendChild(card);
            } else {
                if (productsPart2) productsPart2.appendChild(card);
            }
        });
    }
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
// 3. دوال السلة وإتمام الطلب
// ==========================================
function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const template = document.getElementById('cartItemTemplate');
    
    if (!container || !template) return;

    container.querySelectorAll('.cart-product-card:not(#cartItemTemplate)').forEach(el => el.remove());

    if (cartData.length === 0) {
        return;
    }

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
            cartData[index].quantity += 1;
            renderCart();
        });

        card.querySelector('.decrease').addEventListener('click', () => {
            if (cartData[index].quantity > 1) {
                cartData[index].quantity -= 1;
                renderCart();
            }
        });

        card.querySelector('.remove-item-btn').addEventListener('click', () => {
            cartData.splice(index, 1);
            renderCart();
        });

        container.appendChild(card);
    });
}

function renderCheckoutSummary() {
    const summaryContainer = document.getElementById('checkoutSummaryContainer');
    if (!summaryContainer) return;
    
    summaryContainer.innerHTML = '';

    let subtotal = 0;

    cartData.forEach(item => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;

        const box = document.createElement('div');
        box.className = 'cart-product-card';
        box.innerHTML = `
            <img src="${item.image}" alt="" class="cart-product-img">
            <div class="cart-product-info">
                <div class="cart-product-title">${item.title}</div>
                <div class="cart-product-specs">size : ${item.size} | color : ${item.color}</div>
                <div class="cart-product-price-qty">
                    <span class="cart-item-price">${item.price} EGP</span>
                    <span>Qty: ${item.quantity}</span>
                </div>
                <div class="cart-item-total-price">Total: ${itemTotal} EGP</div>
            </div>
        `;
        summaryContainer.appendChild(box);
    });

    let discountAmount = subtotal * appliedDiscountRate;
    let finalTotal = subtotal - discountAmount;

    const subtotalVal = document.getElementById('subtotalVal');
    const discountVal = document.getElementById('discountVal');
    const totalVal = document.getElementById('totalVal');

    if (subtotalVal) subtotalVal.textContent = `${subtotal} EGP`;
    if (discountVal) discountVal.textContent = `${discountAmount} EGP`;
    if (totalVal) totalVal.textContent = `${finalTotal} EGP`;
}

function initCartAndCheckoutEvents() {
    const cartView = document.getElementById('cartView');
    const checkoutView = document.getElementById('checkoutView');
    const toCheckoutBtn = document.getElementById('toCheckoutBtn');
    const applyDiscountBtn = document.getElementById('applyDiscountBtn');
    const checkoutForm = document.getElementById('checkoutForm');

    renderCart();

    if (toCheckoutBtn && cartView && checkoutView) {
        toCheckoutBtn.addEventListener('click', () => {
            if (cartData.length === 0) {
                alert("السلة فارغة، أضف منتجات أولاً!");
                return;
            }
            cartView.style.display = 'none';
            checkoutView.style.display = 'block';
            renderCheckoutSummary();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (applyDiscountBtn) {
        applyDiscountBtn.addEventListener('click', () => {
            const discountInputEl = document.getElementById('discountInput');
            if (!discountInputEl) return;
            const discountInput = discountInputEl.value.trim();
            
            if (discountInput === "DART10") {
                appliedDiscountRate = 0.10;
                alert("تم تطبيق الكوبون بنجاح!");
            } else if (discountInput === "") {
                appliedDiscountRate = 0;
                alert("من فضلك أدخل كود الخصم");
            } else {
                appliedDiscountRate = 0;
                alert("كود الخصم غير صحيح");
            }
            renderCheckoutSummary();
        });
    }

    // تفريغ السلة والرجوع لصفحة الـ index عند إتمام الطلب
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // 1. تصفير السلة
            cartData = [];
            appliedDiscountRate = 0;
            
            alert("تم إتمام طلبك بنجاح! شكراً لك.");

            // 2. التوجيه لصفحة index.html (لو الموقع صفحات منفصلة)
            // أو لو الموقع صفحة واحدة SPA، استبدل السطر اللي تحت بـ window.location.href = "index.html"
            window.location.href = "index.html";
        });
    }
}

// ==========================================
// 4. نقطة التنفيذ الرئيسية (DOM Loaded)
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