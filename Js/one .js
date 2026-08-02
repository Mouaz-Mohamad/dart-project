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

// ==========================================
// 2. الدوال المساعدة
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

function isThreeWords(name) {
    const words = name.trim().split(/\s+/);
    return words.length === 3;
}

// دالة عرض المنتجات
function renderProductsLogic() {
    const productTemplate = document.getElementById('productTemplate');
    if (!productTemplate) return;

    // 1. الصفحة الرئيسية (عرض 10 منتجات - لو الكونتينر موجود)
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

    // 2. صفحة كل المنتجات (مقسمة لجزأين: أول 7 فوق، والباقي تحت السكاشن)
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

            // أول 7 منتجات يروحوا في القسم الأول، وباقي المنتجات في القسم الثاني
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
// 3. التنفيذ بالترتيب الصحيح
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
});


let cartData = [
    { id: 1, title: "تيشيرت بيزك", price: 540, size: "M", color: "black", quantity: 1, image: "Photos/products/1.jpg" },
    { id: 1, title: "تيشيرت بيزك", price: 860, size: "M", color: "black", quantity: 1, image: "Photos/products/1.jpg" },
];

let appliedDiscountRate = 0; // نسبة الخصم الافتراضية 0

document.addEventListener('DOMContentLoaded', () => {
    const cartView = document.getElementById('cartView');
    const checkoutView = document.getElementById('checkoutView');
    const toCheckoutBtn = document.getElementById('toCheckoutBtn');
    const applyDiscountBtn = document.getElementById('applyDiscountBtn');
    
    renderCart();

    // الانتقال لواجهة إتمام الطلب
    toCheckoutBtn.addEventListener('click', () => {
        cartView.style.display = 'none';
        checkoutView.style.display = 'block';
        renderCheckoutSummary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // تفعيل زر Apply للكوبون
    applyDiscountBtn.addEventListener('click', () => {
        const discountInput = document.getElementById('discountInput').value.trim();
        
        // مثال: لو دخل كوبون اسمه "DART10" هياخد 10% خصم
        if (discountInput === "DART10") {
            appliedDiscountRate = 0.10; // 10% خصم
            alert("تم تطبيق الكوبون بنجاح!");
        } else if (discountInput === "") {
            appliedDiscountRate = 0;
            alert("من فضلك أدخل كود الخصم");
        } else {
            appliedDiscountRate = 0;
            alert("كود الخصم غير صحيح");
        }
        
        renderCheckoutSummary(); // تحديث الحسابات بعد الكوبون
    });
});

function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const template = document.getElementById('cartItemTemplate');
    
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

    // حساب قيمة الخصم والإجمالي النهائي
    let discountAmount = subtotal * appliedDiscountRate;
    let finalTotal = subtotal - discountAmount;

    document.getElementById('subtotalVal').textContent = `${subtotal} EGP`;
    document.getElementById('discountVal').textContent = `${discountAmount} EGP`;
    document.getElementById('totalVal').textContent = `${finalTotal} EGP`;
}