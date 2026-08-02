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
document.addEventListener('DOMContentLoaded', function () {
    let lastScrollTop = 0;
    const headerNav = document.querySelector('.hedar-nav');
    const iconMenu = document.querySelector('.icon-menu');
    const sideMenu = document.querySelector('.side-menu');

    // التأكد من وجود الهيدر في الصفحة
    if (!headerNav) return;

    // 1. إدارة القائمة الجانبية (فتح/إغلاق)
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
    }

    // 2. إظهار وإخفاء الهيدر عند السكرول
    window.addEventListener('scroll', function () {
        let currentScroll = window.scrollY || document.documentElement.scrollTop;

        // التمرير لأسفل: إخفاء الهيدر (وإغلاق المنيو الجانبية لو مفتوحة)
        if (currentScroll > lastScrollTop && currentScroll > headerNav.offsetHeight) {
            headerNav.style.transform = 'translateY(-100%)';
            if (sideMenu) sideMenu.classList.remove('active');
        } 
        // التمرير لأعلى: إظهار الهيدر فوراً
        else if (currentScroll < lastScrollTop) {
            headerNav.style.transform = 'translateY(0)';
        }

        lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;
    });
});

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
    ]);

    // يشتغل بعد ما Nav-Bar ينزل تماماً في الـ DOM
    initHeader();
});
