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
    ]);

    // يشتغل بعد ما Nav-Bar ينزل تماماً في الـ DOM
    initHeader();
});
