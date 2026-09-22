# V7 — خريطة الكود

## Backend Foundation V0.1

| المسار | المسؤولية |
|---|---|
| `backend/src/server.ts` | تشغيل Express وإغلاق HTTP/PostgreSQL بصورة آمنة |
| `backend/src/app.ts` | تركيب الـmiddleware والـrate limit وCORS ومسارات `/api/v1` |
| `backend/src/config/` | التحقق الصارم من البيئة والـlogger مع إخفاء الحقول الحساسة |
| `backend/src/database/pool.ts` | اتصال PostgreSQL وفحص الجاهزية |
| `backend/src/database/migrate.ts` | Migrations مرتبة مع checksum وadvisory lock ومنع التنفيذ خارج الترتيب |
| `backend/migrations/0001_platform_foundation.sql` | `audit_logs` و`outbox_events` و`idempotency_keys` |
| `backend/migrations/0002_identity_auth.sql` | أساس حسابات Customer/Staff/Representative والجلسات وEmail OTP وPassword Reset وRBAC |
| `backend/src/database/seed.ts` | Seed تجريبي يتطلب تفعيلًا صريحًا وممنوع في Production |
| `backend/src/modules/health/` | Liveness وReadiness بدون تسريب أخطاء قاعدة البيانات |
| `backend/src/modules/identity/` | تسجيل العملاء والمندوبين، جلسات Dart، Email OTP، وإدارة دخول وصلاحيات Staff بالبريد |
| `backend/src/security/` | Argon2id والتشفير والتطبيع وSession/CSRF tokens |
| `backend/src/middleware/authentication.ts` | التحقق المركزي من الجلسة ونوع الحساب والصلاحية وCSRF |
| `backend/tests/` | اختبارات الإعدادات والصحة والأمان وHTTP Auth والترتيب والـseed واختبارات PostgreSQL المعزولة |
| `backend/openapi.yaml` | عقد Foundation وIdentity/Auth المنفذ؛ بقية العقود داخل `docs/API_CONTRACT.md` |

تم توصيل تسجيل/دخول/ملف العميل وEmail OTP ودخول المندوب وبوابة Staff/Owner بالـBackend عند ضبط `window.DART_API_BASE_URL`. بقية الـDomains تنتقل لاحقًا بعد اعتمادها، ومن دون fallback صامت للمصادقة المحلية في Production.

الملفات الجديدة مقسمة بتعليقات BEGIN / END، وتعليقات BACKEND تحدد نقاط استبدال التخزين المحلي بالخادم. لم يتغير شكل وهوية المشروع الأساسية.

| الملف | المسؤولية |
|---|---|
| Js/dart-catalog.js | مصدر مشترك للتصميمات والقطع، تجميع المخزون، السعر الحالي، نسخة سعر الطلب، تخزين الصور وتحميلها |
| Eye/dart-inventory.js | تبديل Groups / All Items / Items Group، قالب صف القطعة، نافذتا التصميم والقطعة، تنبيه المخزون |
| Eye/dart-inventory.css | تنسيق الجروبات والنوافذ والهاتف، تثبيت رؤوس الجداول ومحاذاتها |
| Eye/dart.js | الربط بأقسام الداشبورد الحالية، حفظ البيانات، ترتيب الأحدث، أولوية العرض وإزالة البيانات التجريبية |
| Js/dart-storefront.js | كرت لكل لون، نافذة التصميم، تزامن الكاروسيل واللون، المقاسات المتاحة والصورة البديلة |
| Js/dart-ui.js | واجهة الموقع الحالية والفلاتر والسلة، مع التفويض للوحدات المشتركة |
| Js/dart-platform.js | حجز القطع وإتمام الطلب وحفظ الأسعار وتحديث الحسابات المحلية |
| Eye/dart-operations.js | تعديل الطلب مع الحفاظ على نسخة أسعار القطع السابقة |
| tests/catalog-browser.js | سيناريوهات متصفح فعلية ببيانات اختبار معزولة |

## العلاقات

Model يملك الأسعار والوصف والمقاسات والألوان. كل Color يملك قائمة مراجع الصور. Item يمثل قطعة مادية فريدة ويرجع إلى التصميم واللون والمقاس. Group نتيجة تجميع محسوبة، وليس نسخة أخرى من القطع. Order يحمل نسخة ثابتة من بيانات البيع والتكلفة وقت إنشائه.

## حدود التنفيذ

الربط الحالي محلي بين صفحات نفس المتصفح ونفس الأصل. فتح الموقع والداشبورد على جهازين مختلفين يحتاج قاعدة بيانات وواجهات خادم؛ لم يتم إنشاء خادم إنتاج في هذه النسخة. لا يكفي تعديل عنوان API وحده: يجب أن يستبدل المطور مستودعات القراءة والكتابة، والحجز، وإتمام الطلب بعمليات خادم موثوقة.

الفلاتر لا تتعطل عند تغيير العرض. تحديد الكل والشطب في تفاصيل مجموعة يعملان على القطع المعروضة ضمن المجموعة. إجمالي المجموعة يشمل سجلاتها، بينما المتاح للبيع يستبعد القطع المشطوبة والمحجوزة وغير الموجودة بالمخزون. الخيارات المرتبطة بقطع أو طلبات تُؤرشف وتُستعاد بدل إتلاف العلاقة.

## إضافات V9

| الملف | الإضافة |
|---|---|
| `Js/dart-platform.js` | ساعة عيد الميلاد بتوقيت القاهرة، دورة حياة الخصم، أولوية Checkout، الاحتفال والعداد، شريط النافبار، البحث المطور، Leaderboard وكرت البروفايل الديناميكي |
| `Js/dart-ui.js` | عرض وتثبيت خصم عيد الميلاد التلقائي داخل إجماليات Checkout |
| `Js/dart-tracking.js` | استبعاد الطلبات Delivered من صفحة التتبع النشط |
| `Eye/dart.js` | بوكس مواليد الغد، منح Dart Card يدويًا، خياري الحذف النهائي، واسترجاع رصيد الكارت بعد المرتجع المكتمل |
| `CSS/main.css` + `CSS/responsive.css` | قواعد المكونات الأساسية في Main CSS، والاستجابات فقط داخل Responsive CSS |
| `tests/dashboard-v9-unit.js` | اختبار بيانات معزول لطابور مواليد الغد وخياري الحذف فقط/مع البيانات المرتبطة |
| `tests/v9-requested-features.js` | فحص ثابت لجميع عقود الواجهة المطلوبة في V9 |

## إضافات Finance V1

| الملف | الإضافة |
|---|---|
| `Eye/dart-finance.js` | طبقة البيانات المالية المحلية القابلة للاستبدال بـ API، الفلتر الموحد، حساب P&L وCash Flow وCOD وربحية الموديلات، الشارتات، الأهداف، التسويق والتنبيهات، وتحكم أهلية سحب Dart Card مع سجل تدقيق |
| `Eye/dart-finance.css` | تصميم هادئ ومتجاوب لقسم Finance والشارتات والنماذج والجداول بدون تغيير مكونات Brand المحمية |
| `Eye/Dart Eye.html` | الهيكل الثابت لـFinance وفلتر الفترة وBusiness Insights ونماذج التحرير، وكل عنصر جديد مرتبط بـID واضح؛ لا توجد أي إضافة في صفحات الموقع العام |
| `Eye/dart.js` | شرط واحد في اختيار فائز Dart Card لاستبعاد العميل الذي عطّل الأدمن أهليته |
| `tests/dart-finance-unit.js` | اختبارات الحسابات: الإيراد والمرتجع وCOGS والمصروفات وCash Flow وCOD والأهداف والميزانية وربحية الموديل |
| `tests/finance-dashboard-contract.js` | فحص تحميل Finance وبقاء الشارت والـBirthday والـLatest Updates والـTop Clients دون استبدال |
| `Js/dart-returns.js` | قواعد صافي سعر القطعة بعد خصم الأوردر، وسلسلة مرات الاستبدال، ورسوم المندوب، وتحويل الحالات الداخلية إلى 3 حالات عامة |
| `sections/form-return.html` | نموذج الاستبدال/الاسترجاع وعنوان الاستلام الجديد والخريطة واللون/المقاس البديل؛ الهيكل ثابت في HTML |
| `rep.html` + `Js/dart-rep.js` | كروت استلام المرتجعات للمندوب وبدء/فشل/إتمام الاستلام وتطبيق الاسترجاع أو الاستبدال على القطع والطلب |
| `track.html` + `Js/dart-tracking.js` | كرت تتبع المرتجع بثلاث مراحل، سبب الرفض، المندوب والخريطة الحية |
| `Eye/dart-settings.js` | تحكم قسم Settings والتأكيد المتعدد ومسح مفاتيح Dart وصور الكتالوج فقط، مع حد Backend واضح للمسح الإداري لاحقًا |
| `Eye/dart-settings.css` | تصميم Settings ومنطقة الخطر ونافذة التحذير المتجاوبة |
| `tests/settings-reset-unit.js` | اختبار نطاق المسح ومنع حذف أي بيانات غير تابعة لـDart وفحص وجود عناصر Settings الثابتة |

البيانات المالية تبدأ كمصفوفات فارغة ولا يوجد seed تجريبي. `FinanceRepository` هو الحد الفاصل الذي يستبدله مطور الـBackend بطبقة HTTP، بينما تظل الحسابات النهائية والصلاحيات والتدقيق مسؤولية الخادم حسب `API_CONTRACT.md`.


## Waiting / Restock Reservation

| File | Responsibility |
| --- | --- |
| `backend/migrations/0030_waitlist_reservations.sql` | Waiting schema, FIFO indexes, staff permissions, automatic stock matching and reservation transition trigger |
| `backend/migrations/0031_waitlist_cart_consistency.sql` | Confirmed-Waiting/cart consistency when a customer rebuilds, clears or lets the normal cart expire |
| `backend/src/modules/waiting/waiting.service.ts` | Customer Waiting lifecycle, admin Actions, Demand analytics, audit, exact/alternative allocation and reassignment |
| `backend/src/modules/waiting/waiting.routes.ts` | Customer/admin Waiting HTTP API and granular permission gates |
| `Js/dart-storefront.js` + `Js/dart-ui.js` | Select unavailable variants and join Waiting from the product modal |
| `Js/dart-platform.js` + `profile.html` | My Waiting, queue status, confirm/decline/cancel and customer notification refresh |
| `Eye/dart-waiting.js` + `Eye/Dart Eye.html` | Waiting Queue, Demand, search/filters, row Actions and permission-aware admin controls |
| `Eye/dart-settings.js` | Waiting enable switch, reservation duration and notification/alternative-color settings |


## Live Operations Map

- `Eye/Dart Eye.html`: fixed Live Operations section, four KPI cards, filters, sidebar and map/panel containers.
- `Eye/dart-live-operations.css`: responsive Dart Eye live-map layout, state markers and mobile bottom-panel behavior.
- `Eye/dart-live-operations.js`: 3-second snapshot polling, Leaflet markers/routes, filters, suggested route controls and audited owner actions.
- `Js/dart-rep.js`: representative GPS upload every 3 seconds, Start/Delivered/Waiting/Problem route actions and suggested sequence display.
- `backend/migrations/0032_live_operations.sql`: route-stop persistence, one-current-stop constraint and live-map permissions.
- `backend/src/modules/commerce/commerce.service.ts`: authoritative live snapshot, route-state transitions, nearest-neighbor route suggestion and route ordering.
- `backend/src/modules/commerce/commerce.routes.ts`: protected admin live-map endpoints and representative action/location contracts.
- `backend/tests/live-operations.contract.test.ts`: core migration, permission, state, rate-limit and audit contracts.
