# Dart — دليل قراءة وصيانة الكود

ابدأ من الصفحة أو مسار API الذي تريد تعديله، ثم اتبع الجدول التالي إلى المصدر المسؤول.

## أوامر العمل

| الغرض | الأمر من جذر المشروع |
| --- | --- |
| بناء الواجهة وتجهيز ملفات النشر | `npm run build` |
| بناء JavaScript فقط | `npm run build:js` |
| فحص ملكية المصادر وتنسيقها وصحتها | `npm run check:source` |
| جميع فحوصات الواجهة الثابتة | `npm run test:frontend` |
| فحص الخادم | `npm --prefix backend run check` |
| بناء الخادم | `npm --prefix backend run build` |

اختبارات المتصفح وأوامر تشغيلها مصنفة في `tests/test-inventory.json` ومربوطة بـ `.github/workflows/frontend-ci.yml`.

## أين أعدّل الواجهة؟

| المهمة | المصدر المسؤول |
| --- | --- |
| ترتيب الأقسام وبدء تشغيل الداشبورد | `src/dashboard/core/navigation-events.js` و`startup-final.js` وترتيبهما في `src/runtime-layout.json` |
| حالات الطلبات | `src/dashboard/core/order-workflow.js` |
| المرتجعات والفحص | `src/dashboard/core/return-workflow.js` و`return-editor.js` |
| عرض الطلبات ومجموعاتها | `src/dashboard/core/orders-returns.js` |
| نماذج العملاء والمندوبين | `src/dashboard/core/record-editors.js` |
| نموذج الطلب والبحث | `src/dashboard/core/order-editor-search.js` |
| الفلاتر | `src/dashboard/core/filters.js` و`inventory-filters.js` |
| إحصاءات البراند | `src/dashboard/core/brand-analytics.js` و`analytics-series.js` |
| صفوف الداشبورد والألوان والتفاصيل | `src/dashboard/dashboard-ui.js` و`Eye/dart-dashboard-ui.css` |
| الموظفون والصلاحيات الأمامية | `src/dashboard/staff-admin.js` و`staff-permissions.js` |
| الأخبار والأطقم في الداشبورد | `src/dashboard/news-admin.js` و`sets-admin.js` |
| القطع والموديلات | `Eye/dart-inventory.js` و`src/dashboard/catalog-admin.js` |
| المالية والإعدادات والانتظار | `Eye/dart-finance.js` و`dart-settings.js` و`dart-waiting.js` |
| تسجيل العملاء ونماذج الدخول | `src/storefront/platform/authentication.js` و`auth-forms.js` |
| الحجز والسلة وإتمام الطلب | `src/storefront/platform/cart.js` و`checkout.js` |
| بيانات العميل والملف الشخصي | `src/storefront/platform/customer-state.js` و`profile.js` |
| هوية الزائر والزيارات | `src/storefront/platform/analytics-identity.js` |
| عيد الميلاد والولاء | `src/storefront/platform/birthday-rewards.js` و`birthday-ui.js` |
| بداية تشغيل منصة العميل وواجهتها العامة | `src/storefront/platform/lifecycle.js` و`public-api.js` |
| واجهة Home المخصصة | `src/storefront/home-ui.js` |
| الواجهة المشتركة والتنقل والكتالوج | `Js/dart-ui.js` و`dart-navigation.js` و`dart-catalog.js` |
| تتبع الطلب وواجهة المندوب | `Js/dart-tracking.js` و`dart-rep.js` |
| التنسيق العام | `CSS/base.css` ثم المسؤوليات الحالية في `CSS/main.css` و`CSS/responsive.css` |

`Eye/dart.js` و`Js/dart-platform.js` ملفات تشغيل مولدة، وليسا مكان التعديل اليدوي. قائمة المصادر الكاملة وترتيبها في `src/runtime-layout.json`. لا تغيّر ترتيبها لمجرد ترتيب الأسماء أبجديًا؛ ترتيب تسجيل الأحداث وتعريف الحالة مقصود. الصفحة ما زالت تحمل نفس ملفات التشغيل، والمصادر لا تتحول إلى طلبات شبكة إضافية.

## أين أعدّل الخادم؟

| الجزء | المصدر |
| --- | --- |
| إنشاء الخدمات | `backend/src/app.ts` |
| تجميع Express والحماية والـRouters | `backend/src/application.ts` |
| عقود HTTP | `backend/openapi.yaml` و`docs/API_CONTRACT.md` |
| التحقق من مدخلات التجارة والصلاحيات | `backend/src/modules/commerce/commerce.routes.ts` |
| عمليات كتابة الطلبات والحجز والمرتجعات | `backend/src/modules/commerce/commerce.service.ts` |
| أنواع التجارة المشتركة | `backend/src/modules/commerce/commerce.types.ts` |
| حساب سعر القطعة والخصم | `backend/src/modules/commerce/commerce.pricing.ts` |
| أدوات التواريخ وأهلية الحملات | `backend/src/modules/commerce/commerce.rewards.ts` |
| ترتيب محطات المندوب | `backend/src/modules/commerce/commerce.routing.ts` |
| قراءة لوحة الترتيب وبيانات العميل والتتبع | `backend/src/modules/commerce/commerce.customer-queries.ts` |
| قراءة العمليات المباشرة وعمل المندوب | `backend/src/modules/commerce/commerce.operations-queries.ts` |
| قراءة الطلبات وإصدارها | `backend/src/modules/commerce/commerce.order-queries.ts` |
| سياسة مخاطر الدفع عند الاستلام | `backend/src/modules/commerce/cod-risk.ts` |
| المصادقة وإدارة الموظفين | `backend/src/modules/identity/` |
| الموديلات والقطع | `backend/src/modules/catalog/` |
| المالية | `backend/src/modules/finance/` |
| الانتظار والأطقم والأخبار | `backend/src/modules/waiting/` و`sets/` و`news/` |
| الحملات وسحب Dart Card | `backend/src/modules/promotions/` و`loyalty/` |
| الإشعارات والطوابير | `backend/src/modules/outbox/` |
| ترحيلات قاعدة البيانات | `backend/migrations/` |

## قواعد الصيانة

- PostgreSQL والخادم هما مصدر الحقيقة للسعر والمخزون والخصومات والصلاحيات.
- احتفظ بأسعار الطلب التاريخية. لا تستبدلها بسعر الموديل الحالي.
- مصدر منطق الخصم الحالي وقواعد استعادته هو `docs/DISCOUNT_POLICY_AR.md` وتعليمات المستخدم الأحدث.
- اترك معاملات الكتابة وأقفالها وسجلات التدقيق مترابطة؛ فصل ملفات القراءة لا يمنحها صلاحية كتابة جديدة.
- لا تعدّل ترحيل قاعدة بيانات سبق تطبيقه.
- عدّل المصدر الوحيد، ثم ابنِ ملفات التشغيل وأدرج الاثنين في نفس الالتزام.
- شغّل الفحوصات المتعلقة بالجزء المعدل ومراجعة `.agents/skills/dart-quality-review/SKILL.md` قبل الرفع.
- خرائط الأنظمة والتوثيق التفصيلي في `docs/CODE_MAP.md` و`src/README.md` و`backend/README.md`.
