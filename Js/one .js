// دالة استدعاء السكاشن
async function loadSection(containerId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const html = await response.text();
        
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = html;
    } catch (error) {
        console.error(`خطأ في تحميل (${filePath}):`, error);
    }
}

// دالة تفعيل المنيو بالأسماء الصحيحة من الـ HTML بتاعك
function initHeader() {
    const iconMenu = document.querySelector('.icon-menu');
    const sideMenu = document.querySelector('.side-menu');

    if (iconMenu && sideMenu) {
        // فتح وإغلاق القائمة عند الضغط على الأيقونة
        iconMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            sideMenu.classList.toggle('active');
        });

        // إغلاق القائمة عند الضغط في أي مكان خارجها
        document.addEventListener('click', (event) => {
            if (!sideMenu.contains(event.target) && !iconMenu.contains(event.target)) {
                sideMenu.classList.remove('active');
            }
        });

        // إغلاق القائمة عند عمل سكرول للشاشة
        window.addEventListener('scroll', () => {
            sideMenu.classList.remove('active');
        });
    }
}

//للتاكد من خانه الاسم ان بها ثلاث اسماء 
function isThreeWords(name) {
  // بنشيل المسافات الزايدة ونقسم النص بناءً على المسافات
    const words = name.trim().split(/\s+/);
    return words.length === 3;
}

// استدعاء السكاشن ثم تشغيل المنيو
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSection('header-container', './sections/Nav-Bar.html'),
        loadSection('search-serial-container', './sections/search-serial.html'),
        loadSection('leaderboard-card', './sections/leaderboard-card.html'),
        loadSection('birthday', './sections/birthday.html'),
        loadSection('feedback-form', './sections/form-feedback.html'),
        loadSection('return-form', './sections/form-return.html'),
        loadSection('contact-form', './sections/form-contact.html'),
        loadSection('story', './sections/story.html'),
        loadSection('dart-for-you', './sections/dart-for-you.html'),
        loadSection('birthday-details', './sections/birthday-details.html'),
        loadSection('card-details', './sections/card.html'),
        loadSection('why', './sections/why-dart.html'),
        loadSection('footer', './sections/footer.html'),
    ]);

    // يشتغل بعد ما Nav-Bar ينزل تماماً في الـ DOM
    initHeader();
});



    // ==========================================
    // 1. مصفوفة المنتجات (أنواع مختلفة)
    // ==========================================
    const productsData = [
    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 749, 
        image: "../Photos/products/1.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/2.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/3.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/4.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/5.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/6.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/7.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/9.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/10.jpg" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/11.jfif" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/12.jfif" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/13.jfif" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/14.jfif" },

    { category: "قمصان",
        title: "قميص جينز | بيج", 
        code: "DA-T695", 
        price: 849, 
        image: "../Photos/products/15.jfif" },
    ];

    // عناصر المنتجات
    const productsContainer = document.getElementById('productsContainer');
    const productTemplate = document.getElementById('productTemplate');

    // أخذ أول 12 منتج فقط للعرض في index.html
    const mainPageProducts = productsData.slice(0, 12);

    mainPageProducts.forEach(item => {
    const card = productTemplate.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';

    card.querySelector('.product-img').src = item.image;
    card.querySelector('.product-img').alt = item.title;
    card.querySelector('.product-category').textContent = item.category; // إضافة النوع
    card.querySelector('.product-title').textContent = item.title;
    card.querySelector('.product-code').textContent = `كود : ${item.code}`;
    card.querySelector('.product-price').textContent = `EGP ${item.price}`;

    productsContainer.appendChild(card);
    });

    // ==========================================
    // 2. مصفوفة التقييمات (عرض بالكامل)
    // ==========================================
    const reviewsData = [
    {
        name: "سارة محمود",
        date: "15 يوليو 2026",
        rating: 5,
        title: "خامة ممتازة وتقفيل محترم",
        comment: "القماش مريح جداً في اللبس والتقفيل نضيف مفيش خيوط طالعة، المقاس مضبوط بالظبط زي الجدول. أكيد هطلب تاني",
    },
    {
        name: "خالد علي",
        date: "10 يوليو 2026",
        rating: 5,
        title: "شيك ومريح جداً",
        comment: "التصميم جميل وعصري والألوان نفس الصور بالظبط والتوصيل سريع.",
    },
    {
        name: "أحمد حسام",
        date: "02 يوليو 2026",
        rating: 4,
        title: "مقاس مظبوط خامة جيدة",
        comment: "الخامة جيدة جداً بالنسبة للسعر والمقاس جه مظبوط بظبط.",
    },
    {
        name: "مريم إبراهيم",
        date: "28 يونيو 2026",
        rating: 5,
        title: "خدمة عملاء رائعة",
        comment: "المنتج ممتاز والتغليف شيك جداً، هطلب منكم تاني أكيد.",
    }
    ];

    // عناصر الريفيوز
    const reviewsContainer = document.getElementById('reviewsContainer');
    const reviewTemplate = document.getElementById('reviewTemplate');

    // عرض جميع التقييمات بدون slice
    reviewsData.forEach(item => {
    const card = reviewTemplate.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';

    // رسم النجوم
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